import * as moment from 'moment';
import * as common from './common';
import logger from './logger';

export const config = {  // NB: exported variables are constants => need a container ; cf. https://github.com/Microsoft/TypeScript/issues/6751
	influxWriteUrl: 'http://<<<HOSTNAME>>>/api/v2/write?precision=s&orgID=<<ORGANIZATION ID>>&bucket=<<BUCKET NAME>>',
	influxToken: '<<API TOKEN>>',
	hostName: <string | null>null,  // REQUIRED !
	sendBatchSize: 10,
	sendRetryNumber: 3,
	sendRetryDelay: 3000,  // In milliseconds
}

export const metrics = {
	subvolume: {
		_: 'subvolume',
		// tags:
		isContainer: 'is_container',
		isFullBackup: 'is_full',
		// values:
		size: 'size',
		backupSize: 'backup_size',
		backupSizeCumulated: 'backup_size_cumulated',
	},
};

export type Item = {
	metric: string,
	timestamp: number,
	tags: { [key: string]: string },
	values: { [key: string]: number },
}

export function createTimeStamp(dt?: Date): number {
	return Math.floor((dt ?? new Date()).getTime() / 1000);
}
export function createTimeStampFromTag(tag: string = common.TAG): number {
	const date = moment(tag, common.tagFormat).toDate();
	return Math.floor(date.getTime() / 1000);
}

export function createItem(p: {
	timestamp?: number,
	metric: string,
	tags?: Item['tags'],
} & (
		{ value: number } |
		{ values: { [key: string]: number } }
	)
): Item {
	const { timestamp = createTimeStamp(), metric, tags = {} } = p;
	return {
		metric,
		timestamp,
		tags,
		values: ('value' in p) ? { value: p.value } : p.values,
	};
}

export async function send({ log, items }: { log: logger, items: Item[] }): Promise<void> {
	log.log(`Create batches of ${config.sendBatchSize} items ; ${items.length} items to send`);
	const batches: Item[][] = [];
	for (let i = 0; i < items.length; i += config.sendBatchSize)
		batches.push(items.slice(i, i + config.sendBatchSize));

	for (let i = 0; i < batches.length; ++i) {
		const batch = batches[i];
		const log2 = log.child(`batch_${i + 1}`);
		log2.log(`Batch size: ${batch.length}`);

		let retry = 0;
		RETRY:
		while (true) {
			try {
				await send_private({ log: log2, items: batch });
			}
			catch (ex) {
				log2.exception(ex);
				if ((++retry) < config.sendRetryNumber) {
					log2.log(`Sent failed. Pause ${config.sendRetryDelay} miliseconds`);
					await common.sleep(config.sendRetryDelay);
					log2.log(`Try ${retry + 1}/${config.sendRetryNumber}`);
					continue RETRY;
				}
				else {
					log2.log(`Try ${retry}/${config.sendRetryNumber} failed ; Aborting`);
					throw ex;
				}
			}

			// Sent OK
			break RETRY;
		} // while(true)
	} // for(batches)
}

async function send_private({ log, items }: { log: logger, items: Item[] }): Promise<void> {
	const url = config.influxWriteUrl ?? common.throwError("InfluxDB: config 'influxWriteUrl' is not set");
	const token = config.influxToken ?? common.throwError("InfluxDB: config 'influxToken' is not set");
	const hostName = config.hostName ?? common.throwError("InfluxDB: config 'hostName' is not set");

	const body = items.map((item) => {
		const tags = { ...item.tags, host: hostName };
		const strTags = Object.entries(tags).map(([key, value]) => `${key}=${value}`);
		const strValues = Object.entries(item.values).map(([key, value]) => `${key}=${value}`);
		return `${item.metric},${strTags} ${strValues} ${item.timestamp}`;
	}).join('\n');
	log.log(`Send:\n${body}`);

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Authorization': `Token ${token}` },
		body,
	});
	log.log('Response status code', response.status, response.statusText);
	if (!response.ok) {
		log.log('Response text: ', await response.text());
		common.throwError(`InfluxDB response ${response.status}: ${response.statusText}`, log);
	}
}
