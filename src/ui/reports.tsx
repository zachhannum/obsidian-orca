/**
 * Draws the book page. The author edits the book's metadata here, and
 * the page writes it on settle. The page draws the design and the
 * reading order read-only, with a word count beside each entry of the
 * reading order.
 *
 * The author edits the reading order in the navigator and nowhere else,
 * so a click on an entry here focuses that entry in the navigator. The
 * author edits the design in the design panel in the right sidebar. A
 * button on this page opens the panel.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { BOOK_KEY, type BookMetadata } from "@/book/note";
import { ROLES } from "@/book/roles";
import { Icon } from "@/ui/icon";
import { foliate, type Cover, type Line, type Report } from "@/ui/report";
import type { Summed } from "@/ui/summary";

/** The actions the page asks the view to perform. */
export interface Acting {
  /** Sets one property. An empty value takes it off the note. */
  set(key: keyof BookMetadata, value: string): void;
  /** The url a vault image is drawn from. */
  picture(path: string): string;
  /** Opens the vault's images for the author to pick the cover from. */
  chooseCover(): void;
  /** Takes what a drag from the file explorer carried as the cover, if it names an image. */
  dropCover(carried: string): void;
  /** Focuses an entry in the navigator, by its place in the reading order. */
  locate(at: number): void;
  asMarkdown(): void;
  /** Opens the export dialog on this book. */
  exports(): void;
}

/** The state the page is drawn in. */
export type Shown =
  | {
      kind: "book";
      report: Report;
      generation: number;
      /** The design, read-only. */
      designed: readonly Summed[];
    }
  | { kind: "refused"; said: string; newer: boolean }
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
        <Book report={shown.report} designed={shown.designed} acting={acting} />
      ) : shown.kind === "refused" ? (
        <Refused said={shown.said} newer={shown.newer} acting={acting} />
      ) : null}
    </div>
  );
}

function Book({
  report,
  designed,
  acting,
}: {
  report: Report;
  designed: readonly Summed[];
  acting: Acting;
}): JSX.Element {
  return (
    <div className="orca-book-page" data-testid="orca-book-page">
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
        <button
          type="button"
          className="orca-book-export"
          data-testid="orca-book-export"
          onClick={() => {
            acting.exports();
          }}
        >
          <Icon name="download" className="orca-book-icon" />
          Export book
        </button>
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
        <Well cover={report.cover} acting={acting} />
      </div>

      <div className="orca-book-design" data-testid="orca-book-design">
        <div className="orca-order-head">
          <span className="orca-order-title">Design</span>
        </div>
        <div className="orca-book-summary">
          {designed.map((line) => (
            <div
              key={line.label}
              className="orca-book-row"
              data-testid="orca-book-summed"
              data-label={line.label}
            >
              <span className="orca-book-label">{line.label}</span>
              <span className="orca-book-summed">{line.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="orca-book-order">
        <div className="orca-order-head">
          <span className="orca-order-title">Reading order</span>
          <span className="orca-order-hint">Read-only</span>
        </div>
        <div className="orca-order" data-testid="orca-order">
          <div className="orca-order-columns">
            <span>Entry</span>
            <span className="orca-order-count">Words</span>
            <span className="orca-order-count">Pages</span>
          </div>
          {report.lines.map((line) => (
            <Entry key={line.at} line={line} acting={acting} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The cover, as the picture it is. The well opens the picker and takes
 * a dropped image, and the button beside it takes the cover off the
 * note.
 */
function Well({ cover, acting }: { cover: Cover; acting: Acting }): JSX.Element {
  return (
    <div className="orca-book-row">
      <span className="orca-book-label">cover</span>
      <div className="orca-cover" data-testid="orca-cover">
        <button
          type="button"
          className="orca-cover-pick"
          data-testid="orca-cover-pick"
          onClick={() => {
            acting.chooseCover();
          }}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            acting.dropCover(event.dataTransfer.getData("text/plain"));
          }}
        >
          {cover.kind === "image" ? (
            <Chosen key={cover.path} path={cover.path} src={acting.picture(cover.path)} />
          ) : cover.kind === "missing" ? (
            <>
              <span className="orca-cover-frame is-missing" />
              <span className="orca-cover-named">
                <span className="orca-cover-name">{cover.written}</span>
                <span className="orca-cover-missing" data-testid="orca-cover-missing">
                  Not in the vault
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="orca-cover-frame" />
              <span className="orca-cover-none">Choose an image</span>
            </>
          )}
        </button>
        {cover.kind === "none" ? null : (
          <button
            type="button"
            className="clickable-icon orca-cover-clear"
            data-testid="orca-cover-clear"
            onClick={() => {
              acting.set("cover", "");
            }}
          >
            <Icon name="x" className="orca-book-icon" />
            <span className="orca-visually-hidden">Remove the cover</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** The image the cover names, with its name, its folder and its size in pixels. */
function Chosen({ path, src }: { path: string; src: string }): JSX.Element {
  const [size, setSize] = useState("");
  const slash = path.lastIndexOf("/");
  const folder = slash < 0 ? "" : path.slice(0, slash);
  return (
    <>
      <img
        className="orca-cover-picture"
        data-testid="orca-cover-picture"
        src={src}
        alt=""
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          setSize(`${naturalWidth} × ${naturalHeight}`);
        }}
      />
      <span className="orca-cover-named">
        <span className="orca-cover-name" data-testid="orca-cover-name">
          {path.slice(slash + 1)}
        </span>
        <span className="orca-cover-where">
          {folder}
          {size === "" ? null : (
            <span className="orca-cover-size" data-testid="orca-cover-size">
              {folder === "" ? "" : " · "}
              {size}
            </span>
          )}
        </span>
      </span>
    </>
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
      <span className="orca-order-count" data-testid="orca-order-words">
        {line.kind !== "note" ? (
          <span className="orca-order-none">—</span>
        ) : line.words === undefined ? null : (
          line.words.toLocaleString()
        )}
      </span>
      <span className="orca-order-count" data-testid="orca-order-pages">
        {line.pages === undefined ? (
          <span className="orca-order-none">—</span>
        ) : (
          foliate(line.pages)
        )}
      </span>
    </div>
  );
}

/** Paints the refusal message, with a way back to the editor. */
function Refused({
  said,
  newer,
  acting,
}: {
  said: string;
  newer: boolean;
  acting: Acting;
}): JSX.Element {
  return (
    <div className="orca-book-refused" data-testid="orca-book-refused">
      <Icon name="lock" className="orca-book-icon" />
      <div className="orca-book-said">{said}</div>
      {newer ? <div className="orca-book-hint">Update Orca to open it.</div> : null}
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
