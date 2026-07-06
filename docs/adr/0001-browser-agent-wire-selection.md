# ADR 0001: Browser transport supports advertised agent wire protocols

## Status

Accepted

## Context

The browser client originally assumed a Codex-compatible WebSocket wire after the doggypile daemon handshake. We now need to support multiple backend agents, including opencode, which uses newline-delimited JSON-RPC directly over the doggypile stream.

The daemon can advertise available agents and their wire protocols.

## Decision

The browser transport will:

- call `list_agents` before connecting when agent selection is `auto`
- prefer `codex` when available
- fall back to `opencode` when Codex is unavailable
- use WebSocket framing for `codex`
- use JSONL framing for `opencode` and other JSONL agents
- expose selected `agent`, `wire`, and `fallbackFrom` metadata to the UI

The UI may display the selected agent/path in connection status.

The projection layer tolerates opencode live-stream lifecycle quirks, including stale empty lifecycle frames and duplicated replay artifacts.

## Consequences

Positive:

- Browser can work with either Codex or opencode daemons.
- Transport protocol selection is daemon-driven instead of hardcoded.
- Codex remains the preferred/default experience.

Tradeoffs:

- Client transport is more complex.
- Projection layer now contains compatibility logic for opencode streaming quirks.
- Future agents should advertise a `wire` value and ideally avoid requiring agent-specific projection hacks.

## Alternatives considered

- Keep separate browser builds per agent.
- Require users to manually select the agent.
- Proxy all agents through a Codex-compatible WebSocket adapter in the daemon.
