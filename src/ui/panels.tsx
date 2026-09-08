/**
 * Draws the design panel: the book's face, picked from the families
 * the machine has.
 *
 * A row is set in the face it offers, and the browser is what sets it.
 * Nothing crosses to the engine to fill the list, so a picker opened
 * over six hundred families costs the engine nothing.
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
import { picking, type Cut } from "@/ui/face";
import { Icon } from "@/ui/icon";

/** The actions the panel asks the view to perform. */
export interface Acting {
  /** Sets the book in a family. */
  pick(family: Family): void;
}

/** The state the panel is drawn in. */
export type Shown =
  | {
      kind: "book";
      /** The book the panel is designing. */
      name: string;
      index: FontIndex;
      /** The family the book is set in, or nothing for the theme's own. */
      face: string | undefined;
      /** The cuts the engine registered for it. */
      cuts: Cut[];
      /** The complaint a family the machine does not have raised. */
      missing: string | undefined;
    }
  | { kind: "reading" }
  | { kind: "none" };

/** The panel as the view holds it: painted, and let go. */
export interface Mounted {
  paint(shown: Shown): void;
  unmount(): void;
}

/**
 * Mounts the panel under a view's element. The view owns the root: it
 * makes one here and unmounts it when the leaf closes, and nothing
 * else empties the element underneath.
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
        Reading the faces this machine has
      </div>
    );
  }
  return (
    <div className="orca-panel" data-testid="orca-panel">
      <div className="orca-panel-group">TEXT</div>
      <div className="orca-panel-row">
        <span className="orca-panel-label">Face</span>
        <Picker
          index={shown.index}
          face={shown.face}
          acting={acting}
        />
      </div>
      <Cuts cuts={shown.cuts} />
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
 * The families the index has, filtered by what was typed. A commit
 * takes the row the keys are on, so a string matching nothing leaves
 * the book set in the face it already has.
 */
function Picker({
  index,
  face,
  acting,
}: {
  index: FontIndex;
  face: string | undefined;
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

  const commit = (family: Family | undefined): void => {
    // Text matching nothing does not commit: the picker offers the
    // index, and a family is never named by hand.
    if (family === undefined) return;
    acting.pick(family);
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
        data-testid="orca-panel-face"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span>{face ?? "EB Garamond"}</span>
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
            {picked.offered.map((family, row) => (
              <div
                key={family.name}
                className={
                  row === picked.at
                    ? "orca-panel-option is-on"
                    : "orca-panel-option"
                }
                data-testid="orca-panel-option"
                data-family={family.name}
                // A row previews its own face, and the browser is what
                // draws it: the family is already installed, or the
                // vault's own face was registered with the document.
                style={{ fontFamily: `"${family.name}", var(--font-text)` }}
                // The filter keeps focus, so the blur that would close
                // the menu never fires before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(family);
                }}
              >
                {family.name}
              </div>
            ))}
            {picked.offered.length > 0 ? null : (
              <div
                className="orca-panel-none"
                data-testid="orca-panel-nothing"
              >
                No face of that name
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The cuts the engine registered, which are the styles a family offers. */
function Cuts({ cuts }: { cuts: Cut[] }): JSX.Element | null {
  if (cuts.length === 0) return null;
  return (
    <div className="orca-panel-row">
      <span className="orca-panel-label">Styles</span>
      <div
        className="orca-panel-cuts"
        data-testid="orca-panel-cuts"
        data-cuts={cuts.length}
      >
        {cuts.map((cut) => (
          <span
            key={cut.id}
            className="orca-panel-cut"
            data-testid="orca-panel-cut"
            data-weight={cut.entry.attributes.weight}
            data-italic={String(cut.entry.attributes.italic)}
            data-axes={cut.entry.variations.map((axis) => axis.tag).join(" ")}
          >
            {cut.entry.style}
          </span>
        ))}
      </div>
    </div>
  );
}
