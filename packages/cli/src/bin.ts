#!/usr/bin/env node
import { runCli } from "./index.js";

async function main() {
  const { exitCode } = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}

void main();
