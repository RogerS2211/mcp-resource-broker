#!/usr/bin/env node
// Standalone broker process. Run directly (`mcp-resource-broker`) or have your
// controller auto-spawn it detached so it outlives any single session:
//
//   import { spawn } from 'node:child_process';
//   spawn(process.execPath, [brokerBinPath], { detached: true, stdio: 'ignore' }).unref();
//
// exitOnPortInUse makes a redundant spawn harmless: if a broker already owns the
// port, this one exits 0 immediately.

import { createBroker } from '../src/broker.js';

const broker = createBroker({
    port: parseInt(process.env.BROKER_PORT || '8765', 10),
    host: process.env.BROKER_HOST || '127.0.0.1',
    exitOnPortInUse: true
});

const shutdown = async () => { try { await broker.close(); } finally { process.exit(0); } };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
