/**
 * The markdown orca reads a note as, which is the markdown fleuron
 * reads a book's sources as.
 *
 * A mark is a rule about a block, so this parse has to agree with the
 * engine about where a block ends. What is configured here is the
 * block extensions fleuron turns on for an Obsidian vault. An inline
 * extension moves no block boundary, so the ones that only change
 * inline reading are left out.
 */

import {
  Strikethrough,
  Table,
  TaskList,
  parser,
  type BlockParser,
  type MarkdownParser,
} from "@lezer/markdown";

/** The node a frontmatter block is read as. */
export const FRONTMATTER = "Frontmatter";

/**
 * A YAML block at the top of the file, which fleuron reads as
 * metadata rather than as prose.
 *
 * The block opens on the first line of the file and on no other line,
 * so a line of three dashes further down is the thematic break or the
 * setext underline it would be without this.
 */
const frontmatter: BlockParser = {
  name: FRONTMATTER,
  before: "HorizontalRule",
  parse(cx, line) {
    if (cx.lineStart !== 0 || line.text.trim() !== "---") return false;
    const from = cx.lineStart;
    while (cx.nextLine()) {
      if (line.text.trim() === "---") {
        const to = cx.lineStart + line.text.length;
        cx.nextLine();
        cx.addElement(cx.elt(FRONTMATTER, from, to));
        return true;
      }
    }
    // A block that never closes is not one. The file is read again as
    // prose, which is what the engine does with it.
    return false;
  },
};

/**
 * The parser a note is read with.
 *
 * Footnote definitions are not read as blocks here, and fleuron reads
 * them as blocks. A run written under one names the paragraph rather
 * than the footnote, which changes what a chip says and not whether
 * there is one.
 */
export const notes: MarkdownParser = parser.configure([
  Table,
  TaskList,
  Strikethrough,
  { defineNodes: [{ name: FRONTMATTER, block: true }], parseBlock: [frontmatter] },
]);
