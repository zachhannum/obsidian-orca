/**
 * Draws the design panel, with the groups a book designer works in and
 * the controls in each group. The view in the right sidebar mounts the
 * panel for the book being read. The panel draws the design that the
 * view gives it and sends back one key at a time.
 *
 * Every control draws the value that the book is set in. For a key that
 * the note sets, the control draws the value as it is, and the row has a
 * reset at its end. For a key that the note does not set, the control
 * draws the default.
 *
 * The browser draws each row of the font list in the font that the row
 * names. Filling the list sends nothing to the engine.
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
import {
  LEVELS,
  writeDesign,
  type Design,
  type Level,
  type PageUnit,
  type Written,
} from "@/style/design";
import { effective } from "@/style/theme";
import {
  Field,
  Glyphs,
  Reset,
  Row,
  Segment,
  Select,
  Switch,
  Tabs,
  Warning,
  type Settle,
  type Under,
  type Wrong,
} from "@/ui/controls";
import {
  GLYPHS,
  GROUPS,
  atLevel,
  defaultSaid,
  inUnit,
  trims,
  withKey,
  type Control,
  type Row as Listed,
} from "@/ui/groups";
import { hyphenating } from "@/ui/language";
import { picking } from "@/ui/picker";
import { Icon } from "@/ui/icon";

/** The actions the view performs for the panel. */
export interface Acting {
  /** Sets one design key to a font. The faces of the font go to the engine with the sheet. */
  pick(font: Family, key: string): void;
  /** Writes one design key into the book note, which holds the design. */
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
      /** The unit for drawing and stepping the margins and a custom trim. */
      unit: PageUnit;
      /** The language that the book sets. The hyphenation patterns depend on it. */
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

/** The font that the engine carries. A book is set in it until the author picks a font. */
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

/** The design that a control draws from, and the level that the Headings group shows. */
interface Drawing {
  shown: Shown & { kind: "book" };
  acting: Acting;
  /** The keys the book note sets. */
  own: Readonly<Record<string, Written>>;
  /** Every key, with the value the note sets or else the default. */
  full: Readonly<Record<string, Written>>;
  level: Level;
}

export function Panel({
  shown,
  acting,
}: {
  shown: Shown;
  acting: Acting;
}): JSX.Element {
  // The panel owns the level, not the book, so the level starts on H1.
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
          </div>
          {group.rows.map((line, at) => {
            const levels = line.of.find((control) => control.kind === "level");
            if (levels !== undefined) {
              return (
                <Tabs
                  key={at}
                  value={String(level)}
                  choices={levels.choices ?? []}
                  testid="orca-panel-heading-level"
                  choose={(chosen) => {
                    const found = LEVELS.find((each) => String(each) === chosen);
                    if (found !== undefined) choose(found);
                  }}
                />
              );
            }
            return drawn(line, drawing) ? (
              <Line key={at} line={line} drawing={drawing} />
            ) : null;
          })}
        </div>
      ))}
      {shown.missing === undefined ? null : (
        <Warning said={shown.missing} testid="orca-panel-missing" />
      )}
    </div>
  );
}

/**
 * Draws one row. Each field whose text the panel cannot read gets an
 * error line under the row. The reset clears every key in the row that
 * the book sets.
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

  // The default for a key that the book sets is the value the key takes
  // once cleared. For a heading level's font, that is the body's font.
  const defaults = set.map(({ control, key }) => {
    const cleared = writeDesign(
      effective(withKey(drawing.shown.design, key, undefined)),
    );
    const value = defaultSaid(control, cleared[key], drawing.shown.unit);
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

/** Draws one control and its word. The word goes after the control, or under it in a grid. */
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
      // The word after a switch is its meaning, and the word after a field is its unit.
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
    case "level":
      return null;
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
          unit={shown.unit}
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
    case "length": {
      const unit = control.page === true ? shown.unit : undefined;
      return (
        <Field
          measure={control.kind}
          unit={unit}
          value={unit === undefined ? (text ?? "") : inUnit(text ?? "", unit)}
          faint={faint}
          testid={testid}
          wrong={wrong(key)}
          settle={settle}
        />
      );
    }
  }
}

/**
 * Draws the trim, which the author picks from the sizes a novel is
 * printed at or types out. Picking Custom shows the width and height of
 * the trim that the book is in, so a custom trim starts from it.
 */
function Trim({
  value,
  faint,
  unit,
  testid,
  settle,
  wrong,
}: {
  value: string;
  faint: boolean;
  unit: PageUnit;
  testid: string;
  settle: Settle;
  wrong: (id: string) => Wrong;
}): JSX.Element {
  const [custom, setCustom] = useState(false);
  const offered = trims(unit);
  const named = !custom && offered.some((choice) => choice.value === value);
  const [width = "", height = ""] = value
    .split(/\s+/)
    .map((side) => inUnit(side, unit));
  return (
    <>
      <Select
        value={named ? value : CUSTOM}
        faint={faint}
        choices={[...offered, { value: CUSTOM, label: "Custom" }]}
        testid={testid}
        settle={(chosen) => {
          setCustom(chosen === CUSTOM);
          if (chosen !== undefined && chosen !== CUSTOM) settle(chosen);
        }}
      />
      {named ? null : (
        <div className="orca-panel-grid orca-panel-size">
          <div className="orca-panel-cell">
            <Field
              measure="length"
              unit={unit}
              value={width}
              faint={faint}
              testid={`${testid}-width`}
              wrong={wrong("trim-width")}
              settle={(settled) => {
                settle(sized(settled, height));
              }}
            />
            <span className="orca-panel-said">width</span>
          </div>
          <div className="orca-panel-cell">
            <Field
              measure="length"
              unit={unit}
              value={height}
              faint={faint}
              testid={`${testid}-height`}
              wrong={wrong("trim-height")}
              settle={(settled) => {
                settle(sized(width, settled));
              }}
            />
            <span className="orca-panel-said">height</span>
          </div>
        </div>
      )}
    </>
  );
}

/** The trim select's value for a trim that matches no book size. */
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
 * Decides if the panel draws a row. The glyphs and the word both write
 * the scene break mark, so the panel draws only the one that the mark is
 * set to.
 */
function drawn(line: Listed, drawing: Drawing): boolean {
  const mark = drawing.own["scene-break-mark"] ?? drawing.full["scene-break-mark"];
  const glyphs = line.of.some((control) => control.kind === "glyph");
  const word = line.of.some((control) => control.kind === "word");
  if (glyphs) return mark === undefined || mark === "ornament";
  if (word) return mark === "word";
  return true;
}

/** The line under a row. Only the hyphenation switch has one, which names the language. */
function saidUnder(
  line: Listed,
  shown: Shown & { kind: "book" },
): string | undefined {
  return line.of.some((control) => control.key === "body-hyphens")
    ? hyphenating(shown.language)
    : undefined;
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
