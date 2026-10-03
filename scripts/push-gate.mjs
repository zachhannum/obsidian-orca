// A PreToolUse hook. It stops `git push` and `gh pr create` until the
// CI mirror has passed on the commit being sent.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SENDS = /\bgit\s+push\b|\bgh\s+pr\s+create\b/;
const SURFACE = /^(src\/ui\/|e2e\/|fixture\/|styles\.css$)/;

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

const { tool_input: input } = JSON.parse(readFileSync(0, "utf8"));
if (!SENDS.test(input?.command ?? "")) process.exit(0);

const refuse = (why) => {
  console.error(
    `push gate: ${why} Run \`node scripts/mirror.mjs\` (add \`--e2e\` for a surface change) and fix what fails. ` +
      "If the environment will not run it, fix the environment or stop and ask the user. Do not push around the gate.",
  );
  process.exit(2);
};

let marker;
try {
  marker = JSON.parse(readFileSync(git("rev-parse", "--git-path", "orca-mirror"), "utf8"));
} catch {
  refuse("the mirror has not passed on this checkout.");
}
if (marker.head !== git("rev-parse", "HEAD")) {
  refuse("the mirror passed on an older commit than HEAD.");
}
if (git("status", "--porcelain") !== "") {
  refuse("the working tree has uncommitted changes.");
}
const base = git("merge-base", "HEAD", "origin/main");
const touched = git("diff", "--name-only", `${base}..HEAD`).split("\n");
if (touched.some((file) => SURFACE.test(file)) && !marker.e2e) {
  refuse("this change touches a surface, so the mirror needs the e2e run.");
}
