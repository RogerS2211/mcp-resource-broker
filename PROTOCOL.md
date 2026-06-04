# MCP Resource Broker — Protocol v1

A localhost WebSocket protocol for routing commands from many **controllers**
(agent / MCP-server sides) to one or more shared **resources** (e.g. a browser
extension), with arbitration over which controller owns each exclusive resource.

All messages are JSON objects with a `type` field.

## Roles

| Role | Who | Connects how |
|---|---|---|
| **controller** | An MCP server inside an agent session (Claude, Cursor, …) | WebSocket client |
| **resource** | The controllable thing (browser extension, app, device) | WebSocket client |
| *(observer)* | *Reserved for future dashboards (read-only roster)* | — |

The **broker** is the only WebSocket *server*. This is the key inversion vs.
typical browser-MCP tools, where each agent's server owns the port and they
collide.

## Resource modes

| Mode | Gating | Use when |
|---|---|---|
| `exclusive` | Only the **selected** controller may send commands; others are refused. Holder is auto-assigned (first controller) and reassignable via `select`/`acquire`. | The resource is a single stateful thing where overlapping control is dangerous (a logged-in browser session, a device). |
| `concurrent` | Any controller may send commands; the resource disambiguates with `scope`. | The resource can serve parallel work (per-tab, per-session). |

## Handshake

```jsonc
// controller/resource -> broker
{ "type": "hello", "protocol": "1", "role": "controller",
  "id": "optional-stable-id", "label": "human label", "token": "optional",
  "meta": { } }

{ "type": "hello", "protocol": "1", "role": "resource",
  "name": "browser", "mode": "exclusive", "token": "optional", "meta": { } }

// broker -> client
{ "type": "welcome", "protocol": "1", "assignedId": "...", "role": "...",
  "features": ["exclusive", "concurrent", "leases"] }

// broker -> client (auth/other failure, then socket closes)
{ "type": "error", "error": "unauthorized" }
```

Authentication is a broker-supplied hook: `authenticate({ role, token, meta,
remoteAddress })`. Default accepts localhost only. Replace it with a token /
shared-secret / mTLS check to expose the broker beyond localhost.

## Command routing

```jsonc
// controller -> broker  (broker assigns an internal routing id and forwards)
{ "type": "command", "id": "q-1", "action": "click",
  "params": { "selector": "#go" }, "resource": "browser", "scope": "tab-7" }

// broker -> resource
{ "type": "command", "id": "rt-42", "action": "click",
  "params": { "selector": "#go" }, "scope": "tab-7", "controller": "ctrl-1" }

// resource -> broker -> controller (id mapped back to the controller's q-1)
{ "type": "result", "id": "rt-42", "ok": true, "data": { } }
```

If the target resource is missing/ambiguous, or the controller is not the active
holder of an exclusive resource, the broker replies directly with
`{ "type": "result", "id": "q-1", "ok": false, "error": "..." }` — the resource
is never contacted.

## Leasing & selection (exclusive resources)

```jsonc
{ "type": "acquire", "resource": "browser", "force": false }   // controller -> broker
{ "type": "release", "resource": "browser" }                   // controller -> broker
{ "type": "lease", "resource": "browser", "granted": true, "holder": "ctrl-1" } // broker -> controller

{ "type": "select", "resource": "browser", "controllerId": "ctrl-2" } // resource/observer -> broker (null = none)
```

Holder lifecycle:
- First controller to register is auto-selected (zero-config single-controller).
- `acquire` grants the lease if free (or with `force`); `release` frees it.
- `select` (typically from the resource's own UI, e.g. an extension popup) sets
  the active controller explicitly.
- When the holder disconnects and exactly one controller remains, it is
  auto-selected; otherwise the holder becomes `null` until someone selects.

## Roster & liveness

```jsonc
{ "type": "get_roster" }   // any -> broker
{ "type": "roster",        // broker -> resources (pushed on every change)
  "resources":   [ { "name": "browser", "mode": "exclusive", "meta": {} } ],
  "controllers": [ { "id": "ctrl-1", "label": "session-A", "meta": {} } ],
  "holders":     { "browser": "ctrl-1" } }

{ "type": "ping", "t": 123 }  // -> broker
{ "type": "pong", "t": 123 }  // <- broker
```

A resource renders its picker from `roster.controllers` + `roster.holders` and
calls `select` when the user chooses — exactly the popup flow in the reference
extension.

## Liveness & lease TTL

Independently of the application-level `ping`/`pong` above, the broker sends a
**WebSocket-protocol ping** to every client every `heartbeatMs` (default 15s).
Clients auto-reply with a pong at the transport layer — `ws` and browser
`WebSocket` both do this automatically, so no client code is required. A socket
that misses a ping is terminated; if it held an exclusive lease, the lease is
freed and reassigned. This bounds how long a hung or sleeping controller can
hold a resource to roughly one heartbeat interval.

## Not in v1 (roadmap)

- Observer role and a metrics/audit stream.
- Per-controller capability scoping (read-only, allowed actions/domains) enforced
  broker-side.
- Non-localhost transport hardening (TLS, real auth).
