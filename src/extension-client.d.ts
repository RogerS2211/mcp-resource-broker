import type { Mode } from './protocol.js';
import type { Roster, IncomingCommand, CommandHandlerResult } from './node-client.js';

export interface BrokerResourceOptions {
    /** Broker URL (default: ws://127.0.0.1:8765). */
    url?: string;
    /** Resource name (default: 'browser'). */
    name?: string;
    /** Resource mode (default: 'exclusive'). */
    mode?: Mode;
    token?: string;
    meta?: Record<string, unknown>;
    /** Execute an incoming command in the page; return a result. */
    onCommand?: (cmd: IncomingCommand) => CommandHandlerResult | Promise<CommandHandlerResult>;
    /** Receive roster updates (feed your popup picker). */
    onRoster?: (roster: Roster) => void;
}

/**
 * Browser (MV3) resource client. Exposed as a global `BrokerResource` when the
 * script is loaded directly, and as a CommonJS export when bundled.
 */
export class BrokerResource {
    constructor(opts?: BrokerResourceOptions);
    readonly connected: boolean;
    readonly roster: Roster;
    connect(): void;
    /** Set which controller drives this resource (call from your popup). */
    select(controllerId: string | null): void;
    /** Ask the broker to push a fresh roster. */
    refresh(): void;
    close(): void;
}
