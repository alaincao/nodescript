#!/usr/bin/env node

(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
Object.defineProperty(exports, "__esModule", { value: true });
exports.backupsRotation_keepAtLeast3Year = exports.backupsRotation_keepAtLeast2Year = exports.backupsRotation_keepAtLeast1Year = exports.backupsRotation_keepAtLeast6Months = exports.backupsRotation_keepAtLeast3Months = exports.backupsRotation_keepAtLeast2Months = exports.backupsRotation_keepAtLeast1Month = exports.backupsRotation_keepAtLeast21Days = exports.backupsRotation_keepAtLeast14Days = exports.backupsRotation_keepAtLeast7Days = exports.backupsRotation_keepAtLeast3Days = exports.backupsRotation_keep30Fulls = exports.backupsRotation_keep15Fulls = exports.backupsRotation_keep10Fulls = exports.backupsRotation_keep5Fulls = exports.backupsRotation_keep4Fulls = exports.backupsRotation_keep3Fulls = exports.backupsRotation_keep2Fulls = exports.backupsRotation_keep1Full = exports.snapshotsRotation_timeMachine = exports.snapshotsRotation_keep3Months = exports.snapshotsRotation_keep2Months = exports.snapshotsRotation_keep1Month = exports.snapshotsRotation_keep3Week = exports.snapshotsRotation_keep2Week = exports.snapshotsRotation_keep1Week = exports.snapshotsRotation_keep5Days = exports.snapshotsRotation_keep3Days = exports.snapshotsRotation_keepOnlyLast30 = exports.snapshotsRotation_keepOnlyLast15 = exports.snapshotsRotation_keepOnlyLast10 = exports.snapshotsRotation_keepOnlyLast5 = exports.snapshotsRotation_keepOnlyLast3 = exports.snapshotsRotation_keepOnlyLast2 = exports.snapshotsRotation_keepOnlyLast1 = exports.runBackupRequest = exports.runSendRequest = exports.runSnapshotRequest = void 0;
const path = require("path");
const common = require("./common");
const btrfs = require("./btrfs");
const bosun = require("./bosun");
// Do not create incremental backup if last full was less than 10Mb
const minIncrementalSize = 1024 * 1024 * 10;
const fileDeleteCommand = "rm -v '{FILE}'";
async function runSnapshotRequest(log, item) {
    log = log.child(`snap-${item.name}`);
    const name = item.name;
    const dir = item.snapshotsDir;
    log.log('Create snapshot');
    const { path: dstPath } = await btrfs.snapshotCreate({ log: log, name: name, srcSubvolume: item.subvolume, dstDirectory: dir });
    if (item.bosunMetric != null) {
        log.log('Send directory size to Bosun');
        await bosun.sendDirSize({ log: log.child('bosun'), metric: item.bosunMetric, name: name, dir: dstPath, timestamp: bosun.createTimeStampFromTag() });
    }
    if (item.backup != null) {
        const backupRequest = {
            name: item.name,
            sourceSnapshotsDir: item.snapshotsDir,
            sourceSnapshotsRemove: false,
            destinationBackupsDir: item.backup.dir,
            fullThreshold: item.backup.fullThreshold,
            fullMaxAgeDays: item.backup.fullMaxAgeDays,
            backupRotation: item.backup.rotation,
        };
        await runBackupRequest(log.child('bkp'), backupRequest);
    }
    if (item.snapshotsRotation != null) {
        log.log('Run rotation');
        await item.snapshotsRotation({ log: log.child('rot'), name: name, dir: dir });
    }
    log.log('Snapshot terminated');
}
exports.runSnapshotRequest = runSnapshotRequest;
async function runSendRequest(log, item) {
    log = log.child(`send-${item.name}`);
    const [srcs, dsts] = await Promise.all([
        btrfs.listSnapshots({ log: log.child('listsrcs'), name: item.name, dir: item.srcDir }),
        btrfs.listSnapshots({ log: log.child('listdsts'), name: item.name, dir: item.dstDir })
    ]);
    if (srcs.list.length == 0)
        throw `There is no snapshot available for '${item.name}'`;
    if ((dsts.last != null) && (srcs.last.tag == dsts.last.tag)) {
        log.log(`Nothing to do: last snapshot '${srcs.last.subvolumeName}' has already been sent to '${item.dstDir}'`);
        return;
    }
    let parent = undefined;
    if (dsts.last == null) {
        log.log(`No previous snapshots present in '${item.dstDir}' => Sending the full subvolume`);
    }
    else {
        parent = srcs.list.find((e) => (e.tag == dsts.last.tag));
        if (parent == null)
            log.log(`*** WARNING *** Could not find parent snapshot '${dsts.last.subvolumeName}' in source directory '${item.srcDir}' => Sending the full subvolume`);
        else
            log.log(`Using parent subvolume '${parent.subvolumeName}'`);
    }
    await btrfs.send({ log: log, snapshot: srcs.last, parent: parent, destinationDir: item.dstDir });
    if (item.srcRemove === true) {
        log.log('Remove obsolete snapshots');
        const obsoletes = srcs.list.slice(0, srcs.list.length - 1); // Remove all except the last one (which have just been backuped)
        await Promise.all(obsoletes.map(e => btrfs.snapshotDelete({ log: log.child('del.' + e.subvolumeName),
            subvolume: e.subvolumeName,
            dir: e.containerDir })));
    }
    if (item.dstRotation != null) {
        log.log('Run destination snapshots rotation');
        await item.dstRotation({ log: log.child('dstrot'), name: item.name, dir: item.dstDir });
    }
}
exports.runSendRequest = runSendRequest;
async function runBackupRequest(log, item) {
    log = log.child(`bkp-${item.name}`);
    const [backups, snapshots] = await Promise.all([
        btrfs.listBackups({ log: log.child('listbkp'), name: item.name, dir: item.destinationBackupsDir }),
        btrfs.listSnapshots({ log: log.child('listsnaps'), name: item.name, dir: item.sourceSnapshotsDir, remoteServer: item.sourceSnapshotServer })
    ]);
    if (snapshots.first == null)
        throw "There is no snapshot available for '" + item.name + "'";
    const lastSnapshot = snapshots.last; // Assume not null: if there's a first, there is a last
    let parentSnapshot;
    if (backups.last == null) {
        log.log('Create a full backup: no backups available yet');
        parentSnapshot = undefined;
    }
    else {
        if (lastSnapshot.tag == backups.last.tag) {
            log.log("Nothing to do: last snapshot '" + lastSnapshot.subvolumeName + "' has already been backuped into '" + backups.last.backupName + "'");
            return;
        }
        parentSnapshot = snapshots.list.find((e) => (e.tag == backups.last.tag));
        if (backups.lastFull == null) {
            log.log("Create a full backup: ERROR: could not find previous last full backup");
            parentSnapshot = undefined;
        }
        else if (parentSnapshot == null) {
            log.log("Create a full backup: Could not find snapshot of last backup '" + backups.last.backupName + "'");
        }
        else if (backups.lastFull.size < minIncrementalSize) {
            log.log(`Create a full backup: Last full backup size was '${common.humanFileSize(backups.lastFull.size)}'`);
            parentSnapshot = undefined;
        }
        else if ((item.fullThreshold != null)
            && (backups.last.sizeCumulated != null)
            && ((backups.last.sizeCumulated / backups.lastFull.size) > item.fullThreshold)) {
            // Cumulated size of the snapshots has reach threshold
            log.log(`Create a full backup: Full backup size is '${common.humanFileSize(backups.lastFull.size)}' and cumulated snapshots size is '${common.humanFileSize(backups.last.sizeCumulated)}'`);
            parentSnapshot = undefined;
        }
        else if ((item.fullMaxAgeDays != null)
            && (backups.lastFull.diffDays >= item.fullMaxAgeDays)) {
            log.log(`Create a full backup: Last full backup too old (${backups.lastFull.tag})`);
            parentSnapshot = undefined;
        }
        else {
            log.log("Create an incremental backup");
        }
    }
    let destinationSnapshotDir;
    if (item.destinationSnapshot != null)
        destinationSnapshotDir = item.destinationSnapshot.dir;
    else
        destinationSnapshotDir = undefined;
    await btrfs.backupCreate({ log: log, snapshot: lastSnapshot, parent: parentSnapshot, subvolumeDestinationDir: destinationSnapshotDir, backupDestinationDir: item.destinationBackupsDir });
    if (item.bosunMetric != null) {
        log.log('Send directory size to Bosun');
        if (item.sourceSnapshotServer != null)
            throw 'NYI: Send remote directory size to bosun is not yet implemented!';
        await bosun.sendDirSize({ log: log.child('bosun'), metric: item.bosunMetric, name: item.name, dir: path.join(lastSnapshot.containerDir, lastSnapshot.subvolumeName), timestamp: bosun.createTimeStampFromTag(lastSnapshot.tag) });
    }
    if (item.sourceSnapshotsRemove) {
        log.log('Remove obsolete snapshots');
        if (item.sourceSnapshotServer != null)
            throw 'NYI: Remove obsolete remote snapshots is not yet implemented!';
        const obsoletes = snapshots.list.slice(0, snapshots.list.length - 1); // Remove all except the last one (which have just been backuped)
        await Promise.all(obsoletes.map(e => btrfs.snapshotDelete({ log: log.child('del.' + e.subvolumeName),
            subvolume: e.subvolumeName,
            dir: e.containerDir })));
    }
    if (item.backupRotation != null) {
        log.log('Run backups rotation');
        await item.backupRotation({ log: log.child('rot'), name: item.name, dir: item.destinationBackupsDir });
    }
    if ((item.destinationSnapshot != null) && (item.destinationSnapshot.rotation != null)) {
        log.log('Run destination snapshots rotation');
        await item.destinationSnapshot.rotation({ log: log.child('rot'), name: item.name, dir: item.destinationSnapshot.dir });
    }
}
exports.runBackupRequest = runBackupRequest;
/** Keep only the last X snapshots */
async function snapshotsRotation_keepOnlyLast1(p) { return snapshotsRotation_keepOnlyLastX({ log: p.log, name: p.name, dir: p.dir, n: 1 }); }
exports.snapshotsRotation_keepOnlyLast1 = snapshotsRotation_keepOnlyLast1;
async function snapshotsRotation_keepOnlyLast2(p) { return snapshotsRotation_keepOnlyLastX({ log: p.log, name: p.name, dir: p.dir, n: 2 }); }
exports.snapshotsRotation_keepOnlyLast2 = snapshotsRotation_keepOnlyLast2;
async function snapshotsRotation_keepOnlyLast3(p) { return snapshotsRotation_keepOnlyLastX({ log: p.log, name: p.name, dir: p.dir, n: 3 }); }
exports.snapshotsRotation_keepOnlyLast3 = snapshotsRotation_keepOnlyLast3;
async function snapshotsRotation_keepOnlyLast5(p) { return snapshotsRotation_keepOnlyLastX({ log: p.log, name: p.name, dir: p.dir, n: 5 }); }
exports.snapshotsRotation_keepOnlyLast5 = snapshotsRotation_keepOnlyLast5;
async function snapshotsRotation_keepOnlyLast10(p) { return snapshotsRotation_keepOnlyLastX({ log: p.log, name: p.name, dir: p.dir, n: 10 }); }
exports.snapshotsRotation_keepOnlyLast10 = snapshotsRotation_keepOnlyLast10;
async function snapshotsRotation_keepOnlyLast15(p) { return snapshotsRotation_keepOnlyLastX({ log: p.log, name: p.name, dir: p.dir, n: 15 }); }
exports.snapshotsRotation_keepOnlyLast15 = snapshotsRotation_keepOnlyLast15;
async function snapshotsRotation_keepOnlyLast30(p) { return snapshotsRotation_keepOnlyLastX({ log: p.log, name: p.name, dir: p.dir, n: 30 }); }
exports.snapshotsRotation_keepOnlyLast30 = snapshotsRotation_keepOnlyLast30;
async function snapshotsRotation_keepOnlyLastX(p) {
    p.log.log('Get list of existing snapshots');
    const entries = await btrfs.listSnapshots({ log: p.log.child('list'), name: p.name, dir: p.dir });
    if (entries.last == null) {
        p.log.log('Nothing found');
        return;
    }
    // nb: 'entries.list' sorted chronologically
    const toDelete = entries.list.slice(0, -p.n);
    // NB: 20180716: Deleting them 1 by 1 ; I've seen a kernel panic when deleting them all at the same time ... o_0
    for (let i = 0; i < toDelete.length; ++i)
        await btrfs.snapshotDelete({ log: p.log.child('delete'), dir: p.dir, subvolume: toDelete[i].subvolumeName });
}
/** Keep everything during X days */
function snapshotsRotation_keep3Days(p) { return snapshotsRotation_keepNXXX({ log: p.log, name: p.name, dir: p.dir, nDays: 3 }); }
exports.snapshotsRotation_keep3Days = snapshotsRotation_keep3Days;
function snapshotsRotation_keep5Days(p) { return snapshotsRotation_keepNXXX({ log: p.log, name: p.name, dir: p.dir, nDays: 5 }); }
exports.snapshotsRotation_keep5Days = snapshotsRotation_keep5Days;
function snapshotsRotation_keep1Week(p) { return snapshotsRotation_keepNXXX({ log: p.log, name: p.name, dir: p.dir, nDays: 7 }); }
exports.snapshotsRotation_keep1Week = snapshotsRotation_keep1Week;
function snapshotsRotation_keep2Week(p) { return snapshotsRotation_keepNXXX({ log: p.log, name: p.name, dir: p.dir, nDays: 14 }); }
exports.snapshotsRotation_keep2Week = snapshotsRotation_keep2Week;
function snapshotsRotation_keep3Week(p) { return snapshotsRotation_keepNXXX({ log: p.log, name: p.name, dir: p.dir, nDays: 21 }); }
exports.snapshotsRotation_keep3Week = snapshotsRotation_keep3Week;
function snapshotsRotation_keep1Month(p) { return snapshotsRotation_keepNXXX({ log: p.log, name: p.name, dir: p.dir, nMonths: 1 }); }
exports.snapshotsRotation_keep1Month = snapshotsRotation_keep1Month;
function snapshotsRotation_keep2Months(p) { return snapshotsRotation_keepNXXX({ log: p.log, name: p.name, dir: p.dir, nMonths: 2 }); }
exports.snapshotsRotation_keep2Months = snapshotsRotation_keep2Months;
function snapshotsRotation_keep3Months(p) { return snapshotsRotation_keepNXXX({ log: p.log, name: p.name, dir: p.dir, nMonths: 3 }); }
exports.snapshotsRotation_keep3Months = snapshotsRotation_keep3Months;
async function snapshotsRotation_keepNXXX(p) {
    p.log.log('Get list of existing snapshots');
    const entries = await btrfs.listSnapshots({ log: p.log.child('list'), name: p.name, dir: p.dir });
    const toDelete = [];
    entries.list.forEach((entry, i) => {
        let remove = true;
        if (entry.tag == entries.last.tag)
            // Always keep the last one (should not be needed, but there for safety ...)
            remove = false;
        if (p.nDays != null) {
            if (entry.diffDays <= p.nDays)
                remove = false;
        }
        else if (p.nMonths != null) {
            if (entry.diffMonths <= p.nMonths)
                remove = false;
        }
        else {
            throw "snapshotsRotation_keepNDays: Parameter 'nDays' or 'nMonths' must be specified";
        }
        if (!remove)
            p.log.log('Leave', entry.subvolumeName);
        else
            toDelete.push(entry);
    });
    // NB: 20180716: Deleting them 1 by 1 ; I've seen a kernel panic when deleting them all at the same time ... o_0
    for (let i = 0; i < toDelete.length; ++i)
        await btrfs.snapshotDelete({ log: p.log.child('delete'), dir: p.dir, subvolume: toDelete[i].subvolumeName });
}
/** Keep everything from the last 2 months then 1 per month
 * TODO: Keep only 1 per year after 1 year */
async function snapshotsRotation_timeMachine(p) {
    p.log.log('Get list of existing snapshots');
    const entries = await btrfs.listSnapshots({ log: p.log.child('list'), name: p.name, dir: p.dir });
    const toDelete = [];
    entries.list.forEach((entry, i) => {
        let remove = true;
        if (entry.tag == entries.last.tag)
            // Always keep the last one (should not be needed, but there for safety ...)
            remove = false;
        if (entry.firstOfMonth)
            remove = false;
        if (entry.diffMonths < 2)
            remove = false;
        if (!remove)
            p.log.log('Leave', entry.subvolumeName);
        else
            toDelete.push(entry);
    });
    // NB: 20180716: Deleting them 1 by 1 ; I've seen a kernel panic when deleting them all at the same time ... o_0
    for (let i = 0; i < toDelete.length; ++i)
        await btrfs.snapshotDelete({ log: p.log.child('delete'), dir: p.dir, subvolume: toDelete[i].subvolumeName });
}
exports.snapshotsRotation_timeMachine = snapshotsRotation_timeMachine;
/** Keep N full backups and all their related incremental backups */
async function backupsRotation_keep1Full(p) { await backupsRotation_keepNFulls({ log: p.log, name: p.name, dir: p.dir, nToKeep: 1 }); }
exports.backupsRotation_keep1Full = backupsRotation_keep1Full;
async function backupsRotation_keep2Fulls(p) { await backupsRotation_keepNFulls({ log: p.log, name: p.name, dir: p.dir, nToKeep: 2 }); }
exports.backupsRotation_keep2Fulls = backupsRotation_keep2Fulls;
async function backupsRotation_keep3Fulls(p) { await backupsRotation_keepNFulls({ log: p.log, name: p.name, dir: p.dir, nToKeep: 3 }); }
exports.backupsRotation_keep3Fulls = backupsRotation_keep3Fulls;
async function backupsRotation_keep4Fulls(p) { await backupsRotation_keepNFulls({ log: p.log, name: p.name, dir: p.dir, nToKeep: 4 }); }
exports.backupsRotation_keep4Fulls = backupsRotation_keep4Fulls;
async function backupsRotation_keep5Fulls(p) { await backupsRotation_keepNFulls({ log: p.log, name: p.name, dir: p.dir, nToKeep: 5 }); }
exports.backupsRotation_keep5Fulls = backupsRotation_keep5Fulls;
async function backupsRotation_keep10Fulls(p) { await backupsRotation_keepNFulls({ log: p.log, name: p.name, dir: p.dir, nToKeep: 10 }); }
exports.backupsRotation_keep10Fulls = backupsRotation_keep10Fulls;
async function backupsRotation_keep15Fulls(p) { await backupsRotation_keepNFulls({ log: p.log, name: p.name, dir: p.dir, nToKeep: 15 }); }
exports.backupsRotation_keep15Fulls = backupsRotation_keep15Fulls;
async function backupsRotation_keep30Fulls(p) { await backupsRotation_keepNFulls({ log: p.log, name: p.name, dir: p.dir, nToKeep: 30 }); }
exports.backupsRotation_keep30Fulls = backupsRotation_keep30Fulls;
async function backupsRotation_keepNFulls(p) {
    p.log.log('Get list of existing backups');
    const entries = await btrfs.listBackups({ log: p.log.child('list'), name: p.name, dir: p.dir });
    let promises = [];
    entries.list.forEach((entry, i) => {
        let remove = false;
        if (entry.fullNumber > p.nToKeep)
            remove = true;
        if (!remove)
            p.log.log('Leave', entry.backupName);
        else if (p.debug)
            p.log.log('Would delete', entry.backupName);
        else
            promises.push(common.run({ log: p.log.child('run'), command: fileDeleteCommand, 'FILE': path.join(entry.containerDir, entry.backupName) }));
    });
    await Promise.all(promises);
}
function backupsRotation_keepAtLeast3Days(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, daysToKeep: 3 }); }
exports.backupsRotation_keepAtLeast3Days = backupsRotation_keepAtLeast3Days;
function backupsRotation_keepAtLeast7Days(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, daysToKeep: 7 }); }
exports.backupsRotation_keepAtLeast7Days = backupsRotation_keepAtLeast7Days;
function backupsRotation_keepAtLeast14Days(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, daysToKeep: 14 }); }
exports.backupsRotation_keepAtLeast14Days = backupsRotation_keepAtLeast14Days;
function backupsRotation_keepAtLeast21Days(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, daysToKeep: 21 }); }
exports.backupsRotation_keepAtLeast21Days = backupsRotation_keepAtLeast21Days;
function backupsRotation_keepAtLeast1Month(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, monthsToKeep: 1 }); }
exports.backupsRotation_keepAtLeast1Month = backupsRotation_keepAtLeast1Month;
function backupsRotation_keepAtLeast2Months(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, monthsToKeep: 2 }); }
exports.backupsRotation_keepAtLeast2Months = backupsRotation_keepAtLeast2Months;
function backupsRotation_keepAtLeast3Months(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, monthsToKeep: 3 }); }
exports.backupsRotation_keepAtLeast3Months = backupsRotation_keepAtLeast3Months;
function backupsRotation_keepAtLeast6Months(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, monthsToKeep: 6 }); }
exports.backupsRotation_keepAtLeast6Months = backupsRotation_keepAtLeast6Months;
function backupsRotation_keepAtLeast1Year(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, monthsToKeep: 12 }); }
exports.backupsRotation_keepAtLeast1Year = backupsRotation_keepAtLeast1Year;
function backupsRotation_keepAtLeast2Year(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, monthsToKeep: 24 }); }
exports.backupsRotation_keepAtLeast2Year = backupsRotation_keepAtLeast2Year;
function backupsRotation_keepAtLeast3Year(p) { return backupsRotation_keepAtLeastNDays({ log: p.log, name: p.name, dir: p.dir, monthsToKeep: 36 }); }
exports.backupsRotation_keepAtLeast3Year = backupsRotation_keepAtLeast3Year;
async function backupsRotation_keepAtLeastNDays(p) {
    p.log.log('Get list of existing backups');
    const entries = await btrfs.listBackups({ log: p.log.child('list'), name: p.name, dir: p.dir });
    // List of all entry's tags to keep
    const toKeep = {};
    // Recursive function that add's specified entry and it's parents to 'toKeep'
    function keepWithParents(entry) {
        toKeep[entry.tag] = true;
        if (entry.parent != null)
            keepWithParents(entry.parent);
    }
    ;
    // Flag all tags that must be kept
    entries.list.forEach((entry) => {
        if ((p.daysToKeep != null) && (entry.diffDays <= p.daysToKeep))
            // This entry (and all it's parents) must be kept
            keepWithParents(entry);
        else if ((p.monthsToKeep != null) && (entry.diffMonths < p.monthsToKeep))
            // This entry (and all it's parents) must be kept
            keepWithParents(entry);
        else { /*Do not tag*/ }
    });
    // Actually perform rotation
    const tasks = entries.list.map(async (entry) => {
        if (toKeep[entry.tag] == true)
            p.log.log(`Leave`, entry.backupName, `(diffDays:${entry.diffDays} ; diffMonths:${entry.diffMonths})`);
        else if (p.debug)
            p.log.log(`Would delete`, entry.backupName, `(diffDays:${entry.diffDays} ; diffMonths:${entry.diffMonths})`);
        else
            await common.run({ log: p.log.child('run'), command: fileDeleteCommand, 'FILE': path.join(entry.containerDir, entry.backupName) });
    });
    await Promise.all(tasks);
}

},{"./bosun":2,"./btrfs":3,"./common":4,"path":"path"}],2:[function(require,module,exports){
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDirSize = exports.send = exports.send_legacy = exports.createItem = exports.createTimeStampFromTag = exports.createTimeStamp = exports.config = void 0;
const http = require("http");
const https = require("https");
const moment = require("moment");
const common = require("./common");
exports.config = {
    hostName: null,
    bosunHost: 'UNSET',
    bosunHostInSSL: false,
    useSudo: false,
    sendBatchSize: 10,
    sendRetryNumber: 3,
    sendRetryDelay: 3000, // In milliseconds
};
const dirSizeCommand = "du --block-size=1 --summarize '{DIR}' | sed -e 's/\t.*//g'";
function createTimeStamp() {
    return Math.floor((new Date()).getTime() / 1000);
}
exports.createTimeStamp = createTimeStamp;
function createTimeStampFromTag(tag) {
    if (tag == null)
        tag = common.TAG;
    const date = moment(tag, common.tagFormat).toDate();
    return Math.floor(date.getTime() / 1000);
}
exports.createTimeStampFromTag = createTimeStampFromTag;
function createItem(p) {
    if (exports.config.hostName == null)
        throw "Bosun: variable 'hostName' is not set";
    let timestamp = p.timestamp;
    if (timestamp == null)
        timestamp = createTimeStamp();
    const item = { metric: p.metric,
        timestamp: timestamp,
        value: p.value,
        tags: { host: exports.config.hostName } };
    return item;
}
exports.createItem = createItem;
function send_legacy(p) {
    const requestContent = JSON.stringify(p.values);
    const ht = exports.config.bosunHostInSSL ? https : http;
    const request = ht.request({ host: exports.config.bosunHost,
        port: exports.config.bosunHostInSSL ? 443 : 80,
        path: '/api/put',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(requestContent) } }, function (response) {
        console.log('request: ' + requestContent);
        console.log('response (' + response.statusCode + '): ' + response.statusMessage);
        if (response.statusCode != 204)
            // Error
            throw new Error('Response status code ' + response.statusCode);
    });
    request.write(requestContent);
    request.end();
}
exports.send_legacy = send_legacy;
async function send(log, values) {
    log.log(`Create batches of ${exports.config.sendBatchSize} items ; ${values.length} items to send`);
    const batches = [];
    for (let i = 0; i < values.length; i += exports.config.sendBatchSize)
        batches.push(values.slice(i, i + exports.config.sendBatchSize));
    for (let i = 0; i < batches.length; ++i) {
        const batch = batches[i];
        const log2 = log.child(`batch_${i + 1}`);
        log2.log(`Batch size: ${batch.length}`);
        let retry = 0;
        RETRY: while (true) {
            try {
                await send_private(log2, batch);
            }
            catch (ex) {
                log2.exception(ex);
                if ((++retry) < exports.config.sendRetryNumber) {
                    log2.log(`Sent failed. Pause ${exports.config.sendRetryDelay} miliseconds`);
                    await common.sleep(exports.config.sendRetryDelay);
                    log2.log(`Try ${retry + 1}/${exports.config.sendRetryNumber}`);
                    continue RETRY;
                }
                else {
                    log2.log(`Try ${retry}/${exports.config.sendRetryNumber} failed ; Aborting`);
                    throw ex;
                }
            }
            // Sent OK
            break RETRY;
        } // while(true)
    } // for(batches)
}
exports.send = send;
function send_private(log, values) {
    const requestContent = JSON.stringify(values);
    log.log('Send: ', requestContent);
    return new Promise((resolve, reject) => {
        const ht = exports.config.bosunHostInSSL ? https : http;
        const request = ht.request({ host: exports.config.bosunHost,
            port: exports.config.bosunHostInSSL ? 443 : 80,
            path: '/api/put',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(requestContent) } }, function (response) {
            log.log('Response status code', response.statusCode, response.statusMessage);
            if (response.statusCode != 204)
                // Error
                reject('Response status code ' + response.statusCode);
            else
                resolve();
        });
        request.write(requestContent);
        request.end();
    });
}
async function sendDirSize(p) {
    const { stdout } = await common.run({ log: p.log.child('run'), command: (exports.config.useSudo ? 'sudo ' : '') + dirSizeCommand, 'DIR': p.dir });
    p.log.log('Parse size');
    const size = parseInt(stdout);
    const item = createItem({ timestamp: p.timestamp, metric: p.metric, value: size });
    item.tags['name'] = p.name;
    await send(p.log, [item]);
}
exports.sendDirSize = sendDirSize;

},{"./common":4,"http":"http","https":"https","moment":"moment"}],3:[function(require,module,exports){
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackupEntry = exports.SnapshotEntry = exports.createBackupsList = exports.listBackups = exports.listSnapshots = exports.backupCreate = exports.send = exports.snapshotSize = exports.snapshotDelete = exports.snapshotCreate = exports.scrub = exports.balance = exports.getPoolDrives = exports.formats = exports.config = void 0;
const path = require("path");
const moment = require("moment");
const common = require("./common");
exports.config = {
    useSudo: false,
};
exports.formats = {
    snapshot: '{NAME}_{TAG}',
    backup: {
        full: '{NAME}_{TAG}.full.btrfs.xz',
        fullgz: '{NAME}_{TAG}.full.btrfs.gz',
        partial: '{NAME}_{PARENT_TAG}_{TAG}.btrfs.xz',
        partialgz: '{NAME}_{PARENT_TAG}_{TAG}.btrfs.gz',
        partialIdxs: {
            tag: 2,
            parent: 1,
        }
    },
};
const commands = {
    fishow: "btrfs filesystem show '{MOUNTPOINT}'",
    driveName: "lsblk -no pkname {DEVICEPATH}",
    balance: {
        complete: "btrfs balance start '{MOUNTPOINT}'",
        fast: "btrfs balance start -dusage=50 -musage=50 '{MOUNTPOINT}'",
        fastpartial: "btrfs balance start -dusage=50 -musage=50 -dlimit=3 -mlimit=3 '{MOUNTPOINT}'",
    },
    scrub: "btrfs scrub start '{MOUNTPOINT}'",
    snapshot: {
        create: "btrfs subvolume snapshot -r '{SRC}' '{DST}'",
        delete: "btrfs subvolume delete '{SUBVOLUME}'",
        send: {
            direct: {
                regular: "btrfs send '{SRC}' | btrfs receive '{DST_DIR}'",
                sudo: "sudo btrfs send '{SRC}' | sudo btrfs receive '{DST_DIR}'",
            },
            parent: {
                regular: "btrfs send -p '{PARENT}' '{SRC}' | btrfs receive '{DST_DIR}'",
                sudo: "sudo btrfs send -p '{PARENT}' '{SRC}' | sudo btrfs receive '{DST_DIR}'",
            },
        },
    },
    snapshotSize: {
        regular: "btrfs send -p '{PARENT}' '{CHILD}' | wc --bytes",
        sudo: "sudo btrfs send -p '{PARENT}' '{CHILD}' | wc --bytes",
    },
    backup: {
        full: {
            direct: {
                regular: "btrfs send '{SRC}' | xz -T0 -c -3 > '{DST_FILE}'",
                sudo: "sudo btrfs send '{SRC}' | xz -T0 -c -3 | sudo tee '{DST_FILE}' > /dev/null",
            },
            tee: {
                regular: "btrfs send '{SRC}' | xz -T0 -c -3 | tee '{DST_FILE}' | xz -d | btrfs receive '{DST_SNAP_DIR}'",
                sudo: "sudo btrfs send '{SRC}' | xz -T0 -c -3 | sudo tee '{DST_FILE}' | xz -d | sudo btrfs receive '{DST_SNAP_DIR}'",
            },
        },
        partial: {
            direct: {
                regular: "btrfs send -p '{PARENT}' '{SRC}' | xz -T0 -c -3 > '{DST_FILE}'",
                sudo: "sudo btrfs send -p '{PARENT}' '{SRC}' | xz -T0 -c -3 | sudo tee '{DST_FILE}' > /dev/null",
            },
            tee: {
                regular: "btrfs send -p '{PARENT}' '{SRC}' | xz -T0 -c -3 | tee '{DST_FILE}' | xz -d | btrfs receive '{DST_SNAP_DIR}'",
                sudo: "sudo btrfs send -p '{PARENT}' '{SRC}' | xz -T0 -c -3 | sudo tee '{DST_FILE}' | xz -d | sudo btrfs receive '{DST_SNAP_DIR}'",
            },
        },
    },
};
/** List the drives used by a filesystem's pool */
async function getPoolDrives(p) {
    p.log.log('Start');
    const { stdout } = await common.run({ log: p.log, command: (exports.config.useSudo ? 'sudo ' : '') + commands.fishow, 'MOUNTPOINT': p.mountPoint });
    const lines = stdout.split(/\r?\n\r?/);
    let drives = [];
    for (const line of lines) {
        if (!line.trimLeft().startsWith('devid'))
            // Not device listing line
            continue;
        const tokens = line.split(' ');
        drives.push(tokens[tokens.length - 1]); // Last token of the line is the drive name
    }
    if ((p.diskNameOnly == true)) {
        // If partitions are used, get the name of the drives containing those partitions  (e.g. '/dev/sda1' => 'sda')
        const tasks = drives.map(async (devicePath) => {
            const { stdout } = await common.run({ log: p.log.child(`lsblk_${path.basename(devicePath)}`), command: (exports.config.useSudo ? 'sudo ' : '') + commands.driveName, 'DEVICEPATH': devicePath });
            return stdout.trim();
        });
        drives = await Promise.all(tasks);
    }
    else {
        // Extract the device name from the paths (e.g. '/dev/sda1' => 'sda1')
        drives = drives.map(v => path.basename(v));
    }
    p.log.log('End');
    return drives;
}
exports.getPoolDrives = getPoolDrives;
async function balance(p) {
    p.log.log('Start');
    await common.run({ log: p.log, command: (exports.config.useSudo ? 'sudo ' : '') + commands.balance[p.type], 'MOUNTPOINT': p.mountPoint });
    p.log.log('End');
}
exports.balance = balance;
async function scrub(p) {
    p.log.log('Start');
    await common.run({ log: p.log, command: (exports.config.useSudo ? 'sudo ' : '') + commands.scrub, 'MOUNTPOINT': p.mountPoint });
    p.log.log('End');
}
exports.scrub = scrub;
async function snapshotCreate(p) {
    p.log.log('Start');
    const dstName = exports.formats.snapshot.replace('{NAME}', p.name).replace('{TAG}', common.TAG);
    const dstPath = path.join(p.dstDirectory, dstName);
    await common.run({ log: p.log, command: (exports.config.useSudo ? 'sudo ' : '') + commands.snapshot.create, 'SRC': p.srcSubvolume, 'DST': dstPath });
    p.log.log('End');
    return { name: dstName, path: dstPath };
}
exports.snapshotCreate = snapshotCreate;
async function snapshotDelete(p) {
    p.log.log('Start');
    let subvolume = p.subvolume;
    if (p.dir != null)
        subvolume = path.join(p.dir, subvolume);
    await common.run({ log: p.log, command: (exports.config.useSudo ? 'sudo ' : '') + commands.snapshot.delete, 'SUBVOLUME': subvolume });
    p.log.log('End');
}
exports.snapshotDelete = snapshotDelete;
async function snapshotSize(p) {
    p.log.log('Start');
    const parentDir = path.join(p.parent.containerDir, p.parent.subvolumeName);
    const childDir = path.join(p.child.containerDir, p.child.subvolumeName);
    const command = (exports.config.useSudo ? commands.snapshotSize.sudo : commands.snapshotSize.regular);
    const { stdout } = await common.run({ log: p.log.child('run'), command: command, 'PARENT': parentDir, 'CHILD': childDir });
    p.log.log('Parse int');
    const bytes = parseInt(stdout);
    p.log.log('End');
    return bytes;
}
exports.snapshotSize = snapshotSize;
async function send(p) {
    p.log.log('Start');
    const srcSubvolume = path.join(p.snapshot.containerDir, p.snapshot.subvolumeName);
    if (p.parent == null) {
        p.log.log('Send full snapshot', p.snapshot.subvolumeName);
        await common.run({ log: p.log, command: (exports.config.useSudo ? commands.snapshot.send.direct.sudo : commands.snapshot.send.direct.regular), 'SRC': srcSubvolume, 'DST_DIR': p.destinationDir });
    }
    else {
        p.log.log('Send partial snapshot', p.snapshot.subvolumeName);
        const parentSubvolume = path.join(p.parent.containerDir, p.parent.subvolumeName);
        await common.run({ log: p.log, command: (exports.config.useSudo ? commands.snapshot.send.parent.sudo : commands.snapshot.send.parent.regular), 'SRC': srcSubvolume, 'PARENT': parentSubvolume, 'DST_DIR': p.destinationDir });
    }
    p.log.log('End');
}
exports.send = send;
async function backupCreate(p) {
    p.log.log('Start');
    let command;
    let parentSubvolume;
    let dstFilePath;
    if (p.parent == null) {
        const dstFileName = exports.formats.backup.full.replace('{NAME}', p.snapshot.baseName).replace('{TAG}', p.snapshot.tag);
        dstFilePath = path.join(p.backupDestinationDir, dstFileName);
        parentSubvolume = null;
        p.log.log('Create full backup', dstFilePath);
        if (p.subvolumeDestinationDir == null) {
            if (exports.config.useSudo)
                command = commands.backup.full.direct.sudo;
            else
                command = commands.backup.full.direct.regular;
        }
        else {
            if (exports.config.useSudo)
                command = commands.backup.full.tee.sudo;
            else
                command = commands.backup.full.tee.regular;
        }
    }
    else {
        const dstFileName = exports.formats.backup.partial.replace('{NAME}', p.snapshot.baseName).replace('{PARENT_TAG}', p.parent.tag).replace('{TAG}', p.snapshot.tag);
        dstFilePath = path.join(p.backupDestinationDir, dstFileName);
        parentSubvolume = path.join(p.parent.containerDir, p.parent.subvolumeName);
        p.log.log('Create partial backup', dstFilePath);
        if (p.subvolumeDestinationDir == null) {
            if (exports.config.useSudo)
                command = commands.backup.partial.direct.sudo;
            else
                command = commands.backup.partial.direct.regular;
        }
        else {
            if (exports.config.useSudo)
                command = commands.backup.partial.tee.sudo;
            else
                command = commands.backup.partial.tee.regular;
        }
    }
    if (p.snapshot.remoteServer != null)
        command = `ssh "${p.snapshot.remoteServer}" ${command}`;
    const subvolume = path.join(p.snapshot.containerDir, p.snapshot.subvolumeName);
    await common.run({ log: p.log, command, 'SRC': subvolume, 'PARENT': parentSubvolume, 'DST_FILE': dstFilePath, 'DST_SNAP_DIR': p.subvolumeDestinationDir });
    p.log.log('End');
}
exports.backupCreate = backupCreate;
async function listSnapshots(p) {
    const remoteServer = p.remoteServer == null ? undefined : p.remoteServer;
    const pattern = exports.formats.snapshot.replace('{NAME}', p.name).replace('{TAG}', common.tagPattern);
    const subvolumes = await common.dirPattern({ log: p.log, dir: p.dir, pattern: pattern, remoteServer });
    subvolumes.sort(); // NB: Sort so dates can be evaluated chronologically
    const regexPattern = exports.formats.snapshot.replace('{NAME}', p.name).replace('{TAG}', '(' + ('.'.repeat(common.tagFormat.length)) + ')');
    const regexp = new RegExp(regexPattern);
    let lastYear = 0, lastMonth = 0, lastDay = 0, lastHour = 0;
    const currentYear = parseInt(common.NOW.format('YYYY'));
    const currentMonth = parseInt(common.NOW.format('YYYYMM'));
    const currentDay = parseInt(common.NOW.format('YYYYMMDD'));
    const currentHour = parseInt(common.NOW.format('YYYYMMDDHH'));
    const list = subvolumes.map((subvolume, i) => {
        const tag = subvolume.replace(regexp, '$1');
        const date = moment(tag, common.tagFormat);
        const year = date.year();
        const month = parseInt(date.format('YYYYMM'));
        const day = parseInt(date.format('YYYYMMDD'));
        const hour = parseInt(date.format('YYYYMMDDHH'));
        var e = new SnapshotEntry({ baseName: p.name,
            subvolumeName: subvolume,
            remoteServer: remoteServer,
            containerDir: p.dir,
            tag: tag,
            date: date,
            diffYears: common.NOW.diff(date, 'years'),
            diffMonths: common.NOW.diff(date, 'months'),
            diffDays: common.NOW.diff(date, 'days'),
            diffHours: common.NOW.diff(date, 'hours'),
            firstOfYear: (lastYear < year),
            firstOfMonth: (lastMonth < month),
            firstOfDay: (lastDay < day) });
        lastYear = year;
        lastMonth = month;
        lastDay = day;
        lastHour = hour;
        return e;
    });
    let first = undefined;
    let last = undefined;
    if (list.length > 0) {
        first = list[0];
        last = list[list.length - 1];
    }
    return { first, last, list };
}
exports.listSnapshots = listSnapshots;
async function listBackups(p) {
    // Search for full & partial backups files
    const patternFull = exports.formats.backup.full.replace('{NAME}', p.name).replace('{TAG}', common.tagPattern);
    const patternFullgz = exports.formats.backup.fullgz.replace('{NAME}', p.name).replace('{TAG}', common.tagPattern);
    const patternPartial = exports.formats.backup.partial.replace('{NAME}', p.name).replace('{TAG}', common.tagPattern).replace('{PARENT_TAG}', common.tagPattern);
    const patternPartialgz = exports.formats.backup.partialgz.replace('{NAME}', p.name).replace('{TAG}', common.tagPattern).replace('{PARENT_TAG}', common.tagPattern);
    const listOfListOfFiles = await Promise.all([
        common.dirPattern({ log: p.log.child('full'), dir: p.dir, pattern: patternFull, remoteServer: p.remoteServer }),
        common.dirPattern({ log: p.log.child('fullgz'), dir: p.dir, pattern: patternFullgz, remoteServer: p.remoteServer }),
        common.dirPattern({ log: p.log.child('partial'), dir: p.dir, pattern: patternPartial, remoteServer: p.remoteServer }),
        common.dirPattern({ log: p.log.child('partialgz'), dir: p.dir, pattern: patternPartialgz, remoteServer: p.remoteServer }),
    ]);
    const files = Array.prototype.concat.apply([], listOfListOfFiles).map(name => ({ name, size: 0 }));
    // Get file sizes
    if (p.remoteServer != null) {
        //throw 'NYI: Getting remote file sizes is not yet implemented';
    }
    else {
        await common.forEach(files, async (file) => {
            file.size = (await common.stat({ dir: p.dir, name: file.name })).size;
        });
    }
    return createBackupsList({ log: p.log, name: p.name, containerDir: p.dir, remoteServer: p.remoteServer, files });
}
exports.listBackups = listBackups;
async function createBackupsList(p) {
    var _a;
    const remoteServer = (_a = p.remoteServer) !== null && _a !== void 0 ? _a : undefined;
    const containerDir = p.containerDir;
    const regexps = [
        { pattern: exports.formats.backup.full, isPartial: false },
        { pattern: exports.formats.backup.fullgz, isPartial: false },
        { pattern: exports.formats.backup.partial, isPartial: true },
        { pattern: exports.formats.backup.partialgz, isPartial: true },
    ].map(item => {
        const patternName = p.name.replace(/\./g, '\\.');
        let pattern = item.pattern.replace(/\./g, '\\.')
            .replace('{NAME}', patternName)
            .replace('{TAG}', `(${common.tagPatternRegex})`);
        if (item.isPartial)
            pattern = pattern.replace('{PARENT_TAG}', `(${common.tagPatternRegex})`);
        return { regex: new RegExp(pattern),
            isPartial: item.isPartial };
    });
    const files = p.files.map(file => {
        for (const item of regexps) {
            const match = file.name.match(item.regex);
            if (match == null)
                continue;
            if (!item.isPartial) {
                return { name: file.name,
                    size: file.size,
                    isFull: true,
                    tag: match[1],
                    parentTag: undefined };
            }
            else // !isPartial
             {
                return { name: file.name,
                    size: file.size,
                    isFull: false,
                    tag: match[exports.formats.backup.partialIdxs.tag],
                    parentTag: match[exports.formats.backup.partialIdxs.parent] };
            }
        }
        // Not using this file
        return null;
    })
        .filter(v => v != null);
    files.sort((a, b) => // NB: Sort so dates can be evaluated chronologically
     {
        return a.name < b.name ? -1 : 1;
    });
    const list = [];
    let last = undefined;
    let lastFull = undefined;
    let currentFullNumber = 0;
    for (let i = 0; i < files.length; ++i) {
        const file = files[i];
        let fullNumber;
        let parent;
        let sizeCumulated;
        if (file.isFull) {
            fullNumber = (++currentFullNumber);
            parent = undefined;
            sizeCumulated = file.size;
        }
        else {
            parent = list.find((e) => e.tag == file.parentTag);
            if (parent == null)
                // NB: Should already exist in the list since 'files' should be sorted chronologically
                throw "Could not find parent backup for '" + file.name + "'";
            fullNumber = parent.fullNumber;
            if (parent.parent == null)
                // Parent is full backup
                sizeCumulated = file.size;
            else
                sizeCumulated = parent.sizeCumulated + file.size;
        }
        const date = moment(file.tag, common.tagFormat);
        const e = new BackupEntry({ baseName: p.name,
            backupName: file.name,
            remoteServer: remoteServer,
            containerDir: containerDir,
            tag: file.tag,
            date: date,
            diffYears: common.NOW.diff(date, 'years'),
            diffMonths: common.NOW.diff(date, 'months'),
            diffDays: common.NOW.diff(date, 'days'),
            diffHours: common.NOW.diff(date, 'hours'),
            parent: parent,
            size: file.size,
            sizeCumulated: sizeCumulated,
            fullNumber: fullNumber });
        list.push(e);
        if (file.isFull)
            lastFull = e;
        last = e;
    }
    for (let i = 0; i < files.length; ++i) {
        const entry = list[i];
        // Inverse entry.fullNumber (NB: +hack for 'readonly')
        entry.fullNumber = currentFullNumber - entry.fullNumber + 1;
    }
    return { last, lastFull, list };
}
exports.createBackupsList = createBackupsList;
class BaseEntry {
}
class SnapshotEntry extends BaseEntry {
    constructor(init) {
        super();
        Object.assign(this, init);
    }
}
exports.SnapshotEntry = SnapshotEntry;
class BackupEntry extends BaseEntry {
    constructor(init) {
        super();
        Object.assign(this, init);
    }
}
exports.BackupEntry = BackupEntry;

},{"./common":4,"moment":"moment","path":"path"}],4:[function(require,module,exports){
Object.defineProperty(exports, "__esModule", { value: true });
exports.events = exports.html = exports.url = exports.TasksThrotther = exports.arrayToListOfArrays = exports.arrayToDictionary = exports.arraySum = exports.forEach = exports.isNullOrWhiteSpace = exports.readFileLines = exports.humanFileSize = exports.writeJSON = exports.readJSON = exports.writeFile = exports.readFile = exports.rmrf = exports.rmdir = exports.rm = exports.mkdir = exports.mv = exports.exists = exports.stat = exports.dirPattern = exports.ls = exports.run = exports.sleep = exports.setHasErrors = exports.init = exports.tagPatternRegex = exports.tagPattern = exports.tagFormat = exports.hasErrors = exports.TAG = exports.NOW = void 0;
const process = require("process");
const fs = require("fs");
const path = require("path");
const child_process_1 = require("child_process");
const glob = require("glob");
const http = require("http");
const https = require("https");
const moment = require("moment");
const JSON5 = require("json5");
exports.hasErrors = false;
exports.tagFormat = 'YYYYMMDD_HHmm';
exports.tagPattern = '????????_????';
exports.tagPatternRegex = '[0-9]{8}_[0-9]{4}';
function init(p) {
    exports.TAG = ((p.tag != null) ? p.tag : moment(new Date()).format(exports.tagFormat));
    exports.NOW = moment(exports.TAG, exports.tagFormat); // NB: 'NOW' is trimmed of the 'seconds' part
    p.log.log('TAG:', exports.TAG, exports.NOW.toISOString());
    let exitHandler = function (options, err) {
        p.log.output();
        switch (options.mode) {
            case "on exit":
                if (exports.hasErrors)
                    process.exit(-1);
                return;
            case "on uncaughtException":
                console.log('*** uncaughtException', err);
                process.exit(-1);
            default:
                console.log('*** Unknown exit mode', options, err);
                process.exit(-1);
        }
    };
    process.on('exit', exitHandler.bind(null, { mode: 'on exit' }));
    process.on('uncaughtException', exitHandler.bind(null, { mode: 'on uncaughtException' }));
    if (typeof (window) === 'undefined') {
        p.log.log('In NodeJS application => set up a fake DOM/JQuery/Knockout environment');
        // https://stackoverflow.com/questions/1801160/can-i-use-jquery-with-node-js
        const jsdom = require('jsdom');
        const jquery = require('jquery');
        const knockout = require('knockout');
        const dom = new jsdom.JSDOM('<html><body></body></html>');
        global.window = dom.window;
        global.document = dom.window.document;
        global.$ = jquery(window);
        global.ko = knockout;
    }
}
exports.init = init;
function setHasErrors() {
    exports.hasErrors = true;
}
exports.setHasErrors = setHasErrors;
function sleep(ms) {
    return new Promise(callback => setTimeout(callback, ms));
}
exports.sleep = sleep;
function run(p) {
    p.log.log('Create command');
    let command = p.command;
    Object.keys(p).forEach(function (key) {
        switch (key) {
            case 'log':
            case 'command':
            case 'logstds':
            case 'stdin':
                // Regular parameter
                return;
        }
        // Command's parameter
        command = command.replace('{' + key + '}', p[key]);
    });
    function logStds(stdout, stderr) {
        p.log.child('stdout').logLines(stdout);
        p.log.child('stderr').logLines(stderr);
    }
    return new Promise(function (resolve, reject) {
        p.log.log('launch:', command);
        const ps = (0, child_process_1.exec)(command, function (err, stdout, stderr) {
            if (err != null) {
                logStds(stdout, stderr);
                reject(err); // i.e. promise's 'throw'
                return;
            }
            if ((p.logstds == null) || (p.logstds == true))
                logStds(stdout, stderr);
            p.log.log('exited');
            resolve({ stdout: stdout, stderr: stderr });
        });
        if (p.stdin != null) {
            p.log.log(`Write '${p.stdin.length}' characters to stdin`);
            const rc = ps.stdin.write(p.stdin);
            ps.stdin.end();
            p.log.log(`Write rc='${rc}'`);
        }
    });
}
exports.run = run;
function ls(path) {
    return new Promise((resolve, reject) => {
        fs.readdir(path, (err, items) => {
            if (err != null)
                reject(err);
            else
                resolve(items);
        });
    });
}
exports.ls = ls;
async function dirPattern(p) {
    if (p.remoteServer == null) {
        // Simple local search
        p.log.log('Local search:', path.join(p.dir, p.pattern));
        return new Promise((resolve, reject) => {
            glob.Glob(p.pattern, { cwd: p.dir }, (err, files) => {
                if (err != null) {
                    p.log.log('Error:', err);
                    reject(err);
                }
                else {
                    // p.log.log( 'Found:', files );
                    p.log.log('Found', files.length, 'entries');
                    resolve(files);
                }
            });
        });
    }
    else {
        // Use SSH
        p.log.log('Remote search:', path.join(p.dir, p.pattern), 'on server', p.remoteServer);
        try {
            const dirPattern = path.join(p.dir, p.pattern);
            const { stdout, stderr } = await run({ log: p.log, logstds: false, command: 'ssh "{HOSTNAME}" ls -d "{DIR_PATTERN}"', 'HOSTNAME': p.remoteServer, 'DIR_PATTERN': dirPattern });
            const list = stdout.split('\n');
            return list.map(str => path.basename(str)).filter(str => (str != null) && (str.length > 0));
        }
        catch (_a) {
            // e.g. no such file or directory ...
            return [];
        }
    }
}
exports.dirPattern = dirPattern;
function stat(p) {
    const path_ = (p.path != null) ? p.path : path.join(p.dir, p.name);
    return new Promise((resolve, reject) => {
        fs.stat(path_, (err, stats) => {
            if (err)
                reject(err);
            else
                resolve(stats);
        });
    });
}
exports.stat = stat;
function exists(p) {
    const path_ = (p.path != null) ? p.path : path.join(p.dir, p.name);
    return new Promise((resolve) => {
        fs.stat(path_, (err, stats) => {
            resolve((err == null) ? true : false);
        });
    });
}
exports.exists = exists;
function mv(p) {
    return new Promise((resolve, reject) => {
        fs.rename(p.srcPath, p.dstPath, (err) => {
            (err == null) ? resolve() : reject(err);
        });
    });
}
exports.mv = mv;
function mkdir(p) {
    const path_ = (p.path != null) ? p.path : path.join(p.dir, p.name);
    return new Promise((resolve, reject) => {
        fs.mkdir(path_, (err) => {
            (err == null) ? resolve() : reject(err);
        });
    });
}
exports.mkdir = mkdir;
function rm(p) {
    const path_ = (p.path != null) ? p.path : path.join(p.dir, p.name);
    return new Promise((resolve, reject) => {
        fs.unlink(path_, (err) => {
            if (err != null)
                reject(err);
            else
                resolve();
        });
    });
}
exports.rm = rm;
function rmdir(p) {
    const path_ = (p.path != null) ? p.path : path.join(p.dir, p.name);
    return new Promise((resolve, reject) => {
        fs.rmdir(path_, (err) => {
            (err == null) ? resolve() : reject(err);
        });
    });
}
exports.rmdir = rmdir;
async function rmrf(p) {
    const path_ = (p.path != null) ? p.path : path.join(p.dir, p.name);
    const stat_ = await stat(p);
    if (stat_.isDirectory()) {
        // Directory
        const items = await ls(path_);
        for (let i = 0; i < items.length; ++i) {
            // Recurse
            const item = items[i];
            await rmrf({ dir: path_, name: item });
        }
        // This one
        await rmdir(p);
    }
    else {
        // File
        await rm(p);
    }
}
exports.rmrf = rmrf;
async function readFile(p) {
    return new Promise((resolve, reject) => {
        fs.readFile(p.filePath, 'utf8', (err, content) => {
            if (err)
                reject(err);
            else
                resolve(content);
        });
    });
}
exports.readFile = readFile;
async function writeFile(p) {
    return new Promise((resolve, reject) => {
        fs.writeFile(p.filePath, p.stringContent, (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
}
exports.writeFile = writeFile;
/** https://json5.org/ */
async function readJSON(p) {
    let jsonText = p.jsonText;
    if (p.filePath != null)
        jsonText = await readFile({ filePath: p.filePath });
    if (jsonText == null)
        throw `'readJSON()': Missing JSON source`;
    return JSON5.parse(jsonText);
}
exports.readJSON = readJSON;
async function writeJSON(p) {
    const json = JSON.stringify(p.content, null, '\t');
    await writeFile({ filePath: p.filePath, stringContent: json });
}
exports.writeJSON = writeJSON;
/** https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string */
function humanFileSize(bytes, si) {
    if (si == null)
        si = false;
    const thresh = si ? 1000 : 1024;
    if (Math.abs(bytes) < thresh)
        return bytes + ' B';
    const units = si
        ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
        : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    let u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while (Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(1) + ' ' + units[u];
}
exports.humanFileSize = humanFileSize;
async function readFileLines(filePath) {
    var _a;
    const buffer = await fs.promises.readFile(filePath);
    const txt = buffer.toString();
    const lines = (_a = txt.match(/[^\r\n]+/g)) !== null && _a !== void 0 ? _a : [];
    return lines;
}
exports.readFileLines = readFileLines;
function isNullOrWhiteSpace(str) {
    if (str == null)
        return true;
    if (str.length == 0)
        return true;
    if (str.trim() == '')
        return true;
    return false;
}
exports.isNullOrWhiteSpace = isNullOrWhiteSpace;
async function forEach(t, callback) {
    for (let i = 0; i < t.length; ++i)
        await callback(t[i], i);
}
exports.forEach = forEach;
function arraySum(a, f) {
    let rc = 0;
    a.forEach(function (e) {
        rc += f(e);
    });
    return rc;
}
exports.arraySum = arraySum;
function arrayToDictionary(a, keyCast) {
    const dict = {};
    a.forEach(v => {
        dict[keyCast(v)] = v;
    });
    return dict;
}
exports.arrayToDictionary = arrayToDictionary;
/** Split the specified array into multiple arrays according to a grouping key */
function arrayToListOfArrays(a, groupingKeyCast) {
    // Group items into an object "key->T[]"
    const grouped = a.reduce((accu, current) => {
        const key = groupingKeyCast(current);
        let list = accu[key];
        if (list == null) {
            list = [];
            accu[key] = list;
        }
        list.push(current);
        return accu;
    }, {});
    // From the object, create arrays
    const list = [];
    for (let key in grouped)
        list.push(grouped[key]);
    return list;
}
exports.arrayToListOfArrays = arrayToListOfArrays;
/** Throttles the concurrent execution of Promises (e.g. the reduce the number of concurrent requests to a server) */
class TasksThrotther {
    constructor(limit) {
        this.runnings = 0;
        this.throttled = [];
        this.limit = limit;
    }
    /** nb: all the magic is here... */
    async do(callback) {
        const self = this;
        ++self.runnings;
        if (self.runnings <= self.limit) {
            // Execute immediately
            const rc = await callback();
            self.checkNext();
            return rc;
        }
        // Push a promise in 'throttled' & wait for it
        const waitFor = new Promise((resolve) => {
            self.throttled.push(resolve);
        });
        await waitFor;
        // Now we can execute
        const rc = await callback();
        self.checkNext();
        return rc;
    }
    checkNext() {
        const self = this;
        --self.runnings;
        const next = self.throttled.shift();
        if (next != null)
            next();
    }
}
exports.TasksThrotther = TasksThrotther;
var url;
(function (url_1) {
    /** Transform a dictionary like {foo:'bar',hello:'world'} to a parameters string like 'foo=bar&hello=world' */
    function stringifyParameters(parms) {
        var pairs = [];
        Object.keys(parms).forEach(function (key) {
            let value = parms[key];
            key = encodeURIComponent(key);
            if ((value == null) || (typeof (value) === 'string') || (typeof (value) === 'number') || (typeof (value) === 'boolean')) { /*Keep as-is*/ }
            else
                // Convert to JSON
                value = JSON.stringify(value);
            value = encodeURIComponent(value);
            pairs.push(key + "=" + value);
        });
        return pairs.join('&');
    }
    url_1.stringifyParameters = stringifyParameters;
    function getRequest(url, request) {
        if (request != null) {
            const parms = stringifyParameters(request);
            url = `${url}?${parms}`;
        }
        const ht = url.startsWith('https:') ? https : http;
        let data = '';
        return new Promise((resolve, reject) => {
            ht.get(url, (resp) => {
                resp.on('data', (chunk) => {
                    data += chunk;
                });
                resp.on('end', () => {
                    if (resp.statusCode != 200) // HTTP OK
                        reject(`Request failed with status code ${resp.statusCode}`);
                    else
                        resolve(data);
                });
            })
                .on('error', (err) => {
                reject(err);
            });
        });
    }
    url_1.getRequest = getRequest;
    // nb: ES5 incompatible ; requires "Promise" library
    function postRequest(url, request) {
        let requestStr = JSON.stringify(request);
        return new Promise((resolve, reject) => {
            $.ajax({ type: 'POST',
                url: url,
                contentType: 'application/json',
                data: requestStr,
                dataType: 'json',
                success: (data, textStatus, jqXHR) => resolve(data),
                error: (jqXHR, textStatus, errorThrown) => {
                    reject(textStatus);
                }
            });
        });
    }
    url_1.postRequest = postRequest;
})(url = exports.url || (exports.url = {}));
var html;
(function (html) {
    /** TODO ! */
    function showError(message) {
        console.error(message);
    }
    html.showError = showError;
    /** TODO ! */
    function showMessage(message) {
        alert(message);
    }
    html.showMessage = showMessage;
    /** Invoke jQuery.blockUI's '.block()' on the specified element but supports multiple invokation on the same element */
    function block($e) {
        // Insert/increment a block counter as jQuery 'data()'
        var blockCounter = ($e.data('common_blockCounter') | 0) + 1;
        $e.data('common_blockCounter', blockCounter);
        if (blockCounter == 1)
            // This element is not blocked yet
            $e.block(); // TODO: ACA: jQuery.blockUI typings ...
        return $e;
    }
    html.block = block;
    /** Invoke jQuery.blockUI's '.unblock()' on the specified element except if it has been block()ed more than once */
    function unblock($e) {
        // Decrement the block counter in the jQuery 'data()'
        var blockCounter = ($e.data('common_blockCounter') | 0) - 1;
        $e.data('common_blockCounter', blockCounter);
        if (blockCounter < 0) {
            // There is a logic error somewhere...
            showError('INTERNAL ERROR: Unblock count > block count: ' + blockCounter);
            // Reset counter
            blockCounter = 0;
            $e.data('common_blockCounter', 0);
        }
        if (blockCounter == 0)
            // This element is no more blocked by anything else
            $e.unblock(); // TODO: ACA: jQuery.blockUI typings ...
        return $e;
    }
    html.unblock = unblock;
    function contextMenu($triggerControl, items) {
        $triggerControl.contextmenu(() => {
            let clickHandler = null;
            let closeMe = null;
            const $popup = $('<div style="z-index:999;position:absolute;padding:1px;background-color:white;border:1px solid black"></div>');
            items.forEach(item => {
                var $item = $('<div style="cursor:pointer;white-space:nowrap"/>')
                    .text(item.label)
                    .click(() => {
                    closeMe();
                    item.callback();
                });
                $popup.append($item);
            });
            $popup.insertAfter($triggerControl);
            closeMe = () => {
                $popup.remove();
                // Deactivate global click handler
                $(document).unbind('mouseup', clickHandler);
            };
            clickHandler = function (evt) {
                if ((!$popup.is(evt.target))
                    && ($popup.has(evt.target).length == 0)) {
                    // Click not inside the popup
                    if (($triggerControl.is(evt.target))
                        || ($triggerControl.has(evt.target).length != 0))
                        // Click inside the triggering button => Discard
                        return;
                    closeMe();
                }
            };
            // Activate global click handler
            $(document).mouseup(clickHandler);
        });
    }
    html.contextMenu = contextMenu;
    class DropDownDiv {
        constructor(p) {
            var self = this;
            this.$triggerControl = p.$triggerControl;
            this.$content = p.$content;
            var popupTemplate = (p.popupTemplate != null) ? p.popupTemplate : '<div style="z-index:999;position:absolute;display:none;padding:1px"></div>';
            self.shown = false;
            this.$popup = $(popupTemplate)
                .append(self.$content)
                .insertAfter(self.$triggerControl);
            var clickHandler = function (evt) {
                if ((!self.$popup.is(evt.target))
                    && (self.$popup.has(evt.target).length == 0)) {
                    // Click not inside the popup
                    if ((self.$triggerControl.is(evt.target))
                        || (self.$triggerControl.has(evt.target).length != 0))
                        // Click inside the triggering button => Discard
                        return;
                    self.hide();
                }
            };
            self.show = function () {
                if (self.shown)
                    // Already shown
                    return;
                self.$popup.slideDown('fast');
                // Active click handler on the whole document
                $(document).mouseup(clickHandler);
                self.shown = true;
            };
            self.hide = function () {
                if (!self.shown)
                    // Already hidden
                    return;
                self.$popup.slideUp('fast');
                // Deactivate global click handler
                $(document).unbind('mouseup', clickHandler);
                self.shown = false;
            };
            self.$triggerControl.on('click', function () {
                if (self.shown)
                    self.hide();
                else
                    self.show();
            });
            self.$triggerControl.on('keyup', function (evt) {
                if (evt.keyCode == 27) // ESC key pressed
                    self.hide();
                else if (evt.keyCode == 40) // DOWN key pressed
                    self.show();
            });
        }
    }
    html.DropDownDiv = DropDownDiv;
})(html = exports.html || (exports.html = {}));
var events;
(function (events_1) {
    function createEventHandler() {
        return $({});
    }
    events_1.createEventHandler = createEventHandler;
    /** Creates an 'onXXX()' function for event binding */
    function eventBind(eventName, events, self) {
        return function (callback, pp) {
            var handler;
            handler = function (evt, p) {
                if ((pp === null || pp === void 0 ? void 0 : pp.executeOnce) == true)
                    // Unregister myself
                    events.unbind(eventName, handler);
                try {
                    callback(p);
                }
                catch (ex) {
                    console.error('Unexpected error:', ex);
                }
            };
            events.bind(eventName, handler);
            return self;
        };
    }
    events_1.eventBind = eventBind;
    /** Creates a 'triggerXXX()' function for event triggering */
    function eventTrigger(eventName, events) {
        return function (p) {
            events.trigger(eventName, p);
        };
    }
    events_1.eventTrigger = eventTrigger;
})(events = exports.events || (exports.events = {})); // namespace events

},{"child_process":"child_process","fs":"fs","glob":"glob","http":"http","https":"https","jquery":"jquery","jsdom":"jsdom","json5":"json5","knockout":"knockout","moment":"moment","path":"path","process":"process"}],5:[function(require,module,exports){
Object.defineProperty(exports, "__esModule", { value: true });
const moment = require("moment");
class Log {
    constructor(name, parent, onLineAdded) {
        this.parent = parent;
        this.name = name;
        this.nameFull = this.getFullName();
        this.lines = [];
        this.onLineAdded = onLineAdded;
    }
    log(...optionalParams) {
        let args = Array.prototype.slice.call(arguments);
        let line = { date: new Date(), message: args };
        this.lines.push(line);
        if (this.onLineAdded != null)
            this.onLineAdded(this.nameFull, line.date, line.message);
    }
    logLines(text) {
        if (text == null) {
            this.log('<NULL>');
            return;
        }
        var lines = text.split('\n');
        for (let i in lines)
            this.log(lines[i]);
    }
    exception(ex) {
        this.log('*** EXCEPTION:', ex);
    }
    child(name) {
        let l = new Log(name, this, this.onLineAdded);
        this.lines.push({ date: new Date(), child: l });
        return l;
    }
    output() {
        for (let i in this.lines) {
            let line = this.lines[i];
            if (line.child != null) {
                line.child.output();
            }
            else {
                let args = line.message.slice();
                args.unshift(this.nameFull + ':');
                args.unshift(dateString(line.date));
                console.log.apply(console, args);
            }
        }
    }
    getFullName() {
        let name = this.name;
        for (let l = this.parent; l != null; l = l.parent)
            name = l.name + '.' + name;
        return name;
    }
}
function dateString(d) {
    return moment(d).format('YYYY-MM-DD HH:mm:ss.SSS');
}
exports.default = Log;

},{"moment":"moment"}],6:[function(require,module,exports){
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("./logger");
const common = require("./common");
const backup = require("./backup");
const btrfs = require("./btrfs");
const subvolumes = [
    { name: 'homes', path: '/path/to/homes/' },
    { name: 'data', path: '/path/to/data/' },
];
const snapshotsDir = '/path/to/snapshots/';
const backupsDir = '/path/to/backups/';
const backupsTestDir = '/path/to/backups/tests/';
async function main() {
    const log = new logger_1.default('test');
    log.log('*** start');
    try {
        common.init({ log });
        btrfs.config.useSudo = true;
        let isHourly = false;
        let isDaily = false;
        if (common.NOW.minute() == 0) {
            // Hourly is XX:00
            isHourly = true;
            if (common.NOW.hour() == 7) {
                // Daily is 07:00
                isDaily = true;
            }
        }
        // Example hourly snapshots:
        const snapshotTasks = [];
        if (isHourly) {
            log.log('Launch snapshots tasks');
            subvolumes.forEach(item => {
                const task = backup.runSnapshotRequest(log, {
                    name: item.name,
                    subvolume: item.path,
                    snapshotsDir: snapshotsDir,
                    snapshotsRotation: backup.snapshotsRotation_timeMachine,
                });
                snapshotTasks.push(task);
            });
        }
        log.log('Wait for snapshots tasks to terminate');
        await Promise.all(snapshotTasks);
        log.log('Snapshots tasks terminated');
        // Example daily backups
        const backupTasks = [];
        if (isDaily) {
            log.log('Launch backup tasks');
            subvolumes.forEach(item => {
                const task = backup.runBackupRequest(log, {
                    name: item.name,
                    sourceSnapshotsDir: snapshotsDir,
                    sourceSnapshotsRemove: false,
                    destinationBackupsDir: backupsDir,
                    destinationSnapshot: {
                        dir: backupsTestDir,
                        rotation: backup.snapshotsRotation_keepOnlyLast1,
                    },
                });
                backupTasks.push(task);
            });
        }
        log.log('Wait for backups tasks to terminate');
        await Promise.all(backupTasks);
        log.log('Backups tasks terminated');
        log.log('Exit');
    }
    catch (ex) {
        log.exception(ex);
        common.setHasErrors();
    }
    log.log('*** end ; hasErrors', common.hasErrors);
}
main();

},{"./backup":1,"./btrfs":3,"./common":4,"./logger":5}]},{},[6])

//# sourceMappingURL=test.js.map
