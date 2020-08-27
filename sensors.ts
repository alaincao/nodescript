
import * as JSON5 from 'json5';

import Log from './logger';
import * as common from './common';

export const config = {  // NB: exported variables are constants => Need a container ; cf. https://github.com/Microsoft/TypeScript/issues/6751
	useSudo	: false,
	debug	: false,
};

const commands = {
	sensors				: '/usr/bin/sensors -j',
	diskstats			: 'cat /proc/diskstats',
	smartctl			: 'smartctl --attributes /dev/{DISK}',
	diskStandbyStatus	: 'hdparm -C {DRIVES}',
	diskSpinDown		: 'hdparm -y {DRIVES}',
	btrfsDevStats		: 'btrfs dev stats {SUBVOLUME}',
};

export async function getSensorsValues(p:{ log:Log }) : Promise<{[key:string]:{[key:string]:{[key:string]:number}}}>
{
	const {stdout} = await common.run({ log:p.log, command:commands.sensors });
	return JSON5.parse( stdout );
}

export async function getDisksStats(log:Log) : Promise<{[dev:string]:{reads:number,writes:number}}>
{
	const {stdout} = await common.run({ log:log.child('run'), command:commands.diskstats });
	const lines = stdout.split( /\r?\n\r?/ );

	const stats : {[dev:string]:{reads:number,writes:number}} = {};
	for( const line of lines )
	{
		const tokens = line.split( / +/ );
		if( tokens[0].length == 0 )
			// The first element is always an empty string because of the spaces used to align the first column => Remove it
			tokens.shift();

		// cf. https://www.kernel.org/doc/Documentation/ABI/testing/procfs-diskstats
		const dev		= tokens[ 2 ];
		const reads		= parseFloat( tokens[5] );  // sectors read
		const writes	= parseFloat( tokens[9] );  // sectors written
		if( dev == null )
			// Last line is empty ...
			continue;

		stats[ dev ] = { reads, writes };
	}
	return stats;
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

export async function getDiskStandbyStatus(log:Log, drives:string[]) : Promise<{[drive:string]:{standby:boolean}}>
{
	const driveString = drives.map( v=>'/dev/'+v ).join( ' ' );
	const {stdout} = await common.run({ log:log.child('run'), command:(config.useSudo?'sudo ':'')+commands.diskStandbyStatus, 'DRIVES':driveString });

	const lines = stdout.split( /\r?\n\r?/ );
	let newSection = true;
	let currentDriveName : string;
	const drivesStatus : {[drive:string]:{standby:boolean}} = {};
	for( const line of lines )
	{
		if( line.length == 0 )
		{
			// Emtpy line => Beginning a new section
			newSection = true;
			continue;  // Next line
		}

		if( newSection )
		{
			// First line of a section => currentSectionName
			currentDriveName = line	.replace( /:.*/g, '' )
									.replace( /.*\//g, '' );
			newSection = false;
			continue;  // Next line
		}

		const state = line.replace( /.* /g, '' );
		const value = (state == 'standby') ? true : false;
		drivesStatus[ currentDriveName ] = { standby:value };
	}
	return drivesStatus;
}

export async function spinDownDisks(p:{ log:Log, drives:string[] }) : Promise<void>
{
	const driveString = p.drives.map( v=>'/dev/'+v ).join( ' ' );
	p.log.log( `spinDownDisk '${driveString}'` );
	await common.run({ log:p.log.child('run'), command:(config.useSudo?'sudo ':'')+commands.diskSpinDown, 'DRIVES':driveString });
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
		log.log( JSON.stringify(item) );
		items.push( item );
	}

	return items;
}
