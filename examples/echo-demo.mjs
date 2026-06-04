// Minimal runnable demo: a broker, one "echo" resource, and two controllers.
// Shows exclusive arbitration and live hand-off — the browser-extension scenario
// without a browser. Run: npm run example
//
// (In the real world the resource is a browser extension using extension-client.js,
//  and each controller is an MCP server inside a Claude/Cursor/etc. session.)

import { createBroker } from '../src/broker.js';
import { BrokerClient } from '../src/node-client.js';

const PORT = 8802;
const URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const broker = createBroker({ port: PORT });
await sleep(200);

// The shared resource: an "echo browser" that reports which controller it served.
const echo = new BrokerClient({ url: URL, role: 'resource', name: 'echo', mode: 'exclusive' });
echo.onCommand(async ({ action, params, controller }) => {
    console.log(`   [resource] executing "${action}" for ${controller}`);
    return { ok: true, data: `echo:${action}(${JSON.stringify(params)}) for ${controller}` };
});
await echo.connect();

// Two controllers (think: two editor windows / agent sessions).
const a = new BrokerClient({ url: URL, role: 'controller', label: 'session-A' });
const b = new BrokerClient({ url: URL, role: 'controller', label: 'session-B' });
await a.connect();
await b.connect();
await sleep(150);

const tryCmd = async (who, client, action) => {
    const r = await client.command(action, { from: who }, { resource: 'echo' });
    console.log(`-> ${who} "${action}": ${r.ok ? 'OK  ' + r.data : 'REFUSED — ' + r.error}`);
};

console.log('\n1) A is auto-selected; A works, B is refused:');
await tryCmd('A', a, 'navigate');
await tryCmd('B', b, 'navigate');

console.log('\n2) The resource hands control to B:');
echo.select(b.assignedId, 'echo');
await sleep(100);
await tryCmd('A', a, 'click');
await tryCmd('B', b, 'click');

console.log('\n3) A force-acquires the lease back:');
await a.acquire('echo', { force: true });
await tryCmd('A', a, 'screenshot');
await tryCmd('B', b, 'screenshot');

console.log('\nDone.');
a.close(); b.close(); echo.close();
await sleep(100);
await broker.close();
process.exit(0);
