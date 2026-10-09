/**
 * The word count of a note, which the book page reports beside each
 * entry and sums for the book.
 */

import { readFrontmatter } from "@/book/frontmatter";

/**
 * A word is a run of letters and digits, joined across an apostrophe
 * or a hyphen. Punctuation and markdown marks are not words, and a
 * dash with no space around it ends one.
 */
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** An embedded file, which puts an image on the page and no words. */
const EMBED = /!\[\[[^\]]*\]\]/g;

/** The destination of a markdown link, which the page does not print. */
const DESTINATION = /\]\([^)\s]*(?:\s+"[^"]*")?\)/g;

/** An Obsidian comment, which the page does not print. */
const COMMENT = /%%[^]*?%%/g;

/** The name a link reaches a block by, written at the end of the block. */
const BLOCK_ID = /(^|[ \t])\^[A-Za-z0-9-]+[ \t]*$/gm;

/** The marker a callout opens on, which gives its type and prints nothing. */
const CALLOUT = /^([ \t]*>[ \t]*)\[![^\]\n]*\][+-]?(?=[ \t]|$)/gm;

/**
 * Counts the words in a note's body. Its properties, its embeds, its
 * comments and where its links go are not counted. A code block is,
 * since its text is set on the page.
 */
export function countWords(text: string): number {
  const { body } = readFrontmatter(text);
  const printed = body
    .replace(COMMENT, " ")
    .replace(EMBED, " ")
    .replace(DESTINATION, "]")
    .replace(BLOCK_ID, "$1")
    .replace(CALLOUT, "$1");
  return printed.match(WORD)?.length ?? 0;
}
