// Example MCP server (one per agent session) that drives the browser extension
// through the broker. It connects to the broker as a CONTROLLER and exposes its
// browser actions as MCP tools. Run two agent sessions and only the one selected
// in the extension popup will actually control the browser — the other gets a
// clear "not the active controller" error.
//
// Configure it in your agent (e.g. Claude Code / Cursor):
//   { "mcpServers": { "broker-quickstart": {
//       "command": "node",
//       "args": ["<abs-path>/server.js"],
//       "env": { "CONTROLLER_LABEL": "session-1" } } } }
//
// Start the broker first (any one terminal):  npx mcp-resource-broker

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BrokerClient } from 'mcp-resource-broker/node-client';

const RESOURCE = 'demo-browser';

const controller = new BrokerClient({
    url: process.env.BROKER_URL || 'ws://127.0.0.1:8765',
    role: 'controller',
    label: process.env.CONTROLLER_LABEL || `session-${process.pid}`
});
// Auto-reconnects, so the broker and this server can start in any order.
controller.connect().catch(() => {});

async function call(action, params = {}) {
    if (!controller.ready) {
        return { content: [{ type: 'text', text: 'Broker not connected. Start it with: npx mcp-resource-broker' }], isError: true };
    }
    const res = await controller.command(action, params, { resource: RESOURCE });
    if (!res.ok) {
        return { content: [{ type: 'text', text: `Error: ${res.error}` }], isError: true };
    }
    return { content: [{ type: 'text', text: typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2) }] };
}

const server = new McpServer({ name: 'broker-quickstart', version: '0.1.0' });

server.registerTool(
    'get_active_tab',
    { title: 'Get Active Tab', description: 'Return the active browser tab\'s title and URL', inputSchema: z.object({}) },
    async () => call('get_active_tab')
);

server.registerTool(
    'list_tabs',
    { title: 'List Tabs', description: 'List all open browser tabs (id, title, URL)', inputSchema: z.object({}) },
    async () => call('list_tabs')
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`broker-quickstart MCP server started as "${controller.label}"`);
