(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
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

},{"child_process":"child_process","fs":"fs","glob":"glob","http":"http","https":"https","jquery":"jquery","jsdom":"jsdom","json5":"json5","knockout":"knockout","moment":"moment","path":"path","process":"process"}],2:[function(require,module,exports){
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

},{"moment":"moment"}],3:[function(require,module,exports){
Object.defineProperty(exports, "__esModule", { value: true });
exports.clickHelloWho = exports.main = exports.koHelloWho = exports.log = exports.$blockingDiv = exports.config = exports.humanFileSize = void 0;
const path = require("path");
const url = require("url");
const moment = require("moment");
const electron = require("electron");
const common = require("./common");
const Self = require("./testGui");
const logger_1 = require("./logger");
var common_1 = require("./common");
Object.defineProperty(exports, "humanFileSize", { enumerable: true, get: function () { return common_1.humanFileSize; } });
// nb: below are there only for use in the console:
exports.require = require;
exports.common = common;
async function main(p) {
    self = this;
    exports.log = new logger_1.default('gui', /*parent*/ undefined, /*onLineAdded*/ (name, date, args) => {
        const a = args.slice();
        a.unshift(`${moment(date).format('HH:mm:ss.SSS')} ${name}:`);
        console.log.apply(console, a);
    });
    exports.log.log('START');
    common.init({ log: exports.log });
    exports.$blockingDiv = p.$blockingDiv;
    exports.koHelloWho = ko.observable(null);
    const configFileName = path.basename(__filename).replace(/\.html$/, '.json');
    const configFilePath = path.join(__dirname, configFileName);
    exports.log.log(`Load config at '${configFilePath}'`);
    exports.config = await common.readJSON({ filePath: configFilePath });
    ko.applyBindings(self, p.$appContainer[0]);
    exports.log.log('END');
}
exports.main = main;
async function clickHelloWho() {
    const log = Self.log.child('clickHelloWho');
    log.log('START');
    common.html.block(exports.$blockingDiv);
    try {
        log.log({ CWD: process.cwd() });
        (0, exports.koHelloWho)(`${exports.config.helloWho} !`);
    }
    catch (ex) {
        log.exception(ex);
    }
    finally {
        common.html.unblock(exports.$blockingDiv);
        log.log('END');
    }
}
exports.clickHelloWho = clickHelloWho;
// Entry points
if (electron.app == null) {
    // Within HTML => Register this module as 'application'
    window['application'] = this;
}
else {
    // Within Electron CLI => Open window
    electron.app.once('ready', () => {
        exports.log = new logger_1.default('electron', /*parent*/ undefined, /*onLineAdded*/ (name, date, args) => {
            const a = args.slice();
            a.unshift(name + ':');
            console.log.apply(console, a);
        });
        // Create a new window
        const window = new electron.BrowserWindow({ width: 1024,
            height: 768,
            titleBarStyle: 'hiddenInset',
        });
        const loadPage = function () {
            window.loadURL(url.format({
                pathname: path.join(__dirname, 'testGui.html'),
                protocol: 'file:',
                slashes: true,
            }));
        };
        const menu = new electron.Menu();
        menu.append(new electron.MenuItem({ label: 'show devtools', click: () => { window.webContents.openDevTools(); } }));
        menu.append(new electron.MenuItem({ label: 'refresh', click: () => { loadPage(); } }));
        window.setMenu(menu);
        window.webContents.openDevTools();
        loadPage();
    });
}

},{"./common":1,"./logger":2,"./testGui":3,"electron":"electron","moment":"moment","path":"path","url":"url"}]},{},[3])

//# sourceMappingURL=testGui.js.map
