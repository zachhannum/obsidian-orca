/** The build, as a module, so its test runs the same build. */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
import esbuild from "esbuild";
import { VERSION, WIRE_VERSION, initSync, wireVersion } from "fleuron";

const require = createRequire(import.meta.url);

/** The repository, so a build does not depend on where it was started. */
export const root = path.resolve(fileURLToPath(import.meta.url), "../..");

export const engineModule = require.resolve("fleuron/fleuron_bg.wasm");

export const manifestFile = path.join(root, "manifest.json");

export const packageFile = path.join(root, "package.json");

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
  ...builtinModules,
  // esbuild matches the specifier as written, and orca imports the
  // `node:` form. The desktop app provides these, and orca loads them
  // only there.
  ...builtinModules.map((name) => `node:${name}`),
];

/**
 * A stylesheet a module imports is text in the bundle. Obsidian loads
 * `styles.css` itself, and no module imports that one.
 */
export const loader = { ".css": "text" };

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

const compress = promisify(brotliCompress);

const compressed = new Map();

/**
 * The engine module compressed with brotli, as base64. The highest
 * quality takes many seconds, so only a production build pays for it,
 * and a process compresses the module once at each quality.
 */
export function compressedModule({ production = false } = {}) {
  const quality = production ? constants.BROTLI_MAX_QUALITY : 5;
  let encoded = compressed.get(quality);
  if (encoded === undefined) {
    encoded = readFile(engineModule).then(async (module) => {
      const packed = await compress(module, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: quality,
          [constants.BROTLI_PARAM_LGWIN]: constants.BROTLI_MAX_WINDOW_BITS,
          [constants.BROTLI_PARAM_SIZE_HINT]: module.length,
        },
      });
      return packed.toString("base64");
    });
    compressed.set(quality, encoded);
  }
  return encoded;
}

/**
 * `virtual:module` is the engine module, compressed and then base64, so
 * the release is the three files Obsidian installs and nothing beside
 * them. The plugin review does not complete on a `main.js` that holds
 * the module uncompressed.
 */
export function inlineModule({ production = false } = {}) {
  return {
    name: "orca-inline-module",
    setup(build) {
      build.onResolve({ filter: /^virtual:module$/ }, () => ({
        path: engineModule,
        namespace: "orca-module",
      }));
      build.onLoad({ filter: /.*/, namespace: "orca-module" }, async () => ({
        contents: `export default ${JSON.stringify(await compressedModule({ production }))}`,
        loader: "js",
        watchFiles: [engineModule],
      }));
    },
  };
}

/** A call that makes a script element, as the plugin review finds one. */
export const scriptElement = /createElement\(\s*["'`]script["'`]\s*\)/i;

/**
 * Fails the build when the bundle makes a script element. The plugin
 * review rejects one, and a dependency can bring it in: React 19 hoists
 * a rendered `<script>` into the document head.
 */
export function noScriptElements() {
  return {
    name: "orca-no-script-elements",
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) return;
        const texts =
          result.outputFiles?.map((file) => [file.path, file.text]) ??
          [[build.initialOptions.outfile, await readFile(build.initialOptions.outfile, "utf8")]];
        const errors = texts
          .filter(([, text]) => scriptElement.test(text))
          .map(([file]) => ({
            text: `${path.basename(file)} creates a script element at runtime`,
          }));
        return { errors };
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
    plugins: [inlineWorker({ production }), inlineModule({ production }), noScriptElements()],
    loader,
    tsconfig,
    external,
  };
}

/**
 * The manifest and the stylesheet, for a build written somewhere other
 * than the repository root. A build into the root has them already.
 */
export async function copyPlugin(outdir, manifest = manifestFile) {
  if (path.resolve(outdir) === root) return;
  await mkdir(outdir, { recursive: true });
  await copyFile(manifest, path.join(outdir, "manifest.json"));
  await copyFile(path.join(root, "styles.css"), path.join(outdir, "styles.css"));
}

/**
 * The package pins the fleuron the bundle is built against, and the
 * module writes the wire version the bundle reads.
 */
export async function checkEngine(module, pkg = packageFile) {
  const { dependencies } = JSON.parse(await readFile(pkg, "utf8"));
  const pinned = dependencies?.fleuron;
  if (pinned !== VERSION) {
    throw new Error(
      `${path.basename(pkg)} pins fleuron ${String(pinned)}; ` +
        `the bundle is built against fleuron ${VERSION}`,
    );
  }

  initSync({ module: await readFile(module) });
  const wire = wireVersion();
  if (wire !== WIRE_VERSION) {
    throw new Error(
      `${path.basename(module)} is wire ${wire}; fleuron ${VERSION} ` +
        `reads wire ${WIRE_VERSION}`,
    );
  }
}
