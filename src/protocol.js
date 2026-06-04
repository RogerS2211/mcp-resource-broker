// Wire protocol for the MCP resource broker.
//
// Participant roles connect to the broker over WebSocket:
//   - controller : an agent / MCP-server side that issues commands
//   - resource   : the thing being controlled (e.g. a browser extension)
//   - observer   : read-only — receives roster + audit events, may send `select`
//
// A controller's command is routed to the target resource; the resource's
// result is routed back to the originating controller. For EXCLUSIVE resources
// only the currently-selected controller may issue commands; others are
// rejected. For CONCURRENT resources any controller may issue commands and the
// resource disambiguates them via the optional `scope` field (e.g. a tab id).

export const PROTOCOL_VERSION = '1';

export const T = Object.freeze({
    // handshake
    HELLO: 'hello',         // -> broker   { role, name?, mode?, id?, label?, token?, meta? }
    WELCOME: 'welcome',     // <- broker   { assignedId, role, features[] }
    ERROR: 'error',         // <- broker   { error }

    // command routing
    COMMAND: 'command',     // controller -> broker -> resource  { id, action, params, resource?, scope? }
    RESULT: 'result',       // resource   -> broker -> controller { id, ok, data?, error? }

    // exclusive-mode leasing / selection
    ACQUIRE: 'acquire',     // controller -> broker  { resource?, force? }
    RELEASE: 'release',     // controller -> broker  { resource? }
    LEASE: 'lease',         // <- broker             { resource, granted, holder }
    SELECT: 'select',       // resource/observer -> broker  { resource?, controllerId|null }

    // roster / liveness
    GET_ROSTER: 'get_roster',
    ROSTER: 'roster',       // <- broker  { resources[], controllers[], holders{} }
    AUDIT: 'audit',         // <- broker (observers)  { event: { ts, type, ... } }
    PING: 'ping',
    PONG: 'pong'
});

export const MODES = Object.freeze({ EXCLUSIVE: 'exclusive', CONCURRENT: 'concurrent' });

export function isLocalhost(addr) {
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}
