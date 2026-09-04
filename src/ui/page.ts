import type { Stages } from "@/engine/session";

/** The node a page is written into. */
export interface Surface {
  innerHTML: string;
  readonly dataset: DOMStringMap;
}

/** A page as the painter left it, and what the render behind it cost. */
export interface Painted {
  markup: string;
  generation: number;
  stages: Stages;
}

/**
 * Shows a page: the painter's markup in one write, and the generation
 * and stage runs behind it as attributes. A test waits on those rather
 * than on a clock.
 */
export function showPage(surface: Surface, painted: Painted): void {
  surface.innerHTML = painted.markup;
  surface.dataset["generation"] = String(painted.generation);
  surface.dataset["stageStyle"] = String(painted.stages.style);
  surface.dataset["stageLines"] = String(painted.stages.lines);
  surface.dataset["stageFlow"] = String(painted.stages.flow);
  surface.dataset["stagePaint"] = String(painted.stages.paint);
}
