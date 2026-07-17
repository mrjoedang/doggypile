# Web module contracts

## Workspace tabs

`createWorkspaceTabs` is the sole owner of the tab registry and tab lifecycle state: unread counters, activity summaries, active/terminal turn identity, lifecycle revisions, persistence ordering, and the coalesced activity flush.

Its lifecycle boundary is intentionally narrow:

- `notify(connection, message)` — apply one daemon notification once; returns `{ tab, lifecycleChanged, activityChanged }`. Duplicate or stale terminal notifications do not advance the lifecycle revision.
- `beginLocalTurn(tab, attempt)` / `acknowledgeLocalTurn(tab, turnId)` / `failLocalTurn(tab, error, attempt)` — bracket an RPC send attempt and retain its returned terminal identity.
- `materialized(tab, { deviceId, threadId, title })` — atomically replace an ephemeral registry identity.
- `reconcileReadStatus(tab, status, { baselineRevision, attempt })` — admit a read status only when its lifecycle baseline is current and it cannot stale-end known live work.
- `destroy()` — cancel the workspace-owned activity flush.

Low-level lifecycle mutators are private. Callers must not mutate tab identity, unread, activity, turn status, terminal identity, or lifecycle revisions directly.

## Chat controller

The chat controller owns conversation projection/rendering, hydration, send RPC orchestration, and chat UI scheduling. For every daemon message it calls workspace `notify` exactly once, then only updates the visible projection and visible `state.turnActive` rendering state.

Sends route through `beginLocalTurn`, `acknowledgeLocalTurn`, and `failLocalTurn`; ephemeral creation routes through `materialized`. Thread reads route status reconciliation through `reconcileReadStatus`. The controller owns and retains every RAF it requests, including deferred scrolling, and cancels all retained RAFs on `dispose()`.

## Context panel

The context panel owns context visibility/content and its own rendering timers. It does not own lifecycle or activity persistence/flush. Activity coalescing belongs exclusively to workspace tabs.
