# Browser quickstart

A complete, runnable end-to-end demo: control **one browser** from **multiple AI
sessions**, and pick which session is active from the extension popup. This is
the real shape of the problem the broker solves.

```
Claude/Cursor #1 ─ MCP server ─┐
Claude/Cursor #2 ─ MCP server ─┼─► broker (ws://127.0.0.1:8765) ◄─ browser extension
                               ┘        routes to the SELECTED session   (resource "demo-browser")
```

Pieces in this folder:
- `mcp-server/` — a real MCP server (`@modelcontextprotocol/sdk`) that registers
  with the broker as a **controller** and exposes `get_active_tab` / `list_tabs`.
- `extension/` — a minimal Chrome MV3 extension that registers as the **resource**,
  runs commands against the active tab, and has a popup to pick the active session.

## 1. Start the broker

```bash
npx mcp-resource-broker          # or, from the repo root: npm run broker
```

Leave it running. Check it any time with `mcp-resource-broker status`.

## 2. Install the example MCP server

```bash
cd examples/browser-quickstart/mcp-server
npm install
```

## 3. Load the extension (Chrome/Edge)

1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `examples/browser-quickstart/extension`.
3. The service worker connects to the broker. Open the broker's `status` and
   you'll see the `demo-browser` resource appear.

> **Firefox:** edit `extension/manifest.json` `background` to
> `{ "scripts": ["extension-client.js", "background.js"] }`, remove the
> `importScripts(...)` line at the top of `background.js`, then load it via
> `about:debugging` → **This Firefox** → **Load Temporary Add-on**.

## 4. Wire the MCP server into two agent sessions

Add this to each agent (Claude Code, Cursor, Claude Desktop, …), using an
**absolute** path to `server.js`. Give each window a different label:

```jsonc
{
  "mcpServers": {
    "broker-quickstart": {
      "command": "node",
      "args": ["<ABS>/examples/browser-quickstart/mcp-server/server.js"],
      "env": { "CONTROLLER_LABEL": "session-1" }
    }
  }
}
```

Open **two** agent windows (each starts its own MCP server → two controllers).

## 5. See it work

- In **session-1**, call the `get_active_tab` tool → it returns the active tab's
  title + URL. It's auto-selected as the first controller, so it works.
- In **session-2**, call `get_active_tab` → **refused**: "not the active
  controller — select it to take control."
- Open the **extension popup**, pick **session-2**, and call it again → now it
  works, and session-1 is refused. Switch freely; the browser is never driven by
  two sessions at once.

`mcp-resource-broker status --watch` shows the roster and audit events live as
you switch.

## Notes

- `extension/extension-client.js` is vendored from `src/extension-client.js`
  (unpacked extensions must be self-contained). Keep it in sync if you change the
  library.
- The MCP server auto-reconnects, so the broker and sessions can start in any
  order.
