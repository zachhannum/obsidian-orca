import esbuild from "esbuild";
import process from "node:process";
import {
  checkEngine,
  copyPlugin,
  engineModule,
  manifestFile,
  options,
  packageFile,
  root,
} from "./scripts/bundle.mjs";

const args = process.argv.slice(2);
const production = args.includes("production");
const flag = (name, fallback) => {
  const prefix = `--${name}=`;
  const given = args.find((a) => a.startsWith(prefix));
  return given === undefined ? fallback : given.slice(prefix.length);
};
const outdir = flag("out", root);

const manifest = flag("manifest", manifestFile);
await checkEngine(engineModule, flag("package", packageFile));
await copyPlugin(outdir, manifest);

const context = await esbuild.context(options({ production, outdir }));

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
