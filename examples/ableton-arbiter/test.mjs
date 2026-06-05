// Validates the Ableton arbiter without Ableton: a mock Remote Script (upstream)
// + two mock ableton-mcp clients. Asserts that only the active instance's
// commands reach upstream and that `select` switches control.
//
//   node test.mjs

import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = 19877, UP = 19878, CTRL = 19875;
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

// Start the arbiter with test ports.
const arb = spawn(process.execPath, [join(__dirname, 'arbiter.js')], {
    env: { ...process.env, ABLETON_ARBITER_PORT: String(DATA), ABLETON_UPSTREAM_PORT: String(UP), ABLETON_CONTROL_PORT: String(CTRL) },
    stdio: 'ignore'
});
await sleep(600);

// A mock ableton-mcp client: send one JSON request, resolve with the one JSON reply.
function mkClient() {
    const sock = net.connect(DATA, '127.0.0.1');
    sock.on('error', () => {}); // ignore reset when the arbiter is torn down
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
function control(msg) {
    return new Promise((resolve, reject) => {
        const c = net.connect(CTRL, '127.0.0.1');
        let buf = '';
        c.on('connect', () => c.write(JSON.stringify(msg) + '\n'));
        c.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { resolve(JSON.parse(buf.slice(0, i))); c.end(); } });
        c.on('error', reject);
    });
}

try {
    const a = await mkClient();   // id 1 -> auto active
    const b = await mkClient();   // id 2
    await sleep(150);

    const ra = await request(a, { type: 'get_session_info' });
    ok(ra.status === 'success' && ra.result.echoed === 'get_session_info', 'active instance (A) reaches Ableton');

    const rb = await request(b, { type: 'get_session_info' });
    ok(rb.status === 'error' && /not the active/i.test(rb.message), 'inactive instance (B) is refused');

    const snap = await control({ cmd: 'list' });
    ok(snap.instances.length === 2 && snap.upstream === 'ready', 'control: lists 2 instances, upstream ready');
    ok(snap.instances.find(i => i.id === 1).active, 'control: instance 1 is active');

    await control({ cmd: 'select', id: 2 });
    const rb2 = await request(b, { type: 'create_midi_track' });
    ok(rb2.status === 'success' && rb2.result.echoed === 'create_midi_track', 'after select, B reaches Ableton');
    const ra2 = await request(a, { type: 'create_midi_track' });
    ok(ra2.status === 'error', 'after select, A is now refused');

    a.sock.end(); b.sock.end();
} catch (e) {
    failures++;
    console.error('Harness error:', e);
} finally {
    arb.kill();
    upstream.close();
    await sleep(100);
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}
