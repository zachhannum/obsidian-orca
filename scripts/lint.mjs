/**
 * The dependency rule and the conventions around it, checked over
 * `src`. A violation names the file, the line and the rule.
 */

import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { root } from "./bundle.mjs";

/** The five modules, in the order the module map lists them. */
export const MODULES = ["engine", "book", "style", "assets", "ui"];

/** The packages only `ui` may reach. */
const APPLICATION = ["obsidian", "electron"];

const RULES = [
  /**
   * The pipeline runs one way and `ui` sits at its end: `ui` imports
   * the rest, and nothing imports `ui`.
   */
  ({ module, imported }) =>
    imported === "ui" && module !== "ui" && module !== undefined
      ? `\`${module}\` may not import \`ui\``
      : undefined,

  /** Only `ui` knows about Obsidian. */
  ({ module, specifier }) =>
    APPLICATION.includes(specifier) && module !== "ui"
      ? `\`${module ?? "src"}\` may not import \`${specifier}\``
      : undefined,

  /** Imports inside `src` use the `@/` alias. */
  ({ specifier }) =>
    specifier.startsWith(".")
      ? `\`${specifier}\` is a relative import; use \`@/\``
      : undefined,
];

/**
 * Every rule, over one file's imports and, for a test, the note it
 * ends on.
 */
export function check(file, text) {
  const found = [];
  const module = moduleOf(file);
  for (const { specifier, line } of imports(text)) {
    const imported = moduleOf(specifier.startsWith("@/") ? specifier.slice(2) : "");
    for (const rule of RULES) {
      const said = rule({ module, imported, specifier });
      if (said !== undefined) found.push({ file, line, said });
    }
  }
  if (file.endsWith(".test.ts") && backlog(text) === undefined) {
    found.push({
      file,
      line: text.split("\n").length,
      said: "a test file ends on what it does not cover",
    });
  }
  return found;
}

/** Every file under `src`, in path order. */
export async function lint(from = root) {
  const files = [];
  for await (const file of glob("src/**/*.ts", { cwd: from })) files.push(file);
  files.sort();

  const found = [];
  for (const file of files) {
    found.push(...check(file, await readFile(path.join(from, file), "utf8")));
  }
  return found;
}

/** The first path segment, where it is one of the five modules. */
function moduleOf(file) {
  const first = file.replace(/^src\//, "").split("/")[0];
  return MODULES.includes(first) ? first : undefined;
}

/**
 * Every import specifier, with the line it is on. Comments are blanked
 * first, so an import written inside one is not read as code.
 */
function imports(text) {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, (held) => held.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (held, before) => before);
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

/** The note a test file ends on: what the suite does not cover. */
function backlog(text) {
  const lines = text.split("\n");
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  const note = [];
  while (lines.length > 0 && lines.at(-1).startsWith("//")) note.unshift(lines.pop());
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
