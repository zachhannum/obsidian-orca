import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { root } from "./bundle.mjs";

const workflow = await readFile(
  path.join(root, ".github/workflows/ci.yml"),
  "utf8",
);

/** One job's block, from its name to the next job at the same indent. */
function job(name) {
  const from = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(from, -1, `no ${name} job`);
  const rest = workflow.slice(from + 1);
  const next = /\n {2}\w[\w-]*:\n/.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

test("the `checks` job runs the type check, the lint pass and the Node tier on every push", () => {
  const checks = job("checks");

  assert.match(checks, /- run: npm run typecheck\n/);
  assert.match(checks, /- run: npm run lint\n/);
  assert.match(checks, /- run: npm test\n/);
  assert.match(checks, /- run: npm run build\n/);
  assert.match(workflow, /^on:\n {2}pull_request:\n {2}push:\n/m);
});

// What this tier does not cover: whether the runner has what a job
// needs, which only a run on GitHub answers.
