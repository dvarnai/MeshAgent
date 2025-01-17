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

var promise = require('promise');

var AnyPropertyType = 0;
var CurrentTime = 0;
var None = 0;
var PropModeReplace = 0;
var SelectionClear = 29;
var SelectionNotify = 31;
var SelectionRequest = 30;
var XA_PRIMARY = 1;

function nativeAddModule(name)
{
    var value = getJSModule(name);
    var ret = "duk_peval_string_noresult(ctx, \"addModule('" + name + "', Buffer.from('" + Buffer.from(value).toString('base64') + "', 'base64').toString());\");";
    if (ret.length > 16300)
    {
        // MS Visual Studio has a maxsize limitation
        var tmp = Buffer.from(value).toString('base64');
        ret = 'char *_' + name.split('-').join('') + ' = ILibMemory_Allocate(' + (tmp.length + value.length + 2) + ', 0, NULL, NULL);\n';
        var i = 0;
        while (i < tmp.length)
        {
            var chunk = tmp.substring(i, i+16000);
            ret += ('memcpy_s(_' + name.split('-').join('') + ' + ' + i + ', ' + (tmp.length - i) + ', "' + chunk + '", ' + chunk.length + ');\n');
            i += chunk.length;
        }
        ret += ('ILibBase64DecodeEx((unsigned char*)_' + name.split('-').join('') + ', ' + tmp.length + ', (unsigned char*)_' + name.split('-').join('') + ' + ' + tmp.length + ');\n');
        ret += ('duk_push_global_object(ctx);duk_get_prop_string(ctx, -1, "addModule");duk_swap_top(ctx, -2);duk_push_string(ctx, "' + name + '");duk_push_string(ctx, _' + name.split('-').join('') + ' + ' + tmp.length + ');\n');
        ret += ('duk_pcall_method(ctx, 2); duk_pop(ctx);\n');
        ret += ('free(_' + name.split('-').join('') + ');\n');
    }
    module.exports(ret);
}
function dispatchRead(sid)
{
    var id = 0;

    if(sid==null)
    {
        if (process.platform == 'win32')
        {
            var active = require('user-sessions').Current().Active;
            if (active.length > 0)
            {
                id = parseInt(active[0].SessionId);
            }
        }
        else
        {
            id = require('user-sessions').consoleUid();
        }
    }
    else
    {
        id = sid;
    }

    if(id == 0)
    {
        return (module.exports.read());
    }
    else
    {
        var childProperties = { sessionId: id };
        if (process.platform == 'linux')
        {
            xinfo = require('monitor-info').getXInfo(id);
            childProperties.env = { XAUTHORITY: xinfo.xauthority, DISPLAY: xinfo.display };
        }

        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        ret.success = false;
        ret.master = require('ScriptContainer').Create(childProperties);
        ret.master.promise = ret;
        ret.master.on('data', function (d)
        {
            this.promise.success = true;
            this.promise._res(d);
            this.exit();
        });
        ret.master.on('exit', function (code)
        {
            if (!this.promise.success)
            {
                this.promise._rej('Error reading clipboard');
            }
            delete this.promise.master;
        });
        ret.master.ExecuteString("var parent = require('ScriptContainer'); require('clipboard').read().then(function(v){parent.send(v);}, function(e){console.error(e);process.exit();});");
        return (ret);
    }
}

function dispatchWrite(data, sid)
{
    var id = 0;

    if(sid == null)
    {
        if(process.platform == 'win32')
        {
            var active = require('user-sessions').Current().Active;
            if(active.length>0)
            {
                id = parseInt(active[0].SessionId);
            }
        }
        else
        {
            id = require('user-sessions').consoleUid();
        }
    }
    else
    {
        id = sid;
    }

    if(id == 0)
    {
        module.exports(data);
    }
    else
    {
        var childProperties = { sessionId: id };
        if (process.platform == 'linux')
        {
            xinfo = require('monitor-info').getXInfo(id);
            childProperties.env = { XAUTHORITY: xinfo.xauthority, DISPLAY: xinfo.display };
        }

        if (process.platform == 'win32' || !this.master)
        {
            this.master = require('ScriptContainer').Create(childProperties);
            this.master.parent = this;
            this.master.on('exit', function (code) { if (this.parent.master) { delete this.parent.master; } });
            this.master.on('data', function (d) { console.log(d); });
            this.master.ExecuteString("var parent = require('ScriptContainer'); parent.on('data', function(d){try{require('clipboard')(d);}catch(e){require('ScriptContainer').send(e);}if(process.platform == 'win32'){process.exit();}});");
        }
        this.master.send(data);

        if(process.platform == 'linux' && this.master)
        {
            if(this.master.timeout)
            {
                clearTimeout(this.master.timeout);
                this.master.timeout = null;
            }
            this.master.timeout = setTimeout(function (self)
            {
                self.master.exit();
                self.master = null;
            }, 60000, this);
        }

    }
}

function lin_readtext()
{
    var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    try
    {
        require('monitor-info')
    }
    catch(exc)
    {
        ret._rej(exc);
        return (ret);
    }

    var X11 = require('monitor-info')._X11;
    if (!X11)
    {
        ret._rej('X11 required for Clipboard Manipulation');
    }
    else
    {
        var GM = require('monitor-info')._gm;


        ret._getInfoPromise = require('monitor-info').getInfo();
        ret._getInfoPromise._masterPromise = ret;
        ret._getInfoPromise.then(function (mon)
        {
            if (mon.length > 0)
            {
                var white = X11.XWhitePixel(mon[0].display, mon[0].screenId).Val;

                this._masterPromise.CLIPID = X11.XInternAtom(mon[0].display, GM.CreateVariable('CLIPBOARD'), 0);
                this._masterPromise.FMTID = X11.XInternAtom(mon[0].display, GM.CreateVariable('UTF8_STRING'), 0);
                this._masterPromise.PROPID = X11.XInternAtom(mon[0].display, GM.CreateVariable('XSEL_DATA'), 0);
                this._masterPromise.INCRID = X11.XInternAtom(mon[0].display, GM.CreateVariable('INCR'), 0);
                this._masterPromise.ROOTWIN = X11.XRootWindow(mon[0].display, mon[0].screenId);
                this._masterPromise.FAKEWIN = X11.XCreateSimpleWindow(mon[0].display, this._masterPromise.ROOTWIN, 0, 0, mon[0].right, 5, 0, white, white);

                X11.XSync(mon[0].display, 0);
                X11.XConvertSelection(mon[0].display, this._masterPromise.CLIPID, this._masterPromise.FMTID, this._masterPromise.PROPID, this._masterPromise.FAKEWIN, CurrentTime);
                X11.XSync(mon[0].display, 0);


                this._masterPromise.DescriptorEvent = require('DescriptorEvents').addDescriptor(X11.XConnectionNumber(mon[0].display).Val, { readset: true });
                this._masterPromise.DescriptorEvent._masterPromise = this._masterPromise;
                this._masterPromise.DescriptorEvent._display = mon[0].display;
                this._masterPromise.DescriptorEvent.on('readset', function (fd)
                {
                    var XE = GM.CreateVariable(1024);
                    while (X11.XPending(this._display).Val)
                    {
                        X11.XNextEventSync(this._display, XE);
                        if(XE.Deref(0, 4).toBuffer().readUInt32LE() == SelectionNotify)
                        {
                            var id = GM.CreatePointer();
                            var bits = GM.CreatePointer();
                            var sz = GM.CreatePointer();
                            var tail = GM.CreatePointer();
                            var result = GM.CreatePointer();

                            X11.XGetWindowProperty(this._display, this._masterPromise.FAKEWIN, this._masterPromise.PROPID, 0, 65535, 0, AnyPropertyType, id, bits, sz, tail, result);

                            this._masterPromise._res(result.Deref().String);
                            X11.XFree(result.Deref());
                            X11.XDestroyWindow(this._display, this._masterPromise.FAKEWIN);

                            this.removeDescriptor(fd);
                            break;
                        }
                    }
                });
            }
        }, console.error);
    }
    return (ret);
}
function lin_copytext(txt)
{
    var X11 = require('monitor-info')._X11;
    if (!X11)
    {
        throw('X11 required for Clipboard Manipulation');
    }
    else
    {
        var GM = require('monitor-info')._gm;
        var ret = new promise(function (res, rej) { this._res = res; this._rej = rej; });
        ret._txt = txt;
        ret._getInfoPromise = require('monitor-info').getInfo();
        ret._getInfoPromise._masterPromise = ret;
        ret._getInfoPromise.then(function (mon)
        {
            if (mon.length > 0)
            {
                var white = X11.XWhitePixel(mon[0].display, mon[0].screenId).Val;
                this._masterPromise.CLIPID = X11.XInternAtom(mon[0].display, GM.CreateVariable('CLIPBOARD'), 0);
                this._masterPromise.FMTID = X11.XInternAtom(mon[0].display, GM.CreateVariable('UTF8_STRING'), 0);
                this._masterPromise.ROOTWIN = X11.XRootWindow(mon[0].display, mon[0].screenId);
                this._masterPromise.FAKEWIN = X11.XCreateSimpleWindow(mon[0].display, this._masterPromise.ROOTWIN, 0, 0, mon[0].right, 5, 0, white, white);

                X11.XSetSelectionOwner(mon[0].display, XA_PRIMARY, this._masterPromise.FAKEWIN, CurrentTime);
                X11.XSetSelectionOwner(mon[0].display, this._masterPromise.CLIPID, this._masterPromise.FAKEWIN, CurrentTime);
                X11.XSync(mon[0].display, 0);

                this._masterPromise.DescriptorEvent = require('DescriptorEvents').addDescriptor(X11.XConnectionNumber(mon[0].display).Val, { readset: true });
                this._masterPromise.DescriptorEvent._masterPromise = this._masterPromise;
                this._masterPromise.DescriptorEvent._display = mon[0].display;
                this._masterPromise.DescriptorEvent.on('readset', function (fd)
                {
                    var XE = GM.CreateVariable(1024);
                    while (X11.XPending(this._display).Val)
                    {
                        X11.XNextEventSync(this._display, XE);
                        switch (XE.Deref(0, 4).toBuffer().readUInt32LE())
                        {
                            case SelectionClear:
                                console.info1('Somebody else owns clipboard');
                                break;
                            case SelectionRequest:
                                console.info1('Somebody wants us to send them data');

                                var ev = GM.CreateVariable(GM.PointerSize == 8 ? 72 : 36);
                                var sr_requestor = GM.PointerSize == 8 ? XE.Deref(40, 8) : XE.Deref(20, 4);
                                var sr_selection = GM.PointerSize == 8 ? XE.Deref(48, 8) : XE.Deref(24, 4);
                                var sr_property = GM.PointerSize == 8 ? XE.Deref(64, 8) : XE.Deref(32, 4);
                                var sr_target = GM.PointerSize == 8 ? XE.Deref(56, 8) : XE.Deref(28, 4);
                                var sr_time = GM.PointerSize == 8 ? XE.Deref(72, 8) : XE.Deref(36, 4);
                                var sr_display = GM.PointerSize == 8 ? XE.Deref(24, 8) : XE.Deref(12, 4);

                                ev.Deref(0, 4).toBuffer().writeUInt32LE(SelectionNotify);
                                var ev_requestor = GM.PointerSize == 8 ? ev.Deref(32, 8) : ev.Deref(16, 4);
                                var ev_selection = GM.PointerSize == 8 ? ev.Deref(40, 8) : ev.Deref(20, 4);
                                var ev_target = GM.PointerSize == 8 ? ev.Deref(48, 8) : ev.Deref(24, 4);
                                var ev_time = GM.PointerSize == 8 ? ev.Deref(64, 8) : ev.Deref(32, 4);
                                var ev_property = GM.PointerSize == 8 ? ev.Deref(56, 8) : ev.Deref(28, 4);
                                var cliptext = GM.CreateVariable(this._masterPromise._txt);

                                sr_requestor.Deref().pointerBuffer().copy(ev_requestor.toBuffer()); console.info1('REQUESTOR: ' + sr_requestor.Deref().pointerBuffer().toString('hex'));
                                sr_selection.Deref().pointerBuffer().copy(ev_selection.toBuffer()); console.info1('SELECTION: ' + sr_selection.Deref().pointerBuffer().toString('hex'));
                                sr_target.Deref().pointerBuffer().copy(ev_target.toBuffer()); console.info1('TARGET: ' + sr_target.Deref().pointerBuffer().toString('hex'));
                                sr_time.Deref().pointerBuffer().copy(ev_time.toBuffer()); console.info1('TIME: ' + sr_time.Deref().pointerBuffer().toString('hex'));

                                if (sr_target.Deref().Val == this._masterPromise.FMTID.Val)
                                {
                                    console.info1('UTF8 Request for: ' + cliptext.String);
                                    console.info1(sr_display.Val, sr_requestor.Deref().Val, sr_property.Deref().Val, sr_target.Deref().Val);
                                    X11.XChangeProperty(sr_display.Deref(), sr_requestor.Deref(), sr_property.Deref(), sr_target.Deref(), 8, PropModeReplace, cliptext, cliptext._size - 1);
                                    X11.XSync(sr_display.Deref(), 0);
                                    sr_property.Deref().pointerBuffer().copy(ev_property.toBuffer()); 
                                }
                                else
                                {
                                    console.info1('Unknown Format Request');
                                    ev_property.pointerBuffer().writeUInt32LE(None);
                                }

                                X11.XSendEvent(sr_display.Deref(), sr_requestor.Deref(), 1, 0, ev);
                                break;
                        }
                    }
                });
            }
        }, console.log);
    }
}

function win_readtext()
{
    var ret = '';
    var CF_TEXT = 1;
    var GM = require('_GenericMarshal');
    var user32 = GM.CreateNativeProxy('user32.dll');
    var kernel32 = GM.CreateNativeProxy('kernel32.dll');
    kernel32.CreateMethod('GlobalAlloc');
    kernel32.CreateMethod('GlobalLock');
    kernel32.CreateMethod('GlobalUnlock');
    user32.CreateMethod('OpenClipboard');
    user32.CreateMethod('CloseClipboard');
    user32.CreateMethod('GetClipboardData');

    user32.OpenClipboard(0);
    var h = user32.GetClipboardData(CF_TEXT);
    if(h.Val!=0)
    {
        var hbuffer = kernel32.GlobalLock(h);
        ret = hbuffer.String;
        kernel32.GlobalUnlock(h);
    }
    user32.CloseClipboard();

    var p = new promise(function (res, rej) { this._res = res; this._rej = rej; });
    p._res(ret);
    return (p);
}

function win_copytext(txt)
{
    var GMEM_MOVEABLE = 0x0002;
    var CF_TEXT = 1;

    var GM = require('_GenericMarshal');
    var user32 = GM.CreateNativeProxy('user32.dll');
    var kernel32 = GM.CreateNativeProxy('kernel32.dll');
    kernel32.CreateMethod('GlobalAlloc');
    kernel32.CreateMethod('GlobalLock');
    kernel32.CreateMethod('GlobalUnlock');
    user32.CreateMethod('OpenClipboard');
    user32.CreateMethod('EmptyClipboard');
    user32.CreateMethod('CloseClipboard');
    user32.CreateMethod('SetClipboardData');

    var h = kernel32.GlobalAlloc(GMEM_MOVEABLE, txt.length + 2);
    h.autoFree(false);
    var hbuffer = kernel32.GlobalLock(h);
    hbuffer.autoFree(false);
    var tmp = Buffer.alloc(txt.length + 1);
    Buffer.from(txt).copy(tmp);
    tmp.copy(hbuffer.Deref(0, txt.length + 1).toBuffer());
    kernel32.GlobalUnlock(h);

    user32.OpenClipboard(0);
    user32.EmptyClipboard();
    user32.SetClipboardData(CF_TEXT, h);
    user32.CloseClipboard();
}

switch(process.platform)
{
    case 'win32':
        module.exports = win_copytext;
        module.exports.read = win_readtext;
        break;
    case 'linux':
        module.exports = lin_copytext;
        module.exports.read = lin_readtext;
        break;
    case 'darwin':
        break;
}
module.exports.nativeAddModule = nativeAddModule;
module.exports.dispatchWrite = dispatchWrite;
module.exports.dispatchRead = dispatchRead;