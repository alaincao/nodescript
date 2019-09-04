
import * as http from 'http';
import * as https from 'https';
import { hostname } from 'os';
import * as moment from 'moment';
import * as common from './common';
import logger from './logger';

export const config = {  // NB: exported variables are constants => Need a container ; cf. https://github.com/Microsoft/TypeScript/issues/6751
		hostName		: <string>null,  // REQUIRED !
		bosunHost		: 'bosun.sigmaconso.com',
		bosunHostInSSL	: true,
		useSudo			: false,
	};
export const metricContainer = 'Sigma.Docker.ContainerSize';
export const metricSubvolume = 'Sigma.SubvolumeSize';
// export const metricBackup = 'Sigma.BackupSize';
export const metricResponseTime = 'Sigma.Http.ResponseTime';

const dirSizeCommand = "du --block-size=1 --summarize '{DIR}' | sed -e 's/\t.*//g'";

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

export function send_legacy(p:{values:Item[]}) : void
{
	const requestContent = JSON.stringify( p.values );
	const ht = config.bosunHostInSSL ? https : http;
	const request = ht.request( {	host: config.bosunHost,
									port: 80,
									path: '/api/put',
									method: 'POST',
									headers: {	'Content-Type': 'application/x-www-form-urlencoded',
												'Content-Length': Buffer.byteLength(requestContent) } },
								function(response)
								{
									console.log( 'request: '+requestContent );
									console.log( 'response ('+response.statusCode+'): '+response.statusMessage );

									if( response.statusCode != 204 )
										// Error
										throw new Error( 'Response status code '+response.statusCode );
								} );
	request.write( requestContent );
	request.end();
}

export async function send(log:logger, values:Item[]) : Promise<void>
{
	const requestContent = JSON.stringify( values );
	log.log( 'Send: ', requestContent );

	return new Promise<void>( (resolve, reject)=>
		{
			const ht = config.bosunHostInSSL ? https : http;
			const request = ht.request( {	host: config.bosunHost,
											port: 443,
											path: '/api/put',
											method: 'POST',
											headers: {	'Content-Type': 'application/x-www-form-urlencoded',
														'Content-Length': Buffer.byteLength(requestContent) } },
										function(response)
										{
											log.log( 'Response status code', response.statusCode, response.statusMessage );

											if( response.statusCode != 204 )
												// Error
												reject( 'Response status code '+response.statusCode );
											else
												resolve();
										} );
			request.write( requestContent );
			request.end();
		} );
}

export async function sendDirSize(p:{ log:logger, metric:string, name:string, dir:string, timestamp?:number }) : Promise<void>
{
	const {stdout} = await common.run({ log:p.log.child('run'), command:(config.useSudo?'sudo ':'')+dirSizeCommand, 'DIR':p.dir });
	p.log.log( 'Parse size' );
	const size = parseInt( stdout );

	const item = createItem({ timestamp:p.timestamp, metric:p.metric, value:size });
	item.tags['name'] = p.name;
	await send( p.log, [item] );
}
