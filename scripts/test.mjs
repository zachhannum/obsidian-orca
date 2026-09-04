/** The Node tier: every test bundled the way the plugin is. */

import { spawn } from "node:child_process";
import { glob, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import esbuild from "esbuild";
import { external, inlineWorker, root, tsconfig } from "./bundle.mjs";

const outdir = path.join(root, "build/test");
await rm(outdir, { recursive: true, force: true });

const entryPoints = [];
for await (const file of glob("src/**/*.test.ts", { cwd: root })) {
  entryPoints.push(path.join(root, file));
}

await esbuild.build({
  entryPoints,
  outdir,
  outbase: path.join(root, "src"),
  absWorkingDir: root,
  bundle: true,
  format: "esm",
  target: "node22",
  platform: "node",
  sourcemap: "inline",
  logLevel: "info",
  logOverride: { "empty-import-meta": "silent" },
  plugins: [inlineWorker()],
  tsconfig,
  external,
});

const built = entryPoints.map((entry) => {
  const under = path.relative(path.join(root, "src"), entry);
  return path.join(outdir, under.replace(/\.ts$/, ".js"));
});

const node = spawn(
  process.execPath,
  ["--test", "--enable-source-maps", ...built],
  { cwd: root, stdio: "inherit", env: { ...process.env, ORCA_ROOT: root } },
);
node.on("exit", (code) => process.exit(code ?? 1));
