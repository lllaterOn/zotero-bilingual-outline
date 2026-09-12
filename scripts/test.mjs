import { build } from "esbuild";
import { readdir, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = (await readdir(path.join(root, "tests")))
  .filter(name => name.endsWith(".test.ts")).sort();
if (!files.length) throw new Error("No tests found");
await mkdir(path.join(root, ".build/tests"), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: files.map(name => `tests/${name}`),
  outdir: ".build/tests",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["node:*", "jsdom"],
  sourcemap: "inline",
});
const result = spawnSync(process.execPath, ["--test", ...files.map(name =>
  path.join(root, ".build/tests", name.replace(/\.ts$/, ".mjs")))], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
