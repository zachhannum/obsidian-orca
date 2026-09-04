/**
 * The Node tier, as a table on the job's summary page. GitHub renders
 * whatever a job appends to the file `GITHUB_STEP_SUMMARY` names, and
 * off a runner there is no file, so nothing is written.
 */

import { appendFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { root } from "./bundle.mjs";

/** How much of a failure's message a summary carries. */
const QUOTED = 2000;

export default async function* summary(events) {
  const files = new Map();
  const failures = [];

  for await (const event of events) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const { name, file, details } = event.data;
    if (details?.type === "suite") continue;

    const at = source(file);
    const held = files.get(at) ?? { tests: 0, failed: 0, ms: 0 };
    held.tests += 1;
    held.ms += details?.duration_ms ?? 0;
    if (event.type === "test:fail") {
      held.failed += 1;
      failures.push({ at, name, message: details?.error?.message ?? "" });
    }
    files.set(at, held);
  }

  const out = process.env["GITHUB_STEP_SUMMARY"];
  if (out !== undefined) appendFileSync(out, markdown(files, failures));
}

/**
 * The test as it is written. Source maps are on, so an event usually
 * names the source already; one that names the bundle is mapped back.
 */
function source(file) {
  if (file === undefined) return "the run";
  const built = path.join(root, "build/test");
  const under = path.relative(built, file);
  return under.startsWith("..")
    ? path.relative(root, file)
    : path.join("src", under.replace(/\.js$/, ".ts"));
}

function markdown(files, failures) {
  const passed = total(files, (held) => held.tests - held.failed);
  const failed = total(files, (held) => held.failed);
  const lines = [
    "## Node tier",
    "",
    `${passed} passed` + (failed > 0 ? `, ${failed} failed` : ""),
    "",
    "| | file | tests | time |",
    "| --- | --- | --- | --- |",
  ];
  for (const [at, held] of [...files].sort()) {
    const mark = held.failed > 0 ? "✗" : "✓";
    lines.push(`| ${mark} | \`${at}\` | ${held.tests} | ${seconds(held.ms)} |`);
  }
  for (const { at, name, message } of failures) {
    lines.push("", `### \`${at}\` › ${name}`, "", "```", quote(message), "```");
  }
  return `${lines.join("\n")}\n`;
}

function total(files, of) {
  return [...files.values()].reduce((sum, held) => sum + of(held), 0);
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function quote(message) {
  const said = message.replaceAll("```", "'''");
  return said.length > QUOTED ? `${said.slice(0, QUOTED)}\n...` : said;
}
