# Codapter Implementation Checklist

Reference spec: `codex-protocol-analysis.md`

## Parallelization Tracks

After Milestone 1.1 (project scaffolding) is complete, work can split into parallel tracks:

```
                    ┌─ 1.1 Scaffolding ─┐
                    │   (sequential)     │
                    └────────┬───────────┘
           ┌─────────────────┼─────────────────┐
           ▼                 ▼                  ▼
    Track A: Core       Track B: Pi        Track C: Native
    ────────────        ──────────         ──────────────
    1.2 IBackend        2.2 PiBackend      4.2 command/exec
    1.3 Transport       (session lifecycle) 5.2 Config stubs
    1.4 Initialize                         5.3 Unknown methods
    2.1 State mgmt
    2.3 Thread RPCs
           │                 │                  │
           └─────────────────┼──────────────────┘
                             ▼
                    Milestone 3: Turn Execution
                    (convergence — requires A + B)
                    3.1 State machine
                    3.2 Turn RPCs
                    3.3 Elicitation
                             │
                             ▼
                    Milestone 4.1: Tool Translation
                    (requires 3 complete)
                             │
                             ▼
                    Milestone 6: Integration & Polish
                    (requires all tracks)
```

**Track A (Core Protocol)**: IBackend interface, transport layer, initialize handshake, thread state management, thread RPC methods. This is the adapter's skeleton — protocol handling without any backend.

**Track B (Pi Integration)**: PiBackend class implementing IBackend. Spawning Pi processes, JSONL communication, session file parsing. Can develop against IBackend contract from Track A.

**Track C (Adapter-Native)**: Features that don't touch the backend at all. Standalone command/exec (Node child_process), config stubs (in-memory store), unknown method error handler. Fully independent.

**Convergence**: Milestone 3 (turn execution) is where tracks A and B merge — the state machine translates Pi events into Codex events through the IBackend interface. Track C merges at integration testing.

---

## Milestone 1: Project Scaffolding & Transport Layer

### 1.1 Project Setup
- [ ] Create `codapter/` repo directory
- [ ] Initialize `package.json` (root workspace, `@codapter/` scope, version 0.1.0)
- [ ] Create `tsconfig.base.json` (ES2022, NodeNext, strict, composite)
- [ ] Create `biome.json` (2-space indent, 100 char width, recommended rules)
- [ ] Set up Husky pre-commit hook (lint-staged + check)
- [ ] Create workspace packages: `packages/core/`, `packages/backend-pi/`, `packages/cli/`
- [ ] Each package: `package.json`, `tsconfig.json` extending base, `src/` directory
- [ ] Add vitest config (`vitest.config.ts`)
- [ ] Add git submodules: Codex types repo, Pi mono repo
- [ ] Create `scripts/build-dist.mjs` (esbuild CLI bundler)
- [ ] Create `CHANGELOG.md` with initial entry
- [ ] Verify: `npm run build`, `npm run lint`, `npm run test` all pass (empty)

**Done when**: Project compiles, lints, and runs empty test suite.

### 1.2 IBackend Interface
- [ ] Define `IBackend` interface in `packages/core/src/backend.ts`
- [ ] Methods: `initialize`, `dispose`, `isAlive`
- [ ] Methods: `createSession`, `resumeSession`, `forkSession`, `disposeSession`
- [ ] Methods: `listSessions`, `readSessionHistory`, `setSessionName`
- [ ] Methods: `prompt(sessionId, turnId, text, images?)`, `abort(sessionId)`
- [ ] Methods: `listModels`, `setModel`, `getCapabilities`
- [ ] Methods: `respondToElicitation(sessionId, requestId, response)`
- [ ] Event interface: `onEvent(sessionId, listener): Disposable`
- [ ] Use opaque `sessionId: string`, not file paths
- [ ] Define `BackendEvent` union type (text_delta, thinking_delta, tool_start, tool_update, tool_end, message_end, error)
- [ ] Write `docs/backend-interface.md`

**Done when**: Interface compiles, JSDoc on all methods, documentation written.

### 1.3 Transport Layer
- [ ] Implement NDJSON framing: `parseNdjsonLine()`, `serializeNdjsonLine()`
- [ ] Implement stdio transport: read stdin line-by-line, write to stdout
- [ ] Implement WebSocket transport: `--listen ws://host:port` argument
- [ ] Both transports share a common `ITransport` interface (send/receive messages)
- [ ] CLI entry point: accept `app-server` subcommand, `--listen` flag
- [ ] Ignore `--analytics-default-enabled` flag gracefully
- [ ] Unit tests: NDJSON parsing (valid, malformed, empty lines, Unicode)
- [ ] Unit tests: transport send/receive round-trip

**Done when**: `codapter app-server` starts on stdio; `codapter app-server --listen ws://127.0.0.1:9234` starts WebSocket server.

### 1.4 Initialize Handshake
- [ ] Parse `InitializeParams` from incoming request
- [ ] Extract `clientInfo.name`, `clientInfo.version`, `capabilities`
- [ ] Store client capabilities (experimentalApi, optOutNotificationMethods)
- [ ] Return `InitializeResponse` with userAgent, platformFamily, platformOs
- [ ] Configurable identity: `emulateCodexIdentity` from TOML or env
- [ ] Log client version, warn on version mismatch
- [ ] Reject all RPC methods before initialize completes
- [ ] Unit test: valid initialize → correct response
- [ ] Unit test: RPC before initialize → error

**Done when**: Codex Desktop connects, completes handshake, no errors in GUI.

---

## Milestone 2: Thread Lifecycle

### 2.1 Thread State Management
- [ ] Create adapter state directory (`~/.local/share/codapter/`)
- [ ] Implement thread-to-session mapping store (JSON file)
- [ ] Thread ID generation (UUID)
- [ ] Store: threadId → {sessionPath, name, createdAt, updatedAt, archived, cwd}
- [ ] Handle mapping corruption: validate on load, skip invalid entries
- [ ] Unit tests: create, read, update, delete mappings
- [ ] Unit tests: corrupt file recovery

**Done when**: Mapping store persists across adapter restarts.

### 2.2 Pi Backend Implementation (session lifecycle)
- [ ] Implement `PiBackend` class implementing `IBackend`
- [ ] `createSession`: spawn Pi process (`--mode rpc`), send `new_session`
- [ ] `resumeSession`: spawn Pi process, send `switch_session` with session path
- [ ] `forkSession`: spawn Pi process, load parent session, call `fork`
- [ ] `disposeSession`: terminate Pi process
- [ ] `listSessions`: scan Pi session directory, parse JSONL headers
- [ ] `readSessionHistory`: parse Pi JSONL session file → BackendMessage[]
- [ ] `setSessionName`: call Pi `set_session_name`
- [ ] Pi process lifecycle: spawn, track, idle timeout, terminate
- [ ] Configurable idle timeout (env var or TOML, default 5 min)
- [ ] Max concurrent process limit (default 10)
- [ ] Unit tests with mock Pi process (mock stdin/stdout)

**Done when**: Can create, resume, fork, list, and dispose sessions through PiBackend.

### 2.3 Thread RPC Methods
- [ ] `thread/start` → call `backend.createSession()`, return Thread object
- [ ] `thread/resume` → call `backend.resumeSession()`, return Thread with turns
- [ ] `thread/read` → call `backend.readSessionHistory()`, translate to ThreadItems
- [ ] `thread/fork` → reject if turn active; call `backend.forkSession()`, return new Thread
- [ ] `thread/name/set` → call `backend.setSessionName()`
- [ ] `thread/list` → call `backend.listSessions()`, return paginated list
- [ ] `thread/archive` / `thread/unarchive` → update mapping store flag
- [ ] Per-thread state machine: `starting → ready → turn_active → forking → terminating`
- [ ] Request queue: buffer turn/start until thread state is `ready`
- [ ] Thread title generation from first user message
- [ ] Unit tests: each method with mock backend
- [ ] Unit tests: state machine transitions
- [ ] Unit tests: request buffering during `starting` state

**Done when**: Threads appear in Codex Desktop sidebar, can be created/resumed/forked.

---

## Milestone 3: Turn Execution & Streaming

### 3.1 Message Decomposition State Machine
- [ ] Design state machine: tracks current item type (text, thinking, tool)
- [ ] On text_delta: if no open agentMessage item, emit item/started; emit delta
- [ ] On thinking_delta: emit agent_reasoning_delta (or reasoning item)
- [ ] On tool_start: close any open text item (emit item/completed); emit new item/started
- [ ] On tool_update: emit item delta (commandExecution output or fileChange diff)
- [ ] On tool_end: emit item/completed with full result
- [ ] On message_end: close any open items, emit turn/completed
- [ ] On error: close open items, emit turn/completed(failed)
- [ ] Handle parallel tool calls (multiple open tool items)
- [ ] Unit tests: text only → single agentMessage item
- [ ] Unit tests: text then tool → two items
- [ ] Unit tests: tool then text → two items
- [ ] Unit tests: parallel tools → concurrent items
- [ ] Unit tests: error mid-stream → proper cleanup
- [ ] Unit tests: abort → synthesize item/completed for open items

**Done when**: All interleaving patterns produce correct Codex event sequences.

### 3.2 Turn RPC Methods
- [ ] `turn/start` → validate thread state is `ready`; transition to `turn_active`
- [ ] Map UserInput to Pi prompt format (text, images via ImageContent)
- [ ] Call `backend.prompt(sessionId, turnId, text, images)`
- [ ] Emit `turn/started` notification
- [ ] Route backend events through decomposition state machine
- [ ] On completion: transition thread to `ready`, emit `turn/completed`
- [ ] `turn/interrupt` → call `backend.abort()`, synthesize cleanup events
- [ ] Handle Pi prompt ack vs actual completion (ack is "accepted", not "done")
- [ ] Handle late Pi error responses after initial ack
- [ ] Emit `thread/status/changed` on state transitions
- [ ] Image input mapping: Codex UserInput image/localImage → Pi ImageContent
- [ ] Unit tests: full turn lifecycle (start → deltas → complete)
- [ ] Unit tests: interrupt mid-turn
- [ ] Unit tests: Pi error after ack
- [ ] Unit tests: image inputs

**Done when**: Send message in Codex Desktop, see streamed response with thinking.

### 3.3 Elicitation Support
- [ ] Listen for Pi `extension_ui_request` events (select, confirm, input, editor)
- [ ] Map to Codex `elicitation_request` server request
- [ ] Wait for GUI response
- [ ] Map GUI response → Pi `extension_ui_response`
- [ ] Ignore non-elicitation Pi UI events (notify, setStatus, setWidget, setTitle)
- [ ] Unit tests: elicitation round-trip

**Done when**: Pi extension prompts appear as inline forms in Codex Desktop.

---

## Milestone 4: Tool Call Display & Command Execution

### 4.1 Tool Call Translation
- [ ] Map Pi bash tool → Codex `commandExecution` ThreadItem
  - command, cwd, output streaming, exit code, duration
- [ ] Map Pi edit/write tool → Codex `fileChange` ThreadItem
  - changes array with path, kind (add/delete/update), diff
- [ ] Map Pi read/grep/find/ls tools → Codex `agentMessage` items (output as text)
- [ ] Verify parallel tool call event correlation (Pi tool IDs)
- [ ] Unit tests: each tool type mapping
- [ ] Unit tests: parallel tool calls

**Done when**: Tool calls render correctly in Codex Desktop with proper icons/formatting.

### 4.2 Standalone Command Execution (adapter-native)
- [ ] Implement `command/exec` using Node.js `child_process.spawn`
- [ ] Support PTY mode (node-pty or raw spawn)
- [ ] Stream stdout/stderr as `command/exec/outputDelta` (base64 encoded)
- [ ] `command/exec/write` → write to process stdin
- [ ] `command/exec/resize` → resize PTY
- [ ] `command/exec/terminate` → kill process
- [ ] Process tracking: map processId → child process
- [ ] Cleanup on disconnect
- [ ] Unit tests: spawn, stream output, write stdin, terminate
- [ ] Unit tests: process cleanup on adapter shutdown

**Done when**: Codex Desktop integrated terminal works for running commands.

---

## Milestone 5: Model & Config Management

### 5.1 Model Management
- [ ] `model/list` → call `backend.listModels()`, translate to Codex Model format
- [ ] Model selection on `thread/start` → pass to backend
- [ ] Model selection on `turn/start` → call `backend.setModel()`
- [ ] Unit tests: model listing, selection

### 5.2 Config & Auth Stubs
- [ ] `config/read` → return defaults; merge with in-memory overrides
- [ ] `config/value/write` → store in memory, return success
- [ ] `config/batchWrite` → store in memory, return success
- [ ] `configRequirements/read` → return null
- [ ] `getAuthStatus` → return auth status from backend capabilities
- [ ] `skills/list` → call `backend.getCapabilities()` or return empty
- [ ] `plugin/list` → return empty
- [ ] In-memory config store survives for adapter lifecycle
- [ ] Unit tests: write → read back → same value

### 5.3 Unknown Method Handling
- [ ] RPC router catch-all: unrecognized methods → JSON-RPC `-32601`
- [ ] Log unrecognized methods at warn level
- [ ] Unit test: unknown method → proper error response

**Done when**: Model picker works, settings pages don't crash.

---

## Milestone 6: Integration Testing & Polish

### 6.1 End-to-End with Codex Desktop
- [ ] Configure Codex Desktop: set `CODEX_CLI_PATH` to codapter dist binary
- [ ] Test: start thread, send message, see streamed response
- [ ] Test: tool calls display (bash command, file edit)
- [ ] Test: interrupt active turn
- [ ] Test: resume thread after restart
- [ ] Test: fork thread
- [ ] Test: model switching
- [ ] Test: standalone command execution in terminal
- [ ] Test: thread listing in sidebar
- [ ] Test: thinking/reasoning display

### 6.2 Remote Mode
- [ ] Test: `codapter app-server --listen ws://127.0.0.1:9234`
- [ ] Test: SSH tunnel connection from Codex Desktop
- [ ] Test: reconnect after disconnect
- [ ] Test: session persistence across reconnects

### 6.3 Smoke Test Suite (automated)
- [ ] Smoke test: basic conversation (2+2)
- [ ] Smoke test: bash tool call
- [ ] Smoke test: file create/edit
- [ ] Smoke test: multi-turn context
- [ ] Smoke test: model switching
- [ ] Smoke test: thinking display
- [ ] Smoke test: session persistence
- [ ] Smoke test: interrupt
- [ ] Smoke test: fork
- [ ] Smoke test: standalone shell
- [ ] Smoke test: thread listing
- [ ] All smoke tests pass with `npm run test:smoke`

### 6.4 Documentation & Release
- [ ] Complete `docs/api-mapping.md` (validated against real GUI)
- [ ] Complete `docs/architecture.md`
- [ ] Complete `docs/integration.md` (setup guide)
- [ ] Update CHANGELOG.md
- [ ] Build dist: `npm run build:dist`
- [ ] Tag v0.1.0

**Done when**: Full coding assistant experience works through Codex Desktop GUI powered by Pi.
