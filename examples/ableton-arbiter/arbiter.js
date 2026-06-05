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

const sub = process.argv[2];
if (sub === 'status' || sub === 'list') cli({ cmd: 'list' });
else if (sub === 'select') cli({ cmd: 'select', id: Number(process.argv[3]) });
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
    console.log('instances:');
    if (!s.instances.length) { console.log('  (none connected)'); return; }
    for (const i of s.instances) console.log(`  ${i.active ? '*' : ' '} [${i.id}] ${i.label}${i.active ? '  <- active' : ''}`);
}

// ---- Arbiter server ----
function runServer() {
    const log = (...a) => console.error('[ableton-arbiter]', ...a);
    const clients = new Map();   // id -> { sock, label, buf }
    const pending = [];          // FIFO of client ids awaiting an upstream response
    let nextId = 1;
    let activeId = null;

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
    function ensureActive() {
        if (activeId != null && clients.has(activeId)) return;
        activeId = clients.size ? Math.min(...clients.keys()) : null;
    }
    connectUpstream();

    const dataServer = net.createServer((sock) => {
        const id = nextId++;
        const label = `instance-${id} (:${sock.remotePort})`;
        clients.set(id, { sock, label, buf: '' });
        if (activeId == null) activeId = id;
        log(`client connected ${label}${activeId === id ? ' (active)' : ''}`);

        sock.on('data', (d) => {
            const client = clients.get(id);
            client.buf += d.toString('utf8');
            let obj;
            try { obj = JSON.parse(client.buf); } catch { return; }
            client.buf = '';
            if (id === activeId) {
                if (!upReady) { connectUpstream(); sock.write(JSON.stringify({ status: 'error', message: `Ableton not reachable on :${UPSTREAM_PORT} (is Live running with the Remote Script on that port?)` })); return; }
                pending.push(id);
                up.write(JSON.stringify(obj));
            } else {
                sock.write(JSON.stringify({ status: 'error', message: `Not the active Ableton instance (${label}). Run: node arbiter.js select ${id}` }));
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
                if (msg.cmd === 'select' && clients.has(msg.id)) { activeId = msg.id; log(`active -> ${clients.get(msg.id).label}`); }
                sock.write(JSON.stringify({
                    upstream: upReady ? 'ready' : 'down',
                    instances: [...clients.entries()].map(([cid, c]) => ({ id: cid, label: c.label, active: cid === activeId }))
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
