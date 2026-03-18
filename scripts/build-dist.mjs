import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const entryPoint = new URL("../packages/cli/src/bin.ts", import.meta.url);
const outfile = new URL("../dist/codapter.mjs", import.meta.url);
const legacyOutfile = new URL("../dist/codapter.cjs", import.meta.url);
const legacySourceMapOutfile = new URL("../dist/codapter.cjs.map", import.meta.url);

await mkdir(dirname(fileURLToPath(outfile)), { recursive: true });
await rm(fileURLToPath(legacyOutfile), { force: true });
await rm(fileURLToPath(legacySourceMapOutfile), { force: true });

await esbuild.build({
  banner: {
    js: 'import { createRequire } from "node:module";const require = createRequire(import.meta.url);',
  },
  bundle: true,
  entryPoints: [fileURLToPath(entryPoint)],
  format: "esm",
  minify: true,
  outfile: fileURLToPath(outfile),
  platform: "node",
  sourcemap: true,
  target: "node22",
});

await chmod(fileURLToPath(outfile), 0o755);
