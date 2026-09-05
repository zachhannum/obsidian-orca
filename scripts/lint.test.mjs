import assert from "node:assert/strict";
import { test } from "node:test";
import { check, lint } from "./lint.mjs";

const said = (file, text) => check(file, text).map((found) => found.said);

test("the dependency rule runs one way: `ui` imports `book`, `book` does not import `ui`", () => {
  assert.deepEqual(
    said("src/book/note.ts", 'import { PREVIEW_VIEW } from "@/ui/preview";\n'),
    ["`book` may not import `ui`"],
  );
  assert.deepEqual(
    said("src/ui/preview.ts", 'import { SAMPLE } from "@/book/sample";\n'),
    [],
  );
});

test("only `ui` imports Obsidian", () => {
  assert.deepEqual(
    said("src/assets/vault.ts", 'import { Plugin } from "obsidian";\n'),
    ["`assets` may not import `obsidian`"],
  );
  assert.deepEqual(
    said("src/ui/plugin.ts", 'import { Plugin } from "obsidian";\n'),
    [],
  );
});

test("only `ui` draws", () => {
  assert.deepEqual(
    said("src/book/order.ts", 'import { useState } from "react";\n'),
    ["`book` may not import `react`"],
  );
  assert.deepEqual(
    said(
      "src/style/css.ts",
      'import { useSortable } from "@dnd-kit/sortable";\n',
    ),
    ["`style` may not import `@dnd-kit/sortable`"],
  );
  assert.deepEqual(
    said("src/ui/navigator.tsx", 'import { useState } from "react";\n'),
    [],
  );
});

test("imports inside `src` use the `@/` alias", () => {
  assert.deepEqual(
    said("src/book/sample.ts", 'import { note } from "./note";\n'),
    ["`./note` is a relative import; use `@/`"],
  );
});

test("an import inside a comment or a url is not an import", () => {
  assert.deepEqual(
    said(
      "src/book/note.ts",
      '// import { view } from "@/ui/preview";\nconst at = "https://example.test//x";\n',
    ),
    [],
  );
});

test("a doc comment opens with a name, not a question word", () => {
  assert.deepEqual(
    said(
      "src/ui/make.ts",
      '/** What a new chapter is called before the author names it. */\nexport const CHAPTER = "New chapter";\n',
    ),
    ["a doc comment opens with a question word; name the thing"],
  );
  assert.deepEqual(
    said(
      "src/ui/make.ts",
      "/**\n * How a leaf is put on a view.\n */\ntype SetViewState = () => void;\n",
    ),
    ["a doc comment opens with a question word; name the thing"],
  );
  assert.deepEqual(
    said(
      "src/ui/make.ts",
      '/** The default chapter name. */\nexport const CHAPTER = "New chapter";\n',
    ),
    [],
  );
  assert.deepEqual(
    said(
      "src/ui/shelf.ts",
      "/** Whether the row has a note. */\nkind: string;\n",
    ),
    [],
  );
});

test("a test file missing the note on what it does not cover is a violation", () => {
  assert.deepEqual(said("src/book/note.test.ts", 'import "@/book/note";\n'), [
    "a test file ends on what it does not cover",
  ]);
  assert.deepEqual(
    said(
      "src/book/note.test.ts",
      'import "@/book/note";\n\n// What this tier does not cover: the vault.\n',
    ),
    [],
  );
});

test("the repository answers the lint pass", async () => {
  assert.deepEqual(await lint(), []);
});

// What this tier does not cover: the type check and the production
// bundle, which the same CI job runs.
