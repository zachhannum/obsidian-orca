import type { Stages } from "@/engine/session";

/** The node a page is written into. */
export interface Surface {
  innerHTML: string;
  readonly dataset: DOMStringMap;
}

/** A painted page, and the render behind it. */
export interface Painted {
  markup: string;
  generation: number;
  stages: Stages;
}

/**
 * Writes a page into the surface in one go. The generation and stage
 * runs ride along as attributes, which a test waits on rather than a
 * clock.
 */
export function showPage(surface: Surface, painted: Painted): void {
  surface.innerHTML = painted.markup;
  surface.dataset["generation"] = String(painted.generation);
  surface.dataset["stageStyle"] = String(painted.stages.style);
  surface.dataset["stageLines"] = String(painted.stages.lines);
  surface.dataset["stageFlow"] = String(painted.stages.flow);
  surface.dataset["stagePaint"] = String(painted.stages.paint);
}
