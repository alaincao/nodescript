
import * as path from 'path';
import Log from './logger';
import * as common from './common';
import * as btrfs from './btrfs';
import * as bosun from './bosun';

// Do not create incremental backup if last full was less than 10Mb
const minIncrementalSize = 1024 * 1024 * 10;

const fileDeleteCommand = "rm -v '{FILE}'";

export async function runSnapshotRequest(log:Log, item:SnapshotRequest) : Promise<void>
{
	log = log.child( `snap-${item.name}` );
	const name = item.name;
	const dir = item.snapshotsDir;

	log.log( 'Create snapshot' );
	const { path:dstPath } = await btrfs.snapshotCreate({ log:log, name:name, srcSubvolume:item.subvolume, dstDirectory:dir });

	if( item.bosunMetric != null )
	{
		log.log( 'Send directory size to Bosun' );
		await bosun.sendDirSize({ log:log.child('bosun'), metric:item.bosunMetric, name:name, dir:dstPath, timestamp:bosun.createTimeStampFromTag() });
	}

	if( item.backup != null )
	{
		const backupRequest : BackupRequest = {
				name					: item.name,
				sourceSnapshotsDir		: item.snapshotsDir,
				sourceSnapshotsRemove	: false,
				destinationBackupsDir	: item.backup.dir,
				fullThreshold			: item.backup.fullThreshold,
				fullMaxAgeDays			: item.backup.fullMaxAgeDays,
				backupRotation			: item.backup.rotation,
			};
		await runBackupRequest( log.child('bkp'), backupRequest );
	}

	if( item.snapshotsRotation != null )
	{
		log.log( 'Run rotation' );
		await item.snapshotsRotation({ log:log.child('rot'), name:name, dir:dir });
	}

	log.log( 'Snapshot terminated' );
}

export async function runSendRequest(log:Log, item:SendRequest) : Promise<void>
{
	log = log.child( `send-${item.name}` );

	const [ srcs, dsts ] = await Promise.all([
		btrfs.listSnapshots({ log:log.child('listsrcs'), name:item.name, dir:item.srcDir }),
		btrfs.listSnapshots({ log:log.child('listdsts'), name:item.name, dir:item.dstDir }) ]);
	if( srcs.list.length == 0 )
		throw `There is no snapshot available for '${item.name}'`;

	if( (dsts.last != null) && (srcs.last.tag == dsts.last.tag) )
	{
		log.log( `Nothing to do: last snapshot '${srcs.last.subvolumeName}' has already been sent to '${item.dstDir}'` );
		return;
	}

	let parent : btrfs.SnapshotEntry = null;
	if( dsts.last == null )
	{
		log.log( `No previous snapshots present in '${item.dstDir}' => Sending the full subvolume` );
	}
	else
	{
		parent = srcs.list.find( (e)=>(e.tag == dsts.last.tag) );
		if( parent == null )
			log.log( `*** WARNING *** Could not find parent snapshot '${dsts.last.subvolumeName}' in source directory '${item.srcDir}' => Sending the full subvolume` );
		else
			log.log( `Using parent subvolume '${parent.subvolumeName}'` );
	}

	await btrfs.send({ log:log, snapshot:srcs.last, parent:parent, destinationDir:item.dstDir });

	if( item.srcRemove === true )
	{
		log.log( 'Remove obsolete snapshots' );
		const obsoletes = srcs.list.slice( 0, srcs.list.length-1 );  // Remove all except the last one (which have just been backuped)
		await Promise.all( obsoletes.map(e=>btrfs.snapshotDelete({	log			: log.child('del.'+e.subvolumeName),
																	subvolume	: e.subvolumeName,
																	dir			: e.containerDir })) );
	}

	if( item.dstRotation != null )
	{
		log.log( 'Run destination snapshots rotation' );
		await item.dstRotation({ log:log.child('dstrot'), name:item.name, dir:item.dstDir });
	}
}

export async function runBackupRequest(log:Log, item:BackupRequest) : Promise<void>
{
	log = log.child( `bkp-${item.name}` );

	const [ backups, snapshots ] = await Promise.all([
							btrfs.listBackups({ log:log.child('listbkp'), name:item.name, dir:item.destinationBackupsDir }),
							btrfs.listSnapshots({ log:log.child('listsnaps'), name:item.name, dir:item.sourceSnapshotsDir, remoteServer:item.sourceSnapshotServer }) ]);

	if( snapshots.first == null )
		throw "There is no snapshot available for '"+item.name+"'";

	let parentSnapshot : btrfs.SnapshotEntry;
	if( backups.last == null )
	{
		log.log( 'Create a full backup: no backups available yet' );
		parentSnapshot = null;
	}
	else
	{
		if( snapshots.last.tag == backups.last.tag )
		{
			log.log( "Nothing to do: last snapshot '"+snapshots.last.subvolumeName+"' has already been backuped into '"+backups.last.backupName+"'" );
			return;
		}

		parentSnapshot = snapshots.list.find( (e)=>(e.tag == backups.last.tag) );
		if( parentSnapshot == null )
		{
			log.log( "Create a full backup: Could not find snapshot of last backup '"+backups.last.backupName+"'" );
		}
		else if( backups.lastFull.size < minIncrementalSize )
		{
			log.log( `Create a full backup: Last full backup size was '${common.humanFileSize(backups.last.size)}'` );
			parentSnapshot = null;
		}
		else if(	(item.fullThreshold != null)
				&&	(backups.last.sizeCumulated != null)
				&&	((backups.last.sizeCumulated / backups.lastFull.size) > item.fullThreshold) )
		{
			// Cumulated size of the snapshots has reach threshold
			log.log( `Create a full backup: Full backup size is '${common.humanFileSize(backups.lastFull.size)}' and cumulated snapshots size is '${common.humanFileSize(backups.last.sizeCumulated)}'` );
			parentSnapshot = null;
		}
		else if(	(item.fullMaxAgeDays != null)
				&&	(backups.lastFull.diffDays >= item.fullMaxAgeDays) )
		{
			log.log( `Create a full backup: Last full backup too old (${backups.lastFull.tag})` );
			parentSnapshot = null;
		}
		else
		{
			log.log( "Create an incremental backup" );
		}
	}
	if( item.destinationSnapshot != null )
		var destinationSnapshotDir = item.destinationSnapshot.dir;
	else
		destinationSnapshotDir = null;
	await btrfs.backupCreate({ log:log, snapshot:snapshots.last, parent:parentSnapshot, subvolumeDestinationDir:destinationSnapshotDir, backupDestinationDir:item.destinationBackupsDir });

	if( item.bosunMetric != null )
	{
		log.log( 'Send directory size to Bosun' );
		if( item.sourceSnapshotServer != null )
			throw 'NYI: Send remote directory size to bosun is not yet implemented!';
		await bosun.sendDirSize({ log:log.child('bosun'), metric:item.bosunMetric, name:item.name, dir:path.join(snapshots.last.containerDir, snapshots.last.subvolumeName)  , timestamp:bosun.createTimeStampFromTag(snapshots.last.tag) });
	}

	if( item.sourceSnapshotsRemove )
	{
		log.log( 'Remove obsolete snapshots' );
		if( item.sourceSnapshotServer != null )
			throw 'NYI: Remove obsolete remote snapshots is not yet implemented!';
		const obsoletes = snapshots.list.slice( 0, snapshots.list.length-1 );  // Remove all except the last one (which have just been backuped)
		await Promise.all( obsoletes.map(e=>btrfs.snapshotDelete({	log			: log.child('del.'+e.subvolumeName),
																	subvolume	: e.subvolumeName,
																	dir			: e.containerDir })) );
	}

	if( item.backupRotation != null )
	{
		log.log( 'Run backups rotation' );
		await item.backupRotation({ log:log.child('rot'), name:item.name, dir:item.destinationBackupsDir });
	}

	if( (item.destinationSnapshot != null) && (item.destinationSnapshot.rotation != null) )
	{
		log.log( 'Run destination snapshots rotation' );
		await item.destinationSnapshot.rotation({ log:log.child('rot'), name:item.name, dir:item.destinationSnapshot.dir });
	}
}

/** Keep only the last snapshot */
export async function snapshotsRotation_keepOnlyLast1(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return snapshotsRotation_keepOnlyLastX({ log:p.log, name:p.name, dir:p.dir, n:1 }); }
export async function snapshotsRotation_keepOnlyLast2(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return snapshotsRotation_keepOnlyLastX({ log:p.log, name:p.name, dir:p.dir, n:2 }); }
export async function snapshotsRotation_keepOnlyLast3(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return snapshotsRotation_keepOnlyLastX({ log:p.log, name:p.name, dir:p.dir, n:3 }); }
export async function snapshotsRotation_keepOnlyLast5(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return snapshotsRotation_keepOnlyLastX({ log:p.log, name:p.name, dir:p.dir, n:5 }); }
export async function snapshotsRotation_keepOnlyLast10(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return snapshotsRotation_keepOnlyLastX({ log:p.log, name:p.name, dir:p.dir, n:10 }); }
async function snapshotsRotation_keepOnlyLastX(p:{ log:Log, name:string, dir:string, n:number }) : Promise<void>
{
	p.log.log( 'Get list of existing snapshots' );
	const entries = await btrfs.listSnapshots({ log:p.log.child('list'), name:p.name, dir:p.dir });
	if( entries.last == null )
	{
		p.log.log( 'Nothing found' );
		return;
	}

	// nb: 'entries.list' sorted chronologically
	const toDelete = entries.list.slice( 0, -p.n );

	// NB: 20180716: Deleting them 1 by 1 ; I've seen a kernel panic when deleting them all at the same time ... o_0
	for( let i=0; i<toDelete.length; ++i )
		await btrfs.snapshotDelete({ log:p.log.child('delete'), dir:p.dir, subvolume:toDelete[i].subvolumeName });
}

/** Keep everything during X days */
export function snapshotsRotation_keep3Days(p:{ log:Log, name:string, dir:string }) : Promise<void>		{ return snapshotsRotation_keepNDays({ log:p.log, name:p.name, dir:p.dir, nDays:3 }); }
export function snapshotsRotation_keep5Days(p:{ log:Log, name:string, dir:string }) : Promise<void>		{ return snapshotsRotation_keepNDays({ log:p.log, name:p.name, dir:p.dir, nDays:5 }); }
export function snapshotsRotation_keep1Week(p:{ log:Log, name:string, dir:string }) : Promise<void>		{ return snapshotsRotation_keepNDays({ log:p.log, name:p.name, dir:p.dir, nDays:7 }); }
async function snapshotsRotation_keepNDays(p:{ log:Log, name:string, dir:string, nDays:number }) : Promise<void>
{
	p.log.log( 'Get list of existing snapshots' );
	const entries = await btrfs.listSnapshots({ log:p.log.child('list'), name:p.name, dir:p.dir });

	const toDelete : btrfs.SnapshotEntry[] = [];
	entries.list.forEach( (entry, i)=>
		{
			let remove = true;
			if( entry.tag == entries.last.tag )
				// Always keep the last one (should not be needed, but there for safety ...)
				remove = false;
			if( entry.diffDays <= p.nDays )
				remove = false;
			if(! remove )
				p.log.log( 'Leave', entry.subvolumeName );
			else
				toDelete.push( entry );
		} );

	// NB: 20180716: Deleting them 1 by 1 ; I've seen a kernel panic when deleting them all at the same time ... o_0
	for( let i=0; i<toDelete.length; ++i )
		await btrfs.snapshotDelete({ log:p.log.child('delete'), dir:p.dir, subvolume:toDelete[i].subvolumeName });
}

/** Keep everything from the last 2 months then 1 per month
 * TODO: Keep only 1 per year after 1 year */
export async function snapshotsRotation_timeMachine(p:{ log:Log, name:string, dir:string }) : Promise<void>// SnapshotsRotation = async function(p)
{
	p.log.log( 'Get list of existing snapshots' );
	const entries = await btrfs.listSnapshots({ log:p.log.child('list'), name:p.name, dir:p.dir });

	const toDelete : btrfs.SnapshotEntry[] = [];
	entries.list.forEach( (entry, i)=>
		{
			let remove = true;
			if( entry.tag == entries.last.tag )
				// Always keep the last one (should not be needed, but there for safety ...)
				remove = false;
			if( entry.firstOfMonth )
				remove = false;
			if( entry.diffMonths < 2 )
				remove = false;
			if(! remove )
				p.log.log( 'Leave', entry.subvolumeName );
			else
				toDelete.push( entry );
		} );

	// NB: 20180716: Deleting them 1 by 1 ; I've seen a kernel panic when deleting them all at the same time ... o_0
	for( let i=0; i<toDelete.length; ++i )
		await btrfs.snapshotDelete({ log:p.log.child('delete'), dir:p.dir, subvolume:toDelete[i].subvolumeName });
}

/** Keep N full backups and all their related incremental backups */
export async function backupsRotation_keep1Full(p:{ log:Log, name:string, dir:string }) : Promise<void>		{ await backupsRotation_keepNFulls({ log:p.log, name:p.name, dir:p.dir, nToKeep:1 }); }
export async function backupsRotation_keep2Fulls(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ await backupsRotation_keepNFulls({ log:p.log, name:p.name, dir:p.dir, nToKeep:2 }); }
export async function backupsRotation_keep3Fulls(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ await backupsRotation_keepNFulls({ log:p.log, name:p.name, dir:p.dir, nToKeep:3 }); }
export async function backupsRotation_keep5Fulls(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ await backupsRotation_keepNFulls({ log:p.log, name:p.name, dir:p.dir, nToKeep:5 }); }
export async function backupsRotation_keep10Fulls(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ await backupsRotation_keepNFulls({ log:p.log, name:p.name, dir:p.dir, nToKeep:10 }); }
export async function backupsRotation_keep15Fulls(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ await backupsRotation_keepNFulls({ log:p.log, name:p.name, dir:p.dir, nToKeep:15 }); }
export async function backupsRotation_keep30Fulls(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ await backupsRotation_keepNFulls({ log:p.log, name:p.name, dir:p.dir, nToKeep:30 }); }
async function backupsRotation_keepNFulls(p:{ log:Log, name:string, dir:string, nToKeep:number, debug?:boolean }) : Promise<void>
{
	p.log.log( 'Get list of existing backups' );
	const entries = await btrfs.listBackups({ log:p.log.child('list'), name:p.name, dir:p.dir });

	let promises : Promise<{stdout:string,stderr:string}>[] = [];
	entries.list.forEach( (entry, i)=>
		{
			let remove = false;
			if( entry.fullNumber > p.nToKeep )
				remove = true;
			if(! remove )
				p.log.log( 'Leave', entry.backupName );
			else if( p.debug )
				p.log.log( 'Would delete', entry.backupName );
			else
				promises.push(
						common.run({ log:p.log.child('run'), command:fileDeleteCommand, 'FILE':path.join(entry.containerDir, entry.backupName) })
					);
		} );
	await Promise.all( promises );
}

export function backupsRotation_keepAtLeast3Days(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, daysToKeep:3 }); }
export function backupsRotation_keepAtLeast7Days(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, daysToKeep:7 }); }
export function backupsRotation_keepAtLeast1Month(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, monthsToKeep:1 }); }
export function backupsRotation_keepAtLeast2Months(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, monthsToKeep:2 }); }
export function backupsRotation_keepAtLeast3Months(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, monthsToKeep:3 }); }
export function backupsRotation_keepAtLeast6Months(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, monthsToKeep:6 }); }
export function backupsRotation_keepAtLeast1Year(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, monthsToKeep:12 }); }
export function backupsRotation_keepAtLeast2Year(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, monthsToKeep:24 }); }
export function backupsRotation_keepAtLeast3Year(p:{ log:Log, name:string, dir:string }) : Promise<void>	{ return backupsRotation_keepAtLeastNDays({ log:p.log, name:p.name, dir:p.dir, monthsToKeep:36 }); }
async function backupsRotation_keepAtLeastNDays(p:{ log:Log, name:string, dir:string, daysToKeep?:number, monthsToKeep?:number, debug?:boolean }) : Promise<void>
{
	p.log.log( 'Get list of existing backups' );
	const entries = await btrfs.listBackups({ log:p.log.child('list'), name:p.name, dir:p.dir });

	// List of all entry's tags to keep
	const toKeep : {[key:string]:boolean} = {};

	// Recursive function that add's specified entry and it's parents to 'toKeep'
	function keepWithParents(entry:btrfs.BackupEntry) : void
	{
		toKeep[ entry.tag ] = true;

		if( entry.parent != null )
			keepWithParents( entry.parent );
	};

	// Flag all tags that must be kept
	entries.list.forEach( (entry)=>
		{
			if( (p.daysToKeep != null) && (entry.diffDays <= p.daysToKeep) )
				// This entry (and all it's parents) must be kept
				keepWithParents( entry );
			else if( (p.monthsToKeep != null) && (entry.diffMonths < p.monthsToKeep) )
				// This entry (and all it's parents) must be kept
				keepWithParents( entry );
			else
				{/*Do not tag*/}
		} );

	// Actually perform rotation
	const tasks = entries.list.map( async (entry)=>
		{
			if( toKeep[entry.tag] == true )
				p.log.log( `Leave`, entry.backupName, `(diffDays:${entry.diffDays} ; diffMonths:${entry.diffMonths})` );
			else if( p.debug )
				p.log.log( `Would delete`, entry.backupName, `(diffDays:${entry.diffDays} ; diffMonths:${entry.diffMonths})` );
			else
				await common.run({ log:p.log.child('run'), command:fileDeleteCommand, 'FILE':path.join(entry.containerDir, entry.backupName) })
		} );
	await Promise.all( tasks );
}

export type SnapshotsRotation = (p:{ log:Log, name:string, dir:string })=>Promise<void>;
export type BackupsRotation = (p:{ log:Log, name:string, dir:string })=>Promise<void>;

export interface SnapshotRequest
{
	name				: string;
	subvolume			: string;
	snapshotsDir		: string;
	snapshotsRotation?	: SnapshotsRotation;
	backup?				: {
								dir				: string;
								fullThreshold?	: number;
								fullMaxAgeDays?	: number;
								rotation		: BackupsRotation;
							};
	bosunMetric?		: string;
}
export interface SendRequest
{
	name			: string;
	srcDir			: string;
	dstDir			: string;
	srcRemove		: boolean;
	dstRotation?	: SnapshotsRotation;
}
export interface BackupRequest
{
	name					: string;
	sourceSnapshotServer?	: string;
	sourceSnapshotsDir		: string;
	sourceSnapshotsRemove	: boolean;
	destinationBackupsDir	: string;
	destinationSnapshot?	: {
									dir			: string;
									rotation?	: SnapshotsRotation;
								};
	fullThreshold?			: number;
	fullMaxAgeDays?			: number;
	bosunMetric?			: string;
	backupRotation?			: BackupsRotation;
}
