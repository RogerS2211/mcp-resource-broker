// Validates the Ableton arbiter without Ableton: a mock Remote Script (upstream)
// + mock ableton-mcp clients. Covers active/inactive routing, manual select,
// auto-promotion of an idle (zombie) active, and `select newest`.
//
//   node test.mjs

import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UP = 19878;
const A1 = { data: 19877, ctrl: 19875 };  // arbiter 1: auto-promote OFF (deterministic routing tests)
const A2 = { data: 19887, ctrl: 19885 };  // arbiter 2: auto-promote 300ms (zombie/select-newest tests)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ✓', m); else { failures++; console.error('  ✗ FAIL:', m); } };

// Mock upstream "Remote Script": parse whole-buffer JSON, reply success echoing type.
const upstream = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
        buf += d.toString('utf8');
        let obj; try { obj = JSON.parse(buf); } catch { return; }
        buf = '';
        sock.write(JSON.stringify({ status: 'success', result: { echoed: obj.type } }));
    });
    sock.on('error', () => {});
});
await new Promise(r => upstream.listen(UP, '127.0.0.1', r));

function startArbiter(ports, autoPromoteMs) {
    return spawn(process.execPath, [join(__dirname, 'arbiter.js')], {
        env: {
            ...process.env,
            ABLETON_ARBITER_PORT: String(ports.data),
            ABLETON_UPSTREAM_PORT: String(UP),
            ABLETON_CONTROL_PORT: String(ports.ctrl),
            ABLETON_AUTO_PROMOTE_MS: String(autoPromoteMs)
        },
        stdio: 'ignore'
    });
}
function mkClient(port) {
    const sock = net.connect(port, '127.0.0.1');
    sock.on('error', () => {});
    const c = { sock, buf: '' };
    return new Promise((res) => sock.on('connect', () => res(c)));
}
function request(c, obj) {
    return new Promise((resolve, reject) => {
        const onData = (d) => {
            c.buf += d.toString('utf8');
            let parsed; try { parsed = JSON.parse(c.buf); } catch { return; }
            c.buf = '';
            c.sock.off('data', onData);
            resolve(parsed);
        };
        c.sock.on('data', onData);
        c.sock.write(JSON.stringify(obj));
        setTimeout(() => reject(new Error('timeout')), 2000);
    });
}
function control(port, msg) {
    return new Promise((resolve, reject) => {
        const c = net.connect(port, '127.0.0.1');
        let buf = '';
        c.on('connect', () => c.write(JSON.stringify(msg) + '\n'));
        c.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { resolve(JSON.parse(buf.slice(0, i))); c.end(); } });
        c.on('error', reject);
    });
}

const arb1 = startArbiter(A1, 0);
const arb2 = startArbiter(A2, 300);
await sleep(700);

try {
    // --- Arbiter 1: routing + manual select (auto-promote disabled) ---
    const a = await mkClient(A1.data);   // id 1 -> auto active
    const b = await mkClient(A1.data);   // id 2
    await sleep(150);

    const ra = await request(a, { type: 'get_session_info' });
    ok(ra.status === 'success' && ra.result.echoed === 'get_session_info', 'active instance (A) reaches Ableton');

    const rb = await request(b, { type: 'get_session_info' });
    ok(rb.status === 'error' && /not the active/i.test(rb.message), 'inactive instance (B) is refused');

    const snap = await control(A1.ctrl, { cmd: 'list' });
    ok(snap.instances.length === 2 && snap.upstream === 'ready', 'control: lists 2 instances, upstream ready');
    ok(snap.instances.find(i => i.id === 1).active, 'control: instance 1 is active');

    await control(A1.ctrl, { cmd: 'select', id: 2 });
    const rb2 = await request(b, { type: 'create_midi_track' });
    ok(rb2.status === 'success', 'after select, B reaches Ableton');
    const ra2 = await request(a, { type: 'create_midi_track' });
    ok(ra2.status === 'error', 'after select, A is now refused');
    a.sock.end(); b.sock.end();

    // --- Arbiter 2: auto-promotion of an idle active + select newest ---
    const x = await mkClient(A2.data);   // id 1 -> active, but never sends (the "zombie")
    const y = await mkClient(A2.data);   // id 2
    await sleep(450);                    // let the active (x) go idle past 300ms

    const ry = await request(y, { type: 'get_session_info' });
    ok(ry.status === 'success', 'auto-promote: idle active is superseded by a live request');
    const snap2 = await control(A2.ctrl, { cmd: 'list' });
    ok(snap2.instances.find(i => i.id === 2).active, 'auto-promote: instance 2 is now active');

    const z = await mkClient(A2.data);   // id 3
    await sleep(100);
    const snap3 = await control(A2.ctrl, { cmd: 'select', id: 'newest' });
    ok(snap3.instances.find(i => i.active).id === 3, 'select newest: highest-numbered instance becomes active');

    x.sock.end(); y.sock.end(); z.sock.end();
} catch (e) {
    failures++;
    console.error('Harness error:', e);
} finally {
    arb1.kill(); arb2.kill();
    upstream.close();
    await sleep(100);
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}
