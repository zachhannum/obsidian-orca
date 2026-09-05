/**
 * The run, as a table on the job's summary page. GitHub renders
 * whatever a job appends to the file `GITHUB_STEP_SUMMARY` names, and
 * off a runner there is no file, so nothing is written.
 */

import { appendFileSync } from "node:fs";
import process from "node:process";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
} from "@playwright/test/reporter";
import { OBSIDIAN } from "./launch";

/** How much of a failure's message goes in a summary. */
const QUOTED = 2000;

const MARK: Record<string, string> = {
  expected: "✓",
  unexpected: "✗",
  flaky: "!",
  skipped: "-",
};

export default class Summary implements Reporter {
  private root: Suite | undefined;

  onBegin(_config: FullConfig, root: Suite): void {
    this.root = root;
  }

  onEnd(result: FullResult): void {
    const out = process.env["GITHUB_STEP_SUMMARY"];
    if (out === undefined || this.root === undefined) return;
    appendFileSync(out, markdown(this.root.allTests(), result));
  }
}

function markdown(tests: TestCase[], result: FullResult): string {
  const counted = (of: string): number =>
    tests.filter((test) => test.outcome() === of).length;
  const failed = counted("unexpected");
  const flaky = counted("flaky");
  const lines = [
    `## e2e on Obsidian ${OBSIDIAN}`,
    "",
    [
      `${counted("expected")} passed`,
      ...(flaky > 0 ? [`${flaky} flaky`] : []),
      ...(failed > 0 ? [`${failed} failed`] : []),
    ].join(", ") + ` in ${seconds(result.duration)}`,
    "",
    "| | spec | tries | time |",
    "| --- | --- | --- | --- |",
  ];

  for (const test of tests) {
    const tries = test.results.length;
    const ms = test.results.reduce((sum, run) => sum + run.duration, 0);
    const mark = MARK[test.outcome()] ?? "?";
    lines.push(`| ${mark} | ${test.title} | ${tries} | ${seconds(ms)} |`);
  }

  for (const test of tests) {
    if (test.outcome() === "expected" || test.outcome() === "skipped") continue;
    const said = test.results.at(-1)?.error?.message ?? "";
    lines.push("", `### ${test.title}`, "", "```", quote(said), "```");
  }

  return `${lines.join("\n")}\n`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/** The error's message, without the colours it was printed in. */
function quote(message: string): string {
  const said = message.replace(/\u001b\[\d+m/g, "").replaceAll("```", "'''");
  return said.length > QUOTED ? `${said.slice(0, QUOTED)}\n...` : said;
}
