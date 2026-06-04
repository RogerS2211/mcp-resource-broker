import type { Role, Mode } from './protocol.js';

export interface BrokerClientOptions {
    /** Broker URL (default: ws://127.0.0.1:8765). */
    url?: string;
    role: Role;
    /** Stable id (controllers); the broker assigns one if omitted. */
    id?: string;
    /** Human-readable label shown in the roster/picker. */
    label?: string;
    /** Resource name (resources only). */
    name?: string;
    /** Resource mode (resources only). */
    mode?: Mode;
    token?: string;
    meta?: Record<string, unknown>;
    /** Reconnect automatically on drop (default: true). */
    autoReconnect?: boolean;
}

export interface RosterEntryResource { name: string; mode: Mode; meta: Record<string, unknown>; }
export interface RosterEntryController { id: string; label: string; meta: Record<string, unknown>; }

export interface Roster {
    type: 'roster';
    resources: RosterEntryResource[];
    controllers: RosterEntryController[];
    holders: Record<string, string | null>;
}

export interface CommandResult {
    type: 'result';
    id: string;
    ok: boolean;
    data?: unknown;
    error?: string;
}

export interface IncomingCommand {
    type: 'command';
    id: string;
    action: string;
    params: unknown;
    scope?: unknown;
    controller: string;
}

/** What a resource's onCommand handler returns. */
export interface CommandHandlerResult {
    ok?: boolean;
    data?: unknown;
    error?: string;
}

export interface CommandOptions {
    /** Target resource name (required when more than one resource is connected). */
    resource?: string;
    /** Disambiguator for concurrent resources (e.g. a tab id). */
    scope?: unknown;
    /** Per-call timeout in ms (default: 30000). */
    timeout?: number;
}

export interface LeaseResult {
    type: 'lease';
    resource: string;
    granted: boolean;
    holder: string | null;
    error?: string;
}

export class BrokerClient {
    constructor(opts: BrokerClientOptions);

    readonly ready: boolean;
    readonly assignedId: string | null;
    readonly roster: Roster;

    /** Resource role: handle an incoming command and return a result. */
    onCommand(fn: (cmd: IncomingCommand) => CommandHandlerResult | Promise<CommandHandlerResult>): this;
    /** Subscribe to roster updates. */
    onRoster(fn: (roster: Roster) => void): this;

    connect(): Promise<this>;

    /** Controller role: send a command; resolves with the result envelope. */
    command(action: string, params?: Record<string, unknown>, opts?: CommandOptions): Promise<CommandResult>;
    /** Controller role: request the exclusive lease on a resource. */
    acquire(resource?: string, opts?: { force?: boolean; timeout?: number }): Promise<LeaseResult>;
    /** Controller role: release the exclusive lease. */
    release(resource?: string): void;
    /** Resource/observer role: set which controller is active (or null). */
    select(controllerId: string | null, resource?: string): void;
    /** Request a fresh roster push. */
    getRoster(): void;
    /** Stop auto-reconnect and close the socket. */
    close(): void;
}
