import * as moment from 'moment';
import * as common from './common';
import logger from './logger';

export const config = {  // NB: exported variables are constants => Need a container ; cf. https://github.com/Microsoft/TypeScript/issues/6751
		hostName		: <string|null>null,  // REQUIRED !
		bosunWriteUrl	: 'http://<<HOSTNAME>>/api/put',
		useSudo			: false,
		sendBatchSize	: 100,
		sendRetryNumber	: 3,
		sendRetryDelay	: 3000,  // In milliseconds
	};
export const metricContainerSize = 'container_size';
export const metricSubvolumeSize = 'subvolume_size';

export interface Item
{
	metric		: string,
	timestamp	: number,
	value		: number,
	tags		: {	host			: string,
					[key:string]	: string }
}

export function createTimeStamp() : number
{
	return Math.floor( (new Date()).getTime() / 1000 );
}
export function createTimeStampFromTag(tag?:string) : number
{
	if( tag == null )
		tag = common.TAG;
	const date = moment( tag, common.tagFormat ).toDate();
	return Math.floor( date.getTime() / 1000 );
}

export function createItem(p:{timestamp?:number, metric:string, value:number}) : Item
{
	if( config.hostName == null )
		throw "Bosun: variable 'hostName' is not set";

	let timestamp = p.timestamp;
	if( timestamp == null )
		timestamp = createTimeStamp();

	const item : Item = {	metric		: p.metric,
							timestamp	: timestamp,
							value		: p.value,
							tags		: { host:config.hostName } };
	return item;
}

export async function send(log:logger, values:Item[]) : Promise<void>
{
	log.log( `Create batches of ${config.sendBatchSize} items ; ${values.length} items to send` );
	const batches : Item[][] = [];
	for( let i=0; i<values.length; i+=config.sendBatchSize )
		batches.push( values.slice(i, i+config.sendBatchSize) );

	for( let i=0; i<batches.length; ++i )
	{
		const batch = batches[ i ];
		const log2 = log.child( `batch_${i+1}` );
		log2.log( `Batch size: ${batch.length}` );

		let retry = 0;
	RETRY:
		while( true )
		{
			try
			{
				await send_private({ log: log2, items: batch });
			}
			catch( ex )
			{
				log2.exception( ex );
				if( (++retry) < config.sendRetryNumber )
				{
					log2.log( `Sent failed. Pause ${config.sendRetryDelay} miliseconds` );
					await common.sleep( config.sendRetryDelay );
					log2.log( `Try ${retry+1}/${config.sendRetryNumber}` );
					continue RETRY;
				}
				else
				{
					log2.log( `Try ${retry}/${config.sendRetryNumber} failed ; Aborting` );
					throw ex;
				}
			}

			// Sent OK
			break RETRY;
		} // while(true)
	} // for(batches)
}

async function send_private({ log, items }: { log: logger, items: Item[] }): Promise<void> {
	const url = config.bosunWriteUrl ?? common.throwError("Bosun: config 'bosunWriteUrl' is not set");

	const body = JSON.stringify(items);
	log.log(`Send:\n${body}`);

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': `${Buffer.byteLength(body)}`
		},
		body,
	});
	log.log('Response status code', response.status, response.statusText);
	if (!response.ok) {
		log.log('Response text: ', await response.text());
		common.throwError(`Bosun response ${response.status}: ${response.statusText}`, log);
	}
}
