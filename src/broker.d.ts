import type { Role, Mode } from './protocol.js';

export interface AuthInfo {
    role: Role;
    token?: string;
    meta?: Record<string, unknown>;
    remoteAddress?: string;
}

export interface AuthorizeInfo {
    controllerId: string;
    action: string;
    resource: string;
    params?: unknown;
    meta?: Record<string, unknown>;
}

export interface AuditEvent {
    ts: number;
    type: 'connect' | 'disconnect' | 'command' | 'denied' | 'lease';
    role?: Role;
    id?: string;
    label?: string;
    controller?: string;
    resource?: string;
    action?: string;
    scope?: unknown;
    holder?: string | null;
    reason?: string;
    via?: string;
}

export interface BrokerOptions {
    /** Listen port (default: env BROKER_PORT or 8765). */
    port?: number;
    /** Bind host (default: 127.0.0.1). */
    host?: string;
    /** Connection gate. Default: accept localhost only. */
    authenticate?: (info: AuthInfo) => boolean | Promise<boolean>;
    /** Per-command capability gate (read-only controllers, allow-lists). Default: allow all. */
    authorize?: (info: AuthorizeInfo) => boolean | Promise<boolean>;
    /** Receives an audit event for every command, denial, lease change, connect/disconnect. */
    onAudit?: (event: AuditEvent) => void;
    /** Mode for resources that don't declare one (default: 'exclusive'). */
    defaultMode?: Mode;
    /** Log sink (default: console.error). */
    logger?: (...args: unknown[]) => void;
    /** process.exit(0) on EADDRINUSE — for the auto-spawn pattern (default: false). */
    exitOnPortInUse?: boolean;
    /** Ping interval in ms; sockets that miss a ping are dropped. 0 disables (default: 15000). */
    heartbeatMs?: number;
}

export interface BrokerState {
    resources: string[];
    controllers: string[];
    holders: Record<string, string | null>;
}

export interface Broker {
    readonly port: number;
    readonly host: string;
    /** Snapshot of live resources, controllers, and exclusive holders. */
    state(): BrokerState;
    /** Terminate all clients and stop listening. */
    close(): Promise<void>;
}

export function createBroker(opts?: BrokerOptions): Broker;
