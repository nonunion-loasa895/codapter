import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexBackend } from "../src/index.js";

async function createMockCodexScript(rootDir: string): Promise<string> {
  const scriptPath = join(rootDir, "mock-codex-app-server.mjs");
  const script = [
    "import { StringDecoder } from 'node:string_decoder';",
    "const decoder = new StringDecoder('utf8');",
    "let buffer = '';",
    "",
    "function write(value) {",
    "  process.stdout.write(JSON.stringify(value) + '\\n');",
    "}",
    "",
    "function handleMessage(payload) {",
    "  if (payload.method === 'initialize') {",
    "    write({ id: payload.id, result: { userAgent: 'mock-codex', platformFamily: 'unix', platformOs: 'linux' } });",
    "    return;",
    "  }",
    "  if (payload.method === 'model/list') {",
    "    write({ id: payload.id, result: { data: [{ id: 'gpt-5.4', model: 'gpt-5.4', displayName: 'GPT-5.4', description: 'mock', hidden: false, isDefault: true, inputModalities: ['text'], supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }], defaultReasoningEffort: 'medium', supportsPersonality: true }] } });",
    "    return;",
    "  }",
    "  if (payload.method === 'thread/start') {",
    "    write({ id: payload.id, result: { thread: { id: 'thr_mock', path: '/tmp/thr_mock.jsonl', turns: [] }, model: payload.params.model ?? 'gpt-5.4', reasoningEffort: 'medium' } });",
    "    return;",
    "  }",
    "  if (payload.method === 'turn/start') {",
    "    write({ id: payload.id, result: { turn: { id: 'turn_1', items: [], status: 'inProgress', error: null } } });",
    "    setTimeout(() => {",
    "      write({ method: 'turn/started', params: { threadId: payload.params.threadId, turn: { id: 'turn_1', items: [], status: 'inProgress', error: null } } });",
    "      write({ id: 'srv_1', method: 'item/tool/requestUserInput', params: { threadId: payload.params.threadId, turnId: 'turn_1', itemId: 'item_1', questions: [{ id: 'answer', header: 'Answer', question: 'Continue?', isOther: false, isSecret: false, options: [{ label: 'Yes', description: 'continue' }] }] } });",
    "      write({ method: 'item/agentMessage/delta', params: { threadId: payload.params.threadId, turnId: 'turn_1', itemId: 'msg_1', delta: 'done' } });",
    "      write({ method: 'turn/completed', params: { threadId: payload.params.threadId, turn: { id: 'turn_1', items: [], status: 'completed', error: null } } });",
    "    }, 10);",
    "    return;",
    "  }",
    "}",
    "",
    "process.stdin.on('data', (chunk) => {",
    "  buffer += decoder.write(chunk);",
    "  const lines = buffer.split('\\n');",
    "  buffer = lines.pop() ?? '';",
    "  for (const line of lines) {",
    "    if (!line.trim()) continue;",
    "    const parsed = JSON.parse(line);",
    "    if ('method' in parsed) {",
    "      handleMessage(parsed);",
    "    }",
    "  }",
    "});",
  ].join("\n");
  await writeFile(scriptPath, script, "utf8");
  return scriptPath;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("CodexBackend", () => {
  it("proxies stdio app-server requests and relays notifications/server requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "codapter-codex-test-"));
    const mockScript = await createMockCodexScript(root);
    const backend = createCodexBackend({
      command: "node",
      args: [mockScript],
    });
    await backend.initialize();

    const models = await backend.listModels();
    expect(models[0]?.id).toBe("gpt-5.4");

    const started = await backend.threadStart({
      threadId: "thr_local",
      cwd: process.cwd(),
      model: "gpt-5.4",
      reasoningEffort: "medium",
      launchConfig: {},
    });
    expect(started.threadHandle).toBe("thr_mock");

    const events: Array<{ kind: string; method?: string }> = [];
    const subscription = backend.onEvent(started.threadHandle, (event) => {
      events.push({ kind: event.kind, method: "method" in event ? event.method : undefined });
      if (event.kind === "serverRequest") {
        void backend.resolveServerRequest({
          threadId: "thr_local",
          threadHandle: started.threadHandle,
          requestId: event.requestId,
          response: { result: { answers: { answer: { answers: ["Yes"] } } } },
        });
      }
    });

    await backend.turnStart({
      threadId: "thr_local",
      threadHandle: started.threadHandle,
      turnId: "turn_local",
      cwd: process.cwd(),
      input: [{ type: "text", text: "hello", text_elements: [] }],
      model: "gpt-5.4",
      reasoningEffort: "medium",
    });

    await waitFor(() => events.some((event) => event.kind === "serverRequest"));
    await waitFor(() => events.some((event) => event.method === "turn/completed"));
    expect(events.some((event) => event.method === "turn/completed")).toBe(true);

    subscription.dispose();
    await backend.dispose();
  });

  it("rejects websocket mode deterministically", async () => {
    const backend = createCodexBackend({
      transport: "websocket",
      websocketUrl: "ws://127.0.0.1:9234",
    });
    await expect(backend.initialize()).rejects.toThrow("deferred");
    await expect(backend.initialize()).rejects.toThrow("ws://127.0.0.1:9234");
    expect(backend.isAlive()).toBe(false);
    await expect(backend.dispose()).resolves.toBeUndefined();
  });

  it("rejects websocket mode without URL deterministically", async () => {
    const backend = createCodexBackend({
      transport: "websocket",
    });
    await expect(backend.initialize()).rejects.toThrow(
      "Codex websocket transport is deferred in this implementation"
    );
    expect(backend.isAlive()).toBe(false);
  });
});
