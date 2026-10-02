import assert from "node:assert/strict";
import { test } from "node:test";
import { folderOf } from "@/ui/kept";

test("a file in a folder names the folder, with its slash", () => {
  assert.equal(folderOf("Books/Pride and Prejudice.pdf"), "Books/");
  assert.equal(folderOf("Books/1813/Pride and Prejudice.pdf"), "Books/1813/");
});

test("a file at the top of the vault names no folder", () => {
  assert.equal(folderOf("Pride and Prejudice.pdf"), undefined);
  assert.equal(folderOf("/Pride and Prejudice.pdf"), undefined);
});

// What this suite does not cover: the line the dialog draws from the
// folder, which the e2e suite reads.
