import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { root } from "./bundle.mjs";

const read = (file) => readFile(path.join(root, file), "utf8");

const [workflow, shots, spec, claude] = await Promise.all([
  read(".github/workflows/ci.yml"),
  read(".github/workflows/shots.yml"),
  read("e2e/shots.spec.ts"),
  read("CLAUDE.md"),
]);

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
  assert.match(checks, /apt-get install -y qpdf\n/);
  assert.match(checks, /- run: npm test\n/);
  assert.match(checks, /- run: npm run build\n/);
  assert.match(workflow, /^on:\n {2}pull_request:\n {2}push:\n/m);
});

test("a PR that changes a surface or the tokens takes the site's pictures", () => {
  for (const on of ["pull_request", "push"]) {
    const from = shots.indexOf(`  ${on}:`);
    assert.notEqual(from, -1, `the spec does not run on ${on}`);
    const block = shots.slice(from, shots.indexOf("\nconcurrency:"));
    for (const at of ["src/**", "site/src/styles/tokens.css", "e2e/**"]) {
      assert.ok(block.includes(`"${at}"`), `${on} does not watch ${at}`);
    }
  }
  assert.match(shots, /- run: xvfb-run -a npm run shots\n/);
  assert.match(shots, /apt-get install -y xvfb poppler-utils\n/);
});

test("a push to main that changes a picture opens a PR with the new pictures", () => {
  const from = shots.indexOf("      - name: open a pull request");
  assert.notEqual(from, -1, "nothing opens a pull request");
  const step = shots.slice(from);

  assert.match(step, /if: github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/);
  assert.match(step, /git status --porcelain site\/src\/shots/);
  assert.match(step, /gh pr create --base main/);
  // The pictures reach main through review like anything else.
  assert.doesNotMatch(step, /git push origin (main|HEAD)/);
});

test("the screenshot spec ends on what it does not cover", () => {
  const note = spec
    .trimEnd()
    .split("\n")
    .reduceRight((kept, line) => (line.startsWith("//") ? [line, ...kept] : kept), []);
  assert.ok(note.length > 0, "the spec ends on no note");
  assert.match(note.join("\n"), /does not cover/i);
});

test("CLAUDE.md's CI section lists the shots workflow", () => {
  const section = claude.slice(
    claude.indexOf("## CI scaffolding"),
    claude.indexOf("## Documentation rules"),
  );
  assert.match(section, /shots\.yml/);
});

// What this tier does not cover: whether the runner has what a job
// needs, which only a run on GitHub shows, and whether a picture the
// spec takes looks right, which a person reviewing it answers.
