// Takes the site's pictures in shards: each one is a Playwright run with an
// Obsidian of its own, so the spec's tests are spread over windows.
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import process from "node:process";
import { root } from "./bundle.mjs";

const shards = Number(process.env["ORCA_SHOTS_SHARDS"] ?? Math.min(3, availableParallelism()));

// Windows that share a display share focus, and a picture shows it. On a
// runner each shard gets a display of its own.
const display = process.platform === "linux" && process.env["CI"] !== undefined;

const runs = Array.from({ length: shards }, (_, at) => {
  const playwright = [
    "playwright",
    "test",
    "--project=shots",
    "--update-snapshots=changed",
    `--shard=${at + 1}/${shards}`,
    `--output=test-results/shots-${at + 1}`,
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
      PLAYWRIGHT_HTML_OUTPUT_DIR: `playwright-report/shots-${at + 1}`,
    },
  });
  return new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
});

const codes = await Promise.all(runs);
process.exit(codes.find((code) => code !== 0) ?? 0);
