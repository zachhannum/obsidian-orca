import esbuild from "esbuild";
import builtins from "builtin-modules";
import process from "node:process";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  target: "es2022",
  platform: "browser",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  external: [
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
  ],
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
