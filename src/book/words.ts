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

/**
 * Counts the words in a note's body. Its properties and its embeds are
 * not counted; a code block is, since its text is set on the page.
 */
export function countWords(text: string): number {
  const { body } = readFrontmatter(text);
  return body.replace(EMBED, " ").match(WORD)?.length ?? 0;
}
