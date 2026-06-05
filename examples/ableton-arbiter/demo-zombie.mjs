// Reproducible demo of the stale-active ("zombie") warning in `status` — no
// Ableton required. Starts a mock Remote Script, a fresh arbiter (short 2s
// auto-promote so the demo is quick), and two mock instances where the active
// one goes idle while another waits, then prints `node arbiter.js status`.
//
//   node demo-zombie.mjs
//
// For the assertion-based test see test.mjs; this script is for *seeing* the
// warning text the way you would in real use.

import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pexec = promisify(execFile);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const __dirname = dirname(fileURLToPath(import.meta.url));
const UP = 19878, DATA = 19877, CTRL = 19875;
const env = { ...process.env, ABLETON_ARBITER_PORT: String(DATA), ABLETON_UPSTREAM_PORT: String(UP), ABLETON_CONTROL_PORT: String(CTRL), ABLETON_AUTO_PROMOTE_MS: '2000' };

// Mock Remote Script so `status` shows upstream "ready".
const upstream = net.createServer((s) => { s.on('data', () => s.write(JSON.stringify({ status: 'success', result: {} }))); s.on('error', () => {}); });
await new Promise(r => upstream.listen(UP, '127.0.0.1', r));

console.log('Starting fresh arbiter (auto-promote 2s for the demo; real default is 10s)...');
const arb = spawn(process.execPath, [join(__dirname, 'arbiter.js')], { env, stdio: 'ignore' });
await sleep(600);

console.log('Connecting two mock instances; the active one sends nothing (goes idle)...');
const x = net.connect(DATA, '127.0.0.1'); x.on('error', () => {}); await new Promise(r => x.on('connect', r));
const y = net.connect(DATA, '127.0.0.1'); y.on('error', () => {}); await new Promise(r => y.on('connect', r));

console.log('Waiting past the idle threshold...\n');
await sleep(2500);

const { stdout } = await pexec(process.execPath, [join(__dirname, 'arbiter.js'), 'status'], { env });
console.log('================ node arbiter.js status ================');
process.stdout.write(stdout);
console.log('=======================================================');

x.end(); y.end(); arb.kill(); upstream.close();
await sleep(120);
process.exit(0);
