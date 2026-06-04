import type { Role, Mode } from './protocol.js';

export interface AuthInfo {
    role: Role;
    token?: string;
    meta?: Record<string, unknown>;
    remoteAddress?: string;
}

export interface BrokerOptions {
    /** Listen port (default: env BROKER_PORT or 8765). */
    port?: number;
    /** Bind host (default: 127.0.0.1). */
    host?: string;
    /** Auth gate for every connection. Default: accept localhost only. */
    authenticate?: (info: AuthInfo) => boolean | Promise<boolean>;
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
