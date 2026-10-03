// Runs the CI mirror and records the commit it passed on, so the push
// gate can tell a green commit from an unchecked one.
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

const say = (stream, line) => stream.write(`mirror: ${line}\n`);

const withE2e = process.argv.includes("--e2e");
const steps = [
  ["npm", ["run", "build"]],
  ["npm", ["run", "lint"]],
  ["npm", ["test"]],
  ...(withE2e ? [["npm", ["run", "e2e"]]] : []),
];

if (git("status", "--porcelain") !== "") {
  say(process.stderr, "commit your changes first, the mirror records a commit.");
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
  git("rev-parse", "--git-path", "orca-mirror"),
  JSON.stringify({ head: git("rev-parse", "HEAD"), e2e: withE2e }),
);
say(process.stdout, "green.");
