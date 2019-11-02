
import * as path from 'path';
import * as url from 'url';
import * as moment from 'moment';
import * as electron from 'electron';
import * as common from './common';
import * as Self from './testGui';
import Log from './logger';

export { humanFileSize } from './common';
// nb: below are there only for use in the console:
exports.require = require;
exports.common = common;

export var config : {
						helloWho	: string,
					};
export var $blockingDiv : JQuery;
export var log : Log;
export var koHelloWho	: KnockoutObservable<string>;

export async function main(p:{
							$blockingDiv	: JQuery,
							$appContainer	: JQuery,
						}) : Promise<void>
{
	self = this;
	log = new Log( 'gui', /*parent*/null, /*onLineAdded*/(name,date,args)=>
		{
			const a = args.slice();
			a.unshift( `${moment(date).format('HH:mm:ss.SSS')} ${name}:` );
			console.log.apply( console, a );
		} );
	log.log( 'START' );
	common.init({ log });
	$blockingDiv	= p.$blockingDiv;
	koHelloWho		= ko.observable( null );

	const configFileName = path.basename( __filename ).replace( /\.html$/, '.json' );
	const configFilePath = path.join( __dirname, configFileName );
	log.log( `Load config at '${configFilePath}'` );
	config = await common.readJSON({ filePath:configFilePath });

	ko.applyBindings( self, p.$appContainer[0] );
	log.log( 'END' );
}

export async function clickHelloWho() : Promise<void>
{
	const log = Self.log.child( 'clickHelloWho' );
	log.log( 'START' );
	common.html.block( $blockingDiv );
	try
	{
		log.log({ CWD:process.cwd() });
		koHelloWho( `${config.helloWho} !` );
	}
	catch( ex )
	{
		log.exception( ex );
	}
	finally
	{
		common.html.unblock( $blockingDiv );
		log.log( 'END' );
	}
}





// Entry points
if( electron.app == null )
{
	// Within HTML => Register this module as 'application'
	(<any>window)['application'] = this;
}
else
{
	// Within Electron CLI => Open window
	electron.app.once( 'ready', ()=>
		{
			log = new Log( 'electron', /*parent*/null, /*onLineAdded*/(name,date,args)=>
				{
					const a = args.slice();
					a.unshift( name+':' );
					console.log.apply( console, a );
				} );

			// Create a new window
			const window = new electron.BrowserWindow({	width: 1024,
														height: 768,
														titleBarStyle: 'hiddenInset',
													});

			const loadPage = function()
						{
							window.loadURL( url.format({
												pathname: path.join(__dirname, 'testGui.html'),
												protocol: 'file:',
												slashes: true,
											}) );
						};

			const menu = new electron.Menu();
			menu.append( new electron.MenuItem({ label:'show devtools', click:()=>{ window.webContents.openDevTools(); } }) );
			menu.append( new electron.MenuItem({ label:'refresh', click:()=>{ loadPage(); } }) );
			window.setMenu( menu );

			window.webContents.openDevTools();

			loadPage();
		} );
}
