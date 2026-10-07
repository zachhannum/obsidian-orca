import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { root } from "./bundle.mjs";

/**
 * The names the community directory's scanner skips, as its FAQ gives
 * them. The list is fixed, so a file the review should not read takes
 * one of these names.
 */
const SKIPPED = `
  node_modules, dist, build, pkg, test-vault, .pnpm-store, .obsidian,
  esbuild.config.mjs, version-bump.mjs, automation,
  *.test.*, *.tests.*, *.spec.*, *.specs.*,
  test, tests, __tests__, testUtils, e2e-tests, mocks, __mocks__,
  *.cjs, *.mjs, *.cts, *.mts, vite, scripts, docs,
  i18n, i18next, locale, locales, translations, l10n`
  .split(",")
  .map((name) => name.trim())
  .map((name) => new RegExp(`^${name.replace(/[.]/g, "\\.").replace(/\*/g, ".*")}$`));

/** The files outside the shipped source that the review may read. */
const ALLOWED = ["playwright.config.ts", "styles.css"];

const { stdout } = await promisify(execFile)("git", ["ls-files"], { cwd: root, maxBuffer: 1 << 26 });
const scanned = stdout
  .split("\n")
  .filter((file) => /\.(ts|tsx|js|jsx|css)$/.test(file))
  .filter((file) => !file.split("/").some((part) => SKIPPED.some((name) => name.test(part))));

test("the scanner reads no file outside `src` but the stylesheet and the Playwright config", () => {
  assert.deepEqual(
    scanned.filter((file) => !file.startsWith("src/")),
    ALLOWED,
  );
});

test("the scanner skips the docs site, the e2e suite and the design's sheets and scripts", () => {
  for (const folder of ["docs/", "e2e-tests/", "design/"]) {
    assert.deepEqual(scanned.filter((file) => file.startsWith(folder)), [], folder);
  }
  assert.ok(stdout.includes("design/chrome.spec.css\n"));
  assert.ok(stdout.includes("docs/src/content.config.ts\n"));
  assert.ok(stdout.includes("e2e-tests/harness/launch.ts\n"));
});

test("the scanner skips the Node vault adapter and the stylesheets the style tests read", () => {
  assert.ok(stdout.includes("src/assets/testUtils/directory.ts\n"));
  assert.ok(stdout.includes("src/style/subset.test.css\n"));
  assert.deepEqual(
    scanned.filter((file) => file.endsWith(".css")),
    ["styles.css"],
  );
  assert.deepEqual(
    scanned.filter((file) => file.includes("testUtils")),
    [],
  );
});

test("the push gate asks for the e2e run when a change touches the suite's folder", async () => {
  const gate = await readFile(path.join(root, "scripts/push-gate.mjs"), "utf8");
  const [, source] = /const SURFACE = \/(.+)\/;/.exec(gate) ?? [];
  assert.ok(source, "the gate names its surfaces");
  assert.ok(new RegExp(source).test("e2e-tests/harness/launch.ts"));
});

// What this tier does not cover: the scanner's own matching, which its
// FAQ gives as a list of names and no rule. A preview scan on the
// developer dashboard is what shows a nested folder is skipped.
