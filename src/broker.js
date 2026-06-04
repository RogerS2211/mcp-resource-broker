// The broker: a long-lived router between many controllers and one-or-more
// shared resources. Transport is localhost WebSocket. See protocol.js for the
// message shapes and src/../PROTOCOL.md for the full spec.
//
// This is the generic core of the connection broker. It knows nothing about
// browsers or any specific application — it routes opaque {action, params}
// command envelopes and arbitrates which controller owns each exclusive resource.

import { WebSocketServer } from 'ws';
import { T, MODES, isLocalhost, PROTOCOL_VERSION } from './protocol.js';

/**
 * @param {object} opts
 * @param {number} [opts.port]            Listen port (default env BROKER_PORT or 8765)
 * @param {string} [opts.host]            Bind host (default 127.0.0.1)
 * @param {function} [opts.authenticate]  async ({role, token, meta, remoteAddress}) => boolean — connection gate
 * @param {function} [opts.authorize]     async ({controllerId, action, resource, params, meta}) => boolean — per-command gate
 * @param {function} [opts.onAudit]       (event) => void — receives an audit event for every command/denial/lease change
 * @param {string} [opts.defaultMode]     'exclusive' | 'concurrent' for resources that don't declare one
 * @param {function} [opts.logger]        (...args) => void
 * @param {boolean} [opts.exitOnPortInUse] process.exit(0) on EADDRINUSE (for auto-spawn pattern)
 * @param {number} [opts.heartbeatMs]     ping interval; sockets missing a ping are dropped (0 disables)
 */
export function createBroker(opts = {}) {
    const {
        port = parseInt(process.env.BROKER_PORT || '8765', 10),
        host = '127.0.0.1',
        authenticate = async ({ remoteAddress }) => isLocalhost(remoteAddress),
        authorize = async () => true,
        onAudit = null,
        defaultMode = MODES.EXCLUSIVE,
        logger = (...a) => console.error('[broker]', ...a),
        exitOnPortInUse = false,
        heartbeatMs = 15000
    } = opts;

    const resources = new Map();   // name -> { ws, name, mode, meta }
    const controllers = new Map(); // id   -> { ws, id, label, meta, order }
    const observers = new Set();   // ws (read-only roster + audit subscribers)
    const holders = new Map();     // resourceName -> controllerId | null  (exclusive selection)
    const pending = new Map();     // routingId -> { ctrlWs, origId }
    let ridSeq = 1;
    let orderSeq = 1;

    const wss = new WebSocketServer({ port, host });
    wss.on('listening', () => logger(`listening on ws://${host}:${port}`));
    wss.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            logger(`port ${port} already in use — another broker is running`);
            if (exitOnPortInUse) process.exit(0);
        } else {
            logger('server error:', e.message);
        }
    });

    // Liveness: terminate sockets that stop answering WebSocket pings. When a
    // terminated socket is a lease holder, its 'close' handler frees and
    // reassigns the lease — so a hung or sleeping controller can't hold a
    // resource forever. ws auto-replies to pings, so clients need no extra code.
    const heartbeat = heartbeatMs > 0 ? setInterval(() => {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
            ws.isAlive = false;
            try { ws.ping(); } catch {}
        }
    }, heartbeatMs) : null;
    if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref();

    const safeSend = (ws, data) => {
        try { if (ws && ws.readyState === ws.OPEN) ws.send(typeof data === 'string' ? data : JSON.stringify(data)); }
        catch { /* ignore */ }
    };
    const controllersByOrder = () => [...controllers.values()].sort((a, b) => a.order - b.order);

    function rosterPayload() {
        return {
            type: T.ROSTER,
            resources: [...resources.values()].map(r => ({ name: r.name, mode: r.mode, meta: r.meta })),
            controllers: [...controllers.values()].map(c => ({ id: c.id, label: c.label, meta: c.meta })),
            holders: Object.fromEntries(holders)
        };
    }
    function broadcastRoster() {
        const p = JSON.stringify(rosterPayload());
        for (const r of resources.values()) safeSend(r.ws, p);
        for (const o of observers) safeSend(o, p);
    }

    // Emit an audit event to the onAudit callback and any connected observers.
    function audit(event) {
        const ev = { ts: Date.now(), ...event };
        if (onAudit) { try { onAudit(ev); } catch { /* ignore */ } }
        if (observers.size) {
            const p = JSON.stringify({ type: T.AUDIT, event: ev });
            for (const o of observers) safeSend(o, p);
        }
    }

    // Ensure an exclusive resource has a valid holder: if none, auto-select the
    // oldest controller. This gives zero-config single-controller use ("it just
    // works") while still letting a human/observer reassign via SELECT.
    function ensureHolder(name) {
        const r = resources.get(name);
        if (!r || r.mode !== MODES.EXCLUSIVE) return;
        const cur = holders.get(name);
        if (cur && controllers.has(cur)) return;
        const list = controllersByOrder();
        holders.set(name, list.length ? list[0].id : null);
    }

    function pickResource(name) {
        if (name) return resources.get(name) || null;
        if (resources.size === 1) return [...resources.values()][0];
        return null; // ambiguous: caller must name the resource
    }

    wss.on('connection', (ws, req) => {
        const remoteAddress = req.socket.remoteAddress;
        ws._role = null; ws._id = null; ws._resourceName = null;
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('message', (data) => {
            let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
            handle(ws, msg, remoteAddress).catch(e => logger('handler error:', e.message));
        });
        ws.on('close', () => onClose(ws));
        ws.on('error', () => {});
    });

    async function handle(ws, msg, remoteAddress) {
        // --- Handshake ---
        if (msg.type === T.HELLO) {
            const ok = await authenticate({ role: msg.role, token: msg.token, meta: msg.meta, remoteAddress });
            if (!ok) { safeSend(ws, { type: T.ERROR, error: 'unauthorized' }); ws.close(); return; }

            if (msg.role === 'resource') {
                const name = msg.name || 'default';
                ws._role = 'resource'; ws._resourceName = name;
                resources.set(name, { ws, name, mode: msg.mode || defaultMode, meta: msg.meta || {} });
                ensureHolder(name);
                safeSend(ws, { type: T.WELCOME, protocol: PROTOCOL_VERSION, assignedId: name, role: 'resource', features: ['exclusive', 'concurrent', 'leases', 'observer', 'audit'] });
                safeSend(ws, rosterPayload());
                broadcastRoster();
                audit({ type: 'connect', role: 'resource', id: name });
                logger(`resource registered: "${name}" (${msg.mode || defaultMode})`);
            } else if (msg.role === 'observer') {
                ws._role = 'observer';
                observers.add(ws);
                safeSend(ws, { type: T.WELCOME, protocol: PROTOCOL_VERSION, assignedId: null, role: 'observer', features: ['observer', 'audit'] });
                safeSend(ws, rosterPayload());
                logger('observer connected');
            } else {
                const id = msg.id || `ctrl-${orderSeq}`;
                ws._role = 'controller'; ws._id = id;
                controllers.set(id, { ws, id, label: msg.label || id, meta: msg.meta || {}, order: orderSeq++ });
                for (const name of resources.keys()) ensureHolder(name);
                safeSend(ws, { type: T.WELCOME, protocol: PROTOCOL_VERSION, assignedId: id, role: 'controller', features: ['exclusive', 'concurrent', 'leases'] });
                broadcastRoster();
                audit({ type: 'connect', role: 'controller', id, label: msg.label || id });
                logger(`controller registered: "${id}" (${msg.label || ''})`);
            }
            return;
        }

        // --- Controller issues a command ---
        if (ws._role === 'controller' && msg.type === T.COMMAND) {
            const deny = (error, reason) => {
                safeSend(ws, { type: T.RESULT, id: msg.id, ok: false, error });
                audit({ type: 'denied', controller: ws._id, resource: msg.resource, action: msg.action, reason });
            };
            const resource = pickResource(msg.resource);
            if (!resource) {
                deny('no such resource (or none connected / ambiguous — name it)', 'no-resource');
                return;
            }
            if (resource.mode === MODES.EXCLUSIVE && holders.get(resource.name) !== ws._id) {
                deny('not the active controller for this resource — select it to take control', 'not-active');
                return;
            }
            // Per-command capability gate (read-only controllers, allow-lists, etc.)
            let allowed = true;
            try {
                allowed = await authorize({ controllerId: ws._id, action: msg.action, resource: resource.name, params: msg.params, meta: controllers.get(ws._id)?.meta });
            } catch { allowed = false; }
            if (!allowed) {
                deny(`action "${msg.action}" not permitted for this controller`, 'unauthorized');
                return;
            }
            const rid = `rt-${ridSeq++}`;
            pending.set(rid, { ctrlWs: ws, origId: msg.id });
            safeSend(resource.ws, { type: T.COMMAND, id: rid, action: msg.action, params: msg.params, scope: msg.scope, controller: ws._id });
            audit({ type: 'command', controller: ws._id, resource: resource.name, action: msg.action, scope: msg.scope });
            return;
        }

        // --- Resource returns a result ---
        if (ws._role === 'resource' && msg.type === T.RESULT) {
            const p = pending.get(msg.id);
            if (p) {
                pending.delete(msg.id);
                safeSend(p.ctrlWs, { type: T.RESULT, id: p.origId, ok: msg.ok, data: msg.data, error: msg.error });
            }
            return;
        }

        // --- Controller acquires / releases an exclusive lease ---
        if (ws._role === 'controller' && (msg.type === T.ACQUIRE || msg.type === T.RELEASE)) {
            const resource = pickResource(msg.resource);
            if (!resource) { safeSend(ws, { type: T.LEASE, resource: msg.resource, granted: false, error: 'no such resource' }); return; }
            if (msg.type === T.ACQUIRE) {
                const cur = holders.get(resource.name);
                if (!cur || !controllers.has(cur) || cur === ws._id || msg.force) holders.set(resource.name, ws._id);
                safeSend(ws, { type: T.LEASE, resource: resource.name, granted: holders.get(resource.name) === ws._id, holder: holders.get(resource.name) });
            } else {
                if (holders.get(resource.name) === ws._id) { holders.set(resource.name, null); ensureHolder(resource.name); }
                safeSend(ws, { type: T.LEASE, resource: resource.name, granted: false, holder: holders.get(resource.name) });
            }
            broadcastRoster();
            audit({ type: 'lease', resource: resource.name, holder: holders.get(resource.name), via: msg.type });
            return;
        }

        // --- Selection (from a resource or observer): set the active controller ---
        if (msg.type === T.SELECT) {
            const name = msg.resource || ws._resourceName || pickResource()?.name;
            if (name && resources.has(name) && (msg.controllerId === null || controllers.has(msg.controllerId))) {
                holders.set(name, msg.controllerId);
                broadcastRoster();
                audit({ type: 'lease', resource: name, holder: msg.controllerId, via: 'select' });
            }
            return;
        }

        if (msg.type === T.GET_ROSTER) { safeSend(ws, rosterPayload()); return; }
        if (msg.type === T.PING) { safeSend(ws, { type: T.PONG, t: msg.t }); return; }
    }

    function onClose(ws) {
        if (ws._role === 'controller' && ws._id) {
            controllers.delete(ws._id);
            for (const [rid, p] of pending) if (p.ctrlWs === ws) pending.delete(rid);
            for (const [name, holderId] of holders) {
                if (holderId === ws._id) {
                    const remaining = controllersByOrder();
                    holders.set(name, remaining.length === 1 ? remaining[0].id : null);
                }
            }
            broadcastRoster();
            audit({ type: 'disconnect', role: 'controller', id: ws._id });
            logger(`controller gone: "${ws._id}"`);
        } else if (ws._role === 'resource' && ws._resourceName) {
            resources.delete(ws._resourceName);
            broadcastRoster();
            audit({ type: 'disconnect', role: 'resource', id: ws._resourceName });
            logger(`resource gone: "${ws._resourceName}"`);
        } else if (ws._role === 'observer') {
            observers.delete(ws);
            logger('observer disconnected');
        }
    }

    return {
        port,
        host,
        /** Inspect live state (resources/controllers/holders). For tests/dashboards. */
        state: () => ({
            resources: [...resources.keys()],
            controllers: [...controllers.keys()],
            holders: Object.fromEntries(holders)
        }),
        close: () => new Promise((res) => {
            if (heartbeat) clearInterval(heartbeat);
            for (const c of controllers.values()) { try { c.ws.terminate(); } catch {} }
            for (const r of resources.values()) { try { r.ws.terminate(); } catch {} }
            for (const o of observers) { try { o.terminate(); } catch {} }
            wss.close(() => res());
        })
    };
}
