/*
Copyright 2019 Intel Corporation

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/


const MB_OK = 0x00000000;
const MB_OKCANCEL                = 0x00000001;
const MB_ABORTRETRYIGNORE        = 0x00000002;
const MB_YESNOCANCEL             = 0x00000003;
const MB_YESNO                   = 0x00000004;
const MB_RETRYCANCEL             = 0x00000005;

const MB_DEFBUTTON1              = 0x00000000;
const MB_DEFBUTTON2              = 0x00000100;
const MB_DEFBUTTON3              = 0x00000200;
const MB_ICONHAND                = 0x00000010;
const MB_ICONQUESTION            = 0x00000020;
const MB_ICONEXCLAMATION         = 0x00000030;
const MB_ICONASTERISK            = 0x00000040;

const IDOK     = 1;
const IDCANCEL = 2;
const IDABORT  = 3;
const IDRETRY  = 4;
const IDIGNORE = 5;
const IDYES    = 6;
const IDNO     = 7;

var promise = require('promise');
var childScript = "\
        require('ScriptContainer').on('data', function (j)\
        {\
            switch(j.command)\
            {\
                case 'messageBox':\
                    if(process.platform == 'win32')\
                    {\
                        var GM = require('_GenericMarshal');\
                        var user32 = GM.CreateNativeProxy('user32.dll');\
                        user32.CreateMethod('MessageBoxA');\
                        user32.MessageBoxA.async(0, GM.CreateVariable(j.caption), GM.CreateVariable(j.title), " + (MB_YESNO | MB_DEFBUTTON2 | MB_ICONEXCLAMATION).toString() + ").then(\
                        function(r)\
                        {\
                            if(r.Val == " + IDYES.toString() + ")\
                            {\
                                require('ScriptContainer').send(" + IDYES.toString() + ");\
                            }\
                            else\
                            {\
                                require('ScriptContainer').send(" + IDNO.toString() + ");\
                            }\
                            process.exit();\
                        });\
                    }\
                    break;\
            }\
        });\
    ";

function messageBox()
{
    this._ObjectID = 'message-box';
    this.create = function create(title, caption, timeout)
    {
        var GM = require('_GenericMarshal');
        var kernel32 = GM.CreateNativeProxy('kernel32.dll');
        kernel32.CreateMethod('ProcessIdToSessionId');
        var psid = GM.CreateVariable(4);
        if (kernel32.ProcessIdToSessionId(process.pid, psid).Val == 0)
        {
            ret._rej('Internal Error');
            return (ret);
        }

        if (timeout == null) { timeout = 10; }
        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        var options = { executionTimeout: timeout };

        try
        {
            options.sessionId = require('user-sessions').consoleUid();
            if (options.sessionId == psid.toBuffer().readUInt32LE()) { delete options.sessionId; }
        }
        catch(ee)
        {
            ret._rej('No logged on users');
            return (ret);
        }
        ret._title = title;
        ret._caption = caption;
        ret._container = require('ScriptContainer').Create(options);
        ret._container.promise = ret;
        ret._container.on('data', function (j)
        {
            if(j == IDYES)
            {
                this.promise._res();
            }
            else
            {
                this.promise._rej('Denied');
            }
        });
        ret._container.on('exit', function ()
        {
            this.promise._rej('Timeout');
        });
        ret._container.ExecuteString(childScript);
        ret._container.send({ command: 'messageBox', caption: caption, title: title });
        return (ret);
    };
}


function linux_messageBox()
{
    this._ObjectID = 'message-box';
    this.create = function create(title, caption, timeout)
    {
        if (timeout == null) { timeout = 10; }
        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        var zenity = '', kdialog = '';
        var uid;    
        var xinfo;

        try
        {
            uid = require('user-sessions').consoleUid();
            xinfo = require('monitor-info').getXInfo(uid);
        }
        catch(e)
        {
            uid = 0;
            xinfo = require('monitor-info').getXInfo(0);
        }

        if (xinfo == null)
        {
            ret._rej('This system cannot display a user dialog box when a user is not logged in');
            return (ret);
        }

        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = '';
        child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
        child.stdin.write("whereis zenity | awk '{ print $2 }'\nexit\n");
        child.waitExit();
        zenity = child.stdout.str.trim();
        if (process.platform == 'freebsd' && zenity == '' && require('fs').existsSync('/usr/local/bin/zenity')) { zenity = '/usr/local/bin/zenity'; }
        if (zenity != '')
        {
            // GNOME/ZENITY
            ret.child = require('child_process').execFile(zenity, ['zenity', '--question', '--title=' + title, '--text=' + caption, '--timeout=' + timeout], { uid: uid, env: { XAUTHORITY: xinfo.xauthority, DISPLAY: xinfo.display } });
            ret.child.promise = ret;
            ret.child.stderr.on('data', function (chunk) { });
            ret.child.stdout.on('data', function (chunk) { });
            ret.child.on('exit', function (code)
            {
                switch (code)
                {
                    case 0:
                        this.promise._res();
                        break;
                    case 1:
                        this.promise._rej('denied');
                        break;
                    default:
                        this.promise._rej('timeout');
                        break;
                }
            });
        }
        else
        {
            child = require('child_process').execFile('/bin/sh', ['sh']);
            child.stdout.str = '';
            child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
            child.stdin.write("whereis kdialog | awk '{ print $2 }'\nexit\n");
            child.waitExit();
            kdialog = child.stdout.str.trim();
            if (process.platform == 'freebsd' && kdialog == '' && require('fs').existsSync('/usr/local/bin/kdialog')) { kdialog = '/usr/local/bin/kdialog'; }
            if (kdialog == '') { ret._rej('Platform not supported (zenity or kdialog not found)'); return (ret); }
            if (process.platform != 'freebsd' && process.env['DISPLAY'])
            {
                ret.child = require('child_process').execFile(kdialog, ['kdialog', '--title', title, '--yesno', caption]);
                ret.child.promise = ret;
            }
            else
            {
                var xdg = require('user-sessions').findEnv(uid, 'XDG_RUNTIME_DIR'); if (xdg == null) { xdg = ''; }
                if (!xinfo || !xinfo.display || !xinfo.xauthority) { ret._rej('Interal Error, could not determine X11/XDG env'); return (ret); }
                ret.child = require('child_process').execFile(kdialog, ['kdialog', '--title', title, '--yesno', caption], { uid: uid, env: { DISPLAY: xinfo.display, XAUTHORITY: xinfo.xauthority, XDG_RUNTIME_DIR: xdg } });
                ret.child.promise = ret;
            }
            ret.child.stdout.on('data', function (chunk) { });
            ret.child.stderr.on('data', function (chunk) { });
            ret.child.on('exit', function (code)
            {
                switch (code) {
                    case 0:
                        this.promise._res();
                        break;
                    case 1:
                        this.promise._rej('denied');
                        break;
                    default:
                        this.promise._rej('timeout');
                        break;
                }
            });
        }
        return (ret);
    };
}

if (process.platform == 'darwin')
{
    function translateObject(obj)
    {
        var j = JSON.stringify(obj);
        var b = Buffer.alloc(j.length + 4);
        b.writeUInt32LE(j.length + 4);
        Buffer.from(j).copy(b, 4);
        return (b);
    }
}

function macos_messageBox()
{
    this._ObjectID = 'message-box';
    this._initIPCBase = function _initIPCBase()
    {
        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });

        try
        {
            ret.uid = require('user-sessions').consoleUid();
        }
        catch (e)
        {
            ret._rej(e);
            return (ret);
        }

        ret.path = '/var/tmp/' + process.execPath.split('/').pop() + '_ev';
        var n;

        try
        {
            n = require('tls').generateRandomInteger('1', '99999');
        }
        catch (e)
        {
            n = 0;
        }
        while (require('fs').existsSync(ret.path + n))
        {
            try {
                n = require('tls').generateRandomInteger('1', '99999');
            }
            catch (e) {
                ++n;
            }
        }
        ret.path = ret.path + n;
        ret.tmpServiceName = 'meshNotificationServer' + n;
        return (ret);
    };
    
    this.create = function create(title, caption, timeout)
    {
        // Start Local Server
        var ret = this._initIPCBase();
        ret.title = title; ret.caption = caption; ret.timeout = timeout;
        ret.server = this.startMessageServer(ret);
        ret.server.ret = ret;
        ret.server.on('connection', function (c)
        {
            this._connection = c;
            c.promise = this.ret;
            c.on('data', function (buffer)
            {
                if (buffer.len < 4 || buffer.readUInt32LE(0) > buffer.len) { this.unshift(buffer); }
                var p = JSON.parse(buffer.slice(4, buffer.readUInt32LE(0)).toString());
                switch (p.command)
                {
                    case 'ERROR':
                        this.promise._rej(p.reason);
                        break;
                    case 'DIALOG':
                        if (p.timeout)
                        {
                            this.promise._rej('TIMEOUT');
                        }
                        else
                        {
                            if (p.button == 'Yes')
                            {
                                this.promise._res(p.button);
                            }
                            else
                            {
                                this.promise._rej('denied');
                            }
                        }
                        break;
                }
            });
            c.write(translateObject({ command: 'DIALOG', title: this.ret.title, caption: this.ret.caption, icon: 'caution', buttons: ['"Yes"', '"No"'], buttonDefault: 2, timeout: this.ret.timeout }));
        });

        return (ret);
    };
    this.notify = function notify(title, caption)
    {
        // Start Local Server
        var ret = this._initIPCBase();
        ret.title = title; ret.caption = caption; 
        ret.server = this.startMessageServer(ret);
        ret.server.ret = ret;
        ret.server.on('connection', function (c)
        {
            this._connection = c;
            c.promise = this.ret;
            c.on('data', function (buffer)
            {
                if (buffer.len < 4 || buffer.readUInt32LE(0) > buffer.len) { this.unshift(buffer); }
                var p = JSON.parse(buffer.slice(4, buffer.readUInt32LE(0)).toString());
                switch (p.command)
                {
                    case 'ERROR':
                        this.promise._rej(p.reason);
                        break;
                    case 'NOTIFY':

                        this.promise._res();
                        break;
                }
            });
            c.write(translateObject({ command: 'NOTIFY', title: this.ret.title, caption: this.ret.caption }));
        });

        return (ret);
    };
    this.startClient = function startClient(options)
    {
        // Create the Client
        console.log('Starting Client...');

        options.osversion = require('service-manager').getOSVersion();
        options.uid = require('user-sessions').consoleUid();
        this.client = require('net').createConnection(options);
        this.client._options = options;
        this.client.on('data', function (buffer)
        {
            if (buffer.len < 4 || buffer.readUInt32LE(0) > buffer.len) { this.unshift(buffer); }
            var p = JSON.parse(buffer.slice(4, buffer.readUInt32LE(0)).toString());
            switch (p.command)
            {
                case 'NOTIFY':
                    this._shell = require('child_process').execFile('/bin/sh', ['sh']);
                    this._shell.stdout.str = ''; this._shell.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                    this._shell.stderr.str = ''; this._shell.stderr.on('data', function (chunk) { this.str += chunk.toString(); });
                    this._shell.stdin.write('osascript -e \'tell current application to display notification "' + p.caption + '" with title "' + p.title + '"\'\nexit\n');
                    this._shell.waitExit();
                    if (this._shell.stderr.str != '')
                    {
                        this.end(translateObject({ command: 'ERROR', reason: this._shell.stderr.str }));
                    }
                    else
                    {
                        this.end(translateObject({ command: 'NOTIFY', status: 0 }));
                    }
                    break;
                case 'DIALOG':
                    var timeout = p.timeout ? (' giving up after ' + p.timeout) : '';
                    var icon = p.icon ? ('with icon ' + p.icon) : '';
                    var buttons = p.buttons ? ('buttons {' + p.buttons.toString() + '}') : '';
                    if (p.buttonDefault != null)
                    {
                        buttons += (' default button ' + p.buttonDefault)
                    }
                    this._shell = require('child_process').execFile('/bin/sh', ['sh']);
                    this._shell.stdout.str = ''; this._shell.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
                    this._shell.stderr.str = ''; this._shell.stderr.on('data', function (chunk) { this.str += chunk.toString(); });
                    this._shell.stdin.write('osascript -e \'tell current application to display dialog "' + p.caption + '" with title "' + p.title + '" ' + icon + ' ' + buttons + timeout + '\' | awk \'{ c=split($0, tokens, ","); split(tokens[1], val, ":"); if(c==1) { print val[2] } else { split(tokens[2], gu, ":"); if(gu[2]=="true") { print "_TIMEOUT_" } else { print val[2]  }  } }\'\nexit\n');
                    this._shell.waitExit();
                    if (this._shell.stderr.str != '')
                    {
                        this.end(translateObject({ command: 'ERROR', reason: this._shell.stderr.str }));
                    }
                    else
                    {
                        if (this._shell.stdout.str.trim() == '_TIMEOUT_')
                        {
                            this.end(translateObject({ command: 'DIALOG', timeout: true }));
                        }
                        else
                        {
                            this.end(translateObject({ command: 'DIALOG', button: this._shell.stdout.str.trim() }));
                        }
                    }
                    break;
                default:
                    break;
            }
        });
        this.client.on('error', function () { this.uninstall(); }).on('end', function () { this.uninstall(); });
        this.client.uninstall = function ()
        {
            // Need to uninstall ourselves
            var child = require('child_process').execFile(process.execPath, [process.execPath.split('/').pop(), '-exec', "var s=require('service-manager').manager.getLaunchAgent('" + this._options.service + "', " + this._options.uid + "); s.unload(); require('fs').unlinkSync(s.plist);process.exit();"], { detached: true, type: require('child_process').SpawnTypes.DETACHED });
            child.waitExit();
        };
        return (this.client);
    };
    this.startMessageServer = function startMessageServer(options)
    {
        if (require('fs').existsSync(options.path)) { require('fs').unlinkSync(options.path); }
        options.writableAll = true;

        var ret = require('net').createServer();
        ret.uid = require('user-sessions').consoleUid();
        ret.osversion = require('service-manager').getOSVersion();
        ret._options = options;
        ret.timer = setTimeout(function (obj)
        {
            obj.close();
            obj._options._rej('Connection timeout');
        }, 5000, ret);
        ret.listen(options);
        ret.on('connection', function (c)
        {
            clearTimeout(this.timer);
        });
        ret.on('~', function ()
        {
            require('fs').unlinkSync(this._options.path);
        });

        require('service-manager').manager.installLaunchAgent(
            {
                name: options.tmpServiceName, servicePath: process.execPath, startType: 'AUTO_START', uid: ret.uid,
                sessionTypes: ['Aqua'], parameters: ['-exec', "require('message-box').startClient({ path: '" + options.path + "', service: '" + options.tmpServiceName + "' }).on('end', function () { process.exit(); }).on('error', function () { process.exit(); });"]
            });
        require('service-manager').manager.getLaunchAgent(options.tmpServiceName, ret.uid).load();

        return (ret);
    };
}


switch(process.platform)
{
    case 'win32':
        module.exports = new messageBox();
        break;
    case 'linux':
    case 'freebsd':
        module.exports = new linux_messageBox();
        break;
    case 'darwin':
        module.exports = new macos_messageBox();
        break;
}






