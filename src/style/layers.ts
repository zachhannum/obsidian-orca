/**
 * The layers a matched rule is shown under: the author's own sheet, the
 * design panel, and orca's theme. The engine's own sheet is shown as
 * part of orca's theme.
 */

import type { MatchedRule } from "fleuron";
import { DESIGN_SHEET, OWN_SHEET } from "@/style/sheet";
import { THEME_SHEET } from "@/style/theme";

export type Layer = "own" | "design" | "theme";

/** The sheet name the engine gives its own sheet. */
const USER_AGENT_SHEET = "user-agent.css";

/** The layers in the order they are shown, the one that wins first. */
const SHOWN: readonly Layer[] = ["own", "design", "theme"];

/** A sheet orca did not send, and that is not the engine's, has no layer. */
export function layerOf(sheet: string): Layer | undefined {
  if (sheet === OWN_SHEET) return "own";
  if (sheet === DESIGN_SHEET) return "design";
  if (sheet === THEME_SHEET || sheet === USER_AGENT_SHEET) return "theme";
  return undefined;
}

/**
 * Matched rules by layer, in the order they are shown, with no empty
 * layer. Inside a layer the rule that wins comes first. A rule from a
 * sheet with no layer is left out.
 */
export function groupRules(
  rules: readonly MatchedRule[],
): { layer: Layer; rules: MatchedRule[] }[] {
  const reversed = [...rules].reverse();
  return SHOWN.map((layer) => ({
    layer,
    rules: reversed.filter((rule) => layerOf(rule.sheet) === layer),
  })).filter((group) => group.rules.length > 0);
}
