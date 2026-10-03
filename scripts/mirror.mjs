// Runs the CI mirror and records the commit it passed on, so the push
// gate can tell a green commit from an unchecked one.
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

const withE2e = process.argv.includes("--e2e");
const steps = [
  ["npm", ["run", "build"]],
  ["npm", ["run", "lint"]],
  ["npm", ["test"]],
  ...(withE2e ? [["npm", ["run", "e2e"]]] : []),
];

if (git("status", "--porcelain") !== "") {
  console.error("mirror: commit your changes first, the mirror records a commit.");
  process.exit(1);
}

for (const [command, args] of steps) {
  console.log(`mirror: ${command} ${args.join(" ")}`);
  const ran = spawnSync(command, args, { stdio: "inherit" });
  if (ran.status !== 0) {
    console.error(`mirror: ${args.join(" ")} failed, so nothing is recorded.`);
    process.exit(ran.status ?? 1);
  }
}

writeFileSync(
  git("rev-parse", "--git-path", "orca-mirror"),
  JSON.stringify({ head: git("rev-parse", "HEAD"), e2e: withE2e }),
);
console.log("mirror: green.");
