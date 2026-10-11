/**
 * Draws inspect mode over the painted pages: the box under the pointer
 * and the pinned box, each tinted in its margin, padding and content,
 * outlined on every page it reaches, with a tag beside the first piece.
 *
 * The host is a sibling of the surface in the well. The surface is
 * written again on every paint, so nothing of the overlay lives in it.
 */

import { createRoot } from "react-dom/client";
import { useEffect, useLayoutEffect, useState, type JSX } from "react";
import type { Inspection } from "fleuron";
import type { PageUnit } from "@/style/design";
import {
  fragments,
  layersOf,
  placedOn,
  sameFrames,
  tagOf,
  type Frame,
  type Rect,
} from "@/ui/inspect";

/** A box the overlay draws, under the key the surface names it by. */
export interface Marked {
  key: string;
  inspection: Inspection;
  generation?: number;
}

export interface Overlaid {
  on: boolean;
  hovered: Marked | undefined;
  pinned: Marked | undefined;
  unit: PageUnit;
  /**
   * The painted pages, counting from 0, and each one's sheet in points
   * from the trim's corner. The page's box on screen is the sheet.
   */
  sheets: ReadonlyMap<number, Rect>;
  /** Raised on each paint and resize, so the pages are measured before the next frame. */
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
  sheets: new Map(),
  measured: 0,
};

/** Mounts the overlay beside the surface, inside the well that holds both. */
export function mountOverlay(surface: HTMLElement): MountedOverlay {
  const host = surface.ownerDocument.win.createDiv({ cls: "orca-inspect-host" });
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

export function InspectOverlay({
  surface,
  host,
  overlaid,
}: {
  surface: HTMLElement;
  host: HTMLElement;
  overlaid: Overlaid;
}): JSX.Element | null {
  const { on, hovered, pinned, unit, sheets, measured } = overlaid;
  const [frames, place] = useState<ReadonlyMap<number, Frame>>(new Map());

  // A header that hides, a drawer and a scroll each move the pages and
  // resize nothing, so no observer hears of them. While inspect mode is
  // on, the pages are measured on every frame and placed again only
  // when one moved.
  useLayoutEffect(() => {
    const measure = (): void => {
      const corner = host.getBoundingClientRect();
      const found = new Map<number, Frame>();
      for (const page of sheets.keys()) {
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
      place((was) => (sameFrames(was, found) ? was : found));
    };
    measure();
    if (!on) return;
    const view = host.win;
    let frame = view.requestAnimationFrame(function again() {
      measure();
      frame = view.requestAnimationFrame(again);
    });
    return () => {
      view.cancelAnimationFrame(frame);
    };
  }, [surface, host, sheets, measured, on]);

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
          sheets={sheets}
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
  sheets,
  unit,
}: {
  inspection: Inspection;
  pinned: boolean;
  frames: ReadonlyMap<number, Frame>;
  sheets: ReadonlyMap<number, Rect>;
  unit: PageUnit;
}): JSX.Element {
  const state = pinned ? "pinned" : "hovered";
  const pieces = fragments(inspection.boxes, frames.keys());
  return (
    <>
      {pieces.map(({ box, cut, index }, at) => {
        const frame = frames.get(box.page);
        const sheet = sheets.get(box.page);
        if (frame === undefined || sheet === undefined) return null;
        const edged = placedOn(box, sheet);
        const layers = layersOf(box, inspection.computed);
        const tag = at === 0 ? tagOf(inspection, unit, box) : undefined;
        const edge = ["orca-inspect", "orca-inspect-edge"];
        if (pinned) edge.push("is-pinned");
        if (cut !== "none") edge.push(`is-cut-${cut}`);
        return (
          <div
            key={index}
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
              style={placedOn(layers.margin, sheet)}
            />
            <div
              className="orca-inspect orca-inspect-padding"
              data-testid="orca-inspect-padding"
              style={placedOn(layers.padding, sheet)}
            />
            <div
              className="orca-inspect orca-inspect-content"
              data-testid="orca-inspect-content"
              style={placedOn(layers.content, sheet)}
            />
            <div
              className={edge.join(" ")}
              data-testid="orca-inspect-edge"
              data-cut={cut}
              style={edged}
            />
            {tag === undefined ? null : (
              <span
                className="orca-inspect-tag"
                data-testid="orca-inspect-tag"
                style={{ left: edged.left, top: edged.top }}
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
