/**
 * Draws inspect mode over the painted pages: the box under the pointer
 * and the pinned box, each tinted in its margin, padding and content,
 * outlined on every page it reaches, with a tag beside the first piece.
 *
 * The host is a sibling of the surface in the well. The surface is
 * written again on every paint, so nothing of the overlay lives in it.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect, useState, type CSSProperties, type JSX } from "react";
import type { Inspection } from "fleuron";
import type { PageUnit } from "@/style/design";
import { fragments, layersOf, tagOf, type Rect } from "@/ui/inspect";

/** A box the overlay draws, under the key the surface names it by. */
export interface Marked {
  key: string;
  inspection: Inspection;
  generation?: number;
}

/** A page's trim, in points. */
export interface Trim {
  width: number;
  height: number;
}

export interface Overlaid {
  on: boolean;
  hovered: Marked | undefined;
  pinned: Marked | undefined;
  unit: PageUnit;
  /** The painted pages, counting from 0, and each one's trim. */
  trims: ReadonlyMap<number, Trim>;
  /** Raised on each paint and resize, so the pages are measured again. */
  measured: number;
}

export interface MountedOverlay {
  draw(overlaid: Overlaid): void;
  unmount(): void;
}

export const NO_OVERLAY: Overlaid = {
  on: false,
  hovered: undefined,
  pinned: undefined,
  unit: "in",
  trims: new Map(),
  measured: 0,
};

/** Mounts the overlay beside the surface, inside the well that holds both. */
export function mountOverlay(surface: HTMLElement): MountedOverlay {
  const host = surface.ownerDocument.createElement("div");
  host.className = "orca-inspect-host";
  surface.after(host);
  const root = createRoot(host);
  const draw = (overlaid: Overlaid): void => {
    root.render(<InspectOverlay surface={surface} host={host} overlaid={overlaid} />);
  };
  draw(NO_OVERLAY);
  return {
    draw,
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}

/** A painted page's box, in pixels from the host's corner. */
type Frame = Pick<DOMRect, "left" | "top" | "width" | "height">;

export function InspectOverlay({
  surface,
  host,
  overlaid,
}: {
  surface: HTMLElement;
  host: HTMLElement;
  overlaid: Overlaid;
}): JSX.Element | null {
  const { on, hovered, pinned, unit, trims, measured } = overlaid;
  const [frames, place] = useState<ReadonlyMap<number, Frame>>(new Map());

  useLayoutEffect(() => {
    const corner = host.getBoundingClientRect();
    const found = new Map<number, Frame>();
    for (const page of trims.keys()) {
      const sheet = surface.querySelector(`.orca-page[data-page="${String(page + 1)}"]`);
      if (sheet === null) continue;
      const rect = sheet.getBoundingClientRect();
      found.set(page, {
        left: rect.left - corner.left,
        top: rect.top - corner.top,
        width: rect.width,
        height: rect.height,
      });
    }
    place(found);
  }, [surface, host, trims, measured]);

  // The e2e suite waits on these, so they are written once React has
  // committed what they report.
  const hoveredKey = on ? hovered?.key : undefined;
  const pinnedKey = on ? pinned?.key : undefined;
  const pinnedAt = on ? pinned?.generation : undefined;
  useEffect(() => {
    const data = surface.dataset;
    data["inspect"] = on ? "on" : "off";
    written(data, "hovered", hoveredKey);
    written(data, "inspected", pinnedKey);
    written(data, "inspectedGeneration", pinnedAt === undefined ? undefined : String(pinnedAt));
  }, [surface, on, hoveredKey, pinnedKey, pinnedAt]);

  if (!on) return null;
  const drawn: { marked: Marked; pinned: boolean }[] = [];
  if (pinned !== undefined) drawn.push({ marked: pinned, pinned: true });
  if (hovered !== undefined && hovered.key !== pinned?.key) {
    drawn.push({ marked: hovered, pinned: false });
  }
  return (
    <>
      {drawn.map(({ marked, pinned: held }) => (
        <Outline
          key={`${held ? "pinned" : "hovered"}:${marked.key}`}
          inspection={marked.inspection}
          pinned={held}
          frames={frames}
          trims={trims}
          unit={unit}
        />
      ))}
    </>
  );
}

function written(data: DOMStringMap, name: string, value: string | undefined): void {
  if (value === undefined) delete data[name];
  else data[name] = value;
}

function Outline({
  inspection,
  pinned,
  frames,
  trims,
  unit,
}: {
  inspection: Inspection;
  pinned: boolean;
  frames: ReadonlyMap<number, Frame>;
  trims: ReadonlyMap<number, Trim>;
  unit: PageUnit;
}): JSX.Element {
  const state = pinned ? "pinned" : "hovered";
  const pieces = fragments(inspection.boxes, frames.keys());
  return (
    <>
      {pieces.map(({ box, cut }, at) => {
        const frame = frames.get(box.page);
        const trim = trims.get(box.page);
        if (frame === undefined || trim === undefined) return null;
        const layers = layersOf(box, inspection.computed);
        const tag = at === 0 ? tagOf(inspection, unit, box) : undefined;
        const edge = ["orca-inspect", "orca-inspect-edge"];
        if (pinned) edge.push("is-pinned");
        if (cut !== "none") edge.push(`is-cut-${cut}`);
        return (
          <div
            key={box.page}
            className="orca-inspect-frame"
            data-state={state}
            style={{
              left: `${String(frame.left)}px`,
              top: `${String(frame.top)}px`,
              width: `${String(frame.width)}px`,
              height: `${String(frame.height)}px`,
            }}
          >
            <div
              className="orca-inspect orca-inspect-margin"
              data-testid="orca-inspect-margin"
              style={placed(layers.margin, trim)}
            />
            <div
              className="orca-inspect orca-inspect-padding"
              data-testid="orca-inspect-padding"
              style={placed(layers.padding, trim)}
            />
            <div
              className="orca-inspect orca-inspect-content"
              data-testid="orca-inspect-content"
              style={placed(layers.content, trim)}
            />
            <div
              className={edge.join(" ")}
              data-testid="orca-inspect-edge"
              data-cut={cut}
              style={placed(box, trim)}
            />
            {tag === undefined ? null : (
              <span
                className="orca-inspect-tag"
                data-testid="orca-inspect-tag"
                style={{ left: percent(box.x, trim.width), top: percent(box.y, trim.height) }}
              >
                <b>{tag.element}</b>
                {tag.role === undefined ? null : <i>{tag.role}</i>}
                {tag.size === undefined ? null : <i>{tag.size}</i>}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

/** A rectangle in points, placed by percentages of its page. */
function placed(rect: Rect, trim: Trim): CSSProperties {
  return {
    left: percent(rect.x, trim.width),
    top: percent(rect.y, trim.height),
    width: percent(rect.width, trim.width),
    height: percent(rect.height, trim.height),
  };
}

function percent(value: number, of: number): string {
  return of === 0 ? "0%" : `${String((value / of) * 100)}%`;
}
