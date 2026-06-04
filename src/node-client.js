// Node client for the broker — usable as either a controller (an MCP server /
// agent side) or a resource (a Node-hosted controllable thing). The browser
// equivalent for MV3 extensions is extension-client.js.
//
// Controller usage:
//   const c = new BrokerClient({ role: 'controller', label: process.cwd() });
//   await c.connect();
//   const r = await c.command('click', { selector: '#x' }, { resource: 'browser' });
//
// Resource usage:
//   const r = new BrokerClient({ role: 'resource', name: 'browser', mode: 'exclusive' });
//   r.onCommand(async ({ action, params, scope }) => ({ ok: true, data: ... }));
//   await r.connect();

import WebSocket from 'ws';
import { T, PROTOCOL_VERSION } from './protocol.js';

export class BrokerClient {
    constructor({ url = 'ws://127.0.0.1:8765', role, id, label, name, mode, token, meta, autoReconnect = true } = {}) {
        Object.assign(this, { url, role, id, label, name, mode, token, meta });
        this.ws = null;
        this.ready = false;
        this.assignedId = null;
        this.roster = { resources: [], controllers: [], holders: {} };
        this._pending = new Map();
        this._seq = 1;
        this._onCommand = null;
        this._onRoster = null;
        this._reconnect = autoReconnect;
        this._delay = 500;
    }

    onCommand(fn) { this._onCommand = fn; return this; }
    onRoster(fn) { this._onRoster = fn; return this; }

    connect() {
        return new Promise((resolve, reject) => {
            let settled = false;
            const ws = new WebSocket(this.url);
            this.ws = ws;

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    type: T.HELLO, protocol: PROTOCOL_VERSION, role: this.role,
                    id: this.id, label: this.label, name: this.name, mode: this.mode,
                    token: this.token, meta: this.meta
                }));
            });

            ws.on('message', (data) => {
                let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
                if (msg.type === T.WELCOME) {
                    this.ready = true; this.assignedId = msg.assignedId; this._delay = 500;
                    if (!settled) { settled = true; resolve(this); }
                    return;
                }
                if (msg.type === T.ERROR && !settled) { settled = true; reject(new Error(msg.error)); return; }
                this._handle(msg);
            });

            ws.on('close', () => {
                this.ready = false;
                if (!settled) { settled = true; reject(new Error('connection closed before welcome')); }
                if (this._reconnect) setTimeout(() => this.connect().catch(() => {}), this._delay);
            });
            ws.on('error', () => { /* close handles retry */ });
        });
    }

    async _handle(msg) {
        if (msg.type === T.ROSTER) { this.roster = msg; this._onRoster?.(msg); return; }
        if (msg.type === T.RESULT) {
            const p = this._pending.get(msg.id);
            if (p) { this._pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg); }
            return;
        }
        if (msg.type === T.LEASE) {
            const key = 'lease:' + (msg.resource || '');
            const p = this._pending.get(key);
            if (p) { this._pending.delete(key); clearTimeout(p.timer); p.resolve(msg); }
            return;
        }
        if (msg.type === T.COMMAND && this.role === 'resource') {
            let res;
            try { res = await this._onCommand?.(msg); }
            catch (e) { res = { ok: false, error: e.message }; }
            res = res || { ok: false, error: 'no command handler registered' };
            this._send({ type: T.RESULT, id: msg.id, ok: res.ok !== false, data: res.data, error: res.error });
            return;
        }
    }

    _send(obj) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }

    /** Controller: send a command to a resource; resolves with { ok, data, error }. */
    command(action, params = {}, { resource, scope, timeout = 30000 } = {}) {
        return new Promise((resolve, reject) => {
            if (!this.ready) return reject(new Error('not connected'));
            const id = `q-${this._seq++}`;
            const timer = setTimeout(() => { this._pending.delete(id); reject(new Error('command timed out')); }, timeout);
            this._pending.set(id, { resolve, timer });
            this._send({ type: T.COMMAND, id, action, params, resource, scope });
        });
    }

    /** Controller: request the exclusive lease on a resource. */
    acquire(resource, { force = false, timeout = 5000 } = {}) {
        return new Promise((resolve, reject) => {
            const key = 'lease:' + (resource || '');
            const timer = setTimeout(() => { this._pending.delete(key); reject(new Error('lease request timed out')); }, timeout);
            this._pending.set(key, { resolve, timer });
            this._send({ type: T.ACQUIRE, resource, force });
        });
    }

    release(resource) { this._send({ type: T.RELEASE, resource }); }

    /** Resource/observer: set which controller is active for a resource (or null). */
    select(controllerId, resource) { this._send({ type: T.SELECT, controllerId, resource }); }

    getRoster() { this._send({ type: T.GET_ROSTER }); }

    close() { this._reconnect = false; try { this.ws?.close(); } catch {} }
}
