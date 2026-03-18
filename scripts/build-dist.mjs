import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const entryPoint = new URL("../packages/cli/src/bin.ts", import.meta.url);
const outfile = new URL("../dist/codapter.mjs", import.meta.url);

await mkdir(dirname(fileURLToPath(outfile)), { recursive: true });

await esbuild.build({
  bundle: true,
  entryPoints: [fileURLToPath(entryPoint)],
  format: "esm",
  outfile: fileURLToPath(outfile),
  platform: "node",
  sourcemap: true,
  target: "node22",
  banner: {
    js: "#!/usr/bin/env node",
  },
});

await chmod(fileURLToPath(outfile), 0o755);
