# mcp-resource-broker

[![npm version](https://img.shields.io/npm/v/mcp-resource-broker.svg)](https://www.npmjs.com/package/mcp-resource-broker)
[![CI](https://github.com/RogerS2211/mcp-resource-broker/actions/workflows/ci.yml/badge.svg)](https://github.com/RogerS2211/mcp-resource-broker/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Let many AI/agent sessions safely share one stateful resource — with active-instance arbitration instead of collisions.**

<!-- TODO: drop a demo GIF/asciinema here showing two sessions + switching control in the popup.
     Record with the examples/browser-quickstart flow. -->


Most browser-MCP tools (Browser MCP, mcp-chrome, browser-control-mcp, even
Chrome DevTools MCP) assume **one agent**. Open a second editor window or agent
session and they collide on a single port/connection — the resource silently
binds to whichever started first, with no way to choose. This package is the
missing layer: a small **broker** that all sessions and the resource connect to,
which routes browser/resource traffic to the **controller you select** and routes
the response back to that same caller.

> A browser extension is just the first resource type — the pattern fits any
> singleton stateful resource (a desktop app, a device, a single DB session).

## How it compares

There are two different concurrency problems, and most tools only touch the first:
**(a)** one agent driving many tabs/browsers in parallel, and **(b)** many *separate
agent sessions* contending for **one** browser, with a way to choose which is in
control. This package is about **(b)** — and adds **(a)** via concurrent mode.

| Tool | Multiple agent sessions on one browser | Choose which session controls it | Approach |
|---|---|---|---|
| [Browser MCP](https://browsermcp.io/) | ✗ one connection for the server's lifetime | ✗ | extension ↔ server socket |
| [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | ~ subagents share one server, routed per-tab; cross-session is an [open request](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/926) | ✗ | CDP / Puppeteer |
| [mcp-chrome](https://github.com/hangwin/mcp-chrome) | ✗ single native-messaging host, no arbitration | ✗ | native messaging |
| **mcp-resource-broker** | ✓ any number, via a shared broker | ✓ explicit select / lease | broker (this) |

*(Comparison reflects these projects as of June 2026; the browser-control feature
sets overlap — the distinction here is specifically multi-session arbitration.)*

## Why a broker?

The usual design makes the **agent's MCP server** the socket server the extension
connects to. With one agent that's fine. With several, each agent spins up its own
server on the same port — the first wins, the rest silently fail, and the extension
is stuck talking to whichever started first. Inverting it — one **broker** owns the
port; every agent session *and* the extension connect to it as clients — removes the
collision and creates a single place to **arbitrate** who's in control, **scope**
what each session may do, and **audit** every action.

## Concepts

- **controller** — an agent / MCP-server side that issues commands (one per session).
- **resource** — the controllable thing (a browser extension), executes commands.
- **observer** — read-only: live roster + audit stream (powers `status` and dashboards).
- **broker** — the only WebSocket *server*; everyone else is a client. Owns the
  port, holds the roster, arbitrates control.

Resources are **exclusive** (only the selected controller may drive — safe for a
logged-in browser) or **concurrent** (any controller may drive; disambiguated by
`scope`, e.g. a tab id — for parallel work).

The broker also supports an `authorize` hook for per-controller **capability
scoping** (read-only controllers, action allow-lists) and emits an **audit
stream** of every command/denial/lease change. See [`PROTOCOL.md`](./PROTOCOL.md).

See [`PROTOCOL.md`](./PROTOCOL.md) for the wire format.

## Install & try it

```bash
npm install
npm test       # end-to-end: arbitration, hand-off, concurrent routing, auto-reselect
npm run example  # narrated two-session demo (no browser needed)
```

**Want the real thing?** [`examples/browser-quickstart/`](./examples/browser-quickstart)
is a complete, runnable demo — a Chrome extension + a real MCP server — where two
agent sessions share one browser and you pick the active one from the popup.

## Run the broker

```bash
npm run broker            # or: npx mcp-resource-broker
BROKER_PORT=9000 npm run broker
```

### Inspect what's connected

```bash
mcp-resource-broker status            # one-shot: resources, controllers, active holder
mcp-resource-broker status --watch    # live: roster changes + audit events
mcp-resource-broker status --url ws://127.0.0.1:9000
```

```
resources:
  browser  [exclusive]  holder: ctrl-2
controllers:
    ctrl-1  "session-A"
  * ctrl-2  "session-B"  <- active
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

`0.1.0` — routing, exclusive/concurrent modes, leases, selection, roster,
auto-reselect, lease TTL via heartbeat, observer role + `status` CLI, capability
scoping (`authorize`), audit stream, localhost auth hook, and TypeScript types.
Still pre-1.0: lease resumption across reconnects and non-localhost transport
hardening are on the roadmap (see `PROTOCOL.md`).

## Support

If this saved you the headache of building multi-agent arbitration yourself,
you can buy me a coffee — it's appreciated and helps keep the project maintained:

- ☕ **Ko-fi:** [ko-fi.com/rog3rs2211](https://ko-fi.com/rog3rs2211)
- ☕ **Buy Me a Coffee:** [buymeacoffee.com/rog3rs2211](https://buymeacoffee.com/rog3rs2211)

<!-- GitHub Sponsors coming soon. -->

## License

MIT
