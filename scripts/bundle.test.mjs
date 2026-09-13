import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import esbuild from "esbuild";
import { options } from "./bundle.mjs";

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

// What this tier does not cover: whether the Obsidian version the e2e
// suite pins still ships each of these packages, which only a run in
// the app shows.
