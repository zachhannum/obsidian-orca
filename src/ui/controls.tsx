/**
 * The controls in the design panel.
 *
 * Each control takes the value it draws and reports the value to write
 * to the note. A control that reports `undefined` clears the key, so the
 * default applies again. For a key that the book does not set, a control
 * draws the default in faint type.
 *
 * A typed field commits on blur and on Enter, not on each keystroke, so
 * the engine never gets a half-typed length.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { covered, type Cover } from "@/assets/cmap";
import type { Unit, Written } from "@/style/design";
import type { Place } from "@/style/origin";
import type { Override } from "@/style/overrides";
import {
  stepSaid,
  stepped,
  typed,
  type Choice,
  type Measure,
  type Typed,
} from "@/ui/groups";
import { Icon } from "@/ui/icon";
import { browsing, glyphName, COLUMNS } from "@/ui/glyphs";
import { previewFamily } from "@/ui/picker";

/** A control calls it with the value it settles on. */
export type Settle = (value: Written | undefined) => void;

/**
 * A field calls it with the error line for its text, or with `undefined`
 * once the text is correct.
 */
export type Wrong = (said: string | undefined) => void;

/** One line under a row. */
export interface Under {
  said: string;
  testid?: string | undefined;
  /** True for a field's error line. */
  wrong?: boolean;
}

/** The declarations of the author's CSS that override a row. */
export interface Overridden {
  /** Never empty. The first names the row and is the one a click opens. */
  overrides: readonly Override[];
  testid: string;
  /** True when the CSS beats every key in the row, so the label dims too. */
  every: boolean;
  /** Opens the CSS view at a place. */
  open: (place: Place) => void;
}

/** The gap between the lock and its card, and between the card and the window's edge. */
const CARD_GAP = 6;

/**
 * Draws the lock on an overridden row. A hover or focus opens a card with
 * each overriding declaration and its place. The card is drawn on the
 * body because the panel clips overflow. It sits above the lock, or below
 * when the window has no room above.
 */
function Lock({ overridden }: { overridden: Overridden }): JSX.Element {
  const lock = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<HTMLElement | undefined>(undefined);
  const id = useId();
  const first = overridden.overrides[0];

  useLayoutEffect(() => {
    const button = lock.current;
    const drawn = card.current;
    if (body === undefined || button === null || drawn === null) return;
    const view = button.ownerDocument.defaultView ?? window;
    const at = button.getBoundingClientRect();
    const size = drawn.getBoundingClientRect();
    const above = at.top - CARD_GAP - size.height;
    const top = above >= CARD_GAP ? above : at.bottom + CARD_GAP;
    const left = Math.min(
      Math.max(at.right - size.width, CARD_GAP),
      view.innerWidth - size.width - CARD_GAP,
    );
    drawn.style.top = `${String(Math.max(top, CARD_GAP))}px`;
    drawn.style.left = `${String(Math.max(left, CARD_GAP))}px`;
  }, [body, overridden.overrides]);

  const show = (): void => {
    setBody(lock.current?.ownerDocument.body);
  };
  const hide = (): void => {
    setBody(undefined);
  };
  return (
    <>
      <button
        ref={lock}
        type="button"
        className="orca-panel-overridden"
        data-testid={overridden.testid}
        aria-describedby={body === undefined ? undefined : id}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || body === undefined) return;
          event.stopPropagation();
          hide();
        }}
        onClick={() => {
          hide();
          if (first !== undefined) overridden.open(first);
        }}
      >
        <Icon name="lock" className="orca-panel-overridden-icon" />
        {/* Obsidian draws an aria-label as its own tooltip, so the name is hidden text. */}
        <span className="orca-visually-hidden">
          {`Overridden by line ${String(first?.line)} of the book's CSS`}
        </span>
      </button>
      {body === undefined
        ? null
        : createPortal(
            <div
              ref={card}
              id={id}
              role="tooltip"
              className="orca-card mod-floating"
              data-testid="orca-panel-card"
            >
              {overridden.overrides.map((override) => (
                <div
                  key={`${override.sheet}:${String(override.line)}:${String(override.column)}:${override.property}`}
                  className="orca-card-row mod-overridden"
                >
                  <Icon name="lock" className="orca-card-icon" />
                  <div className="orca-card-body">
                    <div className="orca-card-said">
                      <code>{override.property}</code> is overridden with value{" "}
                      <code>{override.value}</code>
                      {override.declared === override.property ? null : (
                        <>
                          {" "}
                          from <code>{override.declared}</code>
                        </>
                      )}
                    </div>
                    <div className="orca-card-at">
                      {`${override.sheet}:${String(override.line)}:${String(override.column)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>,
            body,
          )}
    </>
  );
}

/** Why a control takes no input: its key sets nothing yet, or the author's CSS overrides it. */
export type Inactive = "unset" | "overridden";

/**
 * The props every inactive control carries. It dims, and it is inert, so
 * it takes no click, focus or key, and nothing inside it can open. A list
 * that cannot open is never drawn at the dim's opacity.
 */
export function inactive(reason: Inactive | undefined): {
  className: string | undefined;
  inert: boolean;
  "data-inactive": Inactive | undefined;
} {
  return {
    className: reason === undefined ? undefined : "is-inactive",
    inert: reason !== undefined,
    "data-inactive": reason,
  };
}

/**
 * Draws one row of the panel. The row keeps the slot for the reset even
 * when it has no reset, so the controls do not move when the book starts
 * or stops setting the row.
 */
export function Row({
  label,
  grid,
  reset,
  under,
  keys = [],
  dim = false,
  overridden,
  children,
}: {
  label: string;
  grid: boolean;
  reset: ReactNode;
  under: readonly Under[];
  /** The design keys the row writes. The inspect pane finds the row by these keys. */
  keys?: readonly string[];
  /** True when the row sets nothing until another row is set. */
  dim?: boolean;
  /** Set when the author's CSS has overridden the row. */
  overridden?: Overridden | undefined;
  children: ReactNode;
}): JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const line = overridden?.overrides[0]?.line;
  // The e2e suite waits on this, so it is written once React commits.
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) return;
    if (line === undefined) element.removeAttribute("data-overridden");
    else element.setAttribute("data-overridden", String(line));
  }, [line]);
  // A grid dims each overridden cell where it sits, so only a row's
  // own controls go inactive as a whole. The lock and the reset stay live.
  const controls = inactive(
    dim ? "unset" : !grid && overridden !== undefined ? "overridden" : undefined,
  );
  return (
    <div
      ref={row}
      className={classes(
        "orca-panel-line",
        overridden !== undefined && "mod-overridden",
        dim && "mod-dim",
      )}
      data-keys={keys.length === 0 ? undefined : keys.join(" ")}
      data-dim={dim ? "" : undefined}
    >
      <div className={grid ? "orca-panel-row mod-grid" : "orca-panel-row"}>
        <span
          className={classes(
            "orca-panel-label",
            (dim || overridden?.every === true) && "is-inactive",
          )}
        >
          {label}
        </span>
        <div
          {...controls}
          className={classes("orca-panel-controls", grid && "orca-panel-grid", controls.className)}
        >
          {children}
        </div>
        {overridden === undefined ? null : <Lock overridden={overridden} />}
        <div className="orca-panel-reset-slot">{reset}</div>
      </div>
      {under.map((line) => (
        <div
          key={line.testid ?? line.said}
          className={
            line.wrong === true ? "orca-panel-under mod-wrong" : "orca-panel-under"
          }
          data-testid={line.testid}
        >
          {line.said}
        </div>
      ))}
    </div>
  );
}

/** Draws the reset at the end of a row that the book sets, as Obsidian's icon button. */
export function Reset({
  said,
  testid,
  reset,
}: {
  said: string;
  testid: string;
  reset: () => void;
}): JSX.Element {
  return (
    <div
      className="clickable-icon orca-panel-reset"
      role="button"
      tabIndex={0}
      aria-label={said}
      data-testid={testid}
      onClick={reset}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          reset();
        }
      }}
    >
      <Icon name="rotate-ccw" className="orca-panel-icon" />
    </div>
  );
}

/**
 * Draws a word picked from a list, as Obsidian's own dropdown. The
 * dropdown also offers a value that the note holds and the list does not,
 * so it never draws a choice that the book is not set in.
 */
export function Select({
  value,
  faint,
  choices,
  testid,
  settle,
}: {
  value: string | undefined;
  faint: boolean;
  choices: readonly Choice[];
  testid: string;
  settle: Settle;
}): JSX.Element {
  const offered =
    value === undefined || choices.some((choice) => choice.value === value)
      ? choices
      : [...choices, { value, label: value }];
  return (
    <select
      className={classes("dropdown orca-panel-select", faint && "is-default")}
      data-testid={testid}
      data-default={String(faint)}
      value={value ?? ""}
      onChange={(event) => {
        settle(event.target.value === "" ? undefined : event.target.value);
      }}
    >
      {value === undefined ? <option value="">—</option> : null}
      {offered.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

/** Draws a word picked from a few choices, as one control. */
export function Segment({
  value,
  faint,
  choices,
  testid,
  settle,
}: {
  value: string | undefined;
  faint: boolean;
  choices: readonly Choice[];
  testid: string;
  settle: Settle;
}): JSX.Element {
  return (
    <div
      className="orca-panel-segment"
      data-testid={testid}
      data-on={value ?? ""}
      data-default={String(faint)}
    >
      {choices.map((choice) => {
        const on = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            className={classes(
              "orca-panel-choice",
              on && "is-on",
              on && faint && "is-default",
            )}
            data-testid={`${testid}-${choice.value}`}
            aria-pressed={on}
            aria-label={choice.icon === undefined ? undefined : choice.label}
            onClick={() => {
              settle(choice.value);
            }}
          >
            {choice.icon === undefined ? (
              choice.label
            ) : (
              <Icon name={choice.icon} className="orca-panel-icon" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Draws tabs over the rows under them. The rows draw the same controls
 * for the value that the tab picks. Picking a tab writes nothing to the
 * note.
 */
export function Tabs({
  value,
  choices,
  testid,
  choose,
}: {
  value: string;
  choices: readonly Choice[];
  testid: string;
  choose: (value: string) => void;
}): JSX.Element {
  return (
    <div className="orca-panel-tabs" role="tablist" data-testid={testid} data-on={value}>
      {choices.map((choice) => {
        const on = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="tab"
            className={classes("orca-panel-tab", on && "is-on")}
            data-testid={`${testid}-${choice.value}`}
            aria-selected={on}
            onClick={() => {
              choose(choice.value);
            }}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Draws a switch as Obsidian's toggle. The container handles the click,
 * as in Obsidian's own toggle, and the input inside it only holds the
 * state. A click on the input bubbles up to the container once.
 */
export function Switch({
  on,
  faint,
  testid,
  settle,
}: {
  on: boolean;
  faint: boolean;
  testid: string;
  settle: Settle;
}): JSX.Element {
  const flip = (): void => {
    settle(!on);
  };
  return (
    <div
      className={classes("checkbox-container orca-panel-switch", on && "is-enabled")}
      role="switch"
      aria-checked={on}
      tabIndex={0}
      data-testid={testid}
      data-default={String(faint)}
      onClick={flip}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          flip();
        }
      }}
    >
      <input type="checkbox" tabIndex={-1} aria-hidden="true" checked={on} readOnly />
    </div>
  );
}

/**
 * Draws a text field. The field shows the drawn value until the author
 * types, and shows it again once the edit settles. A paint that lands
 * mid-word therefore does not move the caret.
 *
 * With a measure, it is a number field. The field reads its text before
 * it writes it. Text that it cannot read stays in the field, with an
 * error line under the row. The stepper and the arrow keys move the
 * value by one step of its unit, from the value drawn. The field reads a
 * bare number in `unit`.
 */
export function Field({
  measure,
  unit,
  value,
  faint,
  testid,
  wrong,
  settle,
}: {
  measure?: Measure;
  unit?: Unit | undefined;
  value: string;
  faint: boolean;
  testid: string;
  wrong: Wrong;
  settle: Settle;
}): JSX.Element {
  const [text, setText] = useState<string | undefined>(undefined);
  const [invalid, setInvalid] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const told = useRef({ wrong, invalid });

  useEffect(() => {
    told.current = { wrong, invalid };
  });

  // When the field unmounts with text it cannot read, it clears its error line.
  useEffect(
    () => () => {
      if (told.current.invalid) told.current.wrong(undefined);
    },
    [],
  );

  const heard = (said: string | undefined): void => {
    if (said !== undefined || invalid) wrong(said);
    setInvalid(said !== undefined);
  };

  useEffect(() => {
    if (document.activeElement === field.current) return;
    setText(undefined);
    heard(undefined);
    // Only a new value resets the field to the drawn value.
  }, [value]);

  const commit = (): void => {
    if (text === undefined) return;
    const trimmed = text.trim();
    if (trimmed === "") {
      setText(undefined);
      heard(undefined);
      if (!faint) settle(undefined);
      return;
    }
    const read: Typed =
      measure === undefined ? { value: trimmed } : typed(measure, trimmed, unit);
    if ("wrong" in read) {
      heard(read.wrong);
      return;
    }
    setText(undefined);
    heard(undefined);
    if (faint || String(read.value) !== value) settle(read.value);
  };

  // The field shows the stepped text at once, so a second step before
  // the paint starts from the first step and not from the value drawn.
  const step = (by: 1 | -1, times: number): void => {
    if (measure === undefined) return;
    const next =
      stepped(measure, text ?? value, by, times, unit) ??
      stepped(measure, value, by, times, unit) ??
      stepped(measure, "0", by, times, unit);
    if (next === undefined) return;
    heard(undefined);
    setText(String(next));
    if (faint || String(next) !== value) settle(next);
  };

  const keyed = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setText(undefined);
      heard(undefined);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (measure === undefined) return;
      event.preventDefault();
      step(event.key === "ArrowUp" ? 1 : -1, event.shiftKey ? 10 : 1);
    }
  };

  const input = (
    <input
      ref={field}
      type="text"
      className={classes(
        "orca-panel-text",
        measure === undefined && "orca-panel-words",
        faint && text === undefined && "is-default",
        invalid && "is-invalid",
      )}
      data-testid={testid}
      data-default={String(faint)}
      aria-invalid={invalid}
      spellCheck={false}
      value={text ?? value}
      onChange={(event) => {
        setText(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={keyed}
    />
  );
  if (measure === undefined) return input;

  const from = text ?? value;
  return (
    <div className="orca-panel-number">
      {input}
      <div className="orca-panel-stepper">
        {([1, -1] as const).map((by) => (
          <button
            key={by}
            type="button"
            tabIndex={-1}
            className="orca-panel-step"
            data-testid={`${testid}-${by === 1 ? "up" : "down"}`}
            aria-label={stepSaid(measure, from, by, unit)}
            // The field keeps the focus, so a step does not first commit
            // what was typed and then step from the value before it.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={(event) => {
              step(by, event.shiftKey ? 10 : 1);
            }}
          >
            <Icon
              name={by === 1 ? "chevron-up" : "chevron-down"}
              className="orca-panel-icon"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The cells the browser draws before it offers more. A face of forty thousand code points draws no forty thousand buttons. */
const CELLS = 512;

/**
 * Draws the ornaments on offer and the browser over the face the scene
 * break is set in. The browser lists every code point that face covers,
 * so an ornamental font's own ornaments are picked by eye. Its opener
 * holds the mark when the mark is none of the ornaments offered, so the
 * row shows the mark whatever it is.
 */
export function Glyphs({
  value,
  faint,
  glyphs,
  family,
  read,
  testid,
  settle,
}: {
  value: string | undefined;
  faint: boolean;
  glyphs: readonly string[];
  /** The family the browser reads, which is the face the scene break sets in. */
  family: string;
  read: (family: string) => Promise<readonly Cover[]>;
  testid: string;
  settle: Settle;
}): JSX.Element {
  const own = value !== undefined && !glyphs.includes(value) ? value : "";
  const [open, setOpen] = useState(false);
  const [spans, setSpans] = useState<readonly Cover[] | undefined>(undefined);
  const [text, setText] = useState("");
  const [at, setAt] = useState(0);
  const [budget, setBudget] = useState(CELLS);
  const filter = useRef<HTMLInputElement>(null);
  const browser = useRef<HTMLDivElement>(null);
  const reader = useRef(read);
  const found = useMemo(() => browsing(spans ?? [], text, at), [spans, text, at]);

  useEffect(() => {
    reader.current = read;
  });

  useEffect(() => {
    if (!open) return;
    filter.current?.focus();
    let live = true;
    void reader.current(family).then((covers) => {
      if (live) setSpans(covers);
    });
    return () => {
      live = false;
    };
  }, [open, family]);

  useEffect(() => {
    // An arrow key past the last cell drawn brings more cells in.
    if (found.at >= budget) setBudget(budget + CELLS);
  }, [found.at, budget]);

  useEffect(() => {
    const el = browser.current;
    if (el === null) return;
    // React commits when it chooses, so a count written during a render
    // could be read before the paint that reports it.
    el.dataset["covered"] = spans === undefined ? "" : String(covered(spans));
    el.dataset["offered"] = String(found.offered);
    el.dataset["shown"] = String(budget);
  });

  const close = (): void => {
    setOpen(false);
    setText("");
    setAt(0);
    setBudget(CELLS);
  };

  const commit = (code: number | undefined): void => {
    if (code === undefined) return;
    settle(String.fromCodePoint(code));
    close();
  };

  const keyed = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setAt(found.at + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setAt(Math.max(found.at - 1, 0));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setAt(found.at + COLUMNS);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAt(Math.max(found.at - COLUMNS, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setAt(found.offered - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(found.commits);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const set = value === undefined ? undefined : value.codePointAt(0);
  let cell = 0;
  const drawn: ReactNode[] = [];
  for (const section of found.sections) {
    if (cell >= budget) break;
    const cells: ReactNode[] = [];
    for (const span of section.spans) {
      for (let code = span.from; code <= span.to && cell < budget; code += 1) {
        const here = cell;
        cell += 1;
        cells.push(
          <button
            key={code}
            type="button"
            className={classes(
              "orca-panel-glyph-cell",
              here === found.at && "is-at",
              code === set && "is-on",
            )}
            data-testid="orca-panel-glyph-cell"
            data-code={glyphName(code)}
            title={glyphName(code)}
            aria-label={glyphName(code)}
            // The cell draws in the face the coverage was read from. A
            // face the browser fell back to would show a glyph this one
            // does not have.
            style={{ fontFamily: `"${previewFamily(family)}"` }}
            onMouseDown={(event) => {
              event.preventDefault();
              commit(code);
            }}
          >
            {String.fromCodePoint(code)}
          </button>,
        );
      }
    }
    const first = section.spans[0]?.from ?? 0;
    drawn.push(
      <div key={`${section.name} ${first}`} className="orca-panel-glyph-block">
        <div className="orca-panel-glyph-name" data-testid="orca-panel-glyph-block">
          {section.name}
        </div>
        <div className="orca-panel-glyph-grid">{cells}</div>
      </div>,
    );
  }

  return (
    <div
      className="orca-panel-glyphs"
      data-testid={testid}
      data-on={value ?? ""}
      data-default={String(faint)}
    >
      <div className="orca-panel-glyph-row">
        {glyphs.map((glyph) => {
          const on = glyph === value;
          return (
            <button
              key={glyph}
              type="button"
              className={classes(
                "orca-panel-glyph",
                on && "is-on",
                on && faint && "is-default",
              )}
              data-testid={`${testid}-${glyph}`}
              aria-pressed={on}
              onClick={() => {
                if (faint || !on) settle(glyph);
              }}
            >
              {glyph}
            </button>
          );
        })}
        <button
          type="button"
          className={classes(
            "orca-panel-glyph",
            own !== "" && "is-on",
            own !== "" && faint && "is-default",
          )}
          data-testid={`${testid}-browse`}
          aria-label={`Browse the glyphs in ${family}`}
          aria-expanded={open}
          style={own === "" ? undefined : { fontFamily: `"${previewFamily(family)}"` }}
          onClick={() => {
            if (open) close();
            else setOpen(true);
          }}
        >
          {own === "" ? <Icon name="layout-grid" className="orca-panel-icon" /> : own}
        </button>
      </div>
      {!open ? null : (
        <div
          ref={browser}
          className="orca-panel-menu"
          data-testid={`${testid}-browser`}
        >
          <input
            ref={filter}
            type="text"
            className="orca-panel-filter"
            data-testid="orca-panel-glyph-filter"
            placeholder="Block, hex or glyph"
            spellCheck={false}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setAt(0);
              setBudget(CELLS);
            }}
            onKeyDown={keyed}
            onBlur={close}
          />
          <div className="orca-panel-rows" data-testid="orca-panel-glyph-rows">
            {drawn}
            {spans === undefined ? (
              <div className="orca-panel-none">Reading {family}</div>
            ) : found.offered > 0 ? null : (
              <div className="orca-panel-none" data-testid="orca-panel-glyph-nothing">
                {covered(spans) === 0
                  ? `orca has no file for ${family}`
                  : "No glyph there"}
              </div>
            )}
            {found.offered <= budget ? null : (
              <div
                className="orca-panel-glyph-more"
                data-testid="orca-panel-glyph-more"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setBudget(budget + CELLS);
                }}
              >
                Show more
              </div>
            )}
          </div>
          {spans === undefined ? null : (
            <div className="orca-panel-glyph-count">
              {covered(spans)} code points in {family}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Draws a warning under a control. The warning comes from orca, not from the engine. */
export function Warning({
  said,
  testid,
}: {
  said: string;
  testid: string;
}): JSX.Element {
  return (
    <div className="orca-panel-warning" data-testid={testid}>
      <Icon name="alert-circle" className="orca-panel-icon" />
      <span>{said}</span>
    </div>
  );
}

export function classes(...names: (string | false | undefined)[]): string {
  return names.filter((name) => typeof name === "string").join(" ");
}
