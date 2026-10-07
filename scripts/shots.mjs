// Takes the site's pictures in shards: each one is a Playwright run with an
// Obsidian of its own, so the spec's tests are spread over windows. The
// argument names the project: `shots`, which is the default, or `reel`.
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import process from "node:process";
import { root } from "./bundle.mjs";

const project = process.argv[2] ?? "shots";

// The shots are snapshots, which a run writes again where they changed.
// A reel's frames are plain files the spec writes itself.
const flags = { shots: ["--update-snapshots=changed"], reel: [] }[project];
if (flags === undefined) {
  console.error(`no project called ${project}; name shots or reel`);
  process.exit(1);
}

// A take is one spec file, and a shard with no file to run still opens
// an Obsidian.
const takes =
  project === "reel"
    ? (await readdir(path.join(root, "e2e/reel"))).filter((file) => file.endsWith(".spec.ts")).length
    : Infinity;

const shards = Math.min(
  takes,
  Number(process.env["ORCA_SHOTS_SHARDS"] ?? Math.min(3, availableParallelism())),
);

// Windows that share a display share focus, and a picture shows it. On a
// runner each shard gets a display of its own.
const display = process.platform === "linux" && process.env["CI"] !== undefined;

const runs = Array.from({ length: shards }, (_, at) => {
  const playwright = [
    "playwright",
    "test",
    `--project=${project}`,
    ...flags,
    `--shard=${at + 1}/${shards}`,
    `--output=test-results/${project}-${at + 1}`,
  ];
  const [command, args] = display
    ? ["xvfb-run", ["-a", "npx", ...playwright]]
    : ["npx", playwright];
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ORCA_E2E_DENSITY: "2",
      PLAYWRIGHT_HTML_OUTPUT_DIR: `playwright-report/${project}-${at + 1}`,
    },
  });
  return new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
});

const codes = await Promise.all(runs);
process.exit(codes.find((code) => code !== 0) ?? 0);
