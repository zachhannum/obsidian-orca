/**
 * Draws the book page: the book's metadata, edited here and written on
 * settle, and its reading order, drawn read-only with a word count
 * beside each entry.
 *
 * The reading order is edited in the navigator and nowhere else, so a
 * click on an entry here focuses it there.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useRef, type JSX, type KeyboardEvent } from "react";
import { BOOK_KEY, type BookMetadata } from "@/book/note";
import { ROLES } from "@/book/roles";
import { Icon } from "@/ui/icon";
import type { Line, Report } from "@/ui/report";

/** The actions the page asks the view to perform. */
export interface Acting {
  /** Sets one property. An empty value takes it off the note. */
  set(key: keyof BookMetadata, value: string): void;
  /** Focuses an entry in the navigator, by its place in the reading order. */
  locate(at: number): void;
  asMarkdown(): void;
}

/** The state the page is drawn in. */
export type Shown =
  | { kind: "book"; report: Report; generation: number }
  | { kind: "refused"; said: string }
  | { kind: "none" };

/** The page as the view holds it: painted, and let go. */
export interface Mounted {
  paint(shown: Shown): void;
  unmount(): void;
}

/**
 * Mounts the page under a view's element. The view owns the root: it
 * makes one here and unmounts it when the leaf closes, and nothing
 * else empties the element underneath.
 */
export function mountPage(el: HTMLElement, acting: Acting): Mounted {
  const host = el.createDiv({ cls: "orca-book-host" });
  const root = createRoot(host);
  const draw = (shown: Shown): void => {
    root.render(<Page shown={shown} acting={acting} />);
  };
  draw({ kind: "none" });
  return {
    paint: draw,
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}

export function Page({
  shown,
  acting,
}: {
  shown: Shown;
  acting: Acting;
}): JSX.Element {
  const pane = useRef<HTMLDivElement>(null);
  // The suite waits on the generation the page has painted, so it is
  // written after the commit and never during one.
  useEffect(() => {
    if (pane.current === null) return;
    if (shown.kind === "book") {
      pane.current.dataset["generation"] = String(shown.generation);
    } else {
      delete pane.current.dataset["generation"];
    }
  }, [shown]);

  return (
    <div className="orca-book" data-testid="orca-book" ref={pane}>
      {shown.kind === "book" ? (
        <Book report={shown.report} acting={acting} />
      ) : shown.kind === "refused" ? (
        <Refused said={shown.said} acting={acting} />
      ) : null}
    </div>
  );
}

function Book({
  report,
  acting,
}: {
  report: Report;
  acting: Acting;
}): JSX.Element {
  return (
    <div className="orca-book-page">
      <div className="orca-book-head">
        <div className="orca-book-name">{report.name}</div>
        <div className="orca-book-line" data-testid="orca-book-line">
          <span className="orca-book-format">
            {BOOK_KEY}: {report.format}
          </span>
          <span>·</span>
          <span>{counted(report.chapters, "chapter")}</span>
          <span>·</span>
          <span>{counted(report.words, "word")}</span>
        </div>
      </div>

      <div className="orca-book-metadata">
        {report.fields.map((field) => (
          <label key={field.key} className="orca-book-row">
            <span className="orca-book-label">{field.key}</span>
            <input
              className="orca-book-value"
              data-testid={`orca-metadata-${field.key}`}
              type="text"
              spellCheck={false}
              value={field.value}
              placeholder={`[YOUR ${field.key.toUpperCase()}]`}
              onChange={(event) => {
                acting.set(field.key, event.currentTarget.value);
              }}
            />
          </label>
        ))}
      </div>

      <div className="orca-book-order">
        <div className="orca-order-head">
          <span className="orca-order-title">Reading order</span>
          <span className="orca-order-hint">
            read-only here, and clicking an entry focuses the navigator
          </span>
        </div>
        <div className="orca-order" data-testid="orca-order">
          <div className="orca-order-columns">
            <span>Entry</span>
            <span className="orca-order-count">Words</span>
          </div>
          {report.lines.map((line) => (
            <Entry key={line.at} line={line} acting={acting} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Entry({ line, acting }: { line: Line; acting: Acting }): JSX.Element {
  const locate = (): void => {
    acting.locate(line.at);
  };
  const pressed = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    locate();
  };
  return (
    <div
      className="orca-order-row"
      data-testid="orca-order-entry"
      data-at={line.at}
      data-kind={line.kind}
      data-role={line.role}
      role="button"
      tabIndex={0}
      onClick={locate}
      onKeyDown={pressed}
    >
      <span className="orca-order-entry">
        <span className="orca-order-name">{line.name}</span>
        {line.kind === "generated" ? (
          <span className="orca-chip">generated</span>
        ) : line.named ? (
          <span className="orca-chip">
            {ROLES[line.role].name.toLowerCase()}
          </span>
        ) : null}
      </span>
      <span className="orca-order-count">
        {line.kind !== "note" ? (
          <span className="orca-order-none">—</span>
        ) : line.words === undefined ? null : (
          line.words.toLocaleString()
        )}
      </span>
    </div>
  );
}

/** Paints the refusal message, with a way back to the editor. */
function Refused({
  said,
  acting,
}: {
  said: string;
  acting: Acting;
}): JSX.Element {
  return (
    <div className="orca-book-refused" data-testid="orca-book-refused">
      <Icon name="lock" className="orca-book-icon" />
      <div className="orca-book-said">
        This book was made by a newer version of orca than this one.
      </div>
      <div className="orca-book-versions">{said}</div>
      <div className="orca-book-hint">Update the plugin to open it</div>
      <button
        type="button"
        onClick={() => {
          acting.asMarkdown();
        }}
      >
        Open as markdown
      </button>
    </div>
  );
}

/** A count and its noun, as `1 chapter` or `24 chapters`. */
function counted(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}
