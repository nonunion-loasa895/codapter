# Pi RPC Surface

Status: explored against sibling `../pi-mono` checkout

Purpose: capture the Pi RPC and session surface codapter will need to wrap behind `IBackend`.

## Primary Sources

- `../pi-mono/packages/coding-agent/docs/rpc.md`
- `../pi-mono/packages/coding-agent/docs/session.md`
- `../pi-mono/packages/coding-agent/src/modes/rpc/rpc-types.ts`
- `../pi-mono/packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- `../pi-mono/packages/coding-agent/src/modes/rpc/jsonl.ts`
- `../pi-mono/packages/coding-agent/src/core/agent-session.ts`
- `../pi-mono/packages/coding-agent/src/core/session-manager.ts`
- `../pi-mono/packages/coding-agent/src/core/tools/bash.ts`
- `../pi-mono/packages/agent/README.md`
- `../pi-mono/packages/agent/src/types.ts`
- `../pi-mono/packages/agent/src/agent-loop.ts`

## Transport and Framing

- RPC mode is JSONL over stdin/stdout.
- Framing is strict LF-only. Pi explicitly avoids Node `readline` because it splits on `U+2028` and `U+2029`, which are valid inside JSON strings.
- Commands are correlated by optional `id`.
- Responses use `type: "response"`, `command`, `success`, and optional `data` / `error`.
- Runtime events are streamed separately on stdout.

## Commands Codapter Cares About

### Session lifecycle

- `new_session`
- `switch_session`
- `fork`
- `get_fork_messages`
- `set_session_name`
- `get_state`
- `get_session_stats`
- `get_messages`

### Prompting and cancellation

- `prompt`
- `steer`
- `follow_up`
- `abort`

### Model and reasoning controls

- `set_model`
- `get_available_models`
- `set_thinking_level`

### Not needed for the first adapter layer

- direct user bash commands (`bash`, `abort_bash`)
- export HTML
- queue-mode and retry toggles beyond what codapter needs internally

## Prompt and Session Semantics

- `prompt` accepts `message`, optional `images`, and optional `streamingBehavior`.
- while already streaming, Pi requires `streamingBehavior: "steer" | "followUp"`; otherwise `prompt` errors.
- `steer` and `follow_up` are explicit queued-message operations.
- `abort` waits for the session to become idle.
- `new_session` and `switch_session` can be cancelled by extension hooks and both report `{ cancelled: boolean }` in their success payloads.
- `switch_session` takes a session file path, not an opaque id. Codapter therefore needs an internal opaque-id to path mapping inside `PiBackend`.
- `fork` takes a user `entryId`, not a session path or thread id.
- `get_fork_messages` exposes the available user-message anchors that Pi itself considers valid fork points.
- `get_messages` returns full `AgentMessage[]`, which is useful for in-memory history reads but does not replace JSONL parsing if codapter wants richer entry metadata.

## Images

- Pi uses `ImageContent` objects with `{ type: "image", data, mimeType }`.
- `prompt`, `steer`, and `follow_up` all support optional image arrays.

## Session Identity and Persistence

- Session storage is JSONL files under `~/.pi/agent/sessions/...`.
- Session headers store `id`, `cwd`, `timestamp`, and optional `parentSession`.
- `SessionManager` owns both `sessionId` and `sessionFile`.
- `setSessionFile(path)` loads or creates a file, migrates older session versions in place, and sets the in-memory `sessionId` from the header.
- `newSession()` generates a new UUID-backed session id and, when persistence is enabled, a new timestamped session file path.
- Pi session files can branch within a single file, but `createBranchedSession()` can also materialize a new file with `parentSession` linkage.
- `buildSessionContext()` resolves the active branch into the message list actually fed back to the LLM.

## Event Surface Relevant To Codapter

Pi's lower-level agent emits:

- `message_start`
- `message_update` with assistant delta events
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `turn_start`
- `turn_end`
- `agent_start`
- `agent_end`

Important details:

- assistant text and thinking are true deltas at the agent-event layer.
- `message_update` carries `assistantMessageEvent` variants such as `text_delta`, `thinking_delta`, `toolcall_start`, `toolcall_delta`, `toolcall_end`, `done`, and `error`.
- `tool_execution_update` carries a generic `partialResult` object with the same broad shape as a final tool result: `{ content, details }`.
- tool execution mode in Pi agent-core defaults to parallel. Codapter must be able to correlate multiple concurrent tool calls by `toolCallId`.

## Tool Update Semantics

The important adapter behavior is tool-specific.

### Bash tool

- Pi's bash tool calls `onUpdate` with a cumulative rolling-buffer snapshot, not a pure append-only delta.
- each update includes `content: [{ type: "text", text: ... }]` and optional `details.truncation` / `details.fullOutputPath`.
- codapter must diff successive snapshots to emit true incremental Codex deltas.

### Write/edit tools

- Pi's interactive UI treats partial tool data as progressively updated state and renders it as partial content.
- codapter should treat write/edit partial results as snapshots of the current tool state, not as guaranteed deltas.

## Extension UI / Elicitation

Pi RPC emits `extension_ui_request` events with methods:

- `select`
- `confirm`
- `input`
- `editor`
- `notify`
- `setStatus`
- `setWidget`
- `setTitle`
- `set_editor_text`

The client responds with `extension_ui_response` using one of:

- `{ id, value }`
- `{ id, confirmed }`
- `{ id, cancelled: true }`

Codapter should map only the true elicitation-style requests into Codex user-input requests:

- `select`
- `confirm`
- `input`
- `editor`

The following should stay fire-and-forget and out of milestone-3 elicitation wiring:

- `notify`
- `setStatus`
- `setWidget`
- `setTitle`
- `set_editor_text`

Dialog-style UI requests block until the client sends `extension_ui_response`, but the fire-and-forget methods do not expect a response. Codapter should preserve that split.

## Data Available For Token Usage

- `get_session_stats` returns session-level token totals and cost.
- useful fields include `tokens.input`, `tokens.output`, `tokens.cacheRead`, `tokens.cacheWrite`, and `tokens.total`.
- codapter can use this as the source for `thread/tokenUsage/updated` on turn completion.
- these are cumulative session totals, not native per-turn deltas.

## Gaps Between Pi And Codex

These require explicit adapter logic.

- Pi session switching is file-path based; Codex thread/session identity is opaque.
- Pi prompting is not thread-id based; Codapter must own turn ids and correlation.
- Pi tool updates are not guaranteed to be deltas.
- Pi extension UI contains both elicitation and non-elicitation events on the same stream.
- Pi has no native Codex-style thread list/read/archive RPC. Codapter must own thread registry semantics.
- Pi RPC forking is entry-based rather than thread-id based.

## Recommended Adapter Assumptions

- `PiBackend` owns the opaque session-id to session-path mapping.
- codapter owns thread ids, thread registry, archive state, and thread metadata.
- codapter diffs cumulative tool snapshots before emitting Codex deltas.
- codapter treats Pi's `new_session` / `switch_session` cancellation as non-fatal control flow, not backend errors.
- codapter should derive a fork anchor from session history instead of assuming Pi exposes a direct session-level fork RPC.
