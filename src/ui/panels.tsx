/**
 * Draws the design panel, where the book's font is picked out of the
 * ones the machine has.
 *
 * The browser sets each row in the font it offers. Nothing crosses to
 * the engine to fill the list.
 */

import { createRoot } from "react-dom/client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import type { Family, FontIndex } from "@/assets/fonts";
import { picking, type FontStyle } from "@/ui/picker";
import { Icon } from "@/ui/icon";

/** The actions the view performs for the panel. */
export interface Acting {
  /** Sets the book in a font. */
  pick(font: Family): void;
}

/** The state the panel is drawn in. */
export type Shown =
  | {
      kind: "book";
      /** The book the panel is designing. */
      name: string;
      index: FontIndex;
      /** The font the book is set in, or nothing for the theme's own. */
      font: string | undefined;
      /** The styles the engine registered for it. */
      styles: FontStyle[];
      /** The warning for a font the machine does not have. */
      missing: string | undefined;
    }
  | { kind: "reading" }
  | { kind: "none" };

/** The mounted panel, held by the view. */
export interface Mounted {
  paint(shown: Shown): void;
  unmount(): void;
}

/**
 * Mounts the panel under a view's element. The view owns the root and
 * unmounts it when the leaf closes, and nothing else empties the
 * element underneath.
 */
export function mountPanel(el: HTMLElement, acting: Acting): Mounted {
  const host = el.createDiv({ cls: "orca-panel-host" });
  const root = createRoot(host);
  const draw = (shown: Shown): void => {
    root.render(<Panel shown={shown} acting={acting} />);
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

export function Panel({
  shown,
  acting,
}: {
  shown: Shown;
  acting: Acting;
}): JSX.Element {
  if (shown.kind === "none") {
    return (
      <div className="orca-panel-empty" data-testid="orca-panel-empty">
        No book is open
      </div>
    );
  }
  if (shown.kind === "reading") {
    return (
      <div className="orca-panel-empty" data-testid="orca-panel-reading">
        Reading the fonts this machine has
      </div>
    );
  }
  return (
    <div className="orca-panel" data-testid="orca-panel">
      <div className="orca-panel-group">BODY</div>
      <div className="orca-panel-row">
        <span className="orca-panel-label">Font</span>
        <Picker index={shown.index} font={shown.font} acting={acting} />
      </div>
      <Styles styles={shown.styles} />
      {shown.missing === undefined ? null : (
        <div className="orca-panel-warning" data-testid="orca-panel-missing">
          <Icon name="alert-circle" className="orca-panel-icon" />
          <span>{shown.missing}</span>
        </div>
      )}
    </div>
  );
}

/**
 * The families in the index, filtered by what was typed. A commit
 * takes the selected row, so a string matching nothing leaves the book
 * in the font it already has.
 */
function Picker({
  index,
  font,
  acting,
}: {
  index: FontIndex;
  font: string | undefined;
  acting: Acting;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [at, setAt] = useState(0);
  const filter = useRef<HTMLInputElement>(null);
  const picked = useMemo(() => picking(index, typed, at), [index, typed, at]);

  useEffect(() => {
    if (open) filter.current?.focus();
  }, [open]);

  const close = (): void => {
    setOpen(false);
    setTyped("");
    setAt(0);
  };

  const commit = (chosen: Family | undefined): void => {
    // Text matching nothing does not commit, because the picker offers
    // only families in the index.
    if (chosen === undefined) return;
    acting.pick(chosen);
    close();
  };

  const keyed = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAt(picked.at + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAt(Math.max(picked.at - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(picked.commits);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div className="orca-panel-picker">
      <button
        type="button"
        className="orca-panel-field"
        data-testid="orca-panel-font"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span>{font ?? "EB Garamond"}</span>
        <Icon name="chevron-down" className="orca-panel-icon" />
      </button>
      {!open ? null : (
        <div className="orca-panel-menu" data-testid="orca-panel-menu">
          <input
            ref={filter}
            type="text"
            className="orca-panel-filter"
            data-testid="orca-panel-filter"
            placeholder="Filter"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setAt(0);
            }}
            onKeyDown={keyed}
            onBlur={close}
          />
          <div
            className="orca-panel-rows"
            data-testid="orca-panel-rows"
            data-offered={picked.offered.length}
          >
            {picked.offered.map((offer, row) => (
              <div
                key={offer.name}
                className={
                  row === picked.at
                    ? "orca-panel-option is-on"
                    : "orca-panel-option"
                }
                data-testid="orca-panel-option"
                data-font={offer.name}
                // The browser draws the row in its own font, from an
                // installed one or a vault file registered with the
                // document.
                style={{ fontFamily: `"${offer.name}", var(--font-text)` }}
                // The filter keeps focus, so the blur that would close
                // the menu never fires before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(offer);
                }}
              >
                {offer.name}
              </div>
            ))}
            {picked.offered.length > 0 ? null : (
              <div
                className="orca-panel-none"
                data-testid="orca-panel-nothing"
              >
                No font of that name
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The styles of the font, as the engine registered them. */
function Styles({ styles }: { styles: FontStyle[] }): JSX.Element | null {
  if (styles.length === 0) return null;
  return (
    <div className="orca-panel-row">
      <span className="orca-panel-label">Styles</span>
      <div
        className="orca-panel-styles"
        data-testid="orca-panel-styles"
        data-styles={styles.length}
      >
        {styles.map((style) => (
          <span
            key={style.id}
            className="orca-panel-style"
            data-testid="orca-panel-style"
            data-weight={style.entry.attributes.weight}
            data-italic={String(style.entry.attributes.italic)}
            data-axes={style.entry.variations.map((axis) => axis.tag).join(" ")}
          >
            {style.entry.style}
          </span>
        ))}
      </div>
    </div>
  );
}
