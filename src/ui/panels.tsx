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
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import type { Cover } from "@/assets/cmap";
import { familyNamed, type Family, type FontIndex } from "@/assets/fonts";
import { usedVariant, variantFamily, type Variant } from "@/assets/variants";
import {
  LEVELS,
  writeDesign,
  type Design,
  type Level,
  type PageUnit,
  type Written,
} from "@/style/design";
import type { Place } from "@/style/origin";
import type { Override } from "@/style/overrides";
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
  overriddenAt,
  trims,
  withKey,
  type Control,
  type Owner,
  type Row as Listed,
} from "@/ui/groups";
import { ACTIONS } from "@/ui/actions";
import { boxKey } from "@/ui/inspect";
import { hyphenating } from "@/ui/language";
import { InspectPane, type Inspecting } from "@/ui/pane";
import { browsedFamily } from "@/ui/glyphs";
import { offeredVariants, picking, previewFamily } from "@/ui/picker";
import { Icon } from "@/ui/icon";

/** The actions the view performs for the panel. */
export interface Acting {
  /** Sets one design key to a font. The faces of the font go to the engine with the sheet. */
  pick(font: Family, key: string): void;
  /** Writes one design key into the book note, which holds the design. */
  set(key: string, value: Written | undefined): void;
  /** Sets a font's variant key. The faces of the variant go to the engine with the sheet. */
  variant(key: string, variant: Variant): void;
  /** Adds a font to the book, which no design key names. Its faces go to the engine with the sheet. */
  addFont(font: Family): void;
  /** Takes a font the book added back out, by the name the note holds. */
  dropFont(font: string): void;
  /** Registers a face of each variant of a family with the document, so each variant row draws in its own face. */
  preview(family: Family): void;
  /** The code points a family's default face covers, with that face registered so the browser draws them. */
  coverage(family: Family): Promise<readonly Cover[]>;
  /** Switches the panel between its controls and the author's own CSS. */
  view(viewing: Viewing): void;
  /** Switches the CSS view between wrapping long lines and scrolling them sideways. */
  wrap(on: boolean): void;
  /** Puts the editor's caret at a line and column of the author's CSS, and focuses it. */
  cursor(line: number, column: number): void;
  /** Puts text in at the editor's caret, as typing does. */
  add(text: string): void;
  /** Takes the pin off in the preview. */
  unpin(): void;
  /** Pins the box one node names in the preview, which replaces the pinned one. */
  pin(node: number): void;
  /** Opens the author's CSS with the caret at a place in it. */
  reveal(place: Place): void;
}

/** The panel's two views. In the CSS view the panel draws its header, and the editor under it is not React's. */
export type Viewing = "controls" | "css";

/** The state the panel is drawn in. */
export type Shown =
  | {
      kind: "book";
      viewing: Viewing;
      /** Whether the CSS view wraps long lines. */
      wrapping: boolean;
      /** The book the panel is designing. */
      name: string;
      /** The design as the book note holds it. */
      design: Design;
      index: FontIndex;
      /** The fonts the book adds, which no design key names. */
      fonts: readonly string[];
      /** The unit for drawing and stepping the margins and a custom trim. */
      unit: PageUnit;
      /** The language that the book sets. The hyphenation patterns depend on it. */
      language: string | undefined;
      /** One warning for each font the design names that the machine does not have. */
      missing: readonly string[];
      /** The warnings against the author's CSS, which the CSS view counts. */
      warned: number;
      /** The box pinned in the preview, which the CSS view draws the inspect pane for. */
      inspecting: Inspecting | undefined;
      /** The design keys overridden by the author's CSS, each with the declaration that beats it. */
      overridden: ReadonlyMap<string, Override>;
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

/** The group that adds a font to the book without a design key naming it. */
export const FONTS_GROUP = "Fonts";

/**
 * The group the Fonts group follows. It closes the groups that set
 * type, and a picker there is not the last thing in the panel, so the
 * menu it opens hangs over rows rather than over the end of the scroll.
 */
const FONTS_AFTER = "Headings";

/** The picker that adds a font reads this until a font is picked. */
const ADD_A_FONT = "Add a font";

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
  // The control a rule in the inspect pane asked for, until its row is scrolled to.
  const [opening, setOpening] = useState<Owner | undefined>(undefined);
  const panel = useRef<HTMLDivElement>(null);
  const viewing = shown.kind === "book" ? shown.viewing : undefined;
  useEffect(() => {
    const element = panel.current;
    if (opening === undefined || viewing !== "controls" || element === null) return;
    const row =
      opening.key === undefined
        ? null
        : element.querySelector(`[data-keys~="${CSS.escape(opening.key)}"]`);
    const group = element.querySelector(`[data-group="${CSS.escape(opening.group)}"]`);
    (row ?? group)?.scrollIntoView({ block: "center" });
    setOpening(undefined);
  }, [opening, viewing]);
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
  const css = shown.viewing === "css";
  const header = (
    <div className="orca-panel-header">
      <span className="orca-panel-title">{css ? "CSS" : "Design"}</span>
      <span className="orca-panel-book">— {shown.name}</span>
      {css && shown.warned > 0 ? (
        <span className="orca-panel-warned" data-testid="orca-panel-warned">
          {shown.warned === 1 ? "1 warning" : `${String(shown.warned)} warnings`}
        </span>
      ) : null}
      {css ? (
        <button
          type="button"
          className={
            shown.wrapping
              ? "clickable-icon orca-panel-action is-active"
              : "clickable-icon orca-panel-action"
          }
          data-testid="orca-panel-wrap"
          aria-label={ACTIONS.wrap.label}
          aria-pressed={shown.wrapping}
          onClick={() => {
            acting.wrap(!shown.wrapping);
          }}
        >
          <Icon name={ACTIONS.wrap.icon} className="orca-panel-action-icon" />
        </button>
      ) : null}
      <button
        type="button"
        className="clickable-icon orca-panel-action"
        data-testid={css ? "orca-panel-controls" : "orca-panel-css"}
        aria-label={css ? ACTIONS.controls.label : ACTIONS.css.label}
        onClick={() => {
          acting.view(css ? "controls" : "css");
        }}
      >
        <Icon
          name={css ? ACTIONS.controls.icon : ACTIONS.css.icon}
          className="orca-panel-action-icon"
        />
      </button>
    </div>
  );
  if (css) {
    return (
      <div
        ref={panel}
        className="orca-panel"
        data-testid="orca-panel"
        data-book={shown.name}
        data-viewing="css"
      >
        {header}
        {shown.inspecting === undefined ? null : (
          <InspectPane
            key={boxKey(shown.inspecting.pin)}
            inspecting={shown.inspecting}
            unit={shown.unit}
            acting={{
              cursor: (line, column) => {
                acting.cursor(line, column);
              },
              add: (text) => {
                acting.add(text);
              },
              unpin: () => {
                acting.unpin();
              },
              pin: (node) => {
                acting.pin(node);
              },
              open: (owner) => {
                if (owner.level !== undefined) choose(owner.level);
                setOpening(owner);
                acting.view("controls");
              },
            }}
          />
        )}
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
    <div
      ref={panel}
      className="orca-panel"
      data-testid="orca-panel"
      data-book={shown.name}
      data-viewing="controls"
    >
      {header}
      {GROUPS.map((group) => (
        <Fragment key={group.name}>
          <div
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
          {group.name === FONTS_AFTER ? (
            <Fonts fonts={shown.fonts} index={shown.index} acting={acting} />
          ) : null}
        </Fragment>
      ))}
      {shown.missing.map((said) => (
        <Warning key={said} said={said} testid="orca-panel-missing" />
      ))}
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
  // once cleared. For a heading level's font and a scene break's, that
  // is the body's font.
  const defaults = set.map(({ control, key }) => {
    const cleared = writeDesign(
      effective(withKey(drawing.shown.design, key, undefined)),
    );
    const value =
      control.kind === "variant"
        ? String(cleared[key] ?? defaultVariant(drawing.shown.index, cleared[fontKeyOf(key)]) ?? "none")
        : control.kind === "font"
          ? (stringOf(cleared[key]) ?? carried(cleared))
          : defaultSaid(control, cleared[key] ?? inherited(key, cleared), drawing.shown.unit);
    return keyed.length > 1 && control.said !== undefined
      ? `${control.said} ${value}`
      : value;
  });
  // A row the author's CSS has overridden has no reset. Clearing the key
  // would change nothing on the page.
  const { overridden } = drawing.shown;
  const override = overriddenAt(
    keyed.map(({ key }) => key),
    overridden,
  );
  const reset =
    first === undefined || set.length === 0 || override !== undefined ? null : (
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
    <Row
      label={line.label}
      grid={grid}
      reset={reset}
      under={under}
      keys={keyed.map(({ key }) => key)}
      overridden={
        override === undefined
          ? undefined
          : {
              overrides: override.overrides,
              testid: `orca-panel-overridden-${override.key}`,
              every: keyed.every(({ key }) => overridden.has(key)),
              open: (place) => {
                acting.reveal(place);
              },
            }
      }
    >
      {line.of.map((control) => (
        <Beside
          key={control.key === undefined ? control.kind : atLevel(control.key, level)}
          control={control}
          grid={grid}
          drawing={drawing}
          wrong={wrong}
          overridden={
            control.key !== undefined && overridden.has(atLevel(control.key, level))
          }
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
  overridden,
}: {
  control: Control;
  grid: boolean;
  drawing: Drawing;
  wrong: (id: string) => Wrong;
  /** True when the author's CSS overrides the key the control writes. */
  overridden: boolean;
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
  if (grid) {
    return (
      <div className={overridden ? "orca-panel-cell is-overridden" : "orca-panel-cell"}>
        {drawn}
        {said}
      </div>
    );
  }
  // Outside a grid the row dims its controls as a whole.
  return (
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
          font={text ?? carried(full)}
          faint={faint}
          testid={key === "body-font" ? "orca-panel-font" : testid}
          pick={(family) => {
            acting.pick(family, key);
          }}
        />
      );
    case "variant": {
      const family = offeredVariants(shown.index, stringOf(full[fontKeyOf(key)]));
      if (family === undefined) return null;
      return (
        <VariantPicker
          family={family}
          value={text}
          faint={faint}
          testid={testid}
          pick={(variant) => {
            acting.variant(key, variant);
          }}
          preview={() => {
            acting.preview(family);
          }}
        />
      );
    }
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
          family={browsedFamily(
            stringOf(full["scene-break-font"]),
            stringOf(full["body-font"]),
            CARRIED,
          )}
          read={(family) => {
            const found = familyNamed(shown.index, family);
            return found === undefined ? Promise.resolve([]) : acting.coverage(found);
          }}
          testid={testid}
          settle={settle}
        />
      );
    case "count":
    case "length": {
      const unit = control.page === true ? shown.unit : undefined;
      // A key the design leaves to the body draws the body's value, the
      // way a scene break with no font of its own draws the body's face.
      const drawn = text ?? stringOf(inherited(key, full)) ?? "";
      return (
        <Field
          measure={control.kind}
          unit={unit}
          value={unit === undefined ? drawn : inUnit(drawn, unit)}
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
 * Decides if the panel draws a row. The glyph and its font set the mark
 * a scene break prints, so a design that breaks a scene with a space
 * draws neither.
 */
function drawn(line: Listed, drawing: Drawing): boolean {
  // A Variant row shows only for a family with more than one variant. A
  // heading level with no font of its own asks of the body's family.
  const variant = line.of.find((control) => control.kind === "variant");
  if (variant?.key !== undefined) {
    const font = drawing.full[fontKeyOf(atLevel(variant.key, drawing.level))];
    return offeredVariants(drawing.shown.index, stringOf(font)) !== undefined;
  }
  const ornamental = line.of.some(
    (control) =>
      control.kind === "glyph" ||
      control.key === "scene-break-font" ||
      control.key === "scene-break-size",
  );
  if (!ornamental) return true;
  const mark = drawing.own["scene-break-mark"] ?? drawing.full["scene-break-mark"];
  return mark !== "space";
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
 * The fonts the book carries beyond the ones its design names. A font
 * here registers a face, so the author's CSS can name it. The picker
 * offers the same index the design's font pickers do.
 */
function Fonts({
  fonts,
  index,
  acting,
}: {
  fonts: readonly string[];
  index: FontIndex;
  acting: Acting;
}): JSX.Element {
  return (
    <div
      className="orca-panel-group"
      data-testid="orca-panel-group"
      data-group={FONTS_GROUP}
    >
      <div className="orca-panel-heading">
        <span className="orca-panel-name">{FONTS_GROUP}</span>
      </div>
      {fonts.map((font) => (
        <Row
          key={font}
          label=""
          grid={false}
          under={[]}
          reset={<Drop font={font} drop={acting.dropFont.bind(acting)} />}
        >
          <span
            className="orca-panel-field is-added"
            data-testid="orca-panel-font-added"
            data-font={font}
            style={{
              fontFamily: `"${previewFamily(font)}", "${font}", var(--font-text)`,
            }}
          >
            {font}
          </span>
        </Row>
      ))}
      <Row label="" grid={false} under={[]} reset={null}>
        <Picker
          index={index}
          font={ADD_A_FONT}
          faint
          testid="orca-panel-font-add"
          pick={(font) => {
            acting.addFont(font);
          }}
        />
      </Row>
    </div>
  );
}

/** Takes a font the book added back out, at the end of its row. */
function Drop({
  font,
  drop,
}: {
  font: string;
  drop: (font: string) => void;
}): JSX.Element {
  return (
    <div
      className="clickable-icon orca-panel-reset"
      role="button"
      tabIndex={0}
      aria-label={`Take ${font} out of the book`}
      data-testid="orca-panel-font-drop"
      data-font={font}
      onClick={() => {
        drop(font);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        drop(font);
      }}
    >
      <Icon name="x" className="orca-panel-icon" />
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
                // The browser draws the row in its own font, from a
                // vault file registered with the document in its default
                // variant, or else from an installed one.
                style={{
                  fontFamily: `"${previewFamily(offer.name)}", "${offer.name}", var(--font-text)`,
                }}
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

/**
 * The variants of the family a font row sets, each row drawn in its own
 * face. The faces are registered with the document the first time the
 * menu opens, and a row draws in the interface face until then.
 */
function VariantPicker({
  family,
  value,
  faint,
  testid,
  pick,
  preview,
}: {
  family: Family;
  /** The variant the design names, or nothing for the default. */
  value: string | undefined;
  faint: boolean;
  testid: string;
  pick: (variant: Variant) => void;
  preview: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const { variant: current } = usedVariant(family, value);
  const [at, setAt] = useState(0);
  const menu = useRef<HTMLDivElement>(null);
  const variants = family.variants;

  useEffect(() => {
    if (open) menu.current?.focus();
  }, [open]);

  const commit = (chosen: Variant | undefined): void => {
    if (chosen === undefined) return;
    pick(chosen);
    setOpen(false);
  };

  const keyed = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAt(Math.min(at + 1, variants.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAt(Math.max(at - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(variants[at]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
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
          if (!open) {
            preview();
            setAt(Math.max(variants.indexOf(current), 0));
          }
          setOpen(!open);
        }}
      >
        <span className="orca-panel-family">{value ?? current.name}</span>
        <Icon name="chevron-down" className="orca-panel-icon" />
      </button>
      {!open ? null : (
        <div
          ref={menu}
          tabIndex={-1}
          className="orca-panel-menu"
          data-testid="orca-panel-variants"
          onKeyDown={keyed}
          onBlur={() => {
            setOpen(false);
          }}
        >
          <div className="orca-panel-rows" data-offered={variants.length}>
            {variants.map((variant, row) => (
              <div
                key={variant.name}
                className={row === at ? "orca-panel-option is-on" : "orca-panel-option"}
                data-testid="orca-panel-variant"
                data-variant={variant.name}
                style={{
                  fontFamily: `"${previewFamily(variantFamily(family, variant))}", var(--font-text)`,
                }}
                // The menu keeps focus, so the blur that would close it
                // never fires before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(variant);
                }}
              >
                {variant.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The value a row inherits when the key it writes is cleared. A scene
 * break with no size of its own prints at the body's size, so the row
 * draws that rather than "none".
 */
function inherited(
  key: string,
  cleared: Readonly<Record<string, Written>>,
): Written | undefined {
  return key === "scene-break-size" ? cleared["body-size"] : undefined;
}

/**
 * The face a font row draws. A scene break with no font of its own is
 * set in the body's face, and a design that names no body font is set
 * in the face the engine carries.
 */
function carried(full: Readonly<Record<string, Written>>): string {
  return stringOf(full["body-font"]) ?? CARRIED;
}

/** The font key a variant key sits beside. */
function fontKeyOf(key: string): string {
  return key.replace(/-variant$/, "");
}

function stringOf(value: Written | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

/** The name of a font's default variant, for a family with more than one. */
function defaultVariant(index: FontIndex, font: Written | undefined): string | undefined {
  return offeredVariants(index, stringOf(font))?.variants.find((each) => each.isDefault)?.name;
}
