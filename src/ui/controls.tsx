/**
 * The controls the design panel is drawn from.
 *
 * Each one takes the value the design holds and reports the value the
 * note is to write. A control that reports `undefined` clears the key,
 * so the layer under the design shows through again.
 *
 * A typed field commits on blur and on Enter rather than on the
 * keystroke, so a half-typed length never crosses to the engine.
 */

import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Written } from "@/style/design";
import type { Choice } from "@/ui/groups";
import { Icon } from "@/ui/icon";

/** Told the value a control settled on. */
export type Settle = (value: Written | undefined) => void;

/** One row: the label, and the controls beside it. */
export function Row({
  label,
  said,
  testid,
  children,
}: {
  label: string;
  said?: string;
  testid?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="orca-panel-line">
      <div className="orca-panel-row">
        <span className="orca-panel-label">{label}</span>
        {children}
      </div>
      {said === undefined ? null : (
        <div className="orca-panel-row">
          <span className="orca-panel-label" />
          <span className="orca-panel-said" data-testid={testid}>
            {said}
          </span>
        </div>
      )}
    </div>
  );
}

/** A word picked from a list, drawn as Obsidian's own dropdown. */
export function Select({
  value,
  choices,
  testid,
  settle,
}: {
  value: string | undefined;
  choices: readonly Choice[];
  testid: string;
  settle: Settle;
}): JSX.Element {
  return (
    <select
      className="dropdown orca-panel-select"
      data-testid={testid}
      value={value ?? ""}
      onChange={(event) => {
        settle(event.target.value === "" ? undefined : event.target.value);
      }}
    >
      {value === undefined ? <option value="">—</option> : null}
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

/** A word picked from two or three, drawn as one control. */
export function Segment({
  value,
  choices,
  testid,
  settle,
}: {
  value: string | undefined;
  choices: readonly Choice[];
  testid: string;
  settle: Settle;
}): JSX.Element {
  return (
    <div className="orca-panel-segment" data-testid={testid} data-on={value ?? ""}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className={
            choice.value === value
              ? "orca-panel-choice is-on"
              : "orca-panel-choice"
          }
          data-testid={`${testid}-${choice.value}`}
          aria-pressed={choice.value === value}
          onClick={() => {
            settle(choice.value);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** A switch, which writes yes or no rather than clears the key. */
export function Switch({
  on,
  testid,
  settle,
}: {
  on: boolean | undefined;
  testid: string;
  settle: Settle;
}): JSX.Element {
  return (
    <div
      className={
        on === true
          ? "checkbox-container is-enabled orca-panel-switch"
          : "checkbox-container orca-panel-switch"
      }
    >
      <input
        type="checkbox"
        data-testid={testid}
        checked={on === true}
        onChange={(event) => {
          settle(event.target.checked);
        }}
      />
    </div>
  );
}

/** A length, written the way the note writes it: a number and a unit. */
export function Measure({
  value,
  testid,
  settle,
}: {
  value: Written | undefined;
  testid: string;
  settle: Settle;
}): JSX.Element {
  return (
    <Typed
      value={value === undefined ? "" : String(value)}
      testid={testid}
      className="orca-panel-measure"
      settle={(typed) => {
        settle(typed === "" ? undefined : typed);
      }}
    />
  );
}

/** A number of lines, which is how a sink and a drop cap are decided. */
export function Count({
  value,
  testid,
  settle,
}: {
  value: Written | undefined;
  testid: string;
  settle: Settle;
}): JSX.Element {
  return (
    <Typed
      value={value === undefined ? "" : String(value)}
      testid={testid}
      className="orca-panel-count"
      settle={(typed) => {
        const count = Number(typed);
        if (typed === "") {
          settle(undefined);
        } else if (Number.isInteger(count) && count >= 0) {
          settle(count);
        }
      }}
    />
  );
}

/** The word a scene break is marked with. */
export function Words({
  value,
  testid,
  settle,
}: {
  value: Written | undefined;
  testid: string;
  settle: Settle;
}): JSX.Element {
  return (
    <Typed
      value={value === undefined ? "" : String(value)}
      testid={testid}
      className="orca-panel-words"
      settle={(typed) => {
        settle(typed === "" ? undefined : typed);
      }}
    />
  );
}

/** The ornaments on offer, each drawn in the face the book is set in. */
export function Glyphs({
  value,
  glyphs,
  testid,
  settle,
}: {
  value: Written | undefined;
  glyphs: readonly string[];
  testid: string;
  settle: Settle;
}): JSX.Element {
  const on = value === undefined ? undefined : String(value);
  const offered = glyphs.includes(on ?? "") || on === undefined
    ? glyphs
    : [...glyphs, on];
  return (
    <div className="orca-panel-glyphs" data-testid={testid} data-on={on ?? ""}>
      {offered.map((glyph) => (
        <button
          key={glyph}
          type="button"
          className={
            glyph === on ? "orca-panel-glyph is-on" : "orca-panel-glyph"
          }
          data-testid={`${testid}-${glyph}`}
          aria-pressed={glyph === on}
          onClick={() => {
            settle(glyph === on ? undefined : glyph);
          }}
        >
          {glyph}
        </button>
      ))}
    </div>
  );
}

/** The warning under a control, which comes from orca rather than the engine. */
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

/**
 * A field typed into. The value shown is the design's until the author
 * types, and the design's again once the edit settles, so a paint that
 * lands mid-word does not take the caret away.
 */
function Typed({
  value,
  testid,
  className,
  settle,
}: {
  value: string;
  testid: string;
  className: string;
  settle: (typed: string) => void;
}): JSX.Element {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== field.current) setTyped(undefined);
  }, [value]);

  const commit = (): void => {
    const settled = typed;
    setTyped(undefined);
    if (settled !== undefined && settled !== value) settle(settled.trim());
  };

  const keyed = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setTyped(undefined);
    }
  };

  return (
    <input
      ref={field}
      type="text"
      className={className}
      data-testid={testid}
      value={typed ?? value}
      onChange={(event) => {
        setTyped(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={keyed}
    />
  );
}
