import { createInterface } from "node:readline";
import { AppServerConnection, failure, parseNdjsonLine, serializeNdjsonLine } from "@codapter/core";

const VERSION = "0.1.0";
const ANALYTICS_FLAG = "--analytics-default-enabled";

export interface CliEnvironment {
  readonly stdin?: NodeJS.ReadableStream;
  readonly stdout?: NodeJS.WritableStream;
  readonly stderr?: NodeJS.WritableStream;
  readonly env?: NodeJS.ProcessEnv;
}

export interface CliRunResult {
  readonly exitCode: number;
}

export interface AppServerArgs {
  readonly listenTargets: readonly string[];
  readonly analyticsDefaultEnabledSeen: boolean;
}

const defaultEnvironment: Required<Pick<CliEnvironment, "stdin" | "stdout" | "stderr" | "env">> = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
};

export function parseListenTargets(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): AppServerArgs {
  const listenTargets: string[] = [];
  let analyticsDefaultEnabledSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === ANALYTICS_FLAG) {
      analyticsDefaultEnabledSeen = true;
      continue;
    }

    if (arg.startsWith("--listen=")) {
      const value = arg.slice("--listen=".length).trim();
      if (!value) {
        throw new Error("Missing value for --listen");
      }
      listenTargets.push(value);
      continue;
    }

    if (arg === "--listen") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --listen");
      }
      listenTargets.push(value.trim());
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (listenTargets.length === 0) {
    const fallback = env.CODAPTER_LISTEN ?? "";
    for (const entry of fallback.split(",")) {
      const value = entry.trim();
      if (value) {
        listenTargets.push(value);
      }
    }
  }

  return {
    listenTargets,
    analyticsDefaultEnabledSeen,
  };
}

export async function runCli(
  args: readonly string[],
  environment: CliEnvironment = {}
): Promise<CliRunResult> {
  const stdin = environment.stdin ?? defaultEnvironment.stdin;
  const stdout = environment.stdout ?? defaultEnvironment.stdout;
  const stderr = environment.stderr ?? defaultEnvironment.stderr;
  const env = environment.env ?? defaultEnvironment.env;

  if (args.includes("--version")) {
    stdout.write(`${VERSION}\n`);
    return { exitCode: 0 };
  }

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    writeHelp(stdout);
    return { exitCode: 0 };
  }

  const [command, ...commandArgs] = args;
  if (command !== "app-server") {
    stderr.write(`Unknown command: ${command}\n`);
    return { exitCode: 1 };
  }

  try {
    const parsed = parseListenTargets(commandArgs, env);

    if (parsed.listenTargets.length > 0) {
      stderr.write(
        `WebSocket listeners are not implemented in this CLI slice: ${parsed.listenTargets.join(", ")}\n`
      );
      return { exitCode: 1 };
    }

    await runStdioAppServer(stdin, stdout);
    return { exitCode: 0 };
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : "Invalid CLI arguments"}\n`);
    return { exitCode: 1 };
  }
}

async function runStdioAppServer(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream
): Promise<void> {
  const connection = new AppServerConnection();
  const readline = createInterface({
    input: stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  try {
    for await (const line of readline) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }

      try {
        const message = parseNdjsonLine(trimmed);
        const response = await connection.handleMessage(message);
        if (response) {
          stdout.write(serializeNdjsonLine(response));
        }
      } catch {
        stdout.write(serializeNdjsonLine(failure(null, -32700, "Parse error")));
      }
    }
  } finally {
    readline.close();
  }
}

function writeHelp(stdout: NodeJS.WritableStream): void {
  stdout.write(`codapter ${VERSION}\n`);
  stdout.write("Usage: codapter [--version|--help] | codapter app-server [--listen <url>]...\n");
  stdout.write("Options:\n");
  stdout.write("  --listen <url>                Add a transport listener address\n");
  stdout.write("  --analytics-default-enabled    Accepted and ignored in this slice\n");
}
