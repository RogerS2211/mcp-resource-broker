// Browser (MV3) resource client for the MCP resource broker.
//
// No imports — uses the global WebSocket. Drop this file into a Firefox/Chrome
// background script (background.scripts / service_worker) and instantiate it.
// A background script uses it to: connect to the broker as a "resource", execute
// incoming commands against the page, and relay the instance roster to your popup
// so the user can pick which controller is active.
//
// Usage in a background script:
//   const resource = new BrokerResource({
//     name: 'my-extension',
//     mode: 'exclusive',
//     onCommand: async ({ action, params, scope }) => {
//       // ... do the work in the active tab ...
//       return { ok: true, data: result };
//     },
//     onRoster: (roster) => { latestRoster = roster; }  // expose to popup
//   });
//   resource.connect();
//
// Popup integration: forward { type:'select', controllerId } via resource.select(id),
// and read resource.roster (or the onRoster callback) to render the picker.

(function (global) {
    const T = {
        HELLO: 'hello', WELCOME: 'welcome', ERROR: 'error',
        COMMAND: 'command', RESULT: 'result',
        ROSTER: 'roster', SELECT: 'select', GET_ROSTER: 'get_roster',
        PING: 'ping', PONG: 'pong'
    };

    class BrokerResource {
        constructor(opts = {}) {
            this.url = opts.url || 'ws://127.0.0.1:8765';
            this.name = opts.name || 'browser';
            this.mode = opts.mode || 'exclusive';
            this.token = opts.token;
            this.meta = opts.meta || {};
            this.onCommand = opts.onCommand || (async () => ({ ok: false, error: 'no command handler' }));
            this.onRoster = opts.onRoster || (() => {});
            this.roster = { resources: [], controllers: [], holders: {} };
            this.connected = false;
            this._ws = null;
            this._delay = 1000;
            this._stopped = false;
        }

        connect() {
            let ws;
            try { ws = new WebSocket(this.url); }
            catch (e) { this._retry(); return; }
            this._ws = ws;

            ws.onopen = () => {
                this.connected = true;
                this._delay = 1000;
                this._send({ type: T.HELLO, protocol: '1', role: 'resource', name: this.name, mode: this.mode, token: this.token, meta: this.meta });
            };

            ws.onmessage = async (ev) => {
                let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
                if (msg.type === T.ROSTER) { this.roster = msg; this.onRoster(msg); return; }
                if (msg.type === T.COMMAND) {
                    let res;
                    try { res = await this.onCommand(msg); }
                    catch (e) { res = { ok: false, error: e.message }; }
                    res = res || { ok: false, error: 'no command handler' };
                    this._send({ type: T.RESULT, id: msg.id, ok: res.ok !== false, data: res.data, error: res.error });
                    return;
                }
                if (msg.type === T.PING) { this._send({ type: T.PONG, t: msg.t }); return; }
            };

            ws.onclose = () => { this.connected = false; this._retry(); };
            ws.onerror = () => { /* onclose handles retry */ };
        }

        _retry() {
            if (this._stopped) return;
            setTimeout(() => this.connect(), this._delay);
            this._delay = Math.min(this._delay * 1.5, 15000);
        }

        _send(obj) {
            try { if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj)); }
            catch (e) { /* ignore */ }
        }

        /** Set which controller drives this resource (call from your popup). */
        select(controllerId) { this._send({ type: T.SELECT, controllerId, resource: this.name }); }

        /** Ask the broker to push a fresh roster. */
        refresh() { this._send({ type: T.GET_ROSTER }); }

        close() { this._stopped = true; try { this._ws && this._ws.close(); } catch (e) {} }
    }

    global.BrokerResource = BrokerResource;
    if (typeof module !== 'undefined' && module.exports) module.exports = { BrokerResource };
})(typeof self !== 'undefined' ? self : this);
