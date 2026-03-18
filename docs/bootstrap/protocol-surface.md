# Codex App-Server Protocol Surface

Purpose: capture the exact Codex app-server v2 surface that codapter needs first, using local primary sources instead of narrative reverse-engineering.

## Primary Sources

- `../codex/codex-rs/app-server/README.md`
- `../codex/codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/ServerNotification.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/ClientNotification.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/InitializeParams.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/InitializeResponse.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/v2/*.ts` for per-method payloads

## Wire-Level Baseline

- Transport messages are JSON-RPC 2.0 payloads with the `jsonrpc` header omitted on the wire.
- Local stdio transport is newline-delimited JSON.
- WebSocket transport carries one JSON-RPC message per text frame.
- The external contract is the typed v2 notification surface: `thread/*`, `turn/*`, `item/*`, `command/exec/*`, and related methods.
- Raw legacy `codex/event/*` notifications are still produced internally for compatibility, but the upstream transport layer drops them for external clients. Codapter should not implement the legacy surface.

## First-Implementation Request Surface

These are the request methods that matter for Milestones 1 through 5.

### Handshake and startup

- `initialize`
- client notification: `initialized`

### Threads and turns

- `thread/start`
- `thread/resume`
- `thread/fork`
- `thread/read`
- `thread/list`
- `thread/loaded/list`
- `thread/name/set`
- `thread/archive`
- `thread/unarchive`
- `thread/metadata/update`
- `thread/unsubscribe`
- `turn/start`
- `turn/interrupt`

### Startup/settings surface the GUI expects early

- `config/read`
- `config/value/write`
- `config/batchWrite`
- `configRequirements/read`
- `getAuthStatus`
- `skills/list`
- `plugin/list`
- `model/list`

### Adapter-native execution

- `command/exec`
- `command/exec/write`
- `command/exec/resize`
- `command/exec/terminate`

## First-Implementation Notification Surface

### Thread lifecycle

- `thread/started`
- `thread/status/changed`
- `thread/archived`
- `thread/unarchived`
- `thread/closed`
- `thread/name/updated`
- `thread/tokenUsage/updated`

### Turn lifecycle

- `turn/started`
- `turn/completed`
- `turn/diff/updated`
- `turn/plan/updated`

### Item lifecycle and deltas

- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `item/reasoning/summaryTextDelta`
- `item/reasoning/summaryPartAdded`
- `item/reasoning/textDelta`
- `item/commandExecution/outputDelta`
- `item/commandExecution/terminalInteraction`
- `item/fileChange/outputDelta`
- `item/mcpToolCall/progress`

### Standalone command execution

- `command/exec/outputDelta`

### Miscellaneous but relevant

- `skills/changed`
- `serverRequest/resolved`
- `error`
- `configWarning`

## Payload Notes That Matter To Codapter

### Initialize

- `InitializeParams = { clientInfo, capabilities | null }`
- `InitializeResponse = { userAgent, platformFamily, platformOs }`
- `capabilities.optOutNotificationMethods` is exact-match only.
- unknown opt-out method names are accepted and ignored.
- any non-`initialize` request before initialization is rejected with `Not initialized`.
- repeated `initialize` on the same connection is rejected with `Already initialized`.

### Thread and turn streaming

- `thread/start` returns a `thread` plus resolved execution settings like model, provider, cwd, approval policy, sandbox policy, and reasoning effort.
- `turn/start` returns immediately with the new `turn` object, then streaming notifications follow.
- current upstream note: `turn/started` and `turn/completed` carry `turn` objects whose `items` array may still be empty even when item notifications streamed. Item notifications remain the authoritative streaming surface.
- item lifecycle is always `item/started` then zero or more item-specific deltas then `item/completed`.

### Config and auth

- `config/read` params are not empty: `includeLayers: boolean` is required, `cwd` is optional.
- `config/read` response shape is `config`, `origins`, and `layers | null`.
- `config/value/write` and `config/batchWrite` are modeled as real config file writes, with versioned responses that include `status`, `version`, and canonical `filePath`.
- `configRequirements/read` returns `{ requirements: ConfigRequirements | null }`.
- `getAuthStatus` is still part of the top-level request union, with params `{ includeToken, refreshToken }` and response `{ authMethod, authToken, requiresOpenaiAuth }`.

### Standalone `command/exec`

- request shape is argv-based: `command: string[]`, not a single shell string.
- `processId` is optional for buffered execution, but required for `tty`, `streamStdin`, `streamStdoutStderr`, and all follow-up `write` / `resize` / `terminate` calls.
- `tty: true` implies `streamStdin: true` and `streamStdoutStderr: true`.
- streamed bytes are base64 in `command/exec/outputDelta.deltaBase64`.
- the final `command/exec` response is deferred until process exit and is sent only after all `command/exec/outputDelta` notifications are emitted.
- if stdout/stderr was streamed, the final `stdout` / `stderr` fields are empty rather than duplicated.
- `command/exec/outputDelta` is connection-scoped. Closing the originating connection terminates the process.

## Implementation Implications

- Codapter should import generated protocol types directly during implementation instead of re-declaring request/response payloads by hand.
- The adapter should normalize its internal state machine around v2 item notifications, not the legacy `codex/event/*` names.
- The startup stub plan must preserve real request and response shapes even when the backend implementation is temporary.
- `command/exec` must be implemented against the full lifecycle above, or it should be left explicitly out of milestone scope. A shallow placeholder will not match the protocol.

## Out Of Scope For v0.1

These are present in upstream sources but should not drive the first codapter pass.

- realtime thread methods and notifications
- review mode
n- plugin install/read/uninstall flows
- external agent config import/detect
- Windows sandbox APIs
- fuzzy file search
- account login/logout/rate-limit flows beyond the legacy `getAuthStatus` shape we must satisfy for compatibility

## Recommended Early Validation

- initialize then initialized then `config/read`
- pre-initialize request rejection
- opt-out filtering for `thread/started`
- `thread/start` followed by `thread/started`
- `turn/start` followed by `turn/started`, `item/*`, and `turn/completed`
- buffered `command/exec`
- PTY `command/exec` with write / resize / terminate
