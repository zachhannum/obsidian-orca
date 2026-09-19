/**
 * The book a visible note puts on screen.
 *
 * The design panel follows the book on screen, and a note of a book is
 * that book on screen as much as a preview of it is. A writer turning a
 * tab from the preview to a chapter keeps the panel.
 */

/** A markdown pane, as the panel reads it. */
export interface NotePane {
  /** The book the note belongs to, or the book note's own path. */
  book: string | undefined;
  /** Whether the pane is drawn. A pane in a background tab is not. */
  shown: boolean;
  /** Whether the pane is the active one. */
  active: boolean;
}

/**
 * The book the panel designs from the notes on screen: the active
 * note's book, and otherwise the first book a drawn note belongs to.
 * A pane the workspace is not drawing designs nothing, and neither does
 * a note no book reads.
 */
export function notedBook(panes: readonly NotePane[]): string | undefined {
  const drawn = panes.filter((pane) => pane.shown && pane.book !== undefined);
  const active = drawn.find((pane) => pane.active);
  return (active ?? drawn[0])?.book;
}
