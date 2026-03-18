# GUI Init, Config, and Command Notes

Status: explored against sibling `../codex` checkout

Purpose: capture the GUI-facing startup and standalone command behavior that matters before implementation starts.

## Primary Sources

- `../codex/codex-rs/app-server/README.md`
- `../codex/codex-rs/app-server/src/message_processor.rs`
- `../codex/codex-rs/app-server/src/transport.rs`
- `../codex/codex-rs/app-server/tests/suite/v2/initialize.rs`
- `../codex/codex-rs/app-server/tests/suite/v2/connection_handling_websocket.rs`
- `../codex/codex-rs/app-server/tests/suite/v2/command_exec.rs`
- `../codex/codex-rs/app-server/src/command_exec.rs`
- `../codex/codex-rs/app-server/src/codex_message_processor.rs`
- `../codex/codex-rs/app-server-protocol/schema/typescript/InitializeParams.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/InitializeResponse.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/GetAuthStatusParams.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/GetAuthStatusResponse.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/ServerNotification.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/ClientNotification.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/v2/ConfigReadParams.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/v2/ConfigReadResponse.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/v2/ConfigValueWriteParams.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/v2/ConfigBatchWriteParams.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/v2/ConfigWriteResponse.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/v2/ConfigRequirementsReadResponse.ts`
- `../codex/codex-rs/app-server-protocol/schema/typescript/v2/CommandExec*.ts`
- `../codex/codex-rs/app-server-client/src/*.rs`
- `../codex/codex-rs/tui_app_server/src/*.rs`

## Initialize Handshake Requirements

- The public contract is JSON-RPC 2.0 with the `jsonrpc` field omitted on the wire.
- The client must send exactly one `initialize` request per connection.
- The client must then send an `initialized` notification.
- Any non-`initialize` request before that handshake is rejected with `Not initialized`.
- A second `initialize` on the same connection is rejected with `Already initialized`.
- `InitializeResponse` contains only `userAgent`, `platformFamily`, and `platformOs`.
- For external clients, the relevant notification surface is the typed app-server protocol. Legacy raw `codex/event/*` notifications are not the external contract to target.

## `clientInfo` Rules

- `clientInfo.name` is not cosmetic. The server uses it as the originator/client identity.
- `clientInfo.name` must be valid as an HTTP header value. Invalid values are rejected during initialize.
- The returned `userAgent` is derived from that client identity or from an explicit environment override if one is present upstream.

## Notification Opt-Out Rules

- `capabilities.optOutNotificationMethods` is exact-match only.
- Unknown method names are accepted and ignored.
- The filter applies to typed app-server notifications like `thread/*`, `turn/*`, and `item/*`.
- It does not apply to requests, responses, or errors.

## No App-Level Heartbeat Method Found

- I did not find a dedicated app-server `heartbeat`, `keepalive`, `ping`, or `pong` JSON-RPC method in the protocol schema or app-server request union.
- For WebSocket transport, the server replies to WebSocket control-frame `Ping` with `Pong` at the transport layer.
- For stdio, there is no separate heartbeat RPC in the primary sources.
- Implementation implication: codapter should not invent a custom heartbeat method unless the real GUI trace proves one exists outside the checked-in server/protocol sources.

## Startup Config Surface

### `config/read`

- params: `{ includeLayers: boolean, cwd?: string | null }`
- response: `{ config, origins, layers }`
- `layers` is `Array<ConfigLayer> | null`, not always an array.
- `origins` is a map of key-path to metadata, not a flat blob.

### `config/value/write`

- params: `{ keyPath, value, mergeStrategy, filePath?, expectedVersion? }`
- response: `{ status, version, filePath, overriddenMetadata }`
- upstream models this as a real config file write, not an in-memory patch.

### `config/batchWrite`

- params: `{ edits, filePath?, expectedVersion?, reloadUserConfig? }`
- response uses the same `ConfigWriteResponse` shape.
- `reloadUserConfig` exists in the real contract.

### `configRequirements/read`

- response: `{ requirements: ConfigRequirements | null }`
- returning bare `null` would not match the typed wire contract.

## Auth / Startup Compatibility Surface

### `getAuthStatus`

- params: `{ includeToken: boolean | null, refreshToken: boolean | null }`
- response: `{ authMethod, authToken, requiresOpenaiAuth }`
- it is still part of the top-level request union even though most of the app-server is now v2.

### `skills/list`

- params are not empty. Upstream supports `cwds`, `forceReload`, and `perCwdExtraUserRoots`.
- response shape is `{ data: SkillsListEntry[] }`.

### `plugin/list`

- params support optional `cwds` and `forceRemoteSync`.
- response shape is `{ marketplaces, remoteSyncError }`.
- upstream marks parts of plugin support as under development. For codapter v0.1, a minimal empty-but-correctly-shaped response is safer than inventing semantics.

## Standalone `command/exec` Expectations

- `command/exec` is argv-based: `command: string[]`.
- empty command arrays are rejected upstream.
- `processId` is optional only for buffered execution.
- `tty`, `streamStdin`, `streamStdoutStderr`, and follow-up `write` / `resize` / `terminate` calls require a client-supplied `processId`.
- `tty: true` implies streaming stdin and stdout/stderr.
- stdout/stderr deltas arrive as base64 chunks in `command/exec/outputDelta`.
- If output is streamed, the final `command/exec` response does not duplicate it into `stdout` / `stderr`.
- The final response is sent only after the process exits and after all outputDelta notifications have been emitted.
- `command/exec/outputDelta` is connection-scoped. If the originating connection closes, the server terminates the process.
- PTY output is multiplexed through the `stdout` stream label.
- env overrides merge onto the computed environment, and `null` unsets inherited variables.

## WebSocket Transport Quirks

- initialize responses are request-scoped and do not leak across connections.
- request ids are connection-scoped; identical ids on separate connections are valid and route independently.
- the same listener also serves `/readyz` and `/healthz` over HTTP.
- requests carrying an `Origin` header are rejected.
- the upstream WebSocket transport is explicitly labeled experimental/unsupported, but it is real and tested.
- the checked-in remote client only connects to an already-running `ws://` or `wss://` endpoint and performs the normal initialize/initialized handshake.
- historical notifications are not replayed after reconnect; remote transcript restoration relies on the thread snapshot returned by thread RPCs.

## Legacy / Hidden Surfaces To Keep Out Of v0.1

These do not appear in the checked-in app-server request union and should not shape the first implementation pass.

- GUI-only worktree RPCs such as `create-worktree`, `delete-worktree`, `resolve-worktree-for-thread`, and `worktree-cleanup-inputs`
- hidden/Statsig-gated remote-connection management RPCs from the Electron app UI
- raw `codex/event/*` notification compatibility
- internal originator override env vars and TUI-specific remote UX branches

## Early Smoke Tests

1. stdio handshake: `initialize` then `initialized` then `config/read`
2. pre-init rejection: send `config/read` before initialize and confirm `Not initialized`
3. invalid client name: confirm initialize rejects bad header values
4. opt-out filtering: initialize with `thread/started` in `optOutNotificationMethods` and confirm the notification is suppressed
5. `config/value/write` round-trip using the real wire shapes
6. `command/exec` buffered mode: exit code plus buffered stdout/stderr
7. `command/exec` streaming PTY mode: outputDelta, write, resize, terminate
8. WebSocket health probes plus ping/pong behavior and `Origin` rejection
