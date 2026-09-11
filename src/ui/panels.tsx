/**
 * Draws the design panel: the groups a book designer works in, and the
 * controls in each of them.
 *
 * One component, mounted twice. The right sidebar mounts it against the
 * book being read, and the book note's own page mounts it against the
 * note it shows. Both hand it a design to draw and take back one key at
 * a time.
 *
 * Every control draws the value the book is set in. A key the note sets
 * is drawn as it is, with a reset at the end of its row, and a key it
 * does not set is drawn at its default.
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
import { LEVELS, writeDesign, type Design, type Level, type Written } from "@/style/design";
import { effective } from "@/style/theme";
import {
  Field,
  Glyphs,
  Reset,
  Row,
  Segment,
  Select,
  Switch,
  Warning,
  type Settle,
  type Under,
  type Wrong,
} from "@/ui/controls";
import {
  GLYPHS,
  GROUPS,
  TRIMS,
  atLevel,
  defaultSaid,
  withKey,
  type Control,
  type Row as Listed,
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

/** The design a control is drawn from, and the level the Headings group is on. */
interface Drawing {
  shown: Shown & { kind: "book" };
  acting: Acting;
  /** The keys the book note sets. */
  own: Readonly<Record<string, Written>>;
  /** Every key, with the defaults under the ones the note sets. */
  full: Readonly<Record<string, Written>>;
  level: Level;
  choose: (level: Level) => void;
}

export function Panel({
  shown,
  acting,
}: {
  shown: Shown;
  acting: Acting;
}): JSX.Element {
  // The level is the panel's own, not the book's, so it starts on H1.
  const [level, choose] = useState<Level>(1);
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
  const drawing: Drawing = {
    shown,
    acting,
    own: writeDesign(shown.design),
    full: writeDesign(effective(shown.design)),
    level,
    choose,
  };
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
          {group.rows.map((line, at) =>
            drawn(line, drawing) ? (
              <Line key={at} line={line} drawing={drawing} />
            ) : null,
          )}
        </div>
      ))}
      {shown.missing === undefined ? null : (
        <Warning said={shown.missing} testid="orca-panel-missing" />
      )}
    </div>
  );
}

/**
 * One row, with the error line under each field whose text cannot be
 * read, and a reset that clears every key in the row the book sets.
 */
function Line({ line, drawing }: { line: Listed; drawing: Drawing }): JSX.Element {
  const [wrongs, setWrongs] = useState<Readonly<Record<string, string>>>({});
  const { own, level, acting } = drawing;
  const keyed = line.of.flatMap((control) =>
    control.key === undefined
      ? []
      : [{ control, key: atLevel(control.key, level) }],
  );
  const set = keyed.filter(({ key }) => own[key] !== undefined);
  const first = keyed[0]?.key;

  const wrong =
    (id: string): Wrong =>
    (said) => {
      setWrongs((was) => {
        const next = { ...was };
        if (said === undefined) {
          delete next[id];
        } else {
          next[id] = said;
        }
        return next;
      });
    };

  const under: Under[] = [];
  const said = saidUnder(line, drawing.shown);
  if (said !== undefined) {
    under.push({
      said,
      testid: first === undefined ? undefined : `orca-panel-said-${first}`,
    });
  }
  for (const [id, text] of Object.entries(wrongs)) {
    under.push({ said: text, testid: `orca-panel-invalid-${id}`, wrong: true });
  }

  // The default for a key the book sets is the value the book would be
  // set in without it, so a heading level's font is still the body's.
  const defaults = set.map(({ control, key }) => {
    const cleared = writeDesign(
      effective(withKey(drawing.shown.design, key, undefined)),
    );
    const value = defaultSaid(control, cleared[key]);
    return keyed.length > 1 && control.said !== undefined
      ? `${control.said} ${value}`
      : value;
  });
  const reset =
    first === undefined || set.length === 0 ? null : (
      <Reset
        said={`Reset to default (${defaults.join(", ")})`}
        testid={`orca-panel-reset-${first}`}
        reset={() => {
          for (const { key } of set) acting.set(key, undefined);
        }}
      />
    );

  const grid = line.grid === true;
  return (
    <Row label={line.label} grid={grid} reset={reset} under={under}>
      {line.of.map((control) => (
        <Beside
          key={control.key === undefined ? control.kind : atLevel(control.key, level)}
          control={control}
          grid={grid}
          drawing={drawing}
          wrong={wrong}
        />
      ))}
    </Row>
  );
}

/** One control, and the word drawn after it or, in a grid, under it. */
function Beside({
  control,
  grid,
  drawing,
  wrong,
}: {
  control: Control;
  grid: boolean;
  drawing: Drawing;
  wrong: (id: string) => Wrong;
}): JSX.Element {
  const drawn = <Drawn control={control} drawing={drawing} wrong={wrong} />;
  const said =
    control.said === undefined ? null : (
      // A switch is read by what it means, and a field by its unit.
      <span
        className={
          control.kind === "flag"
            ? "orca-panel-means"
            : grid
              ? "orca-panel-said"
              : "orca-panel-unit"
        }
      >
        {control.said}
      </span>
    );
  return grid ? (
    <div className="orca-panel-cell">
      {drawn}
      {said}
    </div>
  ) : (
    <>
      {drawn}
      {said}
    </>
  );
}

function Drawn({
  control,
  drawing,
  wrong,
}: {
  control: Control;
  drawing: Drawing;
  wrong: (id: string) => Wrong;
}): JSX.Element | null {
  const { shown, own, full, level, acting } = drawing;
  if (control.kind === "styles") {
    return <Styles styles={shown.styles} />;
  }
  if (control.kind === "level") {
    return (
      <Segment
        value={String(level)}
        faint={false}
        choices={control.choices ?? []}
        testid="orca-panel-heading-level"
        settle={(chosen) => {
          const found = LEVELS.find((each) => String(each) === String(chosen));
          if (found !== undefined) drawing.choose(found);
        }}
      />
    );
  }
  if (control.key === undefined) return null;

  const key = atLevel(control.key, level);
  const value = own[key] ?? full[key];
  const text = value === undefined ? undefined : String(value);
  const faint = own[key] === undefined;
  const testid = `orca-panel-${key}`;
  const settle: Settle = (settled) => {
    acting.set(key, settled);
  };

  switch (control.kind) {
    case "font":
      return (
        <Picker
          index={shown.index}
          font={text ?? CARRIED}
          faint={faint}
          testid={key === "body-font" ? "orca-panel-font" : testid}
          pick={(family) => {
            acting.pick(family, key);
          }}
        />
      );
    case "trim":
      return (
        <Trim
          value={text ?? ""}
          faint={faint}
          testid={testid}
          settle={settle}
          wrong={wrong}
        />
      );
    case "select":
      return (
        <Select
          value={text}
          faint={faint}
          choices={control.choices ?? []}
          testid={testid}
          settle={settle}
        />
      );
    case "segment":
      return (
        <Segment
          value={text}
          faint={faint}
          choices={control.choices ?? []}
          testid={testid}
          settle={settle}
        />
      );
    case "flag":
      return (
        <Switch on={value === true} faint={faint} testid={testid} settle={settle} />
      );
    case "glyph":
      return (
        <Glyphs
          value={text}
          faint={faint}
          glyphs={GLYPHS}
          testid={testid}
          settle={settle}
        />
      );
    case "word":
      return (
        <Field
          value={text ?? ""}
          faint={faint}
          testid={testid}
          wrong={wrong(key)}
          settle={settle}
        />
      );
    case "count":
    case "length":
      return (
        <Field
          measure={control.kind}
          value={text ?? ""}
          faint={faint}
          testid={testid}
          wrong={wrong(key)}
          settle={settle}
        />
      );
  }
}

/** The trim, picked from the sizes a novel is printed at or typed out. */
function Trim({
  value,
  faint,
  testid,
  settle,
  wrong,
}: {
  value: string;
  faint: boolean;
  testid: string;
  settle: Settle;
  wrong: (id: string) => Wrong;
}): JSX.Element {
  const named = TRIMS.some((choice) => choice.value === value);
  const [width = "", height = ""] = value.split(/\s+/);
  return (
    <>
      <Select
        value={named ? value : CUSTOM}
        faint={faint}
        choices={[...TRIMS, { value: CUSTOM, label: "Custom" }]}
        testid={testid}
        settle={(chosen) => {
          if (chosen !== undefined && chosen !== CUSTOM) settle(chosen);
        }}
      />
      {named ? null : (
        <>
          <Field
            measure="length"
            value={width}
            faint={faint}
            testid={`${testid}-width`}
            wrong={wrong("trim-width")}
            settle={(settled) => {
              settle(sized(settled, height));
            }}
          />
          <Field
            measure="length"
            value={height}
            faint={faint}
            testid={`${testid}-height`}
            wrong={wrong("trim-height")}
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
function drawn(line: Listed, drawing: Drawing): boolean {
  const mark = drawing.own["scene-break-mark"] ?? drawing.full["scene-break-mark"];
  const glyphs = line.of.some((control) => control.kind === "glyph");
  const word = line.of.some((control) => control.kind === "word");
  if (glyphs) return mark === undefined || mark === "ornament";
  if (word) return mark === "word";
  return true;
}

/** The line under a row. The hyphenation switch names the language. */
function saidUnder(
  line: Listed,
  shown: Shown & { kind: "book" },
): string | undefined {
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
  faint,
  testid,
  pick,
}: {
  index: FontIndex;
  font: string;
  faint: boolean;
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
        className={faint ? "orca-panel-field is-default" : "orca-panel-field"}
        data-testid={testid}
        data-default={String(faint)}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="orca-panel-family">{font}</span>
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
