
import * as process from 'process';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import * as glob from 'glob';
import * as http from 'http';
import * as https from 'https';
import * as moment from 'moment';
import * as JSON5 from 'json5';
import Log from './logger';

export var NOW : moment.Moment;
export var TAG : string;
export var hasErrors : boolean = false;
export const tagFormat =  'YYYYMMDD_HHmm';
export const tagPattern = '????????_????';
export const tagPatternRegex = '[0-9]{8}_[0-9]{4}';

export function init(p:{log:Log, tag?:string}) : void
{
	TAG =  ( (p.tag != null) ? p.tag : moment(new Date()).format(tagFormat) );
	NOW = moment( TAG, tagFormat );  // NB: 'NOW' is trimmed of the 'seconds' part
	p.log.log( 'TAG:', TAG, NOW.toISOString() );

	let exitHandler = function(options,err)
		{
			p.log.output();
			switch( options.mode )
			{
				case "on exit":
					if( hasErrors )
						process.exit( -1 );
					return;
				case "on uncaughtException":
					console.log( '*** uncaughtException', err );
					process.exit( -1 );
				default:
					console.log( '*** Unknown exit mode', options, err );
					process.exit( -1 );
			}
		};
	process.on( 'exit', exitHandler.bind(null, {mode:'on exit'}) );
	process.on( 'uncaughtException', exitHandler.bind(null,{mode:'on uncaughtException'}) );

	if( typeof(window) === 'undefined' )
	{
		p.log.log( 'In NodeJS application => set up a fake DOM/JQuery/Knockout environment' );
		// https://stackoverflow.com/questions/1801160/can-i-use-jquery-with-node-js
		const jsdom = require( 'jsdom' );
		const jquery = require( 'jquery' );
		const knockout = require( 'knockout' );
		const dom = new jsdom.JSDOM( '<html><body></body></html>' );

		(<any>global).window = dom.window;
		(<any>global).document = dom.window.document;
		(<any>global).$ = jquery( window );
		(<any>global).ko = knockout;
	}
}

export function setHasErrors() : void
{
	hasErrors = true;
}

export function sleep(ms:number) : Promise<void>
{
	return new Promise( callback=>setTimeout(callback, ms) );
}

export function run(p:{ log:Log, command:string, logstds?:boolean, stdin?:string, [key:string]:any }) : Promise<{stdout:string,stderr:string}>
{
	p.log.log( 'Create command' );
	let command = p.command;
	Object.keys(p).forEach( function(key)
		{
			switch( key )
			{
				case 'log':
				case 'command':
				case 'logstds':
				case 'stdin':
					// Regular parameter
					return;
			}
			// Command's parameter
			command = command.replace( '{'+key+'}', p[key] );
		});

	function logStds(stdout:string, stderr:string) : void
	{
		p.log.child( 'stdout' ).logLines( stdout );
		p.log.child( 'stderr' ).logLines( stderr );
	}

	return new Promise<{stdout:string,stderr:string}>( function(resolve, reject)
		{
			p.log.log( 'launch:', command );
			const ps = exec( command, function(err, stdout, stderr)
				{
					if( err != null )
					{
						logStds( stdout, stderr );
						reject( err );  // i.e. promise's 'throw'
						return;
					}

					if( (p.logstds == null) || (p.logstds == true) )
						logStds( stdout, stderr );
					p.log.log( 'exited' );
					resolve({ stdout:stdout, stderr:stderr });
				} );
			if( p.stdin != null )
			{
				p.log.log( `Write '${p.stdin.length}' characters to stdin` );
				const rc = ps.stdin.write( p.stdin );
				ps.stdin.end();
				p.log.log( `Write rc='${rc}'` );
			}
		} );
}

export function ls(path:string) : Promise<string[]>
{
	return new Promise<string[]>( (resolve,reject)=>
		{
			fs.readdir( path, (err,items)=>
				{
					if( err != null )
						reject( err );
					else
						resolve( items );
				} );
		} );
}

export async function dirPattern(p:{ log:Log, dir:string, pattern:string, remoteServer?:string }) : Promise<string[]>
{
	if( p.remoteServer == null )
	{
		// Simple local search
		p.log.log( 'Local search:', path.join(p.dir, p.pattern) );
		return new Promise<string[]>( (resolve, reject)=>
			{
				glob.Glob( p.pattern, { cwd:p.dir }, (err,files)=>
					{
						if( err != null )
						{
							p.log.log( 'Error:', err );
							reject( err );
						}
						else
						{
							// p.log.log( 'Found:', files );
							p.log.log( 'Found', files.length, 'entries' );
							resolve( files );
						}
					} );
			} );
	}
	else
	{
		// Use SSH
		p.log.log( 'Remote search:', path.join(p.dir, p.pattern), 'on server', p.remoteServer );

		try
		{
			const dirPattern = path.join( p.dir, p.pattern );
			const {stdout,stderr} = await run({ log:p.log, logstds:false, command:'ssh "{HOSTNAME}" ls -d "{DIR_PATTERN}"', 'HOSTNAME':p.remoteServer, 'DIR_PATTERN':dirPattern });
			const list = stdout.split( '\n' );
			return list.map( str=>path.basename(str) ).filter( str=> (str != null) && (str.length > 0) );
		}
		catch
		{
			// e.g. no such file or directory ...
			return [];
		}
	}
}

type DirNameOrPath = { path :string,	dir?:never,	name?:never }
					| { path?:never,	dir :string,name :string };
export function stat(p:DirNameOrPath) : Promise<fs.Stats>
{
	const path_ = (p.path != null) ? p.path : path.join( p.dir, p.name );
	return new Promise<fs.Stats>( (resolve,reject)=>
		{
			fs.stat( path_, (err, stats)=>
				{
					if( err )
						reject( err );
					else
						resolve( stats );
				} )
		} );
}

export function exists(p:DirNameOrPath) : Promise<boolean>
{
	const path_ = (p.path != null) ? p.path : path.join( p.dir, p.name );
	return new Promise<boolean>( (resolve)=>
		{
			fs.stat( path_, (err, stats)=>
				{
					resolve( (err == null) ? true : false );
				} )
		} );
}

export function mv(p:{ srcPath:string, dstPath:string }) : Promise<void>
{
	return new Promise<void>( (resolve,reject)=>
		{
			fs.rename( p.srcPath, p.dstPath, (err)=>
				{
					(err == null) ? resolve() : reject(err);
				} );
		} );
}

export function mkdir(p:DirNameOrPath) : Promise<void>
{
	const path_ = (p.path != null) ? p.path : path.join( p.dir, p.name );
	return new Promise<void>( (resolve,reject)=>
		{
			fs.mkdir( path_, (err)=>
				{
					(err == null) ? resolve() : reject(err);
				} );
		} )
}

export function rm(p:DirNameOrPath) : Promise<void>
{
	const path_ = (p.path != null) ? p.path : path.join( p.dir, p.name );
	return new Promise<void>( (resolve,reject)=>
		{
			fs.unlink( path_, (err)=>
				{
					if( err != null )
						reject( err );
					else
						resolve();
				} );
		} );
}

export function rmdir(p:DirNameOrPath) : Promise<void>
{
	const path_ = (p.path != null) ? p.path : path.join( p.dir, p.name );
	return new Promise<void>( (resolve,reject)=>
		{
			fs.rmdir( path_, (err)=>
				{
					(err == null) ? resolve() : reject(err);
				} );
		} );
}

export async function rmrf(p:DirNameOrPath) : Promise<void>
{
	const path_ = (p.path != null) ? p.path : path.join( p.dir, p.name );
	const stat_ = await stat( p );
	if( stat_.isDirectory() )
	{
		// Directory
		const items = await ls( path_ );
		for( let i=0; i<items.length; ++i )
		{
			// Recurse
			const item = items[ i ];
			await rmrf({ dir:path_, name:item });
		}

		// This one
		await rmdir( p );
	}
	else
	{
		// File
		await rm( p );
	}
}

export async function readFile(p:{ filePath:string }) : Promise<string>
{
	return new Promise<string>( (resolve,reject)=>
		{
			fs.readFile( p.filePath, 'utf8', (err,content)=>
			{
				if( err )
					reject( err );
				else
					resolve( content );
			} );
		} );
}

export async function writeFile(p:{ filePath:string, stringContent:string }) : Promise<void>
{
	return new Promise<void>( (resolve,reject)=>
		{
			fs.writeFile( p.filePath, p.stringContent, (err)=>
			{
				if( err )
					reject( err );
				else
					resolve();
			} );
		} );
}

/** https://json5.org/ */
export async function readJSON<T>(p:{ filePath?:string, jsonText?:string }) : Promise<T>
{
	let jsonText = p.jsonText;

	if( p.filePath != null )
		jsonText = await readFile({ filePath:p.filePath });

	if( jsonText == null )
		throw `'readJSON()': Missing JSON source`;

	return JSON5.parse( jsonText );
}

export async function writeJSON(p:{ filePath:string, content:any }) : Promise<void>
{
	const json = JSON.stringify( p.content, null, '\t' );
	await writeFile({ filePath:p.filePath, stringContent:json });
}

/** https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string */
export function humanFileSize(bytes?:number, si?:boolean) : string|null
{
	if( bytes == null )
		return null;
	if( si == null )
		si = false;
	const thresh = si ? 1000 : 1024;
	if( Math.abs(bytes) < thresh )
		return bytes + ' B';

	const units = si
		? ['kB','MB','GB','TB','PB','EB','ZB','YB']
		: ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
	let u = -1;
	do
	{
		bytes /= thresh;
		++u;
	} while( Math.abs(bytes) >= thresh && u < units.length - 1 );
	return bytes.toFixed(1)+' '+units[u];
}

export async function readFileLines(filePath:string) : Promise<string[]>
{
	const buffer = await fs.promises.readFile( filePath );
	const txt = buffer.toString();
	const lines = txt.match( /[^\r\n]+/g ) ?? [];
	return lines;
}

export function isNullOrWhiteSpace(str?:string) : boolean
{
	if( str == null )
		return true;
	if( str.length == 0 )
		return true;
	if( str.trim() == '' )
		return true;
	return false;
}

export async function forEach<T>(t:T[], callback:(item:T,i:number)=>Promise<void>) : Promise<void>
{
	for( let i=0; i<t.length; ++i )
		await callback( t[i], i );
}

export function arraySum<T>(a:T[], f:(e:T)=>number) : number
{
	let rc = 0;
	a.forEach( function(e)
		{
			rc += f(e);
		} );
	return rc;
}

export function arrayToDictionary<T>(a:T[], keyCast:(v:T)=>string) : {[key:string]:T}
{
	const dict : {[key:string]:T} = {};
	a.forEach( v=>
		{
			dict[ keyCast(v) ] = v
		} );
	return dict;
}

/** Split the specified array into multiple arrays according to a grouping key */
export function arrayToListOfArrays<T>(a:T[], groupingKeyCast:(v:T)=>string) : T[][]
{
	// Group items into an object "key->T[]"
	const grouped = a.reduce<{[key:string]:T[]}>( (accu,current)=>
	{
		const key = groupingKeyCast( current );
		let list = accu[ key ];
		if( list == null )
		{
			list = [];
			accu[ key ] = list;
		}
		list.push( current );
		return accu;
	}, {} );

	// From the object, create arrays
	const list : T[][] = [];
	for( let key in grouped )
		list.push( grouped[key] );

	return list;
}

/** Throttles the concurrent execution of Promises (e.g. the reduce the number of concurrent requests to a server) */
export class TasksThrotther
{
	private readonly	limit		: number;
	private				runnings	: number = 0;
	private				throttled	: (()=>void)[] = [];

	constructor(limit:number)
	{
		this.limit = limit;
	}

	/** nb: all the magic is here... */
	public async do<T>(callback:()=>Promise<T>) : Promise<T>
	{
		const self = this;

		++ self.runnings;

		if( self.runnings <= self.limit )
		{
			// Execute immediately
			const rc = await callback();
			self.checkNext();
			return rc;
		}

		// Push a promise in 'throttled' & wait for it
		const waitFor = new Promise<void>( (resolve)=>
			{
				self.throttled.push( resolve );
			} );
		await waitFor;

		// Now we can execute
		const rc = await callback();
		self.checkNext();
		return rc;
	}

	private checkNext() : void
	{
		const self = this;

		-- self.runnings;
		const next = self.throttled.shift();
		if( next != null )
			next();
	}
}

export namespace url
{
	/** Transform a dictionary like {foo:'bar',hello:'world'} to a parameters string like 'foo=bar&hello=world' */
	export function stringifyParameters(parms:{[key:string]:any}) : string
	{
		var pairs = <string[]>[];
		Object.keys(parms).forEach( function(key)
			{
				let value = parms[ key ];
				key = encodeURIComponent( key );

				if( (value == null) || (typeof(value) === 'string') || (typeof(value) === 'number') || (typeof(value) === 'boolean') )
					{/*Keep as-is*/}
				else
					// Convert to JSON
					value = JSON.stringify( value );
				value = encodeURIComponent( value );

				pairs.push( key+"="+value );
			} );
		return pairs.join( '&' );
	}

	export function getRequest(url:string, request?:{[key:string]:any}) : Promise<string>
	{
		if( request != null )
		{
			const parms = stringifyParameters( request );
			url = `${url}?${parms}`;
		}

		const ht = url.startsWith('https:') ? https : http;
		let data = '';
		return new Promise<string>( (resolve,reject)=>
			{
				ht.get( url, (resp)=>
						{
							resp.on( 'data', (chunk)=>
								{
									data += chunk;
								} );
							resp.on( 'end', ()=>
								{
									if( resp.statusCode != 200 ) // HTTP OK
										reject( `Request failed with status code ${resp.statusCode}` );
									else
										resolve( data );
								} );
						} )
					.on( 'error', (err)=>
						{
							reject( err );
						} );
			} );
	}

	// nb: ES5 incompatible ; requires "Promise" library
	export function postRequest<T>(url:string, request:{[key:string]:any}) : Promise<T>
	{
		let requestStr = JSON.stringify( request );
		return new Promise<T>( (resolve,reject)=>
			{
				$.ajax({	type		: 'POST',
							url			: url,
							contentType	: 'application/json',
							data		: requestStr,
							dataType	: 'json',
							success		: (data,textStatus,jqXHR)=>resolve( data ),
							error		: (jqXHR,textStatus,errorThrown)=>
											{
												reject( textStatus );
											}
						});
			} );
	}
}

export namespace html
{
	/** TODO ! */
	export function showError(message:string) : void
	{
		console.error( message );
	}

	/** TODO ! */
	export function showMessage(message:string) : void
	{
		alert( message );
	}

	/** Invoke jQuery.blockUI's '.block()' on the specified element but supports multiple invokation on the same element */
	export function block($e:JQuery) : JQuery
	{
		// Insert/increment a block counter as jQuery 'data()'
		var blockCounter = ( $e.data('common_blockCounter')|0 ) + 1;
		$e.data( 'common_blockCounter', blockCounter );

		if( blockCounter == 1 )
			// This element is not blocked yet
			(<any>$e).block();  // TODO: ACA: jQuery.blockUI typings ...

		return $e;
	}

	/** Invoke jQuery.blockUI's '.unblock()' on the specified element except if it has been block()ed more than once */
	export function unblock($e:JQuery) : JQuery
	{
		// Decrement the block counter in the jQuery 'data()'
		var blockCounter = ( $e.data('common_blockCounter')|0 ) - 1;
		$e.data( 'common_blockCounter', blockCounter );

		if( blockCounter < 0 )
		{
			// There is a logic error somewhere...
			showError( 'INTERNAL ERROR: Unblock count > block count: '+blockCounter );

			// Reset counter
			blockCounter = 0;
			$e.data( 'common_blockCounter', 0 );
		}

		if( blockCounter == 0 )
			// This element is no more blocked by anything else
			(<any>$e).unblock();  // TODO: ACA: jQuery.blockUI typings ...

		return $e;
	}

	export function contextMenu($triggerControl:JQuery, items:{label:string,callback:()=>void}[]) : void
	{
		$triggerControl.contextmenu( ()=>
			{
				let clickHandler	: (evt:any)=>void = <any>null;
				let closeMe			: ()=>void = <any>null;

				const $popup = $('<div style="z-index:999;position:absolute;padding:1px;background-color:white;border:1px solid black"></div>');
				items.forEach( item=>
					{
						var $item = $('<div style="cursor:pointer;white-space:nowrap"/>')
								.text( item.label )
								.click( ()=>
									{
										closeMe();
										item.callback();
									} );
						$popup.append( $item );
					} );
				$popup.insertAfter( $triggerControl );

				closeMe = ()=>
					{
						$popup.remove();

						// Deactivate global click handler
						$(document).unbind( 'mouseup', clickHandler );
					};
				clickHandler = function(evt)
					{
						if(	(! $popup.is(evt.target))
						&&	($popup.has(evt.target).length == 0) )
						{
							// Click not inside the popup

							if(	($triggerControl.is(evt.target))
							||	($triggerControl.has(evt.target).length != 0) )
								// Click inside the triggering button => Discard
								return;

							closeMe();
						}
					};

				// Activate global click handler
				$(document).mouseup( clickHandler );
			} );
	}

	export class DropDownDiv
	{
		public readonly	$triggerControl	: JQuery;
		public readonly	$content		: JQuery;
		private			shown			: boolean;
		public readonly	$popup			: JQuery;

		public show	: ()=>void;
		public hide	: ()=>void;

		constructor(p:{	$triggerControl	: JQuery,
						$content		: JQuery,
						popupTemplate?	: string,
					})
		{
			var self = this;
			this.$triggerControl	= p.$triggerControl;
			this.$content			= p.$content;
			var popupTemplate		= (p.popupTemplate != null) ? p.popupTemplate : '<div style="z-index:999;position:absolute;display:none;padding:1px"></div>';
			self.shown				= false;
			this.$popup				= $(popupTemplate)
											.append( self.$content )
											.insertAfter( self.$triggerControl );

			var clickHandler = function(evt:any)
				{
					if(	(! self.$popup.is(evt.target))
					&&	(self.$popup.has(evt.target).length == 0) )
					{
						// Click not inside the popup

						if(	(self.$triggerControl.is(evt.target))
						||	(self.$triggerControl.has(evt.target).length != 0) )
							// Click inside the triggering button => Discard
							return;

						self.hide();
					}
				};

		self.show = function()
			{
				if( self.shown )
					// Already shown
					return;
				self.$popup.slideDown('fast');

				// Active click handler on the whole document
				$(document).mouseup( clickHandler );

				self.shown = true;
			};

		self.hide = function()
			{
				if(! self.shown )
					// Already hidden
					return;
				self.$popup.slideUp('fast');

				// Deactivate global click handler
				$(document).unbind( 'mouseup', clickHandler );

				self.shown = false;
			};

		self.$triggerControl.on('click', function()
			{
				if( self.shown )
					self.hide();
				else
					self.show();
			} );
		self.$triggerControl.on('keyup',  function(evt:any)
			{
				if( evt.keyCode == 27 )  // ESC key pressed
					self.hide();
				else if( evt.keyCode == 40 )  // DOWN key pressed
					self.show();
			} );
		}
	}
}

export namespace events
{
	export interface EventsHandler
	{
		bind	: (name:string, callback:(evt?:any,p?:any)=>void)=>EventsHandler;
		unbind	: (name:string, callback?:(evt?:any,p?:any)=>void)=>EventsHandler;
		trigger	: (name:string, p?:any)=>EventsHandler;
	}

	export function createEventHandler() : EventsHandler
	{
		return $({});
	}

	/** Creates an 'onXXX()' function for event binding */
	export function eventBind<Self,T>(eventName:string, events:EventsHandler, self:Self) : (callback:(p:T)=>void, p?:{executeOnce?:boolean})=>Self
	{
		return function(callback:(p:T)=>void, pp?:{executeOnce?:boolean}) : Self
		{
			var handler : (evt:any,p:T)=>void;
			handler = function(evt:any,p:T)
				{
					if( pp?.executeOnce == true )
						// Unregister myself
						events.unbind( eventName, handler );

					try { callback( p ); }
					catch( ex ) { console.error( 'Unexpected error:', ex ); }
				};
			events.bind( eventName, handler );
			return self;
		};
	}
	/** Creates a 'triggerXXX()' function for event triggering */
	export function eventTrigger<T>(eventName:string, events:EventsHandler) : (p:T)=>void
	{
		return function(p) : void
			{
				events.trigger( eventName, p );
			};
	}
} // namespace events
