/**
 * Draws the design panel: the groups a book designer works in, and the
 * controls in each of them.
 *
 * One component, mounted twice. The right sidebar mounts it against the
 * book being read, and the book note's own page mounts it against the
 * note it shows. Both hand it a design to draw and take back one key at
 * a time.
 *
 * The browser sets each font row in the font it offers. Nothing crosses
 * to the engine to fill the list.
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
import { writeDesign, type Design, type Written } from "@/style/design";
import { PRESETS } from "@/style/theme";
import {
  Count,
  Glyphs,
  Measure,
  Row,
  Segment,
  Select,
  Switch,
  Warning,
  Words,
  type Settle,
} from "@/ui/controls";
import {
  GLYPHS,
  GROUPS,
  TRIMS,
  type Control,
  type Row as Line,
} from "@/ui/groups";
import { hyphenating } from "@/ui/language";
import { picking, type FontStyle } from "@/ui/picker";
import { Icon } from "@/ui/icon";

/** The actions the view performs for the panel. */
export interface Acting {
  /** Sets one design key in a font, whose faces cross with the sheet. */
  pick(font: Family, key: string): void;
  /** Writes one design key into the book note, where the design lives. */
  set(key: string, value: Written | undefined): void;
}

/** The state the panel is drawn in. */
export type Shown =
  | {
      kind: "book";
      /** The book the panel is designing. */
      name: string;
      /** The design as the book note holds it. */
      design: Design;
      index: FontIndex;
      /** The styles the engine registered for the body font. */
      styles: FontStyle[];
      /** The language the book sets, which chooses the hyphenation patterns. */
      language: string | undefined;
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

/** The font the engine carries, which a book is set in until one is picked. */
export const CARRIED = "EB Garamond";

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
  const written = writeDesign(shown.design);
  return (
    <div className="orca-panel" data-testid="orca-panel" data-book={shown.name}>
      {GROUPS.map((group) => (
        <div
          key={group.name}
          className="orca-panel-group"
          data-testid="orca-panel-group"
          data-group={group.name}
        >
          <div className="orca-panel-heading">
            <span className="orca-panel-name">{group.name}</span>
            {group.hint === undefined ? null : (
              <span className="orca-panel-said">{group.hint}</span>
            )}
          </div>
          {group.rows
            .filter((line) => drawn(line, written))
            .map((line, at) => (
              <Row
                key={`${group.name}-${at}`}
                label={line.label}
                said={said(line, shown)}
              >
                {line.of.map((control) => (
                  <Beside
                    key={control.key ?? control.kind}
                    control={control}
                    shown={shown}
                    written={written}
                    acting={acting}
                  />
                ))}
              </Row>
            ))}
        </div>
      ))}
      {shown.missing === undefined ? null : (
        <Warning said={shown.missing} testid="orca-panel-missing" />
      )}
    </div>
  );
}

/** One control, and the words drawn on either side of it. */
function Beside({
  control,
  shown,
  written,
  acting,
}: {
  control: Control;
  shown: Shown & { kind: "book" };
  written: Record<string, Written>;
  acting: Acting;
}): JSX.Element {
  return (
    <>
      {control.named === undefined ? null : (
        <span className="orca-panel-named">{control.named}</span>
      )}
      <Drawn
        control={control}
        shown={shown}
        written={written}
        acting={acting}
      />
      {control.said === undefined || control.kind === "flag" ? null : (
        <span className="orca-panel-unit">{control.said}</span>
      )}
      {control.kind !== "flag" || control.said === undefined ? null : (
        <span className="orca-panel-means">{control.said}</span>
      )}
    </>
  );
}

function Drawn({
  control,
  shown,
  written,
  acting,
}: {
  control: Control;
  shown: Shown & { kind: "book" };
  written: Record<string, Written>;
  acting: Acting;
}): JSX.Element | null {
  const key = control.key;
  const value = key === undefined ? undefined : written[key];
  const testid = key === undefined ? "orca-panel-styles" : `orca-panel-${key}`;
  const settle: Settle = (settled) => {
    if (key !== undefined) acting.set(key, settled);
  };

  if (control.kind === "styles") {
    return <Styles styles={shown.styles} />;
  }
  if (control.kind === "font") {
    return (
      <Picker
        index={shown.index}
        font={value === undefined ? undefined : String(value)}
        testid={key === "body-font" ? "orca-panel-font" : testid}
        pick={(family) => {
          if (key !== undefined) acting.pick(family, key);
        }}
      />
    );
  }
  if (control.kind === "preset") {
    return (
      <Select
        value={value === undefined ? undefined : String(value)}
        choices={PRESETS.map((preset) => ({
          value: preset.name,
          label: preset.name,
        }))}
        testid={testid}
        settle={settle}
      />
    );
  }
  if (control.kind === "trim") {
    return <Trim value={value} testid={testid} settle={settle} />;
  }
  if (control.kind === "select" || control.kind === "segment") {
    const choices = control.choices ?? [];
    return control.kind === "select" ? (
      <Select
        value={value === undefined ? undefined : String(value)}
        choices={choices}
        testid={testid}
        settle={settle}
      />
    ) : (
      <Segment
        value={value === undefined ? undefined : String(value)}
        choices={choices}
        testid={testid}
        settle={settle}
      />
    );
  }
  if (control.kind === "flag") {
    return (
      <Switch
        on={typeof value === "boolean" ? value : undefined}
        testid={testid}
        settle={settle}
      />
    );
  }
  if (control.kind === "count") {
    return <Count value={value} testid={testid} settle={settle} />;
  }
  if (control.kind === "glyph") {
    return (
      <Glyphs value={value} glyphs={GLYPHS} testid={testid} settle={settle} />
    );
  }
  if (control.kind === "word") {
    return <Words value={value} testid={testid} settle={settle} />;
  }
  return <Measure value={value} testid={testid} settle={settle} />;
}

/** The trim, picked from the sizes a novel is printed at or typed out. */
function Trim({
  value,
  testid,
  settle,
}: {
  value: Written | undefined;
  testid: string;
  settle: Settle;
}): JSX.Element {
  const written = value === undefined ? "" : String(value);
  const named = TRIMS.some((choice) => choice.value === written);
  const [width = "", height = ""] = written.split(/\s+/);
  return (
    <>
      <Select
        value={named ? written : CUSTOM}
        choices={[...TRIMS, { value: CUSTOM, label: "Custom" }]}
        testid={testid}
        settle={(chosen) => {
          if (chosen !== CUSTOM) settle(chosen);
        }}
      />
      {named ? null : (
        <>
          <Measure
            value={width}
            testid={`${testid}-width`}
            settle={(settled) => {
              settle(sized(settled, height));
            }}
          />
          <Measure
            value={height}
            testid={`${testid}-height`}
            settle={(settled) => {
              settle(sized(width, settled));
            }}
          />
        </>
      )}
    </>
  );
}

/** The word the trim select shows for a trim no book size carries. */
const CUSTOM = "custom";

function sized(
  width: Written | undefined,
  height: Written | undefined,
): string | undefined {
  if (width === undefined || height === undefined) return undefined;
  const trim = `${String(width)} ${String(height)}`.trim();
  return trim === "" ? undefined : trim;
}

/**
 * Whether a row is drawn. The glyphs and the word both write the mark a
 * scene break carries, so the panel draws the one the mark is set to.
 */
function drawn(line: Line, written: Record<string, Written>): boolean {
  const mark = written["scene-break-mark"];
  const glyphs = line.of.some((control) => control.kind === "glyph");
  const word = line.of.some((control) => control.kind === "word");
  if (glyphs) return mark === undefined || mark === "ornament";
  if (word) return mark === "word";
  return true;
}

/** The line under a row. The hyphenation switch names the language. */
function said(line: Line, shown: Shown & { kind: "book" }): string | undefined {
  if (line.of.some((control) => control.key === "body-hyphens")) {
    return hyphenating(shown.language);
  }
  return line.said;
}

/**
 * The families in the index, filtered by what was typed. A commit
 * takes the selected row, so a string matching nothing leaves the book
 * in the font it already has.
 */
function Picker({
  index,
  font,
  testid,
  pick,
}: {
  index: FontIndex;
  font: string | undefined;
  testid: string;
  pick: (font: Family) => void;
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
    pick(chosen);
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
        data-testid={testid}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span>{font ?? CARRIED}</span>
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
  );
}
