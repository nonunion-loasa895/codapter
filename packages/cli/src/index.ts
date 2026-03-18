import { placeholderCoreContract } from "@codapter/core";

export interface CliRunResult {
  readonly exitCode: number;
}

export async function runCli(args: readonly string[]): Promise<CliRunResult> {
  if (args.includes("--version")) {
    console.log("0.1.0");
    return { exitCode: 0 };
  }

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log("codapter 0.1.0");
    console.log("Available commands: app-server");
    return { exitCode: 0 };
  }

  if (args[0] === "app-server") {
    console.log(`${placeholderCoreContract.packageName}: app-server scaffold initialized`);
    return { exitCode: 0 };
  }

  console.error(`Unknown command: ${args[0]}`);
  return { exitCode: 1 };
}
