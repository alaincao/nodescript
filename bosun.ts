
import * as http from 'http';
import * as https from 'https';
import * as moment from 'moment';
import * as common from './common';
import logger from './logger';

export const config = {  // NB: exported variables are constants => Need a container ; cf. https://github.com/Microsoft/TypeScript/issues/6751
		hostName		: <string|null>null,  // REQUIRED !
		bosunHost		: 'UNSET',  // REQUIRED !
		bosunHostInSSL	: false,
		useSudo			: false,
		sendBatchSize	: 10,
		sendRetryNumber	: 3,
		sendRetryDelay	: 3000,  // In milliseconds
	};

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
									port: config.bosunHostInSSL ? 443 : 80,
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
				await send_private( log2, batch );
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

function send_private(log:logger, values:Item[]) : Promise<void>
{
	const requestContent = JSON.stringify( values );
	log.log( 'Send: ', requestContent );

	return new Promise<void>( (resolve, reject)=>
		{
			const ht = config.bosunHostInSSL ? https : http;
			const request = ht.request( {	host: config.bosunHost,
											port: config.bosunHostInSSL ? 443 : 80,
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
