import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseListenTargets, runCli } from "../src/index.js";

function createStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  stdout.setEncoding("utf8");
  stderr.setEncoding("utf8");
  stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  stderr.on("data", (chunk) => stderrChunks.push(chunk));

  return {
    stdin,
    stdout,
    stderr,
    stdoutChunks,
    stderrChunks,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseListenTargets", () => {
  it("collects repeated listen flags", () => {
    expect(
      parseListenTargets(["--listen", "ws://127.0.0.1:8080", "--listen=unix:///tmp/codapter.sock"])
    ).toEqual({
      listenTargets: ["ws://127.0.0.1:8080", "unix:///tmp/codapter.sock"],
      analyticsDefaultEnabledSeen: false,
    });
  });

  it("falls back to CODAPTER_LISTEN when no explicit listen flags are present", () => {
    expect(
      parseListenTargets([], { CODAPTER_LISTEN: "ws://127.0.0.1:8080, unix:///tmp/codapter.sock" })
    ).toEqual({
      listenTargets: ["ws://127.0.0.1:8080", "unix:///tmp/codapter.sock"],
      analyticsDefaultEnabledSeen: false,
    });
  });
});

describe("runCli", () => {
  it("runs the stdio app-server path by default", async () => {
    const streams = createStreams();
    const input = Readable.from([
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: { name: "codapter-test", title: null, version: "0.1.0" },
          capabilities: { experimentalApi: true, optOutNotificationMethods: [] },
        },
      }),
      "\n",
    ]);

    const result = await runCli(["app-server"], {
      stdin: input,
      stdout: streams.stdout,
      stderr: streams.stderr,
      env: {},
    });

    expect(result).toEqual({ exitCode: 0 });
    expect(streams.stderrChunks.join("")).toBe("");
    const response = JSON.parse(streams.stdoutChunks.join(""));
    expect(response).toMatchObject({
      id: 1,
      result: {
        userAgent: expect.any(String),
        platformFamily: expect.any(String),
        platformOs: expect.any(String),
      },
    });
  });

  it("rejects websocket listener requests in this slice", async () => {
    const streams = createStreams();
    const result = await runCli(["app-server", "--listen", "ws://127.0.0.1:8080"], {
      stdin: streams.stdin,
      stdout: streams.stdout,
      stderr: streams.stderr,
      env: {},
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(streams.stderrChunks.join("")).toContain("WebSocket listeners are not implemented");
  });
});
