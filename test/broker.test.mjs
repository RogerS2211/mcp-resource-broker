// End-to-end test of the broker: exclusive arbitration, selection, lease
// hand-off, concurrent routing, and auto-reselect on disconnect.
//
//   node test/broker.test.mjs

import { createBroker } from '../src/broker.js';
import { BrokerClient } from '../src/node-client.js';

const PORT = 8801;
const URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓', msg); else { failures++; console.error('  ✗ FAIL:', msg); } };

const broker = createBroker({ port: PORT, logger: () => {} });
await sleep(200);

try {
    // A controllable "browser" resource (exclusive) that echoes commands, and a
    // "tabs" resource (concurrent) that any controller may drive.
    const browser = new BrokerClient({ url: URL, role: 'resource', name: 'browser', mode: 'exclusive' });
    browser.onCommand(async ({ action, params, controller }) => ({ ok: true, data: { action, params, servedTo: controller } }));
    await browser.connect();

    const tabs = new BrokerClient({ url: URL, role: 'resource', name: 'tabs', mode: 'concurrent' });
    tabs.onCommand(async ({ action, scope, controller }) => ({ ok: true, data: { action, scope, servedTo: controller } }));
    await tabs.connect();

    const a = new BrokerClient({ url: URL, role: 'controller', label: 'agent-A' });
    await a.connect();
    const b = new BrokerClient({ url: URL, role: 'controller', label: 'agent-B' });
    await b.connect();
    await sleep(150);

    // 1. First controller auto-selected as holder of the exclusive resource.
    ok(broker.state().holders.browser === a.assignedId, 'first controller (A) auto-holds the exclusive resource');

    // 2. Active controller's command succeeds and is served.
    const r1 = await a.command('click', { selector: '#go' }, { resource: 'browser' });
    ok(r1.ok && r1.data.servedTo === a.assignedId, 'active controller A command is served');

    // 3. Non-active controller is rejected (not forwarded to the resource).
    const r2 = await b.command('click', { selector: '#go' }, { resource: 'browser' });
    ok(!r2.ok && /not the active controller/i.test(r2.error), 'inactive controller B is rejected');

    // 4. Resource-side selection hands control to B.
    browser.select(b.assignedId, 'browser');
    await sleep(100);
    ok(broker.state().holders.browser === b.assignedId, 'selection switched holder to B');
    const r3 = await b.command('type', { text: 'hi' }, { resource: 'browser' });
    ok(r3.ok && r3.data.servedTo === b.assignedId, 'newly-active controller B command is served');
    const r4 = await a.command('type', {}, { resource: 'browser' });
    ok(!r4.ok, 'previously-active controller A now rejected');

    // 5. Controller-initiated lease take-over with force.
    const lease = await a.acquire('browser', { force: true });
    ok(lease.granted && broker.state().holders.browser === a.assignedId, 'A re-acquires the lease with force');

    // 6. Concurrent resource: BOTH controllers can drive it, disambiguated by scope.
    const c1 = await a.command('read', {}, { resource: 'tabs', scope: 'tab-1' });
    const c2 = await b.command('read', {}, { resource: 'tabs', scope: 'tab-2' });
    ok(c1.ok && c1.data.scope === 'tab-1', 'concurrent resource serves controller A (tab-1)');
    ok(c2.ok && c2.data.scope === 'tab-2', 'concurrent resource serves controller B (tab-2) simultaneously');

    // 7. Auto-reselect: holder A disconnects, the lone remaining controller (B) takes over.
    a.close();
    await sleep(200);
    ok(broker.state().holders.browser === b.assignedId, 'auto-reselected lone remaining controller (B) after holder left');

    // 8. Unknown resource handled gracefully.
    const r5 = await b.command('x', {}, { resource: 'nope' });
    ok(!r5.ok && /no such resource/i.test(r5.error), 'command to unknown resource errors cleanly');

    b.close(); browser.close(); tabs.close();

    // 9. Lease TTL via heartbeat: a hung holder (socket stops answering pings)
    //    is detected, terminated, and its lease reassigned. Isolated broker with
    //    a fast heartbeat so the test stays quick.
    const broker2 = createBroker({ port: 8803, heartbeatMs: 120, logger: () => {} });
    await sleep(150);
    const hbRes = new BrokerClient({ url: 'ws://127.0.0.1:8803', role: 'resource', name: 'hb', mode: 'exclusive' });
    hbRes.onCommand(async () => ({ ok: true }));
    await hbRes.connect();
    const hung = new BrokerClient({ url: 'ws://127.0.0.1:8803', role: 'controller', label: 'hung', autoReconnect: false });
    const live = new BrokerClient({ url: 'ws://127.0.0.1:8803', role: 'controller', label: 'live' });
    await hung.connect();
    await live.connect();
    await sleep(120);
    ok(broker2.state().holders.hb === hung.assignedId, 'heartbeat: first controller holds the lease');
    hung.ws.pause(); // simulate a hung process — socket stops replying to pings
    await sleep(700); // several heartbeat cycles
    ok(broker2.state().holders.hb === live.assignedId, 'heartbeat: hung holder dropped, lease reassigned to live controller');
    live.close(); hbRes.close();
    await broker2.close();
} catch (e) {
    failures++;
    console.error('Harness error:', e);
} finally {
    await sleep(100);
    await broker.close();
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
}
