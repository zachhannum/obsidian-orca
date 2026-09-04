import esbuild from "esbuild";
import process from "node:process";
import { copyModule, manifestFile, options, root } from "./scripts/bundle.mjs";

const args = process.argv.slice(2);
const production = args.includes("production");
const flag = (name, fallback) => {
  const prefix = `--${name}=`;
  const given = args.find((a) => a.startsWith(prefix));
  return given === undefined ? fallback : given.slice(prefix.length);
};
const outdir = flag("out", root);

await copyModule(outdir, flag("manifest", manifestFile));

const context = await esbuild.context(options({ production, outdir }));

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
