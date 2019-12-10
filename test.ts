
import Log from './logger';
import * as common from './common';

import * as backup from './backup';
import * as btrfs from './btrfs';

const subvolumes = [
		{ name:'homes',	path:'/path/to/homes/' },
		{ name:'data',	path:'/path/to/data/' },
	];
const snapshotsDir		= '/path/to/snapshots/';
const backupsDir		= '/path/to/backups/';
const backupsTestDir	= '/path/to/backups/tests/';

async function main() : Promise<void>
{
	const log = new Log( 'test' );
	log.log( '*** start' );
	try
	{
		common.init({ log });
		btrfs.config.useSudo = true;

		let isHourly = false;
		let isDaily = false;
		if( common.NOW.minute() == 0 )
		{
			// Hourly is XX:00
			isHourly = true;

			if( common.NOW.hour() == 7 )
			{
				// Daily is 07:00
				isDaily = true;
			}
		}

		// Example hourly snapshots:

		const snapshotTasks : Promise<void>[] = [];
		if( isHourly )
		{
			log.log( 'Launch snapshots tasks' );
			subvolumes.forEach( item=>
				{
					const task = backup.runSnapshotRequest( log, {
										name				: item.name,
										subvolume			: item.path,
										snapshotsDir		: snapshotsDir,
										snapshotsRotation	: backup.snapshotsRotation_timeMachine,
									} );
					snapshotTasks.push( task );
				} );
		}
		log.log( 'Wait for snapshots tasks to terminate' );
		await Promise.all( snapshotTasks );
		log.log( 'Snapshots tasks terminated' );

		// Example daily backups

		const backupTasks : Promise<void>[] = [];
		if( isDaily )
		{
			log.log( 'Launch backup tasks' );
			subvolumes.forEach( item=>
				{
					const task = backup.runBackupRequest( log, {
							name					: item.name,
							sourceSnapshotsDir		: snapshotsDir,
							sourceSnapshotsRemove	: false,  // nb: Snapshots are already rotated ; Set to true if all backuped snapshots (except the last one) are to be deleted
							destinationBackupsDir	: backupsDir,
							destinationSnapshot		: {  // Optional/recommended: Extract (i.e. "btrfs receive") the backups so the backups are also TESTED
														dir			: backupsTestDir,
														rotation	: backup.snapshotsRotation_keepOnlyLast1,
													},
						} );
					backupTasks.push( task );
				} );
		}
		log.log( 'Wait for backups tasks to terminate' );
		await Promise.all( backupTasks );
		log.log( 'Backups tasks terminated' );

		log.log( 'Exit' );
	}
	catch( ex )
	{
		log.exception( ex );
		common.setHasErrors();
	}
	log.log( '*** end ; hasErrors', common.hasErrors );
}

main();
