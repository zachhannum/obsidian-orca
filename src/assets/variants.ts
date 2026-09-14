/**
 * The variants of a family: its faces grouped by what their style
 * names say once weight and slope are taken out. A condensed cut and a
 * display cut are variants, and each holds its own weights and italics.
 */

import { AssetError } from "@/assets/errors";
import type { Face, Family } from "@/assets/fonts";

/** Faces of one family that share a style name apart from weight and slope. */
export interface Variant {
  /** The spelling of the first face seen. Names compare without case. */
  name: string;
  isDefault: boolean;
  /** Upright faces first, then by weight. */
  faces: Face[];
}

/** The variant a design names, and whether it named one the family lacks. */
export interface Used {
  variant: Variant;
  /** True when a name was given and the family has no variant of it. */
  fellBack: boolean;
}

/** A style name without its weight and slope words. A name of nothing else is "Regular". */
export function variantName(style: string): string {
  const tokens: Token[] = [];
  for (const [chunk, text] of style.split(/[\s_-]+/).entries()) {
    for (const part of text.split(/(?<=[a-z])(?=[A-Z])/)) {
      if (part !== "") tokens.push({ chunk, text: part });
    }
  }
  const kept: Token[] = [];
  for (let at = 0; at < tokens.length; ) {
    const one = tokens[at];
    const two = tokens[at + 1];
    if (one === undefined) break;
    if (two !== undefined && WEIGHT_AND_SLOPE.has(`${one.text}${two.text}`.toLowerCase())) {
      at += 2;
    } else if (WEIGHT_AND_SLOPE.has(one.text.toLowerCase())) {
      at += 1;
    } else {
      kept.push(one);
      at += 1;
    }
  }
  if (kept.length === 0) return REGULAR;
  let name = "";
  for (const [at, token] of kept.entries()) {
    if (at > 0 && kept[at - 1]?.chunk !== token.chunk) name += " ";
    name += token.text;
  }
  return name;
}

/**
 * A family's variants, the default first and the rest by name. Every
 * face lands in exactly one. A variable face is one face, so its axes
 * make no variants of their own.
 */
export function familyVariants(faces: readonly Face[]): Variant[] {
  const groups = new Map<string, Variant>();
  for (const face of faces) {
    const name = faceVariant(face);
    const key = name.toLowerCase();
    const known = groups.get(key);
    if (known === undefined) groups.set(key, { name, isDefault: false, faces: [face] });
    else known.faces.push(face);
  }
  const variants = [...groups.values()];
  for (const variant of variants) {
    variant.faces.sort(
      (one, two) => Number(one.italic) - Number(two.italic) || one.weight - two.weight,
    );
  }
  variants.sort((one, two) => before(one.name, two.name));
  const chosen = groups.get(REGULAR.toLowerCase()) ?? nearest(variants);
  if (chosen === undefined) return variants;
  chosen.isDefault = true;
  return [chosen, ...variants.filter((variant) => variant !== chosen)];
}

/** The variant of this name, or the family's default when it has none. */
export function usedVariant(family: Family, name: string | undefined): Used {
  const fallback = family.variants.find((variant) => variant.isDefault);
  if (fallback === undefined) throw new AssetError(`the family ${family.name} has no faces`);
  if (name === undefined) return { variant: fallback, fellBack: false };
  const want = name.trim().toLowerCase();
  const found = family.variants.find((variant) => variant.name.toLowerCase() === want);
  return found === undefined
    ? { variant: fallback, fellBack: true }
    : { variant: found, fellBack: false };
}

/** The family name a variant's faces are declared under. The default keeps the family's own. */
export function variantFamily(family: Family, variant: Variant): string {
  return variant.isDefault ? family.name : `${family.name} ${variant.name}`;
}

interface Token {
  chunk: number;
  text: string;
}

const REGULAR = "Regular";

/** The words that name a weight or a slope, in lowercase and without spaces. */
const WEIGHT_AND_SLOPE = new Set([
  "thin",
  "hairline",
  "extralight",
  "ultralight",
  "light",
  "book",
  "regular",
  "normal",
  "roman",
  "upright",
  "medium",
  "semibold",
  "demibold",
  "demi",
  "bold",
  "extrabold",
  "ultrabold",
  "heavy",
  "black",
  "extrablack",
  "ultrablack",
  "italic",
  "oblique",
  "slanted",
]);

/** The name of each width class a face can carry other than the normal one. */
const WIDTHS = new Map([
  [1, "Ultra Condensed"],
  [2, "Extra Condensed"],
  [3, "Condensed"],
  [4, "Semi Condensed"],
  [6, "Semi Expanded"],
  [7, "Expanded"],
  [8, "Extra Expanded"],
  [9, "Ultra Expanded"],
]);

/** A face styled only by weight and slope but set wider or narrower goes under its width. */
function faceVariant(face: Face): string {
  const name = variantName(face.style);
  if (name !== REGULAR) return name;
  return WIDTHS.get(face.width) ?? REGULAR;
}

/**
 * The variant nearest a regular upright: an upright face nearest weight
 * 400 at width 5, or with no upright face anywhere, any face nearest
 * weight 400. Variants arrive sorted by name, so a tie keeps the first.
 */
function nearest(variants: readonly Variant[]): Variant | undefined {
  const upright = variants.some((variant) => variant.faces.some((face) => !face.italic));
  let best: Variant | undefined;
  let bestScore: readonly [number, number] | undefined;
  for (const variant of variants) {
    for (const face of variant.faces) {
      if (upright && face.italic) continue;
      const score = [
        upright ? Math.abs(face.width - 5) : 0,
        Math.abs(face.weight - 400),
      ] as const;
      if (
        bestScore === undefined ||
        score[0] < bestScore[0] ||
        (score[0] === bestScore[0] && score[1] < bestScore[1])
      ) {
        best = variant;
        bestScore = score;
      }
    }
  }
  return best;
}

/** Names sort by their code units, so the order is the same on every run. */
function before(one: string, two: string): number {
  if (one === two) return 0;
  return one < two ? -1 : 1;
}
