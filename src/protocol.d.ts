export const PROTOCOL_VERSION: string;

export type Role = 'controller' | 'resource' | 'observer';
export type Mode = 'exclusive' | 'concurrent';

export const T: Readonly<{
    HELLO: 'hello'; WELCOME: 'welcome'; ERROR: 'error';
    COMMAND: 'command'; RESULT: 'result';
    ACQUIRE: 'acquire'; RELEASE: 'release'; LEASE: 'lease'; SELECT: 'select';
    GET_ROSTER: 'get_roster'; ROSTER: 'roster'; AUDIT: 'audit'; PING: 'ping'; PONG: 'pong';
}>;

export const MODES: Readonly<{ EXCLUSIVE: 'exclusive'; CONCURRENT: 'concurrent' }>;

export function isLocalhost(addr: string): boolean;
