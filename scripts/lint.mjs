/**
 * The dependency rule and the conventions around it, checked over
 * `src`. The doc comment rule also runs over `e2e` and `scripts`, and
 * the clock rule over the specs. A violation names the file, the line
 * and the rule.
 */

import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { root } from "./bundle.mjs";

/** The five modules, in the order the module map lists them. */
export const MODULES = ["engine", "book", "style", "assets", "ui"];

/** The packages only `ui` may reach. */
const APPLICATION = ["obsidian", "electron"];

/** The packages only `ui` may reach, by the prefix their subpaths share. */
const APPLICATION_SCOPES = ["react", "react-dom", "@dnd-kit", "@codemirror"];

/**
 * The openers that describe a thing by its role instead of naming it.
 * STYLE.md's "Code comments" section holds the rule.
 */
const PUZZLE = /^(What|How|Which|Where|Who|The way)\b/;

/**
 * The waits a spec may not take. The preview carries the generation it
 * painted and what that render cost, and an assertion waits on those.
 */
const CLOCKS = [
  [/\bwaitForTimeout\b/, "`waitForTimeout`"],
  [/\bsetTimeout\b/, "`setTimeout`"],
  [/\btimeout\s*:/, "a `timeout`"],
];

const RULES = [
  /**
   * The pipeline runs one way and `ui` is at its end: `ui` imports the
   * rest, and nothing imports `ui`.
   */
  ({ module, imported }) =>
    imported === "ui" && module !== "ui" && module !== undefined
      ? `\`${module}\` may not import \`ui\``
      : undefined,

  /** Only `ui` knows about Obsidian, and only `ui` draws. */
  ({ module, specifier }) =>
    application(specifier) && module !== "ui"
      ? `\`${module ?? "src"}\` may not import \`${specifier}\``
      : undefined,

  /** Imports inside `src` use the `@/` alias. */
  ({ specifier }) =>
    specifier.startsWith(".")
      ? `\`${specifier}\` is a relative import; use \`@/\``
      : undefined,
];

/**
 * Every rule, run over one file's imports, its doc comments and, for a
 * test file, the note it ends on.
 */
export function check(file, text) {
  const found = [];
  const module = moduleOf(file);
  for (const { specifier, line } of imports(text)) {
    const imported = moduleOf(
      specifier.startsWith("@/") ? specifier.slice(2) : "",
    );
    for (const rule of RULES) {
      const said = rule({ module, imported, specifier });
      if (said !== undefined) found.push({ file, line, said });
    }
  }
  found.push(...checkDocs(file, text));
  if (/\.test\.tsx?$/.test(file) && backlog(text) === undefined) {
    found.push({
      file,
      line: text.split("\n").length,
      said: "a test file ends on what it does not cover",
    });
  }
  return found;
}

/** The doc comment rule, run over one file. */
export function checkDocs(file, text) {
  const found = [];
  for (const { first, line } of docs(text)) {
    if (PUZZLE.test(first)) {
      found.push({
        file,
        line,
        said: "a doc comment opens with a question word; name the thing",
      });
    }
  }
  return found;
}

/** The clock rule, run over one spec. */
export function checkClock(file, text) {
  const found = [];
  blanked(text)
    .split("\n")
    .forEach((line, at) => {
      for (const [pattern, named] of CLOCKS) {
        if (!pattern.test(line)) continue;
        found.push({
          file,
          line: at + 1,
          said: `${named} is a clock; wait on what the pane painted`,
        });
      }
    });
  return found;
}

/**
 * Every file under `src` checked in path order, then every file under
 * `e2e` and `scripts` checked against the doc comment rule, then every
 * spec against the clock rule.
 */
export async function lint(from = root) {
  const found = [];
  for (const [pattern, rule] of [
    ["src/**/*.{ts,tsx}", check],
    ["{e2e,scripts}/**/*.{ts,tsx,mjs}", checkDocs],
    ["e2e/**/*.spec.ts", checkClock],
  ]) {
    const files = [];
    for await (const file of glob(pattern, { cwd: from })) files.push(file);
    files.sort();
    for (const file of files) {
      found.push(...rule(file, await readFile(path.join(from, file), "utf8")));
    }
  }
  return found;
}

/** Whether a specifier is one of the packages only `ui` may reach. */
function application(specifier) {
  return (
    APPLICATION.includes(specifier) ||
    APPLICATION_SCOPES.some(
      (scope) => specifier === scope || specifier.startsWith(`${scope}/`),
    )
  );
}

/** The first path segment, where it is one of the five modules. */
function moduleOf(file) {
  const first = file.replace(/^src\//, "").split("/")[0];
  return MODULES.includes(first) ? first : undefined;
}

/**
 * The file with its comments blanked, line for line, so a rule reads the
 * code and never a comment about it.
 */
function blanked(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, before) => before);
}

/**
 * Every import specifier, with the line it is on. Comments are blanked
 * first, so an import written inside one is not read as code.
 */
function imports(text) {
  const code = blanked(text);
  const found = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      found.push({
        specifier: match[1],
        line: code.slice(0, match.index).split("\n").length,
      });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * Every doc comment's first line, with the line the comment starts on.
 * A comment opens at the start of a line, so a `/**` inside a string
 * or a glob is not one.
 */
function docs(text) {
  const found = [];
  for (const match of text.matchAll(/^[ \t]*\/\*\*([\s\S]*?)\*\//gm)) {
    const first = match[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\*?\s?/, ""))
      .find((line) => line.trim() !== "");
    if (first === undefined) continue;
    found.push({
      first: first.trim(),
      line: text.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

/** The note a test file ends on: what the suite does not cover. */
function backlog(text) {
  const lines = text.split("\n");
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  const note = [];
  while (lines.length > 0 && lines.at(-1).startsWith("//"))
    note.unshift(lines.pop());
  const said = note.join("\n");
  return /does not/i.test(said) ? said : undefined;
}

if (import.meta.filename === process.argv[1]) {
  const found = await lint();
  for (const { file, line, said } of found) {
    process.stderr.write(`${file}:${line}  ${said}\n`);
  }
  process.stderr.write(
    found.length === 0 ? "lint: clean\n" : `lint: ${found.length} violations\n`,
  );
  process.exit(found.length === 0 ? 0 : 1);
}
