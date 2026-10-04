// Runs the checks CI runs and records the commit they passed on, so the push
// gate can tell a green commit from an unchecked one.
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

const say = (stream, line) => stream.write(`preflight: ${line}\n`);

const withE2e = process.argv.includes("--e2e");
const steps = [
  ["npm", ["run", "build"]],
  ["npm", ["run", "lint"]],
  ["npm", ["test"]],
  ...(withE2e ? [["npm", ["run", "e2e"]]] : []),
];

if (git("status", "--porcelain") !== "") {
  say(process.stderr, "commit your changes first, the preflight records a commit.");
  process.exit(1);
}

for (const [command, args] of steps) {
  say(process.stdout, `${command} ${args.join(" ")}`);
  const ran = spawnSync(command, args, { stdio: "inherit" });
  if (ran.status !== 0) {
    say(process.stderr, `${args.join(" ")} failed, so nothing is recorded.`);
    process.exit(ran.status ?? 1);
  }
}

writeFileSync(
  git("rev-parse", "--git-path", "orca-preflight"),
  JSON.stringify({ head: git("rev-parse", "HEAD"), e2e: withE2e }),
);
say(process.stdout, "green.");
