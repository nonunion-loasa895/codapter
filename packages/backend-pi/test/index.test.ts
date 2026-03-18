import { describe, expect, it } from "vitest";
import { PiBackend, createPiBackend } from "../src/index.js";

describe("PiBackend", () => {
  it("requires initialize before use", async () => {
    const backend = new PiBackend();

    await expect(backend.createSession()).rejects.toThrow(
      "Pi backend must be initialized before use"
    );
  });

  it("creates, resumes, forks, and disposes sessions", async () => {
    const backend = createPiBackend({ sessionDir: "/tmp/pi-sessions" });
    await backend.initialize();

    const sessionId = await backend.createSession();
    expect(sessionId.startsWith("pi_session_")).toBe(true);
    expect(backend.isAlive()).toBe(true);
    expect(await backend.readSessionHistory(sessionId)).toEqual([]);

    await expect(backend.resumeSession(sessionId)).resolves.toBe(sessionId);

    const forkedSessionId = await backend.forkSession(sessionId);
    expect(forkedSessionId).not.toBe(sessionId);
    expect(await backend.readSessionHistory(forkedSessionId)).toEqual([]);

    await backend.setSessionName(sessionId, "Primary session");
    await backend.setModel(sessionId, "pi-fast");

    await backend.disposeSession(sessionId);
    await expect(backend.readSessionHistory(sessionId)).rejects.toThrow("Unknown Pi session");
  });

  it("returns cloned models and capabilities", async () => {
    const backend = createPiBackend();
    await backend.initialize();

    const models = await backend.listModels();
    const capabilities = await backend.getCapabilities();

    expect(models).toHaveLength(2);
    expect(models[0]?.isDefault).toBe(true);
    expect(capabilities).toEqual({
      requiresAuth: false,
      supportsImages: false,
      supportsThinking: true,
      supportsParallelTools: false,
      supportedToolTypes: [],
    });
  });

  it("throws on unsupported prompt and elicitation operations", async () => {
    const backend = createPiBackend();
    await backend.initialize();
    const sessionId = await backend.createSession();

    await expect(
      backend.prompt(sessionId, "turn_1", "hello", [{ type: "image", url: "https://example.com" }])
    ).rejects.toThrow("Pi backend scaffold does not implement prompt yet");
    await expect(backend.abort(sessionId)).rejects.toThrow(
      "Pi backend scaffold does not implement abort yet"
    );
    await expect(
      backend.respondToElicitation(sessionId, "request_1", { accepted: true })
    ).rejects.toThrow("Pi backend scaffold does not implement respondToElicitation yet");
  });

  it("manages event subscriptions", async () => {
    const backend = createPiBackend();
    await backend.initialize();
    const sessionId = await backend.createSession();
    const listenerCalls: unknown[] = [];

    const subscription = backend.onEvent(sessionId, (event) => {
      listenerCalls.push(event);
    });

    subscription.dispose();
    expect(listenerCalls).toEqual([]);
  });
});
