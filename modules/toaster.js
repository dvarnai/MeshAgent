/*
Copyright 2018 Intel Corporation

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

var promise = require('promise');

if (process.platform == 'linux' || process.platform == 'darwin' || process.platform == 'freebsd')
{
    function findPath(app)
    {
        var child = require('child_process').execFile('/bin/sh', ['sh']);
        child.stdout.str = '';
        child.stdout.on('data', function (chunk) { this.str += chunk.toString(); });
        if (process.platform == 'linux' || process.platform == 'freebsd')
        {
            child.stdin.write("whereis " + app + " | awk '{ print $2 }'\nexit\n");
        }
        else
        {
            child.stdin.write("whereis " + app + "\nexit\n");
        }
        child.waitExit();
        child.stdout.str = child.stdout.str.trim();
        if (process.platform == 'freebsd' && child.stdout.str == '' && require('fs').existsSync('/usr/local/bin/' + app)) { return ('/usr/local/bin/' + app); }
        return (child.stdout.str == '' ? null : child.stdout.str);
    }
}

function Toaster()
{
    this._ObjectID = 'toaster';
    this.Toast = function Toast(title, caption)
    {
        var retVal = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        retVal.title = title;
        retVal.caption = caption;

        switch (process.platform)
        {
            case 'win32':
                {
                    var GM = require('_GenericMarshal');
                    var kernel32 = GM.CreateNativeProxy('kernel32.dll');
                    kernel32.CreateMethod('ProcessIdToSessionId');
                    var psid = GM.CreateVariable(4);
                    var consoleUid = 0;
                    try
                    {
                        consoleUid = require('user-sessions').consoleUid();
                    }
                    catch (e)
                    {
                        retVal._rej('Cannot display user notification when a user is not logged in');
                        return (retVal);
                    }
                    if (kernel32.ProcessIdToSessionId(process.pid, psid).Val == 0)
                    {
                        retVal._rej('internal error'); return (retVal);
                    }

                    if (consoleUid == psid.toBuffer().readUInt32LE())
                    {
                        // We are running on the physical console
                        retVal._child = require('ScriptContainer').Create({ processIsolation: true });
                    }
                    else
                    {
                        // We need so spawn the ScriptContainer into the correct session
                        retVal._child = require('ScriptContainer').Create({ processIsolation: true, sessionId: consoleUid });
                    }
                    retVal._child.parent = retVal;
                    retVal._child.on('exit', function (code) { this.parent._res('DISMISSED'); });
                    retVal._child.addModule('win-console', getJSModule('win-console'));
                    retVal._child.addModule('win-message-pump', getJSModule('win-message-pump'));

                    var str = "\
                            try{\
                            var toast = require('win-console');\
                            var balloon = toast.SetTrayIcon({ szInfo: '" + caption + "', szInfoTitle: '" + title + "', balloonOnly: true });\
                            balloon.on('ToastDismissed', function(){process.exit();});\
                            }\
                            catch(e)\
                            {\
                                require('ScriptContainer').send(e);\
                            }\
                                require('ScriptContainer').send('done');\
                            ";
                    retVal._child.ExecuteString(str);
                    return (retVal);
                }
                break;
	    case 'freebsd':
            case 'linux':
                {
                    try
                    {
                        retVal.consoleUid = require('user-sessions').consoleUid();
                        retVal.xinfo = require('monitor-info').getXInfo(retVal.consoleUid);
			            retVal.username = require('user-sessions').getUsername(retVal.consoleUid);
                    }
                    catch (xxe)
                    {
                        retVal._rej(xxe);
                        return (retVal);
                    }
                    var util = findPath('zenity');
                    if (util)
                    {
                        // Use ZENITY
                        retVal.child = require('child_process').execFile(util, ['zenity', '--notification', '--title=' + title, '--text=' + caption, '--timeout=5'], { uid: retVal.consoleUid, env: { XAUTHORITY: retVal.xinfo.xauthority, DISPLAY: retVal.xinfo.display } });
                        retVal.child.parent = retVal;
                        retVal.child.stderr.str = '';
                        retVal.child.stderr.on('data', function (chunk) { this.str += chunk.toString(); this.parent.kill(); });
                        retVal.child.stdout.on('data', function (chunk) { });
                        retVal.child.on('exit', function (code)
                        {
                            if (this.stderr.str.trim() != '')
                            {
                                if ((util = findPath('notify-send')) && this.stderr.str.split('GLib-CRITICAL').length > 1)
                                {
                                    // This is a bug in zenity, so we should try notify-send
                                    if (process.env['DISPLAY'])
                                    {
                                        // DISPLAY is set, so we good to go
                                        this.parent.child = require('child_process').execFile(util, ['notify-send', this.parent.title, this.parent.caption]);
                                        this.parent.child.parent = this.parent;
                                    }
                                    else
                                    {
                                        // We need to find the DISPLAY to use
                                        var username = require('user-sessions').getUsername(consoleUid);
                                        this.parent.child = require('child_process').execFile('/bin/sh', ['sh']);
                                        this.parent.child.parent = this.parent;
                                        this.parent.child.stdin.write('su - ' + username + ' -c "DISPLAY=' + display + ' notify-send \'' + this.parent.title + '\' \'' + this.parent.caption + '\'"\n');
                                        this.parent.child.stdin.write('exit\n');
                                    }
                                    this.parent.child.stdout.on('data', function (chunk) { });
                                    this.parent.child.waitExit();

                                    // NOTIFY-SEND has a bug where timeouts don't work, so the default is 5 seconds
                                    this.parent._timeout = setTimeout(function onFakeDismissed(obj)
                                    {
                                        obj._res('DISMISSED');
                                    }, 10000, this.parent);
                                }
                                else
{
                                    // Fake a toast using zenity --info
                                    util = findPath('zenity');
                                    this.parent.child = require('child_process').execFile(util, ['zenity', '--info', '--title=' + this.parent.title, '--text=' + this.parent.caption, '--timeout=5'], { uid: this.parent.consoleUid, env: { XAUTHORITY: this.parent.xinfo.xauthority, DISPLAY: this.parent.xinfo.display } });
                                    this.parent.child.parent = this.parent;
                                    this.parent.child.stderr.on('data', function (chunk) { });
                                    this.parent.child.stdout.on('data', function (chunk) { });
                                    this.parent.child.on('exit', function (code)
                                    {
                                        this.parent._res('DISMISSED');
                                    });
                                }
                            }
                            else
                            {
                                this.parent._res('DISMISSED');
                            }
                        });
                    }
                    else
                    {
                        util = findPath('kdialog');
                        if (util) 
			            {
                            // use KDIALOG
                            var xdg = require('user-sessions').findEnv(retVal.consoleUid, 'XDG_RUNTIME_DIR'); if (xdg == null) { xdg = ''; }
                            if (!retVal.xinfo || !retVal.xinfo.display || !retVal.xinfo.xauthority)
                            {
                                retVal._rej('Internal Error');
                                return (retVal);
                            }
		
                            retVal._notify = require('child_process').execFile(util, ['kdialog', '--title', retVal.title, '--passivepopup', retVal.caption, '5'], { uid: retVal.consoleUid, env: { DISPLAY: retVal.xinfo.display, XAUTHORITY: retVal.xinfo.xauthority, XDG_RUNTIME_DIR: xdg } });
                            retVal._notify.parent = retVal;
                            retVal._notify.stdout.on('data', function (chunk) { });
                            retVal._notify.stderr.on('data', function (chunk) { });
                            retVal._notify.on('exit', function (code) { this.parent._res('DISMISSED'); });
                        }
                        else
                        {
                            retVal._rej('Zenity/KDialog not found');
                        }
                    }
                }
                break;
            case 'darwin':
                retVal._toast = require('message-box').notify(title, caption);
                retVal._toast.parent = retVal;
                retVal._toast.then(function (v) { this.parent._res(v); }, function (e) { this.parent._rej(e); });
                break;
        }

        return (retVal);
    };
}

module.exports = new Toaster();
