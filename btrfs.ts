
import * as path from 'path';
import * as moment from 'moment';
import Log from './logger';
import * as common from './common';

export const config = {  // NB: exported variables are constants => Need a container ; cf. https://github.com/Microsoft/TypeScript/issues/6751
	useSudo : false,
};
export const formats = {
	snapshot : '{NAME}_{TAG}',
	backup : {
		full		: '{NAME}_{TAG}.full.btrfs.xz',
		fullgz		: '{NAME}_{TAG}.full.btrfs.gz',  // nb: legacy format
		partial		: '{NAME}_{PARENT_TAG}_{TAG}.btrfs.xz',
		partialgz	: '{NAME}_{PARENT_TAG}_{TAG}.btrfs.gz',  // nb: legacy format
		partialIdxs : {
			tag		: 2,
			parent	: 1,
		}
	},
};
const commands = {
	balance : {
		complete	: "btrfs balance start '{MOUNTPOINT}'",
		fast		: "btrfs balance start -dusage=50 -musage=50 '{MOUNTPOINT}'",
		fastpartial	: "btrfs balance start -dusage=50 -musage=50 -dlimit=3 -mlimit=3 '{MOUNTPOINT}'",
	},
	scrub : "btrfs scrub start '{MOUNTPOINT}'",
	snapshot : {
		create	: "btrfs subvolume snapshot -r '{SRC}' '{DST}'",
		delete	: "btrfs subvolume delete '{SUBVOLUME}'",
		send	: {
			direct	: {
				regular : "btrfs send '{SRC}' | btrfs receive '{DST_DIR}'",
				sudo	: "sudo btrfs send '{SRC}' | sudo btrfs receive '{DST_DIR}'",
			},
			parent	: {
				regular	: "btrfs send -p '{PARENT}' '{SRC}' | btrfs receive '{DST_DIR}'",
				sudo	: "sudo btrfs send -p '{PARENT}' '{SRC}' | sudo btrfs receive '{DST_DIR}'",
			},
		},
	},
	snapshotSize : {
		regular	: "btrfs send -p '{PARENT}' '{CHILD}' | wc --bytes",
		sudo	: "sudo btrfs send -p '{PARENT}' '{CHILD}' | wc --bytes",
	},
	backup : {
		full : {
			direct : {
				regular	: "btrfs send '{SRC}' | xz -T0 -c -3 > '{DST_FILE}'",
				sudo	: "sudo btrfs send '{SRC}' | xz -T0 -c -3 | sudo tee '{DST_FILE}' > /dev/null",
			},
			tee : {
				regular	: "btrfs send '{SRC}' | xz -T0 -c -3 | tee '{DST_FILE}' | xz -d | btrfs receive '{DST_SNAP_DIR}'",
				sudo	: "sudo btrfs send '{SRC}' | xz -T0 -c -3 | sudo tee '{DST_FILE}' | xz -d | sudo btrfs receive '{DST_SNAP_DIR}'",
			},
		},
		partial : {
			direct : {
				regular	: "btrfs send -p '{PARENT}' '{SRC}' | xz -T0 -c -3 > '{DST_FILE}'",
				sudo	: "sudo btrfs send -p '{PARENT}' '{SRC}' | xz -T0 -c -3 | sudo tee '{DST_FILE}' > /dev/null",
			},
			tee : {
				regular	: "btrfs send -p '{PARENT}' '{SRC}' | xz -T0 -c -3 | tee '{DST_FILE}' | xz -d | btrfs receive '{DST_SNAP_DIR}'",
				sudo	: "sudo btrfs send -p '{PARENT}' '{SRC}' | xz -T0 -c -3 | sudo tee '{DST_FILE}' | xz -d | sudo btrfs receive '{DST_SNAP_DIR}'",
			},
		},
	},
};

export async function balance(p:{ log:Log, type:'complete'|'fast'|'fastpartial', mountPoint:string }) : Promise<void>
{
	p.log.log( 'Start' );
	await common.run({ log:p.log, command:(config.useSudo?'sudo ':'')+commands.balance[p.type], 'MOUNTPOINT':p.mountPoint });
	p.log.log( 'End' );
}

export async function scrub(p:{ log:Log, mountPoint:string }) : Promise<void>
{
	p.log.log( 'Start' );
	await common.run({ log:p.log, command:(config.useSudo?'sudo ':'')+commands.scrub, 'MOUNTPOINT':p.mountPoint });
	p.log.log( 'End' );
}

export async function snapshotCreate(p:{ log:Log, name:string, srcSubvolume:string, dstDirectory:string }) : Promise<{name:string,path:string}>
{
	p.log.log( 'Start' );
	const dstName = formats.snapshot.replace( '{NAME}', p.name ).replace( '{TAG}', common.TAG );
	const dstPath = path.join( p.dstDirectory, dstName );
	await common.run({ log:p.log, command:(config.useSudo?'sudo ':'')+commands.snapshot.create, 'SRC':p.srcSubvolume, 'DST':dstPath });
	p.log.log( 'End' );
	return { name:dstName, path:dstPath };
}

export async function snapshotDelete(p:{ log:Log, subvolume:string, dir?:string }) : Promise<void>
{
	p.log.log( 'Start' );
	let subvolume = p.subvolume;
	if( p.dir != null )
		subvolume = path.join( p.dir, subvolume );
	await common.run({ log:p.log, command:(config.useSudo?'sudo ':'')+commands.snapshot.delete, 'SUBVOLUME':subvolume });
	p.log.log( 'End' );
}

export async function snapshotSize(p:{ log:Log, parent:SnapshotEntry, child:SnapshotEntry }) : Promise<number>
{
	p.log.log( 'Start' );

	const parentDir = path.join( p.parent.containerDir, p.parent.subvolumeName );
	const childDir = path.join( p.child.containerDir, p.child.subvolumeName );
	const command = ( config.useSudo ? commands.snapshotSize.sudo : commands.snapshotSize.regular );
	const { stdout } = await common.run({ log:p.log.child('run'), command:command, 'PARENT':parentDir, 'CHILD':childDir });
	p.log.log( 'Parse int' );
	const bytes = parseInt( stdout );

	p.log.log( 'End' );
	return bytes;
}

export async function send(p:{ log:Log, snapshot:SnapshotEntry, parent?:SnapshotEntry, destinationDir:string }) : Promise<void>
{
	p.log.log( 'Start' );
	const srcSubvolume = path.join( p.snapshot.containerDir, p.snapshot.subvolumeName );

	if( p.parent == null )
	{
		p.log.log( 'Send full snapshot', p.snapshot.subvolumeName );
		await common.run({ log:p.log, command:(config.useSudo?commands.snapshot.send.direct.sudo:commands.snapshot.send.direct.regular), 'SRC':srcSubvolume, 'DST_DIR':p.destinationDir });
	}
	else
	{
		p.log.log( 'Send partial snapshot', p.snapshot.subvolumeName );
		const parentSubvolume = path.join( p.parent.containerDir, p.parent.subvolumeName );
		await common.run({ log:p.log, command:(config.useSudo?commands.snapshot.send.parent.sudo:commands.snapshot.send.parent.regular), 'SRC':srcSubvolume, 'PARENT':parentSubvolume, 'DST_DIR':p.destinationDir });
	}

	p.log.log( 'End' );
}

export async function backupCreate(p:{ log:Log, snapshot:SnapshotEntry, parent?:SnapshotEntry, backupDestinationDir:string, subvolumeDestinationDir?:string }) : Promise<void>
{
	p.log.log( 'Start' );
	let command : string;
	let parentSubvolume : string;
	let dstFilePath : string;
	if( p.parent == null )
	{
		const dstFileName = formats.backup.full.replace( '{NAME}', p.snapshot.baseName ).replace( '{TAG}', p.snapshot.tag );
		dstFilePath = path.join( p.backupDestinationDir, dstFileName );
		parentSubvolume = null;
		p.log.log( 'Create full backup', dstFilePath );
		if( p.subvolumeDestinationDir == null )
		{
			if( config.useSudo )
				command = commands.backup.full.direct.sudo;
			else
				command = commands.backup.full.direct.regular;
		}
		else
		{
			if( config.useSudo )
				command = commands.backup.full.tee.sudo;
			else
				command = commands.backup.full.tee.regular;
		}
	}
	else
	{
		const dstFileName = formats.backup.partial.replace( '{NAME}', p.snapshot.baseName ).replace( '{PARENT_TAG}', p.parent.tag ).replace( '{TAG}', p.snapshot.tag );
		dstFilePath = path.join( p.backupDestinationDir, dstFileName );
		parentSubvolume = path.join( p.parent.containerDir, p.parent.subvolumeName );
		p.log.log( 'Create partial backup', dstFilePath );
		if( p.subvolumeDestinationDir == null )
		{
			if( config.useSudo )
				command = commands.backup.partial.direct.sudo;
			else
				command = commands.backup.partial.direct.regular;
		}
		else
		{
			if( config.useSudo )
				command = commands.backup.partial.tee.sudo;
			else
				command = commands.backup.partial.tee.regular;
		}
	}

	if( p.snapshot.remoteServer != null )
		command = `ssh "${p.snapshot.remoteServer}" ${command}`;

	const subvolume = path.join( p.snapshot.containerDir, p.snapshot.subvolumeName );
	await common.run({ log:p.log, command, 'SRC':subvolume, 'PARENT':parentSubvolume, 'DST_FILE':dstFilePath, 'DST_SNAP_DIR':p.subvolumeDestinationDir });
	p.log.log( 'End' );
}

export async function listSnapshots(p:{ log:Log, name:string, dir:string, remoteServer?:string }) : Promise<{first:SnapshotEntry,last:SnapshotEntry,list:SnapshotEntry[]}>
{
	const remoteServer = p.remoteServer == null ? null : p.remoteServer;
	const pattern = formats.snapshot.replace( '{NAME}', p.name ).replace( '{TAG}', common.tagPattern );
	const subvolumes = await common.dirPattern({ log:p.log, dir:p.dir, pattern:pattern, remoteServer });
	subvolumes.sort();  // NB: Sort so dates can be evaluated chronologically

	const regexPattern = formats.snapshot.replace( '{NAME}', p.name ).replace( '{TAG}', '('+('.'.repeat(common.tagFormat.length))+')' );
	const regexp = new RegExp( regexPattern );
	let lastYear=0, lastMonth=0, lastDay=0, lastHour=0;
	const currentYear	= parseInt( common.NOW.format('YYYY') );
	const currentMonth	= parseInt( common.NOW.format('YYYYMM') );
	const currentDay	= parseInt( common.NOW.format('YYYYMMDD') );
	const currentHour	= parseInt( common.NOW.format('YYYYMMDDHH') );
	const list = subvolumes.map( (subvolume,i)=>
		{
			const tag	= subvolume.replace( regexp, '$1' );
			const date	= moment( tag, common.tagFormat );
			const year	= date.year();
			const month	= parseInt( date.format('YYYYMM') );
			const day	= parseInt( date.format('YYYYMMDD') );
			const hour	= parseInt( date.format('YYYYMMDDHH') );
			var e = new SnapshotEntry({	baseName		: p.name,
										subvolumeName	: subvolume,
										remoteServer	: remoteServer,
										containerDir	: p.dir,
										tag				: tag,
										date			: date,
										diffYears		: common.NOW.diff( date, 'years' ),
										diffMonths		: common.NOW.diff( date, 'months' ),
										diffDays		: common.NOW.diff( date, 'days' ),
										diffHours		: common.NOW.diff( date, 'hours' ),
										firstOfYear		: ( lastYear < year ),
										firstOfMonth	: ( lastMonth < month ),
										firstOfDay		: ( lastDay < day ) });
			lastYear	= year;
			lastMonth	= month;
			lastDay		= day;
			lastHour	= hour;
			return e;
		} );

	let first : SnapshotEntry = null;
	let last : SnapshotEntry = null;
	if( list.length > 0 )
	{
		first = list[0];
		last = list[ list.length-1 ];
	}
	return { first, last, list };
}

export async function listBackups(p:{ log:Log, name:string, dir:string, remoteServer?:string }) : Promise<{ last:BackupEntry, lastFull:BackupEntry, list:BackupEntry[] }>
{
	const remoteServer = p.remoteServer == null ? null : p.remoteServer;

	// Search for full & partial backups files
	const patternFull = formats.backup.full.replace( '{NAME}', p.name ).replace( '{TAG}', common.tagPattern );
	const patternFullgz = formats.backup.fullgz.replace( '{NAME}', p.name ).replace( '{TAG}', common.tagPattern );
	const patternPartial = formats.backup.partial.replace( '{NAME}', p.name ).replace( '{TAG}', common.tagPattern ).replace( '{PARENT_TAG}', common.tagPattern );
	const patternPartialgz = formats.backup.partialgz.replace( '{NAME}', p.name ).replace( '{TAG}', common.tagPattern ).replace( '{PARENT_TAG}', common.tagPattern );
	const listOfListOfFiles = await Promise.all([
							common.dirPattern({ log:p.log.child('full'), dir:p.dir, pattern:patternFull, remoteServer }),
							common.dirPattern({ log:p.log.child('fullgz'), dir:p.dir, pattern:patternFullgz, remoteServer }),
							common.dirPattern({ log:p.log.child('partial'), dir:p.dir, pattern:patternPartial, remoteServer }),
							common.dirPattern({ log:p.log.child('partialgz'), dir:p.dir, pattern:patternPartialgz, remoteServer }),
						]);
	const files = <{name:string,size:number}[]>Array.prototype.concat.apply( [], listOfListOfFiles ).map( name=>({ name, size:0 }) );

	// Get file sizes
	if( p.remoteServer != null )
	{
		//throw 'NYI: Getting remote file sizes is not yet implemented';
	}
	else
	{
		await common.forEach( files, async file=>
			{
				file.size = ( await common.stat({ dir:p.dir, name:file.name }) ).size;
			} );
	}

	return createBackupsList({ log:p.log, name:p.name, containerDir:p.dir, remoteServer:p.remoteServer, files });
}

export async function createBackupsList(p:{ log:Log, name:string, files:{name:string,size:number}[], containerDir?:string, remoteServer?:string }) : Promise<{ last:BackupEntry, lastFull:BackupEntry, list:BackupEntry[] }>
{
	const remoteServer	= p.remoteServer == null ? null : p.remoteServer;  // NB: so they're 'null' and not 'undefined'
	const containerDir	= p.containerDir == null ? null : p.containerDir;

	const regexps = [
						{ pattern:formats.backup.full		, isPartial:false },
						{ pattern:formats.backup.fullgz		, isPartial:false },
						{ pattern:formats.backup.partial	, isPartial:true },
						{ pattern:formats.backup.partialgz	, isPartial:true },
					].map( item=>
						{
							const patternName = p.name.replace( /\./g, '\\.' );
							let pattern = item.pattern	.replace( /\./g, '\\.' )
														.replace( '{NAME}', patternName )
														.replace( '{TAG}', `(${common.tagPatternRegex})` );
							if( item.isPartial )
								pattern = pattern		.replace( '{PARENT_TAG}', `(${common.tagPatternRegex})` );
							return {	regex:new RegExp( pattern ),
										isPartial:item.isPartial };
						} );
	const files = p.files	.map( file=>
								{
									for( const item of regexps )
									{
										const match = file.name.match( item.regex );
										if( match == null )
											continue;

										if(! item.isPartial )
										{
											return {	name		: file.name,
														size		: file.size,
														isFull		: true,
														tag			: match[1],
														parentTag	: <string>null };
										}
										else // !isPartial
										{
											return {	name		: file.name,
														size		: file.size,
														isFull		: false,
														tag			: match[formats.backup.partialIdxs.tag],
														parentTag	: match[formats.backup.partialIdxs.parent] };
										}
									}
									// Not using this file
									return null;
								} )
							.filter( v=>v != null );
	files.sort( (a,b)=>  // NB: Sort so dates can be evaluated chronologically
		{
			return a.name < b.name ? -1 : 1;
		} );

	const list : BackupEntry[] = [];
	let last : BackupEntry = null;
	let lastFull : BackupEntry = null;
	let currentFullNumber : number = 0;
	for( let i=0; i<files.length; ++i )
	{
		const file = files[i];
		let fullNumber : number;
		if( file.isFull )
		{
			fullNumber = ( ++ currentFullNumber );
			var parent = <BackupEntry>null;
			var sizeCumulated = <number>null;
		}
		else
		{
			var parent = list.find( (e)=>e.tag == file.parentTag );
			if( parent == null )
				// NB: Should already exist in the list since 'files' should be sorted chronologically
				throw "Could not find parent backup for '"+file.name+"'";

			fullNumber = parent.fullNumber;

			if( parent.parent == null )
				// Parent is full backup
				sizeCumulated = file.size;
			else
				sizeCumulated = parent.sizeCumulated + file.size;
		}

		const date	= moment( file.tag, common.tagFormat );
		const e = new BackupEntry({	baseName		: p.name,
									backupName		: file.name,
									remoteServer	: remoteServer,
									containerDir	: containerDir,
									tag				: file.tag,
									date			: date,
									diffYears		: common.NOW.diff( date, 'years' ),
									diffMonths		: common.NOW.diff( date, 'months' ),
									diffDays		: common.NOW.diff( date, 'days' ),
									diffHours		: common.NOW.diff( date, 'hours' ),
									parent			: parent,
									size			: file.size,
									sizeCumulated	: sizeCumulated,
									fullNumber		: fullNumber });
		list.push( e );
		if( file.isFull )
			lastFull = e;
		last = e;
	}

	for( let i=0; i<files.length; ++i )
	{
		const entry = list[i];

		// Inverse entry.fullNumber (NB: +hack for 'readonly')
		(<any>entry.fullNumber) = currentFullNumber - entry.fullNumber + 1;
	}

	return { last, lastFull, list };
}

abstract class BaseEntry
{
	public readonly	baseName		: string;
	public readonly	remoteServer?	: string;
	public readonly	containerDir	: string;
	public readonly	tag				: string;
	public readonly	date			: moment.Moment;
	public readonly	diffYears		: number;
	public readonly	diffMonths		: number;
	public readonly	diffDays		: number;
	public readonly	diffHours		: number;
}
export class SnapshotEntry extends BaseEntry
{
	public readonly subvolumeName	: string;
	public readonly	firstOfYear		: boolean;
	public readonly	firstOfMonth	: boolean;
	public readonly	firstOfDay		: boolean;

	public constructor(init?:SnapshotEntry)
	{
		super();
		Object.assign( this, init );
	}
}
export class BackupEntry extends BaseEntry
{
	public readonly backupName		: string;

	public readonly parent?			: BackupEntry;
	public readonly size			: number;
	public readonly sizeCumulated?	: number;
	public readonly fullNumber		: number;

	public constructor(init?:BackupEntry)
	{
		super();
		Object.assign( this, init );
	}
}
