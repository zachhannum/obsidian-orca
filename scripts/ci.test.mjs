import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { root } from "./bundle.mjs";

const read = (file) => readFile(path.join(root, file), "utf8");

const [pkg, shotsRunner, workflow, shots, setup, release, cut, spec, claude] = await Promise.all([
  read("package.json"),
  read("scripts/shots.mjs"),
  read(".github/workflows/ci.yml"),
  read(".github/workflows/shots.yml"),
  read(".github/actions/obsidian-setup/action.yml"),
  read(".github/workflows/release.yml"),
  read(".github/workflows/cut-release.yml"),
  read("e2e-tests/shots.spec.ts"),
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
  assert.match(checks, /apt-get install -y qpdf poppler-utils\n/);
  assert.match(checks, /- run: npm test\n/);
  assert.match(checks, /- run: npm run build\n/);
  assert.match(workflow, /^on:\n {2}pull_request:\n {2}push:\n/m);
});

test("the `checks` job uploads the plugin files as the `plugin` artifact", () => {
  const checks = job("checks");

  assert.match(
    checks,
    /uses: actions\/upload-artifact@v4\n\s+with:\n\s+name: plugin\n\s+path: \|\n\s+main\.js\n\s+manifest\.json\n\s+styles\.css\n/,
  );
  // The artifact is built after the bundle, not before it.
  assert.ok(checks.indexOf("- run: npm run build\n") < checks.indexOf("name: plugin\n"));
});

test("the e2e job runs as four shards on a platform, each on a runner of its own", () => {
  const e2e = job("e2e");

  assert.match(e2e, /shard: \[1, 2, 3, 4\]\n/);
  assert.match(e2e, /run: xvfb-run -a npm run e2e -- --shard=\$\{\{ matrix\.shard \}\}\/4\n/);
  assert.match(e2e, /run: npm run e2e -- --shard=\$\{\{ matrix\.shard \}\}\/4\n/);
});

test("the checks main requires report, and pass only when every shard of their platform passed", () => {
  const all = job("e2e-all");

  // The names the ruleset holds, which a shard's name no longer is.
  assert.match(all, /name: e2e on \$\{\{ matrix\.os \}\}\n/);
  assert.match(all, /os: \[ubuntu-latest, macos-latest\]\n/);
  assert.match(job("e2e"), /name: e2e on \$\{\{ matrix\.os \}\} \(\$\{\{ matrix\.shard \}\}\/4\)\n/);
  // A failed shard skips a job that needs it, and a skipped check passes.
  assert.match(all, /needs: e2e\n\s+if: \$\{\{ !cancelled\(\) \}\}\n/);
  assert.match(all, /SHARD: "e2e on \$\{\{ matrix\.os \}\} \("\n/);
  assert.match(all, /\[ "\$passed" = "\$SHARDS" \]\n/);
});

test("only a push to main runs the suite on macOS, and a PR's macOS check passes with no shard", () => {
  assert.ok(
    job("e2e").includes(
      `os: \${{ fromJSON(github.event_name == 'push' && '["ubuntu-latest", "macos-latest"]' || '["ubuntu-latest"]') }}\n`,
    ),
  );
  assert.ok(
    job("e2e-all").includes(
      "SHARDS: ${{ (matrix.os == 'ubuntu-latest' || github.event_name == 'push') && 4 || 0 }}\n",
    ),
  );
  // The workflow's only push is a push to main.
  assert.match(workflow, /^ {2}push:\n {4}branches: \[main\]\n/m);
});

test("each shard keeps its own report and writes its own summary", async () => {
  assert.match(job("e2e"), /name: e2e-report-\$\{\{ matrix\.os \}\}-\$\{\{ matrix\.shard \}\}\n/);
  assert.match(await read("playwright.config.ts"), /\["\.\/e2e-tests\/harness\/report\.ts"\]/);
});

test("`npm run e2e` is one run on one Obsidian", async () => {
  assert.match(pkg, /"e2e": "playwright test --project=orca"/);
  assert.match(await read("playwright.config.ts"), /workers: 1,\n/);
});

test("a PR that changes a surface or the tokens takes the site's pictures", () => {
  for (const on of ["pull_request", "push"]) {
    const from = shots.indexOf(`  ${on}:`);
    assert.notEqual(from, -1, `the spec does not run on ${on}`);
    const block = shots.slice(from, shots.indexOf("\nconcurrency:"));
    for (const at of ["src/**", "docs/src/styles/tokens.css", "e2e-tests/**"]) {
      assert.ok(block.includes(`"${at}"`), `${on} does not watch ${at}`);
    }
  }
  assert.match(shots, /- run: npm run shots\n/);
  assert.match(setup, /apt-get install -y xvfb poppler-utils\n/);
});

test("the spec, the frames and the loop run as jobs that start together", () => {
  const block = (name) => {
    const from = shots.indexOf(`\n  ${name}:\n`);
    assert.notEqual(from, -1, `no ${name} job`);
    const next = /\n {2}\w[\w-]*:\n/.exec(shots.slice(from + 1));
    return shots.slice(from, next === null ? undefined : from + 1 + next.index);
  };
  assert.doesNotMatch(block("spec"), /needs:/);
  assert.doesNotMatch(block("frames"), /needs:/);
  // The render reads the frames, so it waits for them and for nothing else.
  assert.match(block("loop"), /needs: frames\n/);
  assert.match(block("shots"), /needs: \[spec, loop\]\n/);
});

test("the screenshot spec runs in shards, each with an Obsidian and a display of its own", () => {
  assert.match(pkg, /"shots": "node scripts\/shots\.mjs"/);
  assert.match(shotsRunner, /--shard=\$\{at \+ 1\}\/\$\{shards\}/);
  assert.match(shotsRunner, /\["-a", "npx", \.\.\.playwright\]/);
});

test("the shots job renders the landing page's loop from a pinned commit of orca-film", () => {
  assert.match(shots, /ORCA_FILM_REF: [0-9a-f]{40}\n/);
  assert.match(shots, /repository: zachhannum\/orca-film\n\s+ref: \$\{\{ env\.ORCA_FILM_REF \}\}/);
  assert.match(shots, /run: xvfb-run -a npm run film\n/);
});

test("only a push to main renders the loop, and a pull request takes its posters", () => {
  const from = shots.indexOf("      - name: render the loop");
  assert.notEqual(from, -1, "nothing renders the loop");
  const step = shots.slice(from, shots.indexOf("\n      - ", from + 1));
  assert.match(
    step,
    /if \[ "\$GITHUB_REF" = refs\/heads\/main \] && \[ "\$GITHUB_EVENT_NAME" = push \]; then\n\s+node loop\.mjs --into \.\.\/docs\/src\/shots\n\s+else\n\s+node loop\.mjs --posters --into \.\.\/docs\/src\/shots\n/,
  );
});

test("a push to main that changes a picture opens a PR with the new pictures", () => {
  const from = shots.indexOf("      - name: open a pull request");
  assert.notEqual(from, -1, "nothing opens a pull request");
  const step = shots.slice(from);

  assert.match(step, /if: github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'/);
  assert.match(step, /git status --porcelain docs\/src\/shots/);
  assert.match(step, /gh pr create --base main/);
  // The pictures reach main through review like anything else.
  assert.doesNotMatch(step, /git push origin (main|HEAD)/);
});

test("a version tag attaches the plugin to the release", () => {
  assert.match(release, /^on:\n {2}push:\n {4}tags: \["\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"\]\n/m);
  assert.match(release, /- run: npm run build\n/);
  assert.match(
    release,
    /gh release upload "\$TAG" main\.js manifest\.json styles\.css --clobber/,
  );
  for (const file of ["manifest.json", "package.json"]) {
    assert.ok(release.includes(file), `the tag is not checked against ${file}`);
  }
});

test("a cut release pushes its version commit and tag as the release app", () => {
  assert.match(cut, /^on:\n {2}workflow_dispatch:\n/m);
  assert.match(cut, /uses: actions\/create-github-app-token@v3/);
  assert.match(cut, /token: \$\{\{ steps\.app\.outputs\.token \}\}/);
  // The branch goes up before the tag, so no tag points at a commit
  // that main never took.
  assert.ok(cut.indexOf('git push origin "HEAD:') < cut.indexOf('git push origin "$version"'));
});

test("`npm version` bumps the manifest and writes a tag with no `v`", async () => {
  const [pkg, npmrc] = await Promise.all([read("package.json"), read(".npmrc")]);
  assert.equal(JSON.parse(pkg).scripts.version, "node version-bump.mjs");
  assert.match(npmrc, /^tag-version-prefix=""$/m);
});

test("the screenshot spec ends on what it does not cover", () => {
  const note = spec
    .trimEnd()
    .split("\n")
    .reduceRight((kept, line) => (line.startsWith("//") ? [line, ...kept] : kept), []);
  assert.ok(note.length > 0, "the spec ends on no note");
  assert.match(note.join("\n"), /does not cover/i);
});

test("CLAUDE.md's CI section lists the shots and release workflows", () => {
  const section = claude.slice(
    claude.indexOf("## CI scaffolding"),
    claude.indexOf("## Documentation rules"),
  );
  assert.match(section, /shots\.yml/);
  assert.match(section, /release\.yml/);
});

// What this tier does not cover: whether the runner has what a job
// needs, which only a run on GitHub shows, and whether a picture the
// spec takes looks right, which a person reviewing it answers.
