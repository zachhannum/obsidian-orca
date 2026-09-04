/** The build, as a module, so its test runs the same one. */

import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import builtins from "builtin-modules";

const require = createRequire(import.meta.url);

/** The repository, so a build does not depend on where it was started. */
export const root = path.resolve(fileURLToPath(import.meta.url), "../..");

export const engineModule = require.resolve("fleuron/fleuron_bg.wasm");

export const external = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  ...builtins,
];

/** esbuild reads `@/` out of its `paths`. */
export const tsconfig = path.join(root, "tsconfig.json");

/**
 * `virtual:worker` is the worker bundled to one string, so the release
 * is a single JavaScript file and the worker starts from a Blob URL.
 */
export function inlineWorker({ production = false } = {}) {
  return {
    name: "orca-inline-worker",
    setup(build) {
      build.onResolve({ filter: /^virtual:worker$/ }, () => ({
        path: "worker",
        namespace: "orca-worker",
      }));
      build.onLoad({ filter: /.*/, namespace: "orca-worker" }, async () => {
        const built = await esbuild.build({
          entryPoints: [path.join(root, "src/engine/worker.ts")],
          absWorkingDir: root,
          bundle: true,
          format: "iife",
          target: "es2022",
          platform: "browser",
          write: false,
          metafile: true,
          minify: production,
          sourcemap: production ? false : "inline",
          // The glue's fetch path reads `import.meta.url`, which an IIFE
          // does not have. Orca always passes the bytes, so that branch
          // never runs.
          logOverride: { "empty-import-meta": "silent" },
          tsconfig,
          external,
        });
        return {
          contents: `export default ${JSON.stringify(built.outputFiles[0].text)}`,
          loader: "js",
          watchFiles: Object.keys(built.metafile.inputs),
        };
      });
    },
  };
}

export function options({ production, outdir }) {
  return {
    entryPoints: [path.join(root, "src/main.ts")],
    outfile: path.join(outdir, "main.js"),
    absWorkingDir: root,
    bundle: true,
    format: "cjs",
    target: "es2022",
    platform: "browser",
    logLevel: "info",
    sourcemap: production ? false : "inline",
    treeShaking: true,
    minify: production,
    plugins: [inlineWorker({ production })],
    tsconfig,
    external,
  };
}

export async function copyModule(outdir) {
  await mkdir(outdir, { recursive: true });
  await copyFile(engineModule, path.join(outdir, path.basename(engineModule)));
}
