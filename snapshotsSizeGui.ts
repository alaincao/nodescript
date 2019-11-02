
import * as path from 'path';
import * as url from 'url';
import * as electron from 'electron';
import Log from './logger';
import * as common from './common';
import * as btrfs from './btrfs';

export var koDirectory		: KnockoutObservable<string>;
export var koName			: KnockoutObservable<string>;
export var koUseSudo		: KnockoutObservable<boolean>;
export var koReverse		: KnockoutObservable<boolean>;
export var koThrottler		: KnockoutObservable<number>;
export var koSnapshots		: KnockoutObservable<Snapshots>;
export var koHumanReadable	: KnockoutObservable<boolean>;
export var koSelectAll		: KnockoutObservable<boolean>;

export async function main(p:{ $container:JQuery }) : Promise<void>
{
	const self = this;
	await trycatch( 'main', async (log)=>
	{
		common.init({ log:log });

		koDirectory		= ko.observable( '/path/to/snapshots/' );
		koName			= ko.observable( 'bosun' );
		koUseSudo		= ko.observable( true );
		koReverse		= ko.observable( true );
		koThrottler		= ko.observable( 10 );
		koSnapshots		= ko.observable( null );
		koHumanReadable	= ko.observable( true );
		koSelectAll		= ko.observable( true );

		koThrottler.subscribe( (v)=>
			{
				const n = parseInt( <any>v );
				if( n > 0 )
					koThrottler( n );
				else
					koThrottler( 10 );
			} );

		koSelectAll.subscribe( (v)=>
			{
				for( const entry of koSnapshots().entries() )
					entry.checked( v );
			} );

		log.log( 'Apply Knockout bindings' );
		ko.applyBindings( self, p.$container[0] );
	} );
}

class Snapshots
{
	public readonly		entries		: KnockoutObservableArray<{checked:KnockoutObservable<boolean>,entry:btrfs.SnapshotEntry}>;
	public readonly		runs		: KnockoutObservableArray<Run[]>;

	protected readonly	headers		: KnockoutComputed<string[]>;
	protected readonly	footers		: KnockoutComputed<string[]>;
	protected readonly	body		: KnockoutComputed<Cell[][]>;

	constructor(p:{ entries:btrfs.SnapshotEntry[] })
	{
		const self = this;

		this.entries	= ko.observableArray( p.entries.map( entry=>({ checked:ko.observable(true), entry }) ) );
		this.runs		= ko.observableArray( [] );

		this.headers	= ko.computed( ()=>self.getHeaders() );
		this.footers	= ko.computed( ()=>self.getFooters() );
		this.body		= ko.computed( ()=>self.getBody() );
	}

	private getHeaders() : string[]
	{
		const self = this;
		const headers : string[] = [ 'Subvolume' ];
		for( const i in self.runs() )
			headers.push( `${parseInt(i)+1}` );
		return headers;
	}

	private getFooters() : string[]
	{
		const self = this;
		let footers : string[] = [ 'Total ' ];

		const strRuns = self.runs().map( (runsList)=>
			{
				let total = 0;
				for( const run of runsList )
				{
					if( run.running() || (run.size() == null) )
						continue;
					total += run.size();
				}
				return koHumanReadable() ? common.humanFileSize(total) : (''+total);
			} );
		footers = footers.concat( strRuns );

		return footers;
	}

	private getBody() : Cell[][]
	{
		const self = this;

		const names = self.entries().map( v=>v.entry.subvolumeName );

		const columns : Cell[][] = [];

		// Add labels' column
		const labelsColumn = self.entries()
									.map( v=> new Cell({ txt:v.entry.subvolumeName, checked:v.checked }) );
		columns.push( labelsColumn );

		// Add runs' columns
		for( const runsList of self.runs() )
		{
			const runsDict = common.arrayToDictionary( runsList, v=>v.child.subvolumeName );

			const column : Cell[] = [];
			for( let i in names )
			{
				const name = names[ i ];
				const run = runsDict[ name ];
				const cell = ( run == null )
								? new Cell({ txt:'' })
								: new Cell({ koTxt:ko.computed( ()=>
												{
													const size = run.size();
													const strSize = ( size == null )
																		? ''
																		: koHumanReadable()
																			? common.humanFileSize( size )
																			: ''+size;
													return strSize;
												} ), running:run.running });
				column[ i ] = cell;
			}

			columns.push( column );
		}

		const table : Cell[][] = labelsColumn.map( v=>columns.map( w=>null ) );
		for( let x in columns )
		for( let y in names )
			table[y][x] = columns[x][y];

		return table;
	}
}
class Cell
{
	public readonly text		: KnockoutComputed<string>;
	public readonly checked?	: KnockoutObservable<boolean>;
	public readonly showChecked	: KnockoutComputed<boolean>;
	public readonly running		: KnockoutComputed<boolean>;
	public readonly rowSpan		: KnockoutObservable<number>;

	constructor(p:{ txt?:string, koTxt?:KnockoutObservable<string>, checked?:KnockoutObservable<boolean>, running?:KnockoutObservable<boolean> })
	{
		const self = this;

		this.text			= ko.computed( ()=> (p.koTxt != null) ? p.koTxt() : p.txt );
		this.checked		= p.checked;
		this.showChecked	= ko.computed( ()=>(self.checked != null) );
		this.running		= ko.computed( ()=> (p.running == null) ? false : p.running() );
		this.rowSpan		= ko.observable( 1 );
	}
}
class Run
{
	public	parent	: btrfs.SnapshotEntry;
	public	child	: btrfs.SnapshotEntry;
	public	running	: KnockoutObservable<boolean>;
	public	size	: KnockoutObservable<number>;

	constructor(parent:btrfs.SnapshotEntry, child:btrfs.SnapshotEntry)
	{
		this.parent		= parent;
		this.child		= child;
		this.running	= ko.observable( false );
		this.size		= ko.observable( null );
	}
	public async launch(log:Log) : Promise<number>
	{
		const self = this;

		self.size( null );
		self.running( true );

		const size = await btrfs.snapshotSize({ log, parent:self.parent, child:self.child });

		self.running( false );
		self.size( size );

		return size;
	}
}

export async function clickRefresh() : Promise<void>
{
	await trycatch( 'refresh', async (log)=>
	{
		koSnapshots( null );

		btrfs.config.useSudo = koUseSudo();
		const { list } = await btrfs.listSnapshots({	log		: log.child('list'),
														name	: koName(),
														dir		: koDirectory(),
													});
		if( koReverse() )
			list.reverse();
		const snapshots = new Snapshots({ entries:list })
		koSnapshots( snapshots );
	} );
}

export async function clickLaunch() : Promise<void>
{
	const n = koSnapshots().runs().length + 1;
	await trycatch( `run_${n}`, async (log)=>
	{
		log.log( 'Throttler:', koThrottler() );
		const throttler = new common.TasksThrotther( koThrottler() );

		const entries = koSnapshots().entries().filter( (entry)=>entry.checked() );
		log.log( `Launching '${entries.length-1}' runs` );
		const tasks : Promise<number>[] = [];
		const runs : Run[] = [];
		for( let i=1; i<entries.length; ++i )
		{
			const parent = entries[ i-1 ].entry;
			const child = entries[ i ].entry;
			const run = new Run( parent, child );
			tasks.push( throttler.do( ()=>run.launch(log.child(''+i)) ) );
			runs.push( run );
		}

		log.log( `Append runs` );
		koSnapshots().runs.push( runs );

		log.log( `Waiting for tasks to terminate` );
		await Promise.all( tasks );
	} );
}

async function trycatch(logName:string, callback:(log:Log)=>Promise<void>) : Promise<void>
{
	const log = new Log( logName, /*parent*/null, /*onLineAdded*/(name,date,args)=>
		{
			const a = args.slice();
			a.unshift( name+':' );
			console.log.apply( console, a );
		} );
	log.log( '*** start' );
	try
	{
		await callback( log );
		log.log( '*** exit' );
	}
	catch( ex )
	{
		log.exception( ex );
		common.setHasErrors();
	}
	log.log( '*** end ; hasErrors', common.hasErrors );

	console.log( '=====' );
	log.output()
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
			const log = new Log( 'electron', /*parent*/null, /*onLineAdded*/(name,date,args)=>
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
												pathname: path.join(__dirname, 'snapshotsSizeGui.html'),
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
