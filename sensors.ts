
import Log from './logger';
import * as common from './common';
import * as bosun from './bosun';

export const config = {  // NB: exported variables are constants => Need a container ; cf. https://github.com/Microsoft/TypeScript/issues/6751
	useSudo	: false,
	debug	: false,
	metrics	: {
				btrfs : 'CHANGEME.btrfsstat',
				smart : 'CHANGEME.smartinfo',
			},
};

const commands = {
	smartctl		: 'smartctl --attributes /dev/{DISK}',
	btrfsDevStats	: 'btrfs dev stats {SUBVOLUME}',
};

export async function sendDisksHealthToBosun(p:{ log:Log, disksPattern:string, btrfsSubvolumes:string[] }) : Promise<void>
{
	p.log.log( 'Get BTRFS subvolumes states' );
	const btrfsStatsTasks = p.btrfsSubvolumes.map( subvolume=>getBtrfsStats(p.log.child(subvolume), subvolume) );

	p.log.log( 'Get disks list' );
	const disks = await common.dirPattern({ log:p.log.child('ls-disks'), dir:'/dev', pattern:'sd?' });
	p.log.log( 'Get disks SMART state' );
	const smartTasks = disks.map( async disk=>({ disk, values:await getSmartInfo(p.log.child(disk), disk) }) );

	const bosunItems : bosun.Item[] = [];
	p.log.log( 'Create Bosun items from BTRFS states' );
	const timestamp = bosun.createTimeStampFromTag();
	( await Promise.all(btrfsStatsTasks) ).forEach( l=>l.forEach( v=>
		{
			const item = bosun.createItem({ timestamp, metric:config.metrics.btrfs, value:v.value })
			item.tags['disk'] = v.disk;
			item.tags['name'] = v.metric;
			bosunItems.push( item );
		} ) );

	p.log.log( 'Create Bosun items from SMART states' );
	( await Promise.all(smartTasks) ).forEach( v=>
		{
			Object.keys(v.values).forEach( key=>
				{
					const item = bosun.createItem({ timestamp, metric:config.metrics.smart, value:v.values[key] });
					if( item.value == null )
						return;
					item.tags['disk'] = v.disk;
					item.tags['name'] = key;
					bosunItems.push( item );
				} );
		} );

	if( bosunItems.length == 0 )
	{
		p.log.log( 'Nothing to log ...' );
		return;
	}

	await bosun.send( p.log.child('bosun'), bosunItems );
}

export async function getSmartInfo(log:Log, disk:string) : Promise<{temperature:number,startStopCount:number,reallocatedSectors:number,pendingSectors:number,uncorrectableSectors:number}>
{
	const command = (config.useSudo?'sudo ':'')+commands.smartctl;
	const {stdout} = await common.run({ log, command, logstds:config.debug, 'DISK':disk });
	const lines = stdout.split( /\r?\n\r?/ );

	const item = {temperature:<number>null,startStopCount:<number>null,reallocatedSectors:<number>null,pendingSectors:<number>null,uncorrectableSectors:<number>null};
	for( let i=0; i<lines.length; ++i )
	{
		const line = lines[i];
		if( line.length == 0 )
			// Empty line => Beginning a new section
			continue;  // Next line

		const fields = line.trim().replace( / +/g, '{split}' ).split( '{split}' );
		if( fields.length < 10 )
			continue;

		switch( fields[1] )
		{
			case 'Temperature_Celsius':
			case 'Airflow_Temperature_Cel':
				item.temperature = parseFloat( fields[9] );
				break;
			case 'Start_Stop_Count':
			case 'Power_Cycle_Count':
				item.startStopCount = parseFloat( fields[9] );
				break;
			//case 'Reallocated_Event_Count':
			case 'Reallocated_Sector_Ct':
				item.reallocatedSectors = parseFloat( fields[9] );
				break;
			case 'Current_Pending_Sector':
				item.pendingSectors = parseFloat( fields[9] );
				break;
			case 'Offline_Uncorrectable':
			case 'Reported_Uncorrect':
				item.uncorrectableSectors = parseFloat( fields[9] );
				break;
			default:
				continue;
		}
	}

	log.log( item );
	return item;
}

export async function getBtrfsStats(log:Log, subvolume:string) : Promise<{disk:string,metric:string,value:number}[]>
{
	const command = (config.useSudo?'sudo ':'')+commands.btrfsDevStats;
	const {stdout} = await common.run({ log, command, logstds:config.debug, 'SUBVOLUME':subvolume });
	const lines = stdout.split( /\r?\n\r?/ );

	const items : {disk:string,metric:string,value:number}[] = [];
	for( let i=0; i<lines.length; ++i )
	{
		const line = lines[i];
		if( line.length == 0 )
			continue;  // Discard any empty lines

		const match = ( /^\[\/dev\/(.*)\].([a-z\_]+)\s+(\d+)$/g ).exec( line );
		const disk = match[1];
		const metric = match[2];
		const value = parseFloat( match[3] );

		const item = { disk, metric, value };
		log.log( item );
		items.push( item );
	}

	return items;
}
