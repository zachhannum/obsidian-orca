/**
 * Draws the zoom in the preview's bar: a step out, the percentage and a
 * step in. A touch screen zooms by pinch, so it draws no control, and
 * the component still writes the zoom on the surface for both.
 */

import { createRoot } from "react-dom/client";
import { useLayoutEffect, type JSX } from "react";
import { Icon } from "@/ui/icon";
import { CLOSEST, FIT, percentOf } from "@/ui/zoom";

export interface Zoomed {
  zoom: number;
  /** Whether the view on screen zooms. */
  zooms: boolean;
  /** The pixels the zoomed page is moved by, from its left and its top. */
  pan: { x: number; y: number };
}

export interface Zooming {
  /** Whether the device draws the control. */
  control: boolean;
  in: () => void;
  out: () => void;
  fit: () => void;
}

export interface MountedZoom {
  draw(zoomed: Zoomed): void;
  unmount(): void;
}

/** Mounts the control in its slot in the bar. */
export function mountZoom(slot: HTMLElement, surface: HTMLElement, zooming: Zooming): MountedZoom {
  const root = createRoot(slot);
  return {
    draw(zoomed) {
      root.render(<ZoomControl surface={surface} zoomed={zoomed} zooming={zooming} />);
    },
    unmount() {
      root.unmount();
    },
  };
}

export function ZoomControl({
  surface,
  zoomed,
  zooming,
}: {
  surface: HTMLElement;
  zoomed: Zoomed;
  zooming: Zooming;
}): JSX.Element | null {
  const { zoom, zooms, pan } = zoomed;
  const percent = percentOf(zoom);

  // The e2e suite waits on these, so they are written once the page is
  // laid out at the zoom they report.
  useLayoutEffect(() => {
    surface.dataset["zoom"] = String(percent);
    surface.dataset["pan"] = `${String(Math.round(pan.x))},${String(Math.round(pan.y))}`;
  }, [surface, percent, pan.x, pan.y]);

  if (!zooming.control || !zooms) return null;
  return (
    <>
      <button
        type="button"
        className="clickable-icon"
        data-testid="orca-zoom-out"
        aria-label="Zoom out"
        disabled={zoom <= FIT}
        onClick={zooming.out}
      >
        <Icon name="minus" />
      </button>
      <button
        type="button"
        className="orca-zoom-percent"
        data-testid="orca-zoom-percent"
        aria-label="Fit to pane"
        onClick={zooming.fit}
      >
        {`${String(percent)}%`}
      </button>
      <button
        type="button"
        className="clickable-icon"
        data-testid="orca-zoom-in"
        aria-label="Zoom in"
        disabled={zoom >= CLOSEST}
        onClick={zooming.in}
      >
        <Icon name="plus" />
      </button>
    </>
  );
}
