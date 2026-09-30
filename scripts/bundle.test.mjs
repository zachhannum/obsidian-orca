import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";
import { noScriptElements, options, root } from "./bundle.mjs";

test("the editor is CodeMirror as Obsidian ships it, and only the CSS grammar is bundled", async () => {
  const outdir = await mkdtemp(path.join(tmpdir(), "orca-bundle-"));
  try {
    const { metafile } = await esbuild.build({
      ...options({ production: true, outdir }),
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(metafile.inputs);
    const bundled = (name) =>
      inputs.some((input) => input.includes(`node_modules/${name}/`));

    for (const shipped of [
      "@codemirror/state",
      "@codemirror/view",
      "@codemirror/language",
      "@codemirror/commands",
      "@codemirror/autocomplete",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
    ]) {
      assert.equal(bundled(shipped), false, shipped);
    }
    assert.equal(bundled("@codemirror/lang-css"), true);
    assert.equal(bundled("@lezer/css"), true);
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});

test("the shipped bundle makes no script element, and a build that makes one fails", async () => {
  const outdir = await mkdtemp(path.join(tmpdir(), "orca-bundle-"));
  try {
    const shipped = await esbuild.build({
      ...options({ production: true, outdir }),
      write: false,
      logLevel: "silent",
    });
    assert.deepEqual(shipped.errors, []);

    await assert.rejects(
      esbuild.build({
        stdin: { contents: 'document.createElement("script");' },
        outfile: path.join(outdir, "main.js"),
        bundle: true,
        minify: true,
        write: false,
        logLevel: "silent",
        plugins: [noScriptElements()],
      }),
      /creates a script element/,
    );
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});

test("the shipped bundle loads where the app has no Node or Electron", async () => {
  const outdir = await mkdtemp(path.join(tmpdir(), "orca-bundle-"));
  try {
    const built = await esbuild.build({
      ...options({ production: true, outdir }),
      write: false,
      logLevel: "silent",
    });
    const main = built.outputFiles.find((file) => path.basename(file.path) === "main.js");
    assert.ok(main);

    // Obsidian mobile's `require` hands over Obsidian and the CodeMirror
    // it ships, and throws for the rest.
    const shipped = createRequire(path.join(root, "package.json"));
    const obsidian = new Proxy(function () {}, {
      get: (_, key) => (key === "__esModule" ? false : obsidian),
      apply: () => obsidian,
      construct: () => obsidian,
    });
    const refused = [];
    const require = (id) => {
      if (id === "electron" || builtinModules.includes(id.replace(/^node:/, ""))) {
        refused.push(id);
        throw new Error(`Cannot find module '${id}'`);
      }
      return id === "obsidian" ? obsidian : shipped(id);
    };
    const module = { exports: {} };
    const load = vm.runInThisContext(`(function (module, exports, require) {${main.text}\n})`);
    load(module, module.exports, require);

    assert.deepEqual(refused, []);
    assert.equal(typeof module.exports.default, "function");
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});

// What this tier does not cover: the plugin's `onload` on a real
// mobile device, and whether the Obsidian version the e2e suite pins
// still ships each of these packages, which only a run in the app
// shows.
