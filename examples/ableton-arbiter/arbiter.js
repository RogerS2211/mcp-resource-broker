#!/usr/bin/env node
// Ableton arbiter — the broker pattern applied to ahujasid/ableton-mcp.
//
// ableton-mcp's MCP server is a TCP *client* that connects to the Ableton Remote
// Script (a TCP server, normally on :9877) and the project warns "only run one
// instance." To use it at USER SCOPE across multiple Claude/Cursor sessions, this
// arbiter sits in the middle: it occupies the port the MCP servers connect to
// (:9877), holds ONE upstream connection to the real Remote Script (moved to
// :9878), and forwards only the SELECTED instance's commands. Inactive instances
// get an immediate "not the active instance" error instead of corrupting the set.
//
//   ableton-mcp #1 ─┐
//   ableton-mcp #2 ─┼─►  arbiter :9877  ──►  Ableton Remote Script :9878
//   ableton-mcp #3 ─┘     (forwards active)
//
// Setup: change DEFAULT_PORT in the installed AbletonMCP Remote Script from 9877
// to 9878, then run this arbiter. See README.md.
//
// Usage:
//   node arbiter.js                 # run the arbiter
//   node arbiter.js status          # list connected instances + which is active
//   node arbiter.js select <id>     # make instance <id> the active one
//
// Message framing mirrors the Remote Script: accumulate bytes, parse the whole
// buffer as one JSON object, clear on success (request/response is synchronous).

import net from 'node:net';

const DATA_PORT = Number(process.env.ABLETON_ARBITER_PORT || 9877);     // where ableton-mcp connects
const UPSTREAM_HOST = process.env.ABLETON_HOST || '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.ABLETON_UPSTREAM_PORT || 9878); // the real Remote Script
const CONTROL_PORT = Number(process.env.ABLETON_CONTROL_PORT || 9875);   // status/select CLI
// If the active instance has been idle this long (ms), a request from another
// instance auto-promotes it — so a zombie from a closed session can't wedge the
// set. 0 disables (manual `select` only). Override with ABLETON_AUTO_PROMOTE_MS.
const AUTO_PROMOTE_MS = Number(process.env.ABLETON_AUTO_PROMOTE_MS ?? 10000);

const sub = process.argv[2];
if (sub === 'status' || sub === 'list') cli({ cmd: 'list' });
else if (sub === 'select') {
    const arg = process.argv[3];
    cli({ cmd: 'select', id: arg === 'newest' ? 'newest' : Number(arg) });
}
else runServer();

// ---- CLI (status / select) ----
function cli(msg) {
    const c = net.connect(CONTROL_PORT, '127.0.0.1');
    let buf = '';
    c.on('connect', () => c.write(JSON.stringify(msg) + '\n'));
    c.on('data', (d) => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i < 0) return;
        printStatus(JSON.parse(buf.slice(0, i)));
        c.end();
        process.exit(0);
    });
    c.on('error', (e) => {
        console.error(`Cannot reach arbiter control on :${CONTROL_PORT} (${e.code}). Is the arbiter running?`);
        process.exit(2);
    });
}
function printStatus(s) {
    console.log(`upstream (Ableton :${UPSTREAM_PORT}): ${s.upstream}`);
    console.log(`auto-promote idle: ${s.autoPromoteMs ? s.autoPromoteMs / 1000 + 's' : 'off'}`);
    if (s.likelyZombie) {
        const others = s.instances.length - 1;
        console.log(`\n  ⚠ active instance looks STALE — idle ${Math.round(s.activeIdleMs / 1000)}s while ${others} other(s) wait.`);
        console.log(`    It auto-supersedes on the next command, or run: node arbiter.js select newest\n`);
    }
    console.log('instances:');
    if (!s.instances.length) { console.log('  (none connected)'); return; }
    for (const i of s.instances) {
        const idle = i.active && i.idleMs != null ? `  (idle ${Math.round(i.idleMs / 1000)}s)` : '';
        console.log(`  ${i.active ? '*' : ' '} [${i.id}] ${i.label}${i.active ? '  <- active' : ''}${idle}`);
    }
}

// ---- Arbiter server ----
function runServer() {
    const log = (...a) => console.error('[ableton-arbiter]', ...a);
    const clients = new Map();   // id -> { sock, label, buf }
    const pending = [];          // FIFO of client ids awaiting an upstream response
    let nextId = 1;
    let activeId = null;
    let lastActiveActivity = 0;  // ms timestamp of the active instance's last command

    let up = null, upBuf = '', upReady = false, upConnecting = false;

    function connectUpstream() {
        if (upConnecting || upReady) return;
        upConnecting = true;
        up = net.connect(UPSTREAM_PORT, UPSTREAM_HOST);
        up.on('connect', () => { upReady = true; upConnecting = false; log(`upstream connected ${UPSTREAM_HOST}:${UPSTREAM_PORT}`); });
        up.on('data', (d) => {
            upBuf += d.toString('utf8');
            let obj;
            try { obj = JSON.parse(upBuf); } catch { return; }
            upBuf = '';
            const cid = pending.shift();
            const c = cid != null ? clients.get(cid) : null;
            if (c) c.sock.write(JSON.stringify(obj));
        });
        up.on('close', () => { upReady = false; upConnecting = false; up = null; failPending('Ableton connection closed'); log('upstream closed; retrying in 1s'); setTimeout(connectUpstream, 1000); });
        up.on('error', (e) => log('upstream error:', e.message));
    }
    function failPending(message) {
        while (pending.length) {
            const c = clients.get(pending.shift());
            if (c) c.sock.write(JSON.stringify({ status: 'error', message }));
        }
    }
    function activeAlive() {
        const c = activeId != null ? clients.get(activeId) : null;
        return !!(c && !c.sock.destroyed);
    }
    function ensureActive() {
        if (activeId != null && clients.has(activeId)) return;
        activeId = clients.size ? Math.max(...clients.keys()) : null; // prefer the newest session
    }
    connectUpstream();

    const dataServer = net.createServer((sock) => {
        const id = nextId++;
        const label = `instance-${id} (:${sock.remotePort})`;
        sock.setKeepAlive(true, 15000); // reap genuinely dead sockets sooner
        clients.set(id, { sock, label, buf: '' });
        // Take over if nothing is active or the active socket is dead (crashed
        // session). Idle take-over of a still-connected zombie happens on request.
        if (activeId == null || !activeAlive()) { activeId = id; lastActiveActivity = Date.now(); }
        log(`client connected ${label}${activeId === id ? ' (active)' : ''}`);

        sock.on('data', (d) => {
            const client = clients.get(id);
            client.buf += d.toString('utf8');
            let obj;
            try { obj = JSON.parse(client.buf); } catch { return; }
            client.buf = '';

            // Auto-promotion: if this isn't the active instance but the active one
            // is gone or has been idle past the threshold (e.g. a zombie from a
            // closed session), take over instead of rejecting. Triggering here, on
            // the request itself, means the call that would have been rejected
            // simply succeeds — no manual select, no connection-close race.
            if (id !== activeId) {
                const idleMs = Date.now() - lastActiveActivity;
                if (!activeAlive() || (AUTO_PROMOTE_MS > 0 && idleMs > AUTO_PROMOTE_MS)) {
                    log(`auto-promoted ${label} (previous active ${activeAlive() ? `idle ${Math.round(idleMs / 1000)}s` : 'gone'})`);
                    activeId = id;
                }
            }

            if (id === activeId) {
                if (!upReady) { connectUpstream(); sock.write(JSON.stringify({ status: 'error', message: `Ableton not reachable on :${UPSTREAM_PORT} (is Live running with the Remote Script on that port?)` })); return; }
                lastActiveActivity = Date.now();
                pending.push(id);
                up.write(JSON.stringify(obj));
            } else {
                const hint = AUTO_PROMOTE_MS > 0 ? ` (or it auto-activates once the active instance is idle ${Math.round(AUTO_PROMOTE_MS / 1000)}s)` : '';
                sock.write(JSON.stringify({ status: 'error', message: `Not the active Ableton instance (${label}). Run: node arbiter.js select ${id}${hint}` }));
            }
        });
        sock.on('close', () => {
            clients.delete(id);
            for (let i = pending.length - 1; i >= 0; i--) if (pending[i] === id) pending.splice(i, 1);
            if (activeId === id) { activeId = null; ensureActive(); }
            log(`client gone ${label}; active now ${activeId ?? 'none'}`);
        });
        sock.on('error', () => {});
    });
    dataServer.on('error', (e) => {
        if (e.code === 'EADDRINUSE') { console.error(`Port ${DATA_PORT} is in use. Is the real Remote Script still on ${DATA_PORT}? Move it to ${UPSTREAM_PORT} (see README).`); process.exit(1); }
        log('data server error:', e.message);
    });
    dataServer.listen(DATA_PORT, '127.0.0.1', () => log(`listening :${DATA_PORT}  ->  Ableton ${UPSTREAM_HOST}:${UPSTREAM_PORT}`));

    const controlServer = net.createServer((sock) => {
        let cbuf = '';
        sock.on('data', (d) => {
            cbuf += d;
            let i;
            while ((i = cbuf.indexOf('\n')) >= 0) {
                const line = cbuf.slice(0, i); cbuf = cbuf.slice(i + 1);
                let msg; try { msg = JSON.parse(line); } catch { continue; }
                if (msg.cmd === 'select') {
                    const target = msg.id === 'newest' ? (clients.size ? Math.max(...clients.keys()) : null) : msg.id;
                    if (target != null && clients.has(target)) { activeId = target; lastActiveActivity = Date.now(); log(`active -> ${clients.get(target).label}`); }
                }
                const haveActive = activeId != null && clients.has(activeId);
                const activeIdleMs = haveActive ? Date.now() - lastActiveActivity : null;
                const others = clients.size - (haveActive ? 1 : 0);
                const likelyZombie = activeAlive() && AUTO_PROMOTE_MS > 0 && activeIdleMs != null && activeIdleMs > AUTO_PROMOTE_MS && others > 0;
                sock.write(JSON.stringify({
                    upstream: upReady ? 'ready' : 'down',
                    autoPromoteMs: AUTO_PROMOTE_MS,
                    activeIdleMs,
                    likelyZombie,
                    instances: [...clients.entries()].map(([cid, c]) => ({ id: cid, label: c.label, active: cid === activeId, idleMs: cid === activeId ? activeIdleMs : null }))
                }) + '\n');
            }
        });
        sock.on('error', () => {});
    });
    controlServer.on('error', (e) => log('control server error:', e.message));
    controlServer.listen(CONTROL_PORT, '127.0.0.1', () => log(`control :${CONTROL_PORT}  (node arbiter.js status | select <id>)`));

    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
}
