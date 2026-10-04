/**
 * The inspect pane, at the top of the CSS view of the design panel. It
 * shows the box pinned in the preview, with its ancestors as crumbs,
 * the rules the engine matched by layer, and some computed values. Orca
 * computes none of these. A warning from the engine keeps the engine's
 * words.
 *
 * On a phone the panel's drawer covers the page, so the same pane is
 * drawn as a sheet over the foot of the page.
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import type { InspectedDeclaration, MatchedRule } from "fleuron";
import type { PageUnit } from "@/style/design";
import type { Layer } from "@/style/layers";
import { ACTIONS } from "@/ui/actions";
import type { Skipped } from "@/ui/editor";
import { ownerSaid, type Owner } from "@/ui/groups";
import { Icon } from "@/ui/icon";
import {
  boxKey,
  computedRows,
  crumbsOf,
  pulled,
  ruleFor,
  selectorFor,
  specificPicks,
  targetKey,
  type Pin,
  type Pull,
} from "@/ui/inspect";

/** One matched rule as the pane draws it. */
export interface ShownRule {
  rule: MatchedRule;
  /** The control that wrote a design panel rule. */
  owner: Owner | undefined;
  /** The declarations in an author's rule that the engine refused, which it leaves out of the rule. */
  skipped: readonly Skipped[];
}

/** The pinned box and what the view read around it. */
export interface Inspecting {
  pin: Pin;
  layers: readonly { layer: Layer; rules: readonly ShownRule[] }[];
  /** The line the editor's caret is on, where "Add a rule" writes. */
  caret: number | undefined;
}

export interface PaneActing {
  /** Puts the editor's caret on a line and column of the author's CSS, and focuses it. */
  cursor(line: number, column: number): void;
  /** Opens the control that wrote a rule. */
  open(owner: Owner): void;
  /** Puts a rule in at the editor's caret. */
  add(text: string): void;
  /** Takes the pin off in the preview, which closes the pane. */
  unpin(): void;
  /** Pins the box one node names, which replaces the pinned one. */
  pin(node: number): void;
}

const LAYER_SAID: Readonly<Record<Layer, string>> = {
  own: "Book CSS",
  design: "Design panel",
  theme: "Orca's theme",
};

/**
 * Draws the pane. The panel keys it by the box. The crumbs the author
 * picked stay when a refreshed pin names the same box, and clear for
 * another box.
 */
export function InspectPane({
  inspecting,
  unit,
  acting,
}: {
  inspecting: Inspecting;
  unit: PageUnit;
  acting: PaneActing;
}): JSX.Element {
  const { pin, layers, caret } = inspecting;
  const { inspection } = pin;
  const [picked, setPicked] = useState<readonly number[]>(() => specificPicks(inspection));
  const pane = useRef<HTMLDivElement>(null);
  const key = targetKey(pin.target);

  // The e2e suite waits on the generation the pane shows, so it is
  // written once React has committed that pin.
  useEffect(() => {
    const element = pane.current;
    if (element === null) return;
    element.dataset["inspected"] = key;
    element.dataset["generation"] = String(pin.generation);
  }, [key, pin.generation]);

  const selector = selectorFor(inspection, picked);
  const margin = inspection.node === null && inspection.page !== undefined;
  const rows = computedRows(inspection.computed, inspection.boxes, unit);

  return (
    <div className="orca-inspect-pane" data-testid="orca-inspect-pane" ref={pane}>
      <div className="orca-inspect-top">
        <Icon name="crosshair" className="orca-inspect-icon" />
        <div className="orca-inspect-crumbs">
          {crumbsOf(inspection).map((crumb, at) => {
            const ancestor = crumb.ancestor;
            const pins = crumb.pins;
            const last = ancestor === undefined && at > 0;
            const on = last || (ancestor !== undefined && picked.includes(ancestor));
            return (
              <span key={at} className="orca-inspect-crumb-slot">
                {at === 0 ? null : <span className="orca-inspect-sep">›</span>}
                <button
                  type="button"
                  className={on ? "orca-inspect-crumb is-active" : "orca-inspect-crumb"}
                  data-testid="orca-inspect-crumb"
                  data-picked={ancestor === undefined ? undefined : String(on)}
                  data-pins={pins === undefined ? undefined : String(pins)}
                  disabled={ancestor === undefined && pins === undefined}
                  onClick={() => {
                    if (pins !== undefined) {
                      acting.pin(pins);
                      return;
                    }
                    if (ancestor === undefined) return;
                    setPicked(
                      picked.includes(ancestor)
                        ? picked.filter((each) => each !== ancestor)
                        : [...picked, ancestor],
                    );
                  }}
                >
                  {crumb.name}
                  {crumb.faint === undefined ? null : <i>{crumb.faint}</i>}
                </button>
              </span>
            );
          })}
        </div>
        <button
          type="button"
          className="clickable-icon orca-inspect-close"
          data-testid="orca-inspect-close"
          aria-label={ACTIONS.unpin.label}
          onClick={() => {
            acting.unpin();
          }}
        >
          <Icon name={ACTIONS.unpin.icon} className="orca-inspect-icon" />
        </button>
      </div>

      {layers.map(({ layer, rules }) => (
        <div
          key={layer}
          className="orca-inspect-group"
          data-testid="orca-inspect-group"
          data-layer={layer}
        >
          <div className="orca-inspect-origin">{LAYER_SAID[layer]}</div>
          {rules.map((shown, at) => (
            <Rule
              key={`${shown.rule.sheet}:${String(shown.rule.line)}:${String(shown.rule.column)}:${String(at)}`}
              layer={layer}
              shown={shown}
              box={margin ? inspection.element : undefined}
              acting={acting}
            />
          ))}
        </div>
      ))}

      {rows.length === 0 ? null : (
        <>
          <div className="orca-inspect-origin">Computed</div>
          <div className="orca-inspect-computed" data-testid="orca-inspect-computed">
            {rows.map((row) => (
              <Fragment key={row.label}>
                <span className="orca-inspect-label">{row.label}</span>
                <span className="orca-inspect-value" data-label={row.label}>
                  {row.value}
                </span>
              </Fragment>
            ))}
          </div>
        </>
      )}

      <div className="orca-inspect-add-row">
        <button
          type="button"
          className="orca-inspect-add"
          data-testid="orca-inspect-add"
          onClick={() => {
            acting.add(ruleFor(inspection, picked));
          }}
        >
          <Icon name="plus" className="orca-inspect-icon" />
          Add a rule for
          <span className="orca-inspect-selector" data-testid="orca-inspect-selector">
            {selector}
          </span>
        </button>
        {caret === undefined ? null : (
          <span className="orca-inspect-note">Line {caret}</span>
        )}
      </div>
    </div>
  );
}

/** The time a sheet takes to settle, in milliseconds. The page moves up over the same time. */
const SETTLE = 200;

/**
 * Draws the pane as a phone's sheet. The grabber pulls it up to the
 * whole pane and down to the first rule, and a pull down from there
 * takes the pin off. The sheet stays as it was pulled when another box
 * is pinned.
 *
 * The sheet follows the finger both ways. The whole pane is laid out
 * as soon as the finger goes up, and it is drawn lower by what the
 * finger has not uncovered yet. The drag moves the element itself and
 * renders nothing, so the sheet keeps up with the finger.
 */
export function InspectSheet({
  inspecting,
  unit,
  acting,
}: {
  inspecting: Inspecting;
  unit: PageUnit;
  acting: PaneActing;
}): JSX.Element {
  const [pull, setPull] = useState<Pull>("peek");
  const sheet = useRef<HTMLDivElement>(null);
  // The drag under way: where the finger went down, and the heights of the two layouts.
  const drag = useRef<{ from: number; peek: number; full: number } | undefined>(undefined);
  // True while the sheet slides to where a drag left it, when a touch moves nothing.
  const settling = useRef(false);

  // The sheet rises from the foot of the screen when a box is pinned.
  useLayoutEffect(() => {
    const element = sheet.current;
    if (element === null || still(element)) return;
    element.animate(
      [{ transform: `translateY(${String(element.offsetHeight)}px)` }, { transform: "translateY(0)" }],
      { duration: SETTLE, easing: "ease-out" },
    );
  }, []);

  /** Draws the sheet where a drag of `by` pixels down has it, and answers the distance it is drawn under the whole pane's place. */
  const follow = (element: HTMLElement, by: number): number => {
    const held = drag.current;
    if (held === undefined) return 0;
    const whole = pull === "full" || by < 0;
    element.dataset["layout"] = whole ? "full" : "peek";
    const under = Math.max(0, (whole && pull === "peek" ? held.full - held.peek : 0) + by);
    element.style.setProperty("transform", `translateY(${String(under)}px)`);
    return whole ? under : under + held.full - held.peek;
  };

  const release = (element: HTMLElement, by: number): void => {
    const held = drag.current ?? { from: 0, peek: heightIn(element, "peek"), full: heightIn(element, "full") };
    drag.current = held;
    const from = follow(element, by);
    drag.current = undefined;
    const next = pulled(pull, by);
    const rest = held.full - held.peek;
    // A sheet on its way out keeps the layout it has, so the page does
    // not move up for a pane that is going.
    const whole = next !== "closed" || element.dataset["layout"] === "full";
    const shown = whole ? 0 : rest;
    const to = next === "full" ? 0 : next === "peek" ? rest : held.full;
    element.dataset["layout"] = whole ? "full" : "peek";
    const done = (): void => {
      settling.current = false;
      if (next === "closed") {
        acting.unpin();
        return;
      }
      element.dataset["layout"] = next;
      element.style.removeProperty("transform");
      setPull(next);
    };
    element.style.setProperty("transform", `translateY(${String(to - shown)}px)`);
    if (still(element) || from === to) {
      done();
      return;
    }
    settling.current = true;
    const sliding = element.animate(
      [
        { transform: `translateY(${String(from - shown)}px)` },
        { transform: `translateY(${String(to - shown)}px)` },
      ],
      { duration: SETTLE, easing: "ease-out" },
    );
    void sliding.finished.then(done, done);
  };

  return (
    <div
      ref={sheet}
      className="orca-inspect-sheet"
      data-testid="orca-inspect-sheet"
      data-pull={pull}
      data-layout={pull}
    >
      <div
        className="orca-inspect-grabber"
        data-testid="orca-inspect-grabber"
        role="button"
        tabIndex={0}
        aria-expanded={pull === "full"}
        aria-label={pull === "full" ? "Show the first rule" : "Show every rule"}
        onPointerDown={(event) => {
          const element = sheet.current;
          if (element === null || settling.current) return;
          for (const rising of element.getAnimations()) rising.finish();
          drag.current = {
            from: event.clientY,
            peek: heightIn(element, "peek"),
            full: heightIn(element, "full"),
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const element = sheet.current;
          const held = drag.current;
          if (element !== null && held !== undefined) follow(element, event.clientY - held.from);
        }}
        onPointerUp={(event) => {
          const element = sheet.current;
          const held = drag.current;
          if (element !== null && held !== undefined) release(element, event.clientY - held.from);
        }}
        onPointerCancel={() => {
          const element = sheet.current;
          if (element === null || drag.current === undefined) return;
          drag.current = undefined;
          element.dataset["layout"] = pull;
          element.style.removeProperty("transform");
        }}
        onKeyDown={(event) => {
          const element = sheet.current;
          if ((event.key !== "Enter" && event.key !== " ") || element === null) return;
          event.preventDefault();
          if (!settling.current) release(element, 0);
        }}
      >
        <div className="menu-grabber" />
      </div>
      <InspectPane key={boxKey(inspecting.pin)} inspecting={inspecting} unit={unit} acting={acting} />
    </div>
  );
}

/** The height the sheet has in one of its two layouts. */
function heightIn(element: HTMLElement, layout: Pull): number {
  const was = element.dataset["layout"];
  element.dataset["layout"] = layout;
  const height = element.offsetHeight;
  if (was === undefined) delete element.dataset["layout"];
  else element.dataset["layout"] = was;
  return height;
}

/** True where the author asked for less motion, and the sheet goes to its place at once. */
function still(element: HTMLElement): boolean {
  return element.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Rule({
  layer,
  shown,
  box,
  acting,
}: {
  layer: Layer;
  shown: ShownRule;
  /** The at-rule of the margin box. It follows the page selector that a margin box rule matched by. */
  box: string | undefined;
  acting: PaneActing;
}): JSX.Element {
  const { rule, owner, skipped } = shown;
  const selector = box === undefined ? rule.selector : `${rule.selector} › ${box}`;
  let source: JSX.Element | null = null;
  if (layer === "own") {
    source = (
      <button
        type="button"
        className="orca-inspect-src"
        onClick={() => {
          acting.cursor(rule.line, rule.column);
        }}
      >
        line {rule.line}
      </button>
    );
  } else if (layer === "design" && owner !== undefined) {
    source =
      owner.layout === undefined ? (
        <button
          type="button"
          className="orca-inspect-src"
          onClick={() => {
            acting.open(owner);
          }}
        >
          {ownerSaid(owner)}
        </button>
      ) : (
        <span className="orca-inspect-src is-faint">{ownerSaid(owner)}</span>
      );
  }
  return (
    <div
      className="orca-inspect-rule"
      data-testid="orca-inspect-rule"
      data-layer={layer}
      data-line={layer === "own" ? String(rule.line) : undefined}
      data-keys={layer === "design" ? keysOf(owner) : undefined}
    >
      <div className="orca-inspect-rule-h">
        <span className="orca-inspect-sel">{selector}</span>
        {source}
      </div>
      {rule.declarations.map((declaration, at) => (
        <Declaration key={at} declaration={declaration} />
      ))}
      {skipped.map((refused, at) => (
        <div
          key={`skipped-${String(at)}`}
          className="orca-inspect-decl is-skipped"
          data-testid="orca-inspect-decl"
          data-skipped="true"
        >
          <span className="orca-inspect-p">{refused.property}</span>
          {refused.value === undefined ? null : (
            <>
              : <span className="orca-inspect-v">{refused.value}</span>;
            </>
          )}
          <div className="orca-inspect-said">{refused.message}</div>
        </div>
      ))}
    </div>
  );
}

/** The key the rule's row carries, so a spec can match the rule to the control it opens. */
function keysOf(owner: Owner | undefined): string | undefined {
  if (owner === undefined) return undefined;
  return owner.key ?? (owner.layout === undefined ? undefined : `role:${owner.layout}`);
}

function Declaration({
  declaration,
}: {
  declaration: InspectedDeclaration;
}): JSX.Element {
  const lost = !declaration.applied;
  return (
    <div
      className={lost ? "orca-inspect-decl is-lost" : "orca-inspect-decl"}
      data-testid="orca-inspect-decl"
      data-lost={lost ? "true" : undefined}
    >
      <span className="orca-inspect-p">{declaration.property}</span>:{" "}
      <span className="orca-inspect-v">
        {declaration.value}
        {declaration.important ? " !important" : ""}
      </span>
      ;
    </div>
  );
}
