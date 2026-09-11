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
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Unit, Written } from "@/style/design";
import {
  stepSaid,
  stepped,
  typed,
  type Choice,
  type Measure,
  type Typed,
} from "@/ui/groups";
import { Icon } from "@/ui/icon";

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
  children,
}: {
  label: string;
  grid: boolean;
  reset: ReactNode;
  under: readonly Under[];
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="orca-panel-line">
      <div className={grid ? "orca-panel-row mod-grid" : "orca-panel-row"}>
        <span className="orca-panel-label">{label}</span>
        <div
          className={
            grid ? "orca-panel-controls orca-panel-grid" : "orca-panel-controls"
          }
        >
          {children}
        </div>
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
            onClick={() => {
              settle(choice.value);
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

/** Draws the ornaments on offer. */
export function Glyphs({
  value,
  faint,
  glyphs,
  testid,
  settle,
}: {
  value: string | undefined;
  faint: boolean;
  glyphs: readonly string[];
  testid: string;
  settle: Settle;
}): JSX.Element {
  const offered =
    value === undefined || glyphs.includes(value) ? glyphs : [...glyphs, value];
  return (
    <div
      className="orca-panel-glyphs"
      data-testid={testid}
      data-on={value ?? ""}
      data-default={String(faint)}
    >
      {offered.map((glyph) => {
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

function classes(...names: (string | false)[]): string {
  return names.filter((name) => name !== false).join(" ");
}
