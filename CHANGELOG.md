# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-06-04

### Added
- Broker core: routes commands from many controllers to one or more shared
  resources over localhost WebSocket.
- **Exclusive** mode with active-controller arbitration (auto-select first
  controller, manual `select`, `acquire`/`release` leases, auto-reselect of the
  lone remaining controller when a holder leaves).
- **Concurrent** mode: any controller may drive a resource, disambiguated by `scope`.
- **Lease TTL via heartbeat**: sockets that stop answering pings are dropped and
  their lease reassigned, so a hung/sleeping controller can't hold a resource
  forever (`heartbeatMs`, default 15s).
- Pluggable `authenticate` hook (defaults to localhost-only).
- Node client (`BrokerClient`, controller or resource role) and a zero-dependency
  MV3 browser resource client (`BrokerResource`).
- TypeScript declarations for all public entry points.
- Protocol spec (`PROTOCOL.md`), runnable echo demo, and end-to-end test suite.

[0.1.0]: https://github.com/RogerS2211/mcp-resource-broker/releases/tag/v0.1.0
