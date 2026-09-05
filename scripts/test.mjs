/** The Node tier: every test bundled the way the plugin is. */

import { spawn } from "node:child_process";
import { glob, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";
import { external, inlineWorker, root, tsconfig } from "./bundle.mjs";

const outdir = path.join(root, "build/test");
await rm(outdir, { recursive: true, force: true });

const entryPoints = [];
for await (const file of glob("src/**/*.test.{ts,tsx}", { cwd: root })) {
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

const specs = entryPoints.map((entry) => {
  const under = path.relative(path.join(root, "src"), entry);
  return path.join(outdir, under.replace(/\.tsx?$/, ".js"));
});

// The build's own scripts are ESM already, so they run as they are
// written rather than through a bundle.
for await (const file of glob("scripts/**/*.test.mjs", { cwd: root })) {
  specs.push(path.join(root, file));
}

// The spec reporter writes the console. The summary reporter writes
// the job's summary page and yields nothing, so the two do not
// interleave.
const reporters = ["--test-reporter=spec", "--test-reporter-destination=stdout"];
if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
  reporters.push(
    `--test-reporter=${pathToFileURL(path.join(root, "scripts/summary.mjs"))}`,
    "--test-reporter-destination=stdout",
  );
}

const node = spawn(
  process.execPath,
  ["--test", "--enable-source-maps", ...reporters, ...specs],
  { cwd: root, stdio: "inherit", env: { ...process.env, ORCA_ROOT: root } },
);
node.on("exit", (code) => process.exit(code ?? 1));
