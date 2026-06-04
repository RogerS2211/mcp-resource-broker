# mcp-resource-broker

**Let many AI/agent sessions safely share one stateful resource — with active-instance arbitration instead of collisions.**

Most browser-MCP tools (Browser MCP, mcp-chrome, browser-control-mcp, even
Chrome DevTools MCP) assume **one agent**. Open a second editor window or agent
session and they collide on a single port/connection — the resource silently
binds to whichever started first, with no way to choose. This package is the
missing layer: a small **broker** that all sessions and the resource connect to,
which routes browser/resource traffic to the **controller you select** and routes
the response back to that same caller.

> A browser extension is just the first resource type — the pattern fits any
> singleton stateful resource (a desktop app, a device, a single DB session).

## Concepts

- **controller** — an agent / MCP-server side that issues commands (one per session).
- **resource** — the controllable thing (a browser extension), executes commands.
- **broker** — the only WebSocket *server*; everyone else is a client. Owns the
  port, holds the roster, arbitrates control.

Resources are **exclusive** (only the selected controller may drive — safe for a
logged-in browser) or **concurrent** (any controller may drive; disambiguated by
`scope`, e.g. a tab id — for parallel work).

See [`PROTOCOL.md`](./PROTOCOL.md) for the wire format.

## Install & try it

```bash
npm install
npm test       # end-to-end: arbitration, hand-off, concurrent routing, auto-reselect
npm run example  # narrated two-session demo (no browser needed)
```

## Run the broker

```bash
npm run broker            # or: npx mcp-resource-broker
BROKER_PORT=9000 npm run broker
```

Or auto-spawn it from your controller so it outlives any single session (a
redundant spawn is harmless — it exits if the port is taken):

```js
import { spawn } from 'node:child_process';
spawn(process.execPath, [brokerBinPath], { detached: true, stdio: 'ignore' }).unref();
```

## Controller side (your MCP server)

```js
import { BrokerClient } from 'mcp-resource-broker/node-client';

const ctrl = new BrokerClient({ role: 'controller', label: process.cwd() });
await ctrl.connect();

// In each MCP tool handler:
const res = await ctrl.command('click', { selector: '#go' }, { resource: 'browser' });
if (!res.ok) throw new Error(res.error); // e.g. "not the active controller — select it"
return res.data;
```

## Resource side (your browser extension)

Drop [`src/extension-client.js`](./src/extension-client.js) into your MV3
background script (no bundler needed):

```js
const resource = new BrokerResource({
  name: 'my-extension',
  mode: 'exclusive',
  onCommand: async ({ action, params, scope }) => {
    // run it in the active tab, return { ok, data } or { ok:false, error }
    return { ok: true, data: await doThing(action, params) };
  },
  onRoster: (roster) => { latestRoster = roster; } // expose to popup
});
resource.connect();

// Popup picker: list roster.controllers, mark roster.holders[name], and on click:
resource.select(chosenControllerId);
```

A Node resource can use `BrokerClient` with `role: 'resource'` (see the test).

## Status

`0.1.0` — functional core: routing, exclusive/concurrent modes, leases,
selection, roster, auto-reselect, localhost auth hook. **Not yet** production:
no lease TTL/heartbeat, no observer/audit stream, no capability scoping, no
non-localhost hardening. See the roadmap in `PROTOCOL.md`.

## Support

If this saved you the headache of building multi-agent arbitration yourself,
you can buy me a coffee — it's appreciated and helps keep the project maintained:

- ☕ **Ko-fi:** [ko-fi.com/rog3rs2211](https://ko-fi.com/rog3rs2211)
- ☕ **Buy Me a Coffee:** [buymeacoffee.com/rog3rs2211](https://buymeacoffee.com/rog3rs2211)

<!-- GitHub Sponsors coming soon. -->

## License

MIT
