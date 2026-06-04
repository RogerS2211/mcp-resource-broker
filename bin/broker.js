#!/usr/bin/env node
// CLI for mcp-resource-broker.
//
//   mcp-resource-broker [serve] [--port N] [--host H]   start the broker (default)
//   mcp-resource-broker status [--url ws://..] [--watch] show live resources/controllers/holders
//
// `serve` auto-spawn note: have your controller spawn this detached so the
// broker outlives any single session. It exits 0 if the port is already taken.

import { createBroker } from '../src/broker.js';
import { BrokerClient } from '../src/node-client.js';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'serve';

function flag(name, def) {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const next = argv[i + 1];
    return next && !next.startsWith('-') ? next : true;
}

const port = parseInt(flag('--port', process.env.BROKER_PORT || '8765'), 10);
const host = flag('--host', process.env.BROKER_HOST || '127.0.0.1');
const url = flag('--url', `ws://${host}:${port}`);

if (cmd === 'serve') {
    runBroker();
} else if (cmd === 'status') {
    await runStatus(argv.includes('--watch'));
} else {
    console.error(`Unknown command: ${cmd}

Usage:
  mcp-resource-broker [serve] [--port N] [--host H]
  mcp-resource-broker status [--url ws://host:port] [--watch]`);
    process.exit(1);
}

function runBroker() {
    const broker = createBroker({ port, host, exitOnPortInUse: true });
    const shutdown = async () => { try { await broker.close(); } finally { process.exit(0); } };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

function renderRoster(r) {
    const out = [];
    out.push('resources:');
    if (!r.resources.length) out.push('  (none)');
    for (const res of r.resources) {
        const holder = r.holders[res.name];
        out.push(`  ${res.name}  [${res.mode}]  holder: ${holder || '(none)'}`);
    }
    out.push('controllers:');
    if (!r.controllers.length) out.push('  (none)');
    for (const c of r.controllers) {
        const active = Object.values(r.holders).includes(c.id);
        out.push(`  ${active ? '*' : ' '} ${c.id}  "${c.label}"${active ? '  <- active' : ''}`);
    }
    return out.join('\n');
}

async function runStatus(watch) {
    const obs = new BrokerClient({ url, role: 'observer', autoReconnect: watch });

    obs.onRoster((r) => {
        if (watch) console.log(`\n── roster ───────────────`);
        console.log(renderRoster(r));
        if (!watch) { obs.close(); process.exit(0); }
    });
    if (watch) {
        obs.onAudit((e) => {
            const bits = [e.type, e.controller || e.id, e.resource, e.action].filter(Boolean).join(' ');
            console.log(`audit: ${bits}${e.reason ? ` (${e.reason})` : ''}`);
        });
    }

    try {
        await obs.connect();
    } catch (e) {
        console.error(`Cannot reach broker at ${url} (${e.message}). Is it running?`);
        process.exit(2);
    }

    if (!watch) {
        setTimeout(() => { console.error('No roster received from broker.'); process.exit(2); }, 3000);
    } else {
        console.log(`watching ${url} — Ctrl+C to stop`);
    }
}
