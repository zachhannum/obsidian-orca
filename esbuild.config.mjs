import esbuild from "esbuild";
import process from "node:process";
import { copyModule, options, root } from "./scripts/bundle.mjs";

const args = process.argv.slice(2);
const production = args.includes("production");
const out = "--out=";
const outdir = args.find((a) => a.startsWith(out))?.slice(out.length) ?? root;

await copyModule(outdir);

const context = await esbuild.context(options({ production, outdir }));

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
