import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createBroker } from './src/broker.js';
import { BrokerClient } from './src/node-client.js';
const pexec = promisify(execFile);
const PORT = 8807, URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const broker = createBroker({ port: PORT, heartbeatMs: 0, logger: () => {} });
await sleep(150);
const res = new BrokerClient({ url: URL, role: 'resource', name: 'browser', mode: 'exclusive' });
res.onCommand(async () => ({ ok: true })); await res.connect();
const a = new BrokerClient({ url: URL, role: 'controller', label: 'session-A' });
const b = new BrokerClient({ url: URL, role: 'controller', label: 'session-B' });
await a.connect(); await b.connect(); await sleep(120);
res.select(b.assignedId, 'browser'); await sleep(120);

console.log('--- `status` output ---');
const { stdout } = await pexec(process.execPath, ['bin/broker.js', 'status', '--url', URL]);
process.stdout.write(stdout);
a.close(); b.close(); res.close();
await broker.close();
process.exit(0);
