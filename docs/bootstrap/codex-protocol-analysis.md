# Codex Desktop Protocol Analysis & Codapter Design Specification

## Project Objective

Build **codapter** — a protocol adapter that allows the **Codex Desktop GUI** (OpenAI's Electron-based coding assistant) to work with **alternative backends** instead of the OpenAI Codex CLI. The adapter faithfully implements the Codex app-server JSON-RPC protocol on the GUI-facing side, and translates to/from the target backend's protocol on the other.

**First target backend**: Pi (`@mariozechner/pi-coding-agent`), a TypeScript-based coding agent with multi-provider LLM support.

**End state**: A user sets `CODEX_CLI_PATH` to point to the codapter binary, launches Codex Desktop, and gets a fully functional coding assistant experience powered by their chosen backend (Pi, or future alternatives). Threads, conversations, tool calls, file edits, command execution, model switching, and session persistence all work through the Codex GUI. The user cannot distinguish the experience from native Codex except for backend-specific differences (e.g., no sub-agents with Pi).

### Success Criteria

1. **Core chat**: Send messages, receive streamed responses with thinking/reasoning display
2. **Tool execution display**: Bash commands and file edits render correctly in the GUI with output streaming
3. **Thread management**: Create, list, resume, fork, and name threads via the sidebar
4. **Model switching**: Select from available Pi models via the GUI model picker
5. **Session persistence**: Close and reopen the app; threads and history are preserved
6. **Standalone shell**: `command/exec` works for running user commands independent of the LLM
7. **Remote mode**: Works over SSH tunnel via WebSocket or UDS transport
8. **Interrupt**: Cancel in-progress turns
9. **Backend pluggability**: Adding a new backend requires implementing the `IBackend` interface, not modifying core adapter code

### Scope

- **Platform**: Linux and macOS. Windows is out of scope for v0.1.
- **Remote mode**: Codapter listens on WebSocket (TCP or UDS). The user is responsible for installing codapter on the remote host and setting up SSH tunneling. There is no automated remote bootstrap/deployment in v0.1.
- **Wire protocol source of truth**: The Codex app-server protocol types at `codex-rs/app-server-protocol/schema/typescript/v2/` (added as a git submodule). These auto-generated TypeScript types define the exact JSON shapes the GUI expects. All protocol-facing implementation must reference these types, not narrative descriptions in this document.

---

## Codex Desktop Protocol Analysis

This is **OpenAI Codex Desktop** (v26.311.30926, public-beta), an Electron 40 app. There are **three distinct protocol layers** between the GUI and servers:

## 1. Local IPC: Electron GUI ↔ Codex CLI (App Server)

**Transport**: The Electron main process spawns the **Codex CLI** binary as a child process using **stdio** (stdin/stdout pipes). The framing is **newline-delimited JSON** (NDJSON) — each message is a single JSON line terminated by `\n`.

There's also a **Unix domain socket IPC router** at `$TMPDIR/codex-ipc/ipc-$UID.sock` (or `\\.\pipe\codex-ipc` on Windows) for multi-window coordination.

**Protocol**: JSON-RPC-like request/response with three message types:
- **`request`** — `{type: "request", requestId: UUID, sourceClientId, version, method, params, targetClientId?}`
- **`response`** — `{type: "response", requestId, resultType: "success"|"error", method, result|error}`
- **`broadcast`** — `{type: "broadcast", method, sourceClientId, params, version}`

**Initialization handshake**:
```json
→ {id: "__codex_initialize__", method: "initialize", params: {
    clientInfo: {...},
    capabilities: {experimentalApi: true, optOutNotificationMethods: [...]}
  }}
← {type: "response", requestId: "__codex_initialize__", resultType: "success",
   method: "initialize", result: {clientId: UUID}}
```

**Event Namespace Note**: This document contains two sets of event names. The `codex/event/*` names (Section 1 tables) are from the **Electron GUI's internal mapping layer** — the minified JS wraps v2 protocol notifications. The canonical wire format used by the app-server protocol is the **v2 namespace**: `item/*`, `turn/*`, `thread/*` (Section 9 tables, from `app-server-protocol/src/protocol/common.rs`). **Codapter must implement the v2 wire format**, which is what the GUI actually parses after its own translation layer.

### RPC Methods (GUI → CLI)

| Method | Purpose |
|--------|---------|
| `initialize` | Handshake, register client |
| `thread/start` | Start a new conversation thread |
| `thread/resume` | Resume an existing thread |
| `thread/read` | Read thread history |
| `thread/name/set` | Rename a thread |
| `turn/start` | Send a user message / start agent turn |
| `turn/interrupt` | Cancel an in-progress turn |
| `getAuthStatus` | Get auth state + access token |
| `config/read` | Read configuration |
| `configRequirements/read` | Get config requirements |
| `model/list` | List available models |
| `skills/list` | List available skills |
| `plugin/list` | List plugins |
| `create-worktree` | Create a git worktree |
| `delete-worktree` | Delete a worktree |
| `resolve-worktree-for-thread` | Map thread to worktree |
| `worktree-cleanup-inputs` | Get worktree cleanup data |

### Streaming Events (CLI → GUI)

All prefixed `codex/event/`:

| Event | Description |
|-------|-------------|
| `agent_message` / `agent_message_delta` / `agent_message_content_delta` | Streamed agent text output |
| `agent_reasoning` / `agent_reasoning_delta` / `agent_reasoning_raw_content_delta` | Chain-of-thought / reasoning |
| `exec_command_begin` / `exec_command_end` / `exec_command_output_delta` | Shell command execution lifecycle |
| `exec_approval_request` | User approval for shell commands |
| `apply_patch_approval_request` | User approval for file edits |
| `patch_apply_begin` / `patch_apply_end` | File patch application |
| `mcp_tool_call_begin` / `mcp_tool_call_end` | MCP tool invocations |
| `mcp_startup_complete` / `mcp_startup_update` | MCP server lifecycle |
| `elicitation_request` | Agent asks user a question |
| `dynamic_tool_call_request` | Dynamic tool invocation |
| `task_started` / `task_complete` | Task lifecycle |
| `session_configured` | Session ready |
| `token_count` | Token usage update |
| `turn_diff` | Diff of changes from a turn |
| `plan_update` / `plan_delta` | Agent plan streaming |
| `web_search_begin` / `web_search_end` | Web search lifecycle |
| `view_image_tool_call` | Image viewing |
| `collab_agent_spawn_begin/end` / `collab_agent_interaction_begin/end` | Sub-agent collaboration |
| `stream_error` / `error` / `warning` | Error handling |
| `thread_name_updated` / `thread_rolled_back` | Thread state changes |
| `undo_started` / `undo_completed` | Undo operations |
| `remote_task_created` | Remote/cloud task creation |

### Broadcast Events (multi-window IPC)

| Event | Description |
|-------|-------------|
| `thread/started` / `thread/closed` / `thread/archived` / `thread/unarchived` | Thread lifecycle |
| `thread/compacted` / `thread/name/updated` / `thread/status/changed` | Thread state |
| `thread/tokenUsage/updated` | Token updates |
| `thread/realtime/started` / `thread/realtime/closed` | Realtime voice sessions |
| `thread/realtime/itemAdded` / `thread/realtime/outputAudio/delta` / `thread/realtime/error` | Realtime audio streaming |
| `skills/changed` / `client-status-changed` | System state |

## 2. Remote SSH: GUI ↔ Remote Codex (via SSH tunnel)

For remote development, the app uses an **SSH WebSocket tunnel** protocol (`ssh_websocket_v0`).

### Prerequisites

The Codex CLI binary must already be installed and available in `$PATH` on the remote host. The app does **not** automatically deploy or install the CLI remotely — it simply invokes `codex` over SSH and expects it to exist.

### Connection Lifecycle

#### Step 1: Host Discovery

The app discovers available remote hosts by parsing `~/.ssh/config`:
- Reads entries from `~/.ssh/config` using the `ssh-config` npm package
- Filters out hosts matching glob/wildcard patterns (e.g., `*`, `!*`)
- Excluded aliases can be configured
- Each discovered host is assigned an ID of the form `ssh:<alias>`
- Host metadata includes: `display_name`, `kind: "ssh"`, `codex_cli_command`, `terminal_command`, `default_workspaces`

#### Step 2: Bootstrap Remote App-Server

The app SSHs into the remote host and starts a Codex app-server process in the background:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=<timeout> <host> \
  "CODEX_EXTERNAL_ORIGINATOR_OVERRIDE='Codex Desktop' \
   nohup codex app-server --listen ws://127.0.0.1:9234 \
   > /tmp/codex-app-server-ssh-ws-v0.log 2>&1 &"
```

Key details:
- **Default remote port**: `9234` (configurable per-host via `remotePort`)
- **Remote log file**: `/tmp/codex-app-server-ssh-ws-v0.log`
- The process is backgrounded with `nohup` so it persists after the SSH session ends
- The `CODEX_EXTERNAL_ORIGINATOR_OVERRIDE` env var is set to `"Codex Desktop"`
- The `RUST_LOG` environment variable is forwarded (defaults to `warn`)
- The remote server listens on `127.0.0.1` only (loopback), not exposed to the network

#### Step 3: Establish SSH Port-Forward Tunnel

The app creates a persistent SSH tunnel to forward a local port to the remote WebSocket server:

```bash
ssh -N \
  -L <localPort>:127.0.0.1:9234 \
  -o ExitOnForwardFailure=yes \
  -o BatchMode=yes \
  -o ConnectTimeout=<timeout> \
  <host>
```

Key details:
- **Local port selection**: Starts from the port derived from the WebSocket URL and scans up to 1000 ports to find an available one (max port: configurable, capped at a high range)
- **`-N` flag**: No remote command execution, tunnel only
- **`ExitOnForwardFailure=yes`**: SSH exits if port-forwarding fails
- The tunnel process is monitored — stderr is captured (last 4KB kept) for diagnostics
- If the tunnel process dies, it's detected and the connection state is updated
- **Tunnel readiness check**: The app polls the local tunnel port every 100ms, with a 5-second timeout, using TCP connection probes to `127.0.0.1:<localPort>`

#### Step 4: WebSocket Connection

Once the tunnel is confirmed ready:

```
WebSocket connect → ws://127.0.0.1:<localPort>/rpc
```

- The WebSocket URL path is always `/rpc`
- From this point, the exact same JSON-RPC protocol used for local stdio communication (Section 1) runs over the WebSocket
- All the same RPC methods (`thread/start`, `turn/start`, etc.) and streaming events (`codex/event/*`) work identically
- The `WebSocketTransport` class wraps the `ws` npm package (v8.18.3)

### Error Handling and Reconnection

- If the remote app-server bootstrap fails, stderr/stdout from the SSH command is logged for diagnostics
- If the local tunnel fails to become ready within 5 seconds, the tunnel state is reset and retried
- If the tunnel process crashes, the connection state transitions to `disconnected`
- The `AppServerConnection` supports automatic reconnection with exponential backoff (starting at 1 second, max 60 seconds)
- On reconnect, the tunnel and remote app-server are re-established from scratch

### Configuration

Configuration is stored per-host in `remote-ssh-v0.toml` with fields:

| Field | Description |
|-------|-------------|
| `sshAlias` | SSH config alias name |
| `sshHost` | Hostname or IP |
| `sshPort` | SSH port (optional) |
| `identity` | SSH identity/key file (optional) |
| `remotePort` | Remote WebSocket port (default: `9234`) |

The connection can also be configured via a `websocket_url` field on the host config, which overrides the default `ws://127.0.0.1:9234/rpc` URL construction.

### SSH Command Construction

SSH commands are built with these default options:
- `-o BatchMode=yes` — no interactive prompts
- `-o ConnectTimeout=<timeout>` — connection timeout
- Port specified via `-p <port>` when configured
- Identity specified via `-i <identity>` when configured

The `CODEX_APP_SERVER_FORCE_CLI=1` environment variable can be set to force stdio transport even for SSH hosts (bypassing the WebSocket tunnel).

## 3. Cloud API: CLI → OpenAI API

The Codex CLI (app-server) calls the **OpenAI Responses API** (`responses.create`) with server-sent event streaming. Key SSE events consumed:

| SSE Event | Description |
|-----------|-------------|
| `response.created` | Response initiated |
| `response.in_progress` / `response.queued` | Processing states |
| `response.output_item.added` / `response.output_item.done` | Output items (text, tool calls) |
| `response.output_text.delta` | Streamed text tokens |
| `response.function_call_arguments.delta` / `response.function_call_arguments.done` | Tool call arguments |
| `response.completed` / `response.failed` / `response.incomplete` | Terminal states |

### Authentication to OpenAI

- OAuth 2.0 + PKCE flow via `https://auth.openai.com/oauth/authorize` and `https://auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- Local callback server on `http://localhost:1455/auth/callback`
- Scope: `openid profile email offline_access`
- JWT contains `chatgpt_account_id` and `chatgpt_user_id` at claim path `https://api.openai.com/auth`
- Auth headers sent: `Authorization: Bearer <token>`, `ChatGPT-Account-Id: <id>`, `originator: Codex Desktop`
- Auth is only attached to requests to `*.openai.com`, `*.chatgpt.com`, and `localhost`

**Backend API**: `https://chatgpt.com/backend-api` is also referenced (likely for account/profile info).

## 4. Telemetry

Events are batched and POST'd to `https://chat.openai.com/ces/v1/telemetry/intake` with a dummy token. Events include build info, user info, session ID, and are batched with configurable flush intervals (default ~2s, max ~30s). OpenTelemetry instrumentation tracks HTTP requests, spans for `responses.create`, `chat.completions.create`, etc.

Sentry (`@sentry/electron`) is also used for error reporting.

## 5. Code Accessibility and Modifiability

The app's source code is **JavaScript**, not compiled binary. It is packaged inside an Electron `app.asar` archive, which can be extracted with `npx asar extract app.asar <output-dir>`. The code is bundled and minified by Vite (variable names shortened, whitespace stripped), but it is **fully readable** — not obfuscated or encrypted. All protocol string literals (RPC method names, event types, API endpoints, auth URLs) are plaintext and easily searchable with grep.

The extracted source files:
- `.vite/build/main-t5WAGWYs.js` — Electron main process (~177 lines, heavily packed)
- `.vite/build/worker.js` — Worker thread handling agent logic (~145 lines, heavily packed)
- `.vite/build/bootstrap-BYAV6t_u.js` — Bootstrap/shared utilities (~231 lines)
- `.vite/build/preload.js` — Renderer preload bridge (2 lines)
- `webview/assets/*.js` — React UI components and dependencies

The code is **modifiable**: you can edit the extracted JS files, repack with `npx asar pack <dir> app.asar`, and the app will run with your changes. Note that modifying the asar will invalidate the macOS code signature, so Gatekeeper may flag the app. On Linux this is not an issue.

## 6. Feature Flags (Statsig)

The app uses **Statsig** for feature gating. The Statsig SDK is loaded from `statsig-DzjdRosZ.js` in the webview assets.

### Known Feature Gates

| Gate ID | Controls | Condition |
|---------|----------|-----------|
| `4114442250` | **Connections (Remote SSH) settings tab** | Must be `true` AND `windowType === "electron"` for the "Connections" section to appear in Settings |
| `505458` | Unknown (referenced alongside remote connections) | Used in mode/controls rendering |

The `connections` settings slug, the `remote-connections-settings` component, and all backend RPC methods (`refresh-remote-ssh-connections`, `save-codex-managed-remote-ssh-connections`, `set-remote-ssh-connection-auto-connect`) are **fully present** in both beta and production builds. The UI is simply hidden behind the Statsig gate.

**Override**: Since the code is modifiable JavaScript, the Statsig gate check can be patched to always return `true`, exposing the hidden Connections UI. The backend functionality is already complete.

## 7. Related Repositories

- **`../codex/`** — The actual Codex CLI / app-server backend source code (unminified). This is the server-side of the JSON-RPC protocol and will provide a clearer, complete view of the protocol surface without needing to reverse-engineer minified JS.

- **`../pi-mono/`** — An alternate backend (Pi). A future goal is to create an **adapter** that allows the Codex Desktop frontend/GUI to work with the Pi backend instead of the OpenAI Codex backend.

## 8. Reverse Engineering Guide

This section documents the extraction and review process so future agents can reproduce and extend this analysis.

### Extracting from a .zip (Beta)

```bash
unzip -q "Codex (Beta)-darwin-arm64-26.311.30926.zip" -d codex-app
# Result: codex-app/Codex (Beta).app/
```

### Extracting from a .dmg (Production)

```bash
# Requires p7zip (install with: sudo dnf install p7zip p7zip-plugins)
7z x -o./codex-prod "Codex.dmg"
# Result: codex-prod/Codex Installer/Codex.app/
```

### Extracting the Electron asar

The main application code is bundled in an asar archive at:
```
<App>.app/Contents/Resources/app.asar
```

Extract with:
```bash
npx asar extract "<path>/app.asar" ./extracted-output
```

### Extracted Directory Layout

```
extracted-output/
├── .vite/build/
│   ├── bootstrap-<hash>.js    # Shared utilities, Zod schemas, i18n
│   ├── bootstrap.js           # Entry point (2 lines, requires bootstrap-<hash>)
│   ├── main-<hash>.js         # Electron main process - IPC, app server, SSH, auth
│   ├── preload.js             # Context bridge for renderer (2 lines)
│   └── worker.js              # Worker thread - agent logic, OpenAI API, MCP, Sentry
├── native/
│   └── sparkle.node           # Native module for auto-updates (macOS Sparkle)
├── node_modules/              # Bundled native dependencies
│   ├── better-sqlite3/        # Local database
│   └── ...
├── package.json               # App metadata, version, dependencies, build flavor
├── skills/                    # Bundled skills directory
└── webview/
    └── assets/                # React UI components (hundreds of JS files)
        ├── index-<hash>.js              # Main app router, settings, thread UI
        ├── statsig-<hash>.js            # Statsig feature flag SDK
        ├── app-server-manager-hooks-<hash>.js  # App server React hooks
        ├── app-server-connection-state-<hash>.js  # Connection state UI
        ├── remote-connections-settings-<hash>.js  # Remote SSH settings UI
        ├── settings-surface-<hash>.js   # Settings page layout & section definitions
        ├── config-queries-<hash>.js     # Settings section list & config queries
        └── <lang>-<locale>-<hash>.js    # i18n translation files
```

### Where to Find Key Protocol Information

| What | Where to look | Search patterns |
|------|--------------|-----------------|
| RPC methods (GUI→CLI) | `main-<hash>.js` | `method:"<name>"` |
| Streaming events (CLI→GUI) | `worker.js` | `"codex/event/<name>"` |
| Broadcast events (IPC) | `worker.js` | `"thread/<name>"`, `"skills/changed"` |
| OpenAI API calls | `worker.js` | `responses.create`, `chat.completions.create` |
| OAuth/auth flow | `main-<hash>.js` | `auth.openai.com`, `Bearer`, `chatgpt_account_id` |
| SSH remote protocol | `main-<hash>.js` | `ssh_websocket_v0`, `remoteAppServerPort`, `ssh-tunnel` |
| Feature flags | `statsig-<hash>.js`, `index-<hash>.js` | `El(`, `useGateValue`, gate IDs |
| Settings sections | `settings-surface-<hash>.js` or `index-<hash>.js` | `slug:`, settings section filter function |
| URLs/endpoints | `main-<hash>.js`, `worker.js` | `https://`, `ws://` |
| IPC socket path | `main-<hash>.js` | `codex-ipc`, `.sock` |
| Telemetry | `worker.js` | `ces/v1/telemetry`, `telemetry/intake` |

### Useful Search Commands

```bash
# Extract all URLs
grep -oP 'https?://[a-zA-Z0-9._/-]+' .vite/build/*.js | sort -u

# Extract all codex events
grep -oP '"codex/event/[a-zA-Z_]+"' .vite/build/worker.js | sort -u

# Extract all RPC methods
grep -oP 'method:"[a-zA-Z_/]+"' .vite/build/main-*.js | sort -u

# Extract all WebSocket URLs
grep -oP 'wss?://[a-zA-Z0-9._/-]+' .vite/build/*.js | sort -u

# Find feature flag IDs
grep -oP 'El\(`[0-9]+`\)' webview/assets/index-*.js | sort -u

# Compare beta vs production protocol surfaces
diff <(grep -oP 'method:"[a-zA-Z_/]+"' beta/.vite/build/main-*.js | sort -u) \
     <(grep -oP 'method:"[a-zA-Z_/]+"' prod/.vite/build/main-*.js | sort -u)
```

### Modifying and Repacking

```bash
# 1. Extract
npx asar extract app.asar ./extracted

# 2. Edit files in ./extracted (e.g., patch feature flags)

# 3. Repack
cp app.asar app.asar.bak
npx asar pack ./extracted app.asar

# 4. On macOS, clear code signing quarantine:
xattr -cr "Codex.app"
```

### Version Comparison (Beta vs Production)

| Property | Beta | Production |
|----------|------|------------|
| Version | 26.311.30926 | 26.313.41514 |
| Build flavor | `public-beta` | (not set) |
| Build number | 1002 | (not present) |
| Main JS | `main-t5WAGWYs.js` (177 lines) | `main-BFYI5W9_.js` (182 lines) |
| Worker JS | `worker.js` (145 lines) | `worker.js` (152 lines) |
| Extra RPC methods in prod | - | `command/exec`, `command/exec/resize`, `command/exec/terminate`, `command/exec/write`, `thread/fork` |
| Event surface | Identical | Identical |
| Code format | Minified, readable | Minified, readable |

## 9. Adapter Plan: Codex Desktop GUI ↔ Pi Backend

### Objective

Build an **adapter layer** that allows the Codex Desktop GUI to work with the Pi backend instead of the OpenAI Codex CLI. The adapter speaks the Codex JSON-RPC protocol on the GUI-facing side and translates to/from the Pi backend protocol on the other.

### Architecture

```
┌───────────────────────┐
│  Codex Desktop GUI    │
│  (unmodified)         │
└──────────┬────────────┘
           │ NDJSON over stdio / WebSocket
┌──────────▼────────────┐
│  Adapter              │
│  - Codex JSON-RPC     │
│    protocol server    │
│  - Pi backend client  │
│  - Session management │
│  - Protocol mapping   │
└──────────┬────────────┘
           │ Pi protocol (stdio)
┌──────────▼────────────┐
│  Pi Backend(s)        │
│  (one per thread)     │
└───────────────────────┘
```

### Key Design Constraints

1. **Pi single-session limitation**: Pi can only stream one session at a time. The adapter will need to **spawn a separate Pi backend process per active Codex thread/session** and manage their lifecycles.

2. **No sub-agent support**: Pi doesn't support sub-agents, so `collab_agent_*` events will not be emitted. The adapter should gracefully omit these.

3. **Map as much as possible**: Focus on mapping the core user experience — message exchange, tool call display, command execution output, file patches — to provide the richest possible experience through the Codex GUI.

### Exploration Plan

1. **Explore the Codex backend repo (`../codex/`)** to extract the clean, unminified JSON-RPC protocol definitions:
   - Full request/response schemas for each RPC method
   - Streaming event payload shapes
   - Initialize handshake parameters and capabilities
   - Thread/turn lifecycle state machine

2. **Explore the Pi backend repo (`../pi-mono/`)** to understand:
   - Pi's CLI/API protocol (stdio? HTTP? WebSocket?)
   - Session/conversation model
   - How Pi handles tool calls, file edits, command execution
   - Streaming output format
   - Authentication model
   - What capabilities Pi exposes vs. what Codex expects

3. **Design the adapter protocol mapping**:
   - Map Codex RPC methods → Pi equivalents
   - Map Pi streaming output → Codex event format
   - Identify gaps (features Codex expects that Pi can't provide)
   - Design the multi-process session management

4. **Build the adapter** as a Node.js process that:
   - Accepts stdio or WebSocket connections (acting as a Codex app-server)
   - Responds to `initialize`, `thread/start`, `turn/start`, etc.
   - Spawns/manages Pi backend processes per thread
   - Translates Pi output into `codex/event/*` streaming events

### Exploration Findings

#### Codex Backend Protocol (from unminified source)

The Codex app-server is written in **Rust** at `codex-rs/app-server/`. The protocol is defined in `codex-rs/app-server-protocol/src/protocol/` with auto-generated TypeScript types.

**Key RPC methods with full schemas:**

- **`initialize`**: `{clientInfo: {name, title, version}, capabilities: {experimentalApi, optOutNotificationMethods}}` → `{userAgent, platformFamily, platformOs}`
- **`thread/start`**: `{model, cwd, approvalPolicy, sandbox, config, baseInstructions, developerInstructions, ephemeral, dynamicTools, ...}` → `{thread, model, cwd, approvalPolicy, sandbox, reasoningEffort}`
- **`thread/resume`**: `{threadId, model, cwd, ...}` → same as start
- **`thread/fork`**: `{threadId, ...}` → same as resume
- **`thread/read`**: `{threadId, includeTurns}` → `{thread}`
- **`turn/start`**: `{threadId, input: UserInput[], cwd, model, effort, personality, outputSchema, collaborationMode}` → `{turn}`
  - UserInput types: `text`, `image`, `localImage`, `skill`, `mention`
- **`turn/interrupt`**: `{threadId, turnId}` → `{}`
- **`command/exec`**: `{command: string[], processId, tty, streamStdin, streamStdoutStderr, cwd, env, size}` → `{exitCode, stdout, stderr}`

**Server notifications (streaming events):**
- `thread/started`, `thread/status/changed`
- `turn/started`, `turn/completed`
- `item/started`, `item/completed`
- `item/agentMessage/delta` — text chunk streaming
- `item/commandExecution/outputDelta` — command output streaming
- `item/fileChange/outputDelta` — file change streaming
- `command/exec/outputDelta` — exec process output
- `item/commandExecution/requestApproval` — approval request (server→client, expects response)
- `item/fileChange/requestApproval` — file change approval

**ThreadItem types:** `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `agentMessage`

**Thread status:** `notLoaded` → `idle` ↔ `active` (with flags: `waitingOnApproval`, `waitingOnUserInput`) | `systemError`
**Turn status:** `inProgress` → `completed` | `interrupted` | `failed`

#### Pi Backend Protocol (from source)

Pi is a **TypeScript** agent system at `packages/coding-agent/`. Communication is **JSONL over stdin/stdout** in RPC mode.

**RPC commands (36+):**
- **`prompt`**: `{text, images?, streamingBehavior?}` — send user message
- **`steer`**: Interrupt current execution with new instruction
- **`follow_up`**: Queue message after completion
- **`abort`**: Cancel current operation
- **`bash`**: Execute shell command directly (not via LLM)
- **`new_session`**: Start fresh session
- **`get_state`**: Current session state
- **`get_messages`**: Full message history
- **`set_model`/`cycle_model`/`get_available_models`**: Model management
- **`set_thinking_level`/`cycle_thinking_level`**: Reasoning budget
- **`compact`/`set_auto_compaction`**: Context management
- **`switch_session`/`fork`/`get_fork_messages`**: Session management
- **`get_session_stats`**: Token usage & cost
- **`export_html`**: Export session as HTML

**Streaming events (JSONL to stdout):**
- `agent_start` / `agent_end`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
- `auto_compaction_start` / `auto_compaction_end`
- `extension_ui_request` (for interactive prompts)

**Base streaming deltas (from pi-ai):**
- `text_start` / `text_delta` / `text_end`
- `thinking_start` / `thinking_delta` / `thinking_end`
- `toolcall_start` / `toolcall_delta` / `toolcall_end`
- `done` / `error`

**Built-in tools:** `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

**Session persistence:** JSONL files at `~/.pi/agent/sessions/` with branching/forking support.

**RPC response format:**
```json
{"id": "req-id", "type": "response", "command": "prompt", "success": true, "data": {...}}
```

### Protocol Mapping (Codex → Pi)

| Codex RPC Method | Pi Equivalent | Notes |
|-----------------|---------------|-------|
| `initialize` | (connection setup) | Adapter handles; Pi starts with spawned process |
| `thread/start` | `new_session` | Spawn new Pi process per thread |
| `thread/resume` | (spawn + load session) | Spawn Pi, load session file |
| `thread/read` | `get_messages` | Map Pi messages to Codex ThreadItem format |
| `thread/name/set` | `set_session_name` | Direct mapping |
| `turn/start` | `prompt` | Map UserInput to Pi prompt format |
| `turn/interrupt` | `abort` or `steer` | `abort` for cancel, `steer` for redirect |
| `getAuthStatus` | (adapter-managed) | Adapter reports auth status from Pi config |
| `config/read` | `get_state` | Map Pi state to Codex config format |
| `model/list` | `get_available_models` | Direct mapping |
| `skills/list` | `get_commands` | Map Pi skills/commands |
| `command/exec` | **Adapter-native** (Node `child_process`) | NOT routed through Pi — see Decision #35. Pi `bash` is single-threaded and would block during prompts. |

| Codex Streaming Event | Pi Source Event | Notes |
|----------------------|-----------------|-------|
| `item/agentMessage/delta` | `text_delta` | Direct text streaming |
| `item/started` (agentMessage) | `message_start` | Map message lifecycle |
| `item/completed` (agentMessage) | `message_end` | Map message completion |
| `item/started` (commandExecution) | `tool_execution_start` (bash) | Map bash tool calls |
| `item/commandExecution/outputDelta` | `tool_execution_update` | Map bash output |
| `item/completed` (commandExecution) | `tool_execution_end` | Map bash completion |
| `item/started` (fileChange) | `tool_execution_start` (edit/write) | Map file operations |
| `item/completed` (fileChange) | `tool_execution_end` (edit/write) | Include diff in response |
| `turn/started` | `turn_start` | Direct mapping |
| `turn/completed` | `turn_end` / `agent_end` | Map completion |
| `thread/status/changed` | (derived from agent state) | Adapter manages thread state |

### Gaps (Codex features Pi cannot provide)

| Codex Feature | Status | Notes |
|--------------|--------|-------|
| Sub-agents (`collab_agent_*`) | Not supported | Pi has no sub-agent concept |
| MCP tool calls | Not supported | Pi doesn't have MCP integration |
| Dynamic tools | Partial | Pi has extensions but different model |
| File change approval | Different model | Pi doesn't pause for approval; tools auto-execute |
| Sandbox policies | Different model | Pi has no sandbox abstraction |
| Token count events | Partial | Pi tracks usage in `get_session_stats` |
| Plan updates | Not supported | Pi doesn't have a plan concept |
| Web search | Not directly | Would need Pi extension |
| Image viewing | Not supported | Pi has no image tool call display |
| Undo/rollback | Partial | Pi has `fork` but no undo |
| Worktrees | Not supported | Adapter would need to manage |

### Design Decisions

| # | Decision | Resolution | Notes |
|---|----------|------------|-------|
| 1 | **Model selection** | Expose Pi's full available model list via `model/list` | Use `provider/model` format (e.g., `anthropic/claude-sonnet-4-20250514`). Pi extracts provider from prefix. |
| 2 | **Initialize identity** | Configurable via `emulateCodexIdentity` flag (default: `true`) | When true: report as `codex-app-server` with matching platform info. When false: report as `pi-adapter`. Default to true since userAgent goes to Sentry. |
| 3 | **Config/read** | Return minimal stubs/defaults | Don't map Pi config to Codex format initially. Return sensible defaults so GUI settings pages render without errors. |
| 4 | **Config writes** | In-memory persistence per adapter lifecycle | Config writes stored in memory so `config/read` returns consistent values within the same session. Not persisted to disk. Prevents GUI retry loops from write-then-read-back mismatches. |
| 5 | **Pi auth/config** | Use Pi's existing `~/.pi/agent/` defaults | Don't try to manage Pi API keys through the Codex GUI. Pi uses its own `auth.json` and default home directory. |
| 6 | **Approval requests** | Auto-approve / don't generate | Pi auto-executes tools. The adapter doesn't generate approval request events. Tool executions are reported as completed items directly. |
| 7 | **Thinking/reasoning** | Map Pi thinking to Codex reasoning events | Pi `thinking_delta` → Codex `agent_reasoning_delta`. Don't suppress reasoning display. |
| 8 | **Thread registry (single source of truth)** | Adapter-owned thread registry is authoritative | The adapter's thread registry (at `~/.local/share/codapter/threads.json`) is the single source of truth for thread identity, names, archive state, cwd, and metadata. Backend session locators (e.g., Pi session file paths) are stored as internal metadata within the registry, not exposed through IBackend. Backend session scans are used only for initial import/reconciliation, not for ongoing thread listing. IBackend uses opaque `sessionId` strings that the adapter maps internally to backend-specific locators. |
| 9 | **Steering** | Map `turn/interrupt` → Pi `abort`; sequential `turn/start` → Pi `prompt` | Keep interaction model simple. Don't expose Pi's `steer` or `follow_up` directly. |
| 10 | **Sub-agents** | Not supported | Pi has no sub-agent concept. `collab_agent_*` events are never emitted. |
| 11 | **GUI constraint** | GUI drives capabilities | The Codex GUI is the constraint. Only expose behaviors the GUI can represent. If Pi does something the GUI can't show, translate or suppress. |
| 12 | **Message interleaving** | Adapter decomposes Pi's interleaved content into sequential Codex ThreadItems | Pi interleaves text, thinking, and tool calls in one message. Codex uses separate items. Adapter needs a per-thread state machine to track current item type and emit proper item boundaries. |
| 13 | **Session/thread listing** | Adapter registry is authoritative; Pi session scan for import only | `thread/list` reads from the adapter's thread registry, not from Pi's session directory. Pi session directory is scanned only for initial import/reconciliation of sessions created outside the adapter. |
| 14 | **command/exec** | Map to Pi `bash` RPC command | Standalone shell execution, independent of LLM conversation. Output streams to GUI terminal, not fed to LLM. Same behavior as Codex. |
| 15 | **Parallel tool calls** | Supported | Both Pi and Codex support parallel tool execution. Adapter maps Pi's concurrent tool_execution events to concurrent Codex ThreadItems within a turn. |
| 16 | **Transport modes** | Support both stdio and WebSocket | Stdio for local mode (GUI spawns adapter as child process). WebSocket (`--listen ws://...`) for remote mode via SSH tunnel. Both reuse the same protocol handler. |
| 17 | **Backend abstraction** | Design with pluggable backend interface | Pi is the first target, but the adapter should have an abstraction layer so other backends can be plugged in later. Core adapter logic (Codex protocol handling, transport, state machine) is backend-agnostic. Each backend implements a common interface for session management, prompting, tool execution, etc. |
| 18 | **Implementation language** | TypeScript | Pi is TypeScript and has an importable RPC client. Codex protocol types are auto-generated to TypeScript. Faster iteration than Rust. Node.js has built-in stdio/WebSocket support. Can rewrite in Rust later if needed for deployment. |
| 19 | **Project name** | `codapter` | Portmanteau of codex + adapter. New repo directory. Uses Husky for commit hooks, Biome for linting/formatting. |
| 20 | **Error handling** | Map to Codex protocol error model | Pi errors → turn `failed` status with error message. Pi process crash → stdio pipe closes, GUI shows disconnected. Stream errors → `stream_error` event. |
| 21 | **Logging** | JSONL format to stderr and optionally to file | Same structured format for both. Configurable log level per destination. Timestamps included. Configured in `codapter.toml`. |
| 22 | **Spawn mechanism** | `CODEX_CLI_PATH` env var | Set to codapter binary path. Desktop app checks this before bundled binary. Codapter accepts `app-server` subcommand (ignores `--analytics-default-enabled`). |
| 23 | **Backend selection** | `CODAPTER_BACKEND` env var + TOML default | One backend active per adapter instance. Env var overrides TOML default. System-level or per-shell. |
| 24 | **Config file** | `codapter.toml` | TOML format. Sections for logging, identity emulation, backend selection, backend-specific settings. Location TBD (XDG or alongside Pi config). |
| 25 | **Forking** | Supported — straightforward mapping | **Investigated**: GUI calls `thread/fork` with `{threadId, path: null, cwd}` — always forks from latest state (no position specified). Adapter calls Pi `fork` (branches from most recent user message), gets new session file, creates new thread ID. Since each thread has its own Pi process, no session-switching conflicts. Pi's fork switches the active session in its process, but the original thread's process stays on the original session. |
| 26 | **Pi process idle timeout** | Configurable, default 5–10 minutes | Pi processes for idle threads are terminated after timeout. On resume, adapter reads session file directly for history; spawns new Pi process only when `turn/start` is called. |
| 27 | **Remote persistence** | codapter stays alive via nohup; Pi processes persist with idle timeout | On reconnect, GUI sends `thread/resume`; adapter returns full history from session file + reattaches to active Pi process event stream if turn is in progress. No event buffering needed — Codex doesn't replay missed deltas, it reconstructs from completed items. |
| 28 | **Test runner** | vitest | Matches Codex ecosystem. |
| 29 | **Type dependencies** | Git submodules for both Codex and Pi | Codex types: submodule → `codex-rs/app-server-protocol/schema/typescript/v2/`. Pi: submodule on pi-mono, import RPC types/client directly. Submodules keep types in sync; TypeScript catches breaking changes at compile time. |
| 30 | **Image inputs** | Supported in core (Milestone 3) | Codex `UserInput.type: "image"` (URL) / `"localImage"` (path) → Pi `ImageContent`. Straightforward mapping. |
| 31 | **Elicitation** | Resolved: use `item/tool/requestUserInput` | Pi `extension_ui_request` (select, confirm, input, editor) maps to v2 server request `item/tool/requestUserInput` with `ToolRequestUserInputQuestion` params. GUI responds with `ToolRequestUserInputResponse` (answers map). Pi's notify/setStatus/setWidget/setTitle are informational — ignore. MCP elicitation (`mcpServer/elicitation/request`) is a separate method not needed for Pi. |
| 32 | **Max concurrent processes** | Configurable cap (default: 10) | Prevent resource exhaustion from many active threads. Beyond the cap, least-recently-used idle processes are terminated first. |
| 33 | **Unsupported method policy** | Return JSON-RPC `-32601 Method not found` | Every unrecognized RPC method returns a well-formed error, never crashes or silently drops. GUI can gracefully disable features. |
| 34 | **Config write behavior** | In-memory persistence per app lifecycle | Config writes are stored in adapter memory (not on disk) so that `config/read` returns consistent values within the same session. Prevents GUI retry loops from write-then-read-back mismatches. |
| 35 | **command/exec** | Adapter-native, not routed through Pi | Use Node.js `child_process` directly. Pi is single-threaded per session — routing shell commands through Pi while a prompt is running would block or crash. Adapter manages exec processes independently. |
| 36 | **Per-thread state machine** | Required states: `starting → ready → turn_active → forking → terminating` | Serialize operations per thread. Buffer `turn/start` until session is `ready`. Reject `fork` during `turn_active`. Prevent double-prompt (Pi throws if already streaming). |
| 37 | **Pi prompt ack semantics** | Treat `success:true` as "accepted", not "succeeded" | Pi responds immediately with ack, then may emit later failure. Drive turn completion/failure from stream terminal events (`agent_end`, `error`), not from the prompt response. |
| 38 | **Pi process crash scope** | Affects only the crashed thread, not adapter transport | On Pi process crash: emit `turn/completed(failed)` + `thread/status/changed(systemError)` for that thread only. Adapter transport stays alive for other threads. |
| 39 | **Version handling** | Runtime checks + graceful degradation | On `initialize`, log `clientInfo.version`, compare against compiled schema version. Unknown methods → `-32601`. Unknown params → ignore extras. Log version mismatch warnings to stderr. |
| 40 | **Parallel tool demuxing** | Verify Pi event correlation | Confirm Pi's `tool_execution_update` events include tool call IDs for routing to correct concurrent Codex ThreadItems. If not, may need sequential tool execution. |
| 41 | **Abort cleanup** | Adapter manually closes in-progress items | When Pi `abort` doesn't emit `tool_execution_end`/`message_end`, adapter must synthesize `item/completed` events for any open items before emitting `turn/completed(interrupted)`. |
| 42 | **IBackend refinements** | Add missing methods from review feedback | Add: `disposeSession()`, `getCapabilities()`, `respondToElicitation()`. Use opaque `sessionId` not `sessionPath`. Add `turnId` to `prompt()` for event correlation. |
| 43 | **UDS listener support** | `--listen unix:///path/to/adapter.sock` | WebSocket over Unix domain socket — same `/rpc` endpoint, same protocol. UDS lifecycle: create parent dir `0700`, remove stale socket, set `0600`, cleanup on shutdown. Enables SSH streamlocal tunneling to containerized environments without port publishing. |
| 44 | **Listener env var** | `CODAPTER_LISTEN` | Alternative to `--listen` CLI flag. Comma-separated for multiple listeners (e.g., `ws://127.0.0.1:9234,unix:///path/to.sock`). Env var is overridden by explicit `--listen` flags. Falls back to stdio if neither is set. |

### Project Conventions (from agent-runner)

Codapter follows the same conventions as the `agent-runner` project:

**Tooling:**
- **Biome** for linting/formatting: 2-space indent, 100 char line width, recommended rules, import organization enabled
- **Husky** pre-commit hook: runs `lint-staged` (Biome format) + `npm run check` (Biome lint)
- **vitest** for testing (divergence from agent-runner which uses Node native `--test`)
- **TypeScript**: ES2022 target, NodeNext module resolution, strict mode, composite mode for references
- **esbuild** for CLI dist bundling (single-file executable with shebang)

**Package conventions:**
- `"type": "module"` (ES modules)
- Package scope: `@codapter/` (e.g., `@codapter/core`, `@codapter/backend-pi`)
- All packages at version `0.1.0`, synced
- Private packages unless published
- `main`, `types`, `exports` fields in every package.json
- Build via `tsc -b` (project references)

**Project structure:**
```
codapter/
├── package.json               # Root workspace
├── tsconfig.base.json         # Shared TS base config
├── biome.json                 # Linter/formatter config
├── .husky/pre-commit          # lint-staged + check
├── codapter.toml              # Adapter configuration
├── CHANGELOG.md               # Manual, dated entries
├── scripts/
│   └── build-dist.mjs         # esbuild CLI bundling
├── packages/
│   ├── core/                  # Protocol handling, transport, state machine
│   │   └── src/
│   ├── backend-pi/            # Pi backend implementation
│   │   └── src/
│   └── cli/                   # CLI entry point (app-server subcommand)
│       └── src/
├── test/                      # vitest test files
│   ├── unit/                  # Mock backend tests
│   ├── integration/           # Multi-component tests
│   └── smoke/                 # Real Pi + LLM tests
└── docs/
    ├── api-mapping.md         # Codex ↔ Pi field-level mapping
    ├── backend-interface.md   # IBackend spec
    ├── architecture.md        # How the adapter works
    └── integration.md         # Setup guide
```

**Scripts:**
```json
{
  "setup": "npm install",
  "build": "tsc -b",
  "build:dist": "npm run build && node scripts/build-dist.mjs",
  "lint": "biome check .",
  "lint:fix": "biome check --write .",
  "format": "biome format --write .",
  "check": "npm run lint",
  "test": "vitest run",
  "test:smoke": "PI_SMOKE_TEST=1 vitest run test/smoke/",
  "prepare": "husky install",
  "clean": "rimraf dist packages/*/dist"
}
```

**Release process:**
- Version bump in all package.json files (synced)
- Update CHANGELOG.md with dated entry and milestone description
- Build dist artifact: `npm run build:dist`
- Tag and push
- CHANGELOG format: `## YYYY-MM-DD` headers, bullet-point list of changes

### Implementation Plan

#### Milestone 1: Project Scaffolding & Transport Layer
**Goal**: Adapter accepts connections and handles the initialize handshake.

**Deliverables**:
- TypeScript project setup (package.json, tsconfig, build tooling)
- Backend interface definition (`IBackend`) with abstract methods
- Transport layer: stdio server and WebSocket server (`--listen ws://...`)
- NDJSON message framing (parse incoming, serialize outgoing)
- `initialize` handler — respond with platform info, register client
- Configurable identity (`emulateCodexIdentity` flag)
- **Doc**: Backend interface specification (methods, events, lifecycle)

#### Milestone 2: Thread Lifecycle
**Goal**: Create, list, resume, and manage threads.

**Deliverables**:
- Thread-to-session mapping store (XDG state directory)
- `thread/start` → spawn Pi process, send `new_session`, return Thread object
- `thread/resume` → spawn Pi process, load session file, return Thread
- `thread/read` → call Pi `get_messages`, translate to Codex ThreadItems
- `thread/name/set` → call Pi `set_session_name`
- Thread listing (scan Pi session directory, return as thread list for sidebar)
- Pi process lifecycle management (spawn, track, terminate)
- **Doc**: Detailed field-level mapping for thread methods (Codex ↔ Pi)

#### Milestone 3: Turn Execution & Streaming
**Goal**: Send prompts and stream responses with full event translation.

**Deliverables**:
- `turn/start` → send Pi `prompt`, translate streaming events
- Per-thread state machine for message interleaving decomposition
- Event translation: Pi `text_delta` → Codex `item/agentMessage/delta`
- Event translation: Pi `thinking_delta` → Codex `agent_reasoning_delta`
- Event translation: Pi `tool_execution_*` → Codex `item/started`, `item/completed` (commandExecution, fileChange)
- `turn/interrupt` → Pi `abort`, emit turn completed with interrupted status
- Turn status tracking (`inProgress` → `completed` | `interrupted` | `failed`)
- Thread status updates (`idle` ↔ `active`)
- Image input support: map Codex `UserInput` image/localImage → Pi `ImageContent`
- Elicitation support: map Pi `extension_ui_request` → Codex `elicitation_request` event; handle `extension_ui_response` back from GUI
- **Doc**: Detailed event mapping table with payload field translations
- **Doc**: State machine diagram for message decomposition

#### Milestone 4: Tool Call Display & Command Execution
**Goal**: Proper rendering of tool calls, file changes, and standalone command execution.

**Deliverables**:
- Map Pi `bash` tool calls → Codex `commandExecution` ThreadItems with output streaming
- Map Pi `edit`/`write` tool calls → Codex `fileChange` ThreadItems with diff output
- Map Pi `read`/`grep`/`find`/`ls` tool calls → appropriate Codex items
- `command/exec` → Pi `bash` RPC (standalone shell, not LLM context)
- `command/exec/write` → stdin forwarding
- `command/exec/resize` → PTY resize (if Pi supports)
- `command/exec/terminate` → process kill
- Parallel tool call support
- **Doc**: Tool mapping reference (Pi tools → Codex ThreadItem types)

#### Milestone 5: Model & Config Management
**Goal**: Model selection and config stubs.

**Deliverables**:
- `model/list` → Pi `get_available_models`, translate to Codex format
- Model selection on `thread/start` and `turn/start` → Pi `set_model`
- `config/read` → return sensible defaults/stubs
- `configRequirements/read` → return null/empty
- `getAuthStatus` → report auth status from Pi config
- `skills/list` → map Pi commands/skills to Codex format
- `plugin/list` → return empty (no MCP plugins)
- Config write methods → acknowledge, no-op
- **Doc**: Config stub reference, model mapping format

#### Milestone 6: Integration Testing & Polish
**Goal**: End-to-end testing with the real Codex Desktop GUI.

**Deliverables**:
- Configure Codex Desktop to spawn adapter instead of Codex CLI
- End-to-end test: start thread, send message, see response stream
- End-to-end test: tool calls display correctly (bash, file edits)
- End-to-end test: interrupt turn
- End-to-end test: resume thread
- End-to-end test: model switching
- End-to-end test: standalone command execution
- Remote mode test (WebSocket transport via SSH tunnel)
- Error handling and edge cases
- **Doc**: Integration guide (how to configure Codex Desktop to use the adapter)
- **Doc**: Complete API mapping reference (final, validated against real GUI)

#### Documentation Standards

Throughout implementation, maintain these documentation deliverables:

1. **API Mapping Reference** (`docs/api-mapping.md`): Detailed field-level mapping between Codex and Pi protocols. Updated with each milestone as mappings are implemented and validated.

2. **Backend Interface Spec** (`docs/backend-interface.md`): The `IBackend` interface specification with method signatures, expected behaviors, event contracts. This is the contract for future backend integrations.

3. **Architecture Guide** (`docs/architecture.md`): How the adapter works — transport layer, state machines, process management, event translation pipeline.

4. **Integration Guide** (`docs/integration.md`): How to configure Codex Desktop to use the adapter. Local and remote setup instructions.

5. **Inline code documentation**: JSDoc on all public interfaces, types, and non-obvious logic. Focus on "why" not "what".

### Multi-Process Architecture

Since Pi can only handle one active session at a time, the adapter will:

1. Maintain a **map of threadId → Pi process** (spawned `pi-coding-agent` in RPC mode)
2. On `thread/start`: spawn a new Pi process, send `new_session`
3. On `thread/resume`: spawn Pi process, load the saved session file
4. On `turn/start`: route `prompt` to the correct Pi process
5. On `turn/interrupt`: send `abort` to the correct Pi process
6. On thread close/archive: gracefully terminate the Pi process
7. Persist Pi session files mapped to Codex thread IDs for resumability

## Architecture Summary

```
┌─────────────────────────────────────┐
│  Electron Renderer (React/Vite)     │
│  webview/assets/*.js                │
└──────────┬──────────────────────────┘
           │ Electron IPC (contextBridge/preload)
┌──────────▼──────────────────────────┐
│  Electron Main Process              │
│  main-t5WAGWYs.js                   │
│  ┌─────────────────────┐            │
│  │ IPC Router           │◄──────────┼──── Unix socket (/tmp/codex-ipc/ipc-$UID.sock)
│  │ (multi-window sync)  │           │     to other Codex windows
│  └─────────────────────┘            │
│  ┌─────────────────────┐            │
│  │ AppServerConnection  │           │
│  │ (StdioConnection or  │           │
│  │  WebSocketTransport) │           │
│  └──────────┬──────────┘            │
└─────────────┼───────────────────────┘
              │ NDJSON over stdio (local)
              │  — OR —
              │ JSON over WebSocket (remote via SSH tunnel)
┌─────────────▼───────────────────────┐
│  Codex CLI (app-server mode)        │
│  - Manages threads, turns, tools    │
│  - Runs shell commands, patches     │
│  - MCP server integration           │
│  - Calls OpenAI Responses API       │
│           │                         │
└───────────┼─────────────────────────┘
            │ HTTPS + SSE streaming
┌───────────▼─────────────────────────┐
│  OpenAI API                         │
│  responses.create (streaming)       │
│  auth.openai.com (OAuth)            │
│  chatgpt.com/backend-api (profile)  │
└─────────────────────────────────────┘
```

## 10. Remaining Parity Items

GUI features not yet discussed and their adapter handling:

| Feature | Codex Protocol | Adapter Plan |
|---------|---------------|--------------|
| **Thread archiving** | `thread/archive`, `thread/unarchive` | Store archive flag in adapter state. Hidden from sidebar but session file preserved. |
| **Thread listing** | `thread/list` (with sort/pagination) | Scan Pi session directory + adapter state for metadata. Return paginated. |
| **Thread title generation** | Auto-generated from first message | Adapter generates title from first user message text (truncate to ~50 chars). |
| **Token usage reporting** | `thread/tokenUsage/updated` notification | Map from Pi `get_session_stats` (has input/output tokens, cost). Emit periodically or on turn completion. |
| **Context compaction display** | `contextCompaction` ThreadItem | When Pi auto-compacts, emit a `contextCompaction` item so the GUI shows it in the thread. |
| **Realtime/voice** | `thread/realtime/*` events | **Out of scope**. Pi has no voice/realtime API. These events are never emitted. |
| **Image inputs** | `UserInput.type: "image"` / `"localImage"` | Pi supports `ImageContent` in prompts. Map Codex image inputs to Pi format. |
| **Web search** | `webSearch` ThreadItem | **Out of scope** initially. Pi has no built-in web search tool. Could add via Pi extension later. |
| **Image generation** | `imageGeneration` ThreadItem | **Out of scope**. Pi has no image generation tool. |
| **Heartbeat/keepalive** | Periodic ping between GUI and app-server | Adapter responds to heartbeats. Trivial — just echo back. |
| **Thread metadata updates** | `thread/metadata/update` | Store in adapter state (git info, cwd updates). |
| **Undo/rollback** | `thread/rollback` | **Partial**. Could map to Pi `fork` from an earlier message, but complex. Defer to later. |
| **Turn plan display** | `plan_update` / `plan_delta` events | Pi has no plan concept. Not emitted. |
| **Turn diff** | `turn/diff/updated` notification | Pi doesn't track diffs. Could compute from file changes if needed. Defer. |
| **Elicitation requests** | `elicitation_request` event | Map from Pi `extension_ui_request` events. The GUI can display prompts. |

## 11. Testing Strategy

### Unit Tests (Mock Backend)

Comprehensive tests using a **mock backend** that implements `IBackend` with predetermined responses. These validate the adapter's protocol compliance without requiring a real LLM.

**Test categories:**

1. **Protocol compliance tests** — Verify every Codex RPC method returns correctly shaped responses:
   - `initialize` → returns valid `InitializeResponse`
   - `thread/start` → returns `Thread` with correct fields
   - `thread/resume` → returns thread with turns populated
   - `thread/read` → returns thread history
   - `turn/start` → emits proper event sequence
   - `turn/interrupt` → emits turn completed with `interrupted` status
   - All other methods return valid shapes

2. **Event translation tests** — Verify streaming event translation:
   - Mock backend emits text deltas → adapter emits `item/agentMessage/delta`
   - Mock backend emits thinking → adapter emits `agent_reasoning_delta` (mapped from Codex event naming)
   - Mock backend emits tool execution → adapter emits `item/started` + deltas + `item/completed`
   - Mock backend emits error → adapter emits `turn/completed` with `failed` status
   - Multiple interleaved items → adapter decomposes into sequential ThreadItems

3. **State machine tests** — Verify message decomposition:
   - Text followed by tool call → two separate items
   - Tool call followed by text → proper item boundaries
   - Parallel tool calls → concurrent items
   - Interrupt during tool execution → proper cleanup

4. **Thread lifecycle tests**:
   - Create thread → list threads → resume thread → read history
   - Fork thread → verify new thread in listing
   - Archive/unarchive → visibility changes
   - Idle timeout → Pi process terminated → resume spawns new process

5. **Transport tests**:
   - NDJSON framing over stdio (newline delimited, proper parsing)
   - WebSocket transport (message framing, connection lifecycle)
   - Reconnection (resume after disconnect)

6. **Error handling tests**:
   - Backend process crash → GUI sees disconnected
   - Backend returns error → turn fails with message
   - Malformed input → graceful error response
   - Timeout → proper cleanup

### Smoke Tests (Real Pi + LLM)

End-to-end tests against a **real Pi backend** with a live LLM. These validate actual behavior but require API keys and are slower.

**Smoke test suite:**

1. **Basic conversation**: Send "what is 2+2?" → receive streamed response with correct text
2. **Tool execution**: Send "list files in the current directory" → see bash tool call with output
3. **File operations**: Send "create a file called test.txt with 'hello'" → see file change item with diff
4. **Multi-turn**: Send follow-up message → context maintained from previous turn
5. **Model switching**: Switch model via `model/list` + `turn/start` with model param → response uses new model
6. **Thinking display**: Use a model with reasoning → see thinking/reasoning content streamed
7. **Session persistence**: Start thread, close adapter, restart, resume thread → history preserved
8. **Interrupt**: Start a long response, send `turn/interrupt` → turn marked interrupted
9. **Fork**: Create thread with history, fork → new thread with copied history
10. **Standalone shell**: `command/exec` with `["ls", "-la"]` → see stdout output
11. **Thread listing**: Create multiple threads → all appear in list with correct metadata

**Smoke test configuration:**
- Requires `PI_SMOKE_TEST=1` environment variable
- Reads Pi API key from standard Pi auth config (`~/.pi/agent/auth.json`)
- Default model: cheapest/fastest available (e.g., `anthropic/claude-haiku-4-5-20251001`)
- Timeout: 60 seconds per test
- Output: TAP or JUnit format for CI integration

## 12. Implementation References

### Codex Protocol Types (Auto-Generated TypeScript)

**Location**: `/home/kevin/worktrees/codex/codex-rs/app-server-protocol/schema/typescript/v2/`

327 type files. Key types to import/reference:

| Type | File | Purpose |
|------|------|---------|
| `Thread` | `Thread.ts` | Thread object shape (id, preview, status, turns, cwd, etc.) |
| `Turn` | `Turn.ts` | Turn object (id, items, status, error) |
| `ThreadItem` | `ThreadItem.ts` | Union type: agentMessage, commandExecution, fileChange, mcpToolCall, etc. |
| `ThreadStatus` | `ThreadStatus.ts` | `notLoaded \| idle \| active(flags) \| systemError` |
| `TurnStatus` | `TurnStatus.ts` | `inProgress \| completed \| interrupted \| failed` |
| `ThreadStartParams/Response` | `ThreadStartParams.ts`, `ThreadStartResponse.ts` | Thread creation |
| `ThreadResumeParams/Response` | `ThreadResumeParams.ts`, `ThreadResumeResponse.ts` | Thread resume |
| `ThreadForkParams/Response` | `ThreadForkParams.ts`, `ThreadForkResponse.ts` | Thread fork |
| `ThreadReadParams/Response` | `ThreadReadParams.ts`, `ThreadReadResponse.ts` | Read history |
| `TurnStartParams/Response` | `TurnStartParams.ts`, `TurnStartResponse.ts` | Start turn |
| `TurnInterruptParams/Response` | `TurnInterruptParams.ts`, `TurnInterruptResponse.ts` | Interrupt |
| `InitializeParams` | `InitializeParams.ts` | Initialize handshake |
| `InitializeResponse` | `InitializeResponse.ts` | Initialize response |
| `CommandExecParams/Response` | `CommandExecParams.ts`, `CommandExecResponse.ts` | Shell execution |
| `ModelListParams/Response` | `ModelListParams.ts`, `ModelListResponse.ts` | Model listing |
| `UserInput` | `UserInput.ts` | Union: text, image, localImage, skill, mention |
| `FileUpdateChange` | `FileUpdateChange.ts` | File diff (path, kind, diff) |
| `CommandAction` | `CommandAction.ts` | Parsed command actions |
| `AskForApproval` | `AskForApproval.ts` | Approval policy enum |
| `SandboxPolicy` | `SandboxPolicy.ts` | Sandbox configuration |

**Notification types** (streaming events):

| Type | File |
|------|------|
| `ItemStartedNotification` | `ItemStartedNotification.ts` |
| `ItemCompletedNotification` | `ItemCompletedNotification.ts` |
| `AgentMessageDeltaNotification` | `AgentMessageDeltaNotification.ts` |
| `CommandExecutionOutputDeltaNotification` | `CommandExecutionOutputDeltaNotification.ts` |
| `TurnStartedNotification` | `TurnStartedNotification.ts` |
| `TurnCompletedNotification` | `TurnCompletedNotification.ts` |
| `ThreadStatusChangedNotification` | `ThreadStatusChangedNotification.ts` |
| `ThreadStartedNotification` | `ThreadStartedNotification.ts` |

**Note**: These types are auto-generated from Rust via `ts-rs`. They can be copied into the codapter project or referenced as a git subtree. They define the exact JSON shapes the GUI expects.

### Pi RPC Protocol Types & Client

**Location**: `/home/kevin/worktrees/pi-mono/packages/coding-agent/src/modes/rpc/`

| File | Purpose |
|------|---------|
| `rpc-types.ts` | Complete protocol type definitions — `RpcCommand` (36 command variants), `RpcResponse`, `RpcSessionState`, `RpcExtensionUIRequest/Response`, `RpcSlashCommand` |
| `rpc-client.ts` | `RpcClient` class — spawns Pi in RPC mode, typed API for all commands, JSONL framing, event listeners |
| `rpc-mode.ts` | Server-side RPC mode implementation (638 lines) — handles incoming commands, emits events |
| `jsonl.ts` | JSONL framing utilities — `attachJsonlLineReader()`, `serializeJsonLine()` |

**Key Pi types from dependencies:**

| Type | Package | Purpose |
|------|---------|---------|
| `AgentMessage` | `@mariozechner/pi-agent-core` | Union: UserMessage, AssistantMessage, ToolResultMessage |
| `AgentEvent` | `@mariozechner/pi-agent-core` | Streaming events (agent_start, turn_start, message_update, tool_execution_*, etc.) |
| `ThinkingLevel` | `@mariozechner/pi-agent-core` | Reasoning budget levels |
| `Model` | `@mariozechner/pi-ai` | Model descriptor (provider, id, contextWindow, etc.) |
| `ImageContent` | `@mariozechner/pi-ai` | Image input format |
| `AssistantMessageEventStream` | `@mariozechner/pi-ai` | Low-level streaming events (text_delta, thinking_delta, toolcall_delta, etc.) |

**RpcClient API** (key methods):

```typescript
class RpcClient {
  start(): Promise<void>                    // Spawn Pi process
  stop(): Promise<void>                     // Terminate Pi process
  prompt(message: string, images?: ImageContent[]): Promise<void>
  steer(message: string): Promise<void>
  abort(): Promise<void>
  newSession(): Promise<{ cancelled: boolean }>
  getState(): Promise<RpcSessionState>
  getMessages(): Promise<{ messages: AgentMessage[] }>
  setModel(provider: string, modelId: string): Promise<Model>
  getAvailableModels(): Promise<{ models: Model[] }>
  setThinkingLevel(level: ThinkingLevel): Promise<void>
  bash(command: string): Promise<BashResult>
  fork(entryId: string): Promise<{ text: string; cancelled: boolean }>
  getForkMessages(): Promise<{ messages: Array<{ entryId: string; text: string }> }>
  switchSession(sessionPath: string): Promise<{ cancelled: boolean }>
  getSessionStats(): Promise<SessionStats>
  setSessionName(name: string): Promise<void>
  getCommands(): Promise<{ commands: RpcSlashCommand[] }>
  addEventListener(listener: RpcEventListener): void
  removeEventListener(listener: RpcEventListener): void
}
```

### IBackend Interface (Proposed)

The adapter's backend abstraction. Pi is the first implementation.

```typescript
interface IBackend {
  // Lifecycle
  initialize(cwd: string, model?: string): Promise<void>
  dispose(): Promise<void>
  isAlive(): boolean

  // Session management — all use opaque sessionId, not file paths
  createSession(cwd: string): Promise<BackendSession>
  resumeSession(sessionId: string, cwd: string): Promise<BackendSession>
  forkSession(sessionId: string): Promise<BackendSession>
  disposeSession(sessionId: string): Promise<void>
  readSessionHistory(sessionId: string): Promise<BackendMessage[]>
  setSessionName(sessionId: string, name: string): Promise<void>
  getCapabilities(): BackendCapabilities

  // Prompting
  prompt(sessionId: string, turnId: string, text: string, images?: ImageInput[]): Promise<void>
  abort(sessionId: string): Promise<void>

  // Elicitation
  respondToElicitation(sessionId: string, requestId: string, response: ElicitationResponse): Promise<void>

  // Events — listener receives BackendEvent with full correlation context
  onEvent(sessionId: string, listener: BackendEventListener): Disposable

  // Models
  listModels(): Promise<BackendModel[]>
  setModel(sessionId: string, provider: string, model: string): Promise<void>

  // State
  getSessionState(sessionId: string): Promise<BackendSessionState>
}

// Every event carries correlation context for routing and stale-event gating
type BackendEvent =
  | { type: "text_delta"; turnId: string; delta: string }
  | { type: "thinking_delta"; turnId: string; delta: string }
  | { type: "tool_start"; turnId: string; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_update"; turnId: string; toolCallId: string; output: string; isCumulative: boolean }
  | { type: "tool_end"; turnId: string; toolCallId: string; result: ToolResult }
  | { type: "message_end"; turnId: string; stopReason: string }
  | { type: "elicitation_request"; turnId: string; requestId: string; method: string; params: unknown }
  | { type: "error"; turnId: string; message: string }
  | { type: "token_usage"; turnId: string; inputTokens: number; outputTokens: number }

// isCumulative on tool_update: if true, output is full accumulated output (Pi behavior);
// adapter must diff against previous to extract true delta for Codex streaming.
// If false, output is a pure delta (can forward directly).

interface BackendCapabilities {
  supportsImages: boolean
  supportsThinking: boolean
  supportsParallelTools: boolean
  supportedToolTypes: string[]  // e.g., ["bash", "edit", "write", "read", "grep", "find", "ls"]
}
```

Each backend method maps to one or more Codex RPC methods. The adapter core translates between Codex protocol and this interface. Note: `command/exec` (standalone shell) is **not** part of IBackend — it is implemented natively by the adapter using Node.js `child_process` (Decision #35).