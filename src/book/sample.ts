import type { Op, Source } from "fleuron";

/**
 * One note, standing in for a book in the vault. A book of one file
 * takes its title and author from the note's frontmatter.
 */
export const SAMPLE: Source = {
  name: "Chapter Twelve.md",
  text: `---
title: Pride and Prejudice
author: Jane Austen
---

# Chapter Twelve

In consequence of an agreement between the sisters, Elizabeth wrote the
next morning to their mother, to beg that the carriage might be sent for
them in the course of the day. But Mrs. Bennet, who had calculated on
her daughters remaining at Netherfield till the following Tuesday, which
would exactly finish Jane's week, could not bring herself to receive
them with pleasure before.

Her answer, therefore, was not propitious, at least not to Elizabeth's
wishes, for she was impatient to get home. Mrs. Bennet sent them word
that they could not possibly have the carriage before Tuesday; and in
her postscript it was added, that if Mr. Bingley and his sister pressed
them to stay longer, she could spare them very well.

Against staying longer, however, Elizabeth was positively resolved—nor
did she much expect it would be asked; and fearful, on the contrary, as
being considered as intruding themselves needlessly long, she urged Jane
to borrow Mr. Bingley's carriage immediately, and at length it was
settled that their original design of leaving Netherfield that morning
should be mentioned, and the request made.
`,
};

export function openBook(source: Source): Op[] {
  return [
    { op: "dialect", dialect: "obsidian" },
    { op: "markdown", name: source.name, text: source.text },
    // The session keeps every input between renders, style included, so
    // the sample resets it rather than inheriting a real book's.
    { op: "style", css: "" },
  ];
}
