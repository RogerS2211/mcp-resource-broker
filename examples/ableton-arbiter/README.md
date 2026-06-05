# Ableton arbiter

The broker pattern applied to a **real third-party MCP server**:
[ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp). It lets you run
that server at **user scope** across several Claude/Cursor sessions without them
fighting over Ableton — only the session you select actually drives Live.

## Why it's needed

`ableton-mcp`'s server is a TCP **client** that connects to the Ableton Remote
Script (a TCP server on `:9877`), and the project warns *"only run one instance."*
At user scope, every agent window spawns its own client → multiple uncoordinated
controllers on one Live session. The arbiter inserts a single point of control:

```
ableton-mcp #1 ─┐
ableton-mcp #2 ─┼─►  arbiter :9877  ──►  Ableton Remote Script :9878
ableton-mcp #3 ─┘     forwards only the SELECTED instance
```

This is the same idea as the WebSocket broker in this repo (one owner, arbitrated
active instance, `status`/`select`), specialized to Ableton's raw-TCP JSON
protocol so the third-party server needs **no changes**.

## Setup

**1. Move the real Remote Script to port 9878.**
In your installed Remote Script (`.../Ableton/.../Remote Scripts/AbletonMCP_Remote_Script/__init__.py`),
change:
```python
DEFAULT_PORT = 9877   # ->
DEFAULT_PORT = 9878
```
Restart Live. The Remote Script now listens on `:9878`, freeing `:9877`.

**2. Run the arbiter** (it takes `:9877`, where the MCP servers connect):
```bash
node arbiter.js
```

**3. Add `ableton-mcp` at user scope** in each agent (unchanged — it still
connects to `:9877`, which is now the arbiter):
```json
{ "mcpServers": { "AbletonMCP": { "command": "uvx", "args": ["ableton-mcp"] } } }
```

**4. Pick the active session:**
```bash
node arbiter.js status         # list connected instances + which is active
node arbiter.js select 2       # hand control to instance 2
node arbiter.js select newest  # hand control to the most recently connected
```
The first instance to connect is auto-selected. Inactive instances get an
immediate `"not the active Ableton instance"` error instead of corrupting state.

**Auto-promotion (zombie recovery).** If the active instance goes idle past a
threshold (default **10s**) — e.g. a leftover `ableton-mcp` from a closed session
that still holds the connection — the next request from another instance simply
**takes over**, so a stale session can't wedge the set and you don't have to race
to `select` it. A still-busy active session is never stolen from. Tune or disable
with `ABLETON_AUTO_PROMOTE_MS` (`0` = manual `select` only). Dead sockets (crashed
sessions) are handed over immediately via TCP keepalive.

## Test (no Ableton required)

```bash
node test.mjs
```
Spins up a mock Remote Script + two mock clients and asserts that only the active
instance reaches Ableton, that `select` switches control, and that an idle active
is auto-superseded.

To *see* the stale-active warning rendered in `status` (no Ableton needed):
```bash
node demo-zombie.mjs
```

## Ports

| Port | Who | Override |
|---|---|---|
| 9877 | arbiter (where `ableton-mcp` connects) | `ABLETON_ARBITER_PORT` |
| 9878 | real Ableton Remote Script | `ABLETON_UPSTREAM_PORT` |
| 9875 | arbiter control (status/select) | `ABLETON_CONTROL_PORT` |

## Caveats

- **Confirmed against real Ableton Live** for passthrough — a session reaches Live
  through the arbiter (Remote Script moved to `:9878`, arbiter on `:9877`). The
  arbitration/selection logic is additionally covered by `test.mjs` (mock Remote
  Script mirroring the buffered-JSON framing).
- Switch the active instance when it's **idle** (between commands). The arbiter
  routes one synchronous request/response at a time per the protocol.
- Like the Remote Script's own parser, framing assumes one JSON object per
  request (no pipelining), which matches how `ableton-mcp` behaves.
