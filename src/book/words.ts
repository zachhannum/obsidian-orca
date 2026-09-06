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

/** Counts the words in a note's body. Its properties are not counted. */
export function countWords(text: string): number {
  const { body } = readFrontmatter(text);
  return body.match(WORD)?.length ?? 0;
}
