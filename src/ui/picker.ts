/**
 * The font picker, without its drawing.
 *
 * The picker offers only fonts in the index, so a font cannot be
 * misspelled into a book. Typing filters the list, and a string that
 * matches nothing commits nothing.
 */

import {
  familyNamed,
  has,
  matching,
  type Face,
  type Family,
  type FontIndex,
} from "@/assets/fonts";
import { usedVariant, type Variant } from "@/assets/variants";
import { designFonts, designUses, type Design, type FontUse } from "@/style/design";

/** The picker's state. */
export interface Picking {
  /** The fonts the typed string matches, in the order they are offered. */
  offered: Family[];
  /** The selected row, clamped to the offered list, or -1 for none. */
  at: number;
  /** The font a commit takes, or nothing when nothing matches. */
  commits: Family | undefined;
}

/**
 * Filters the index by a typed string and clamps the selected row to
 * the result. A row past the end of a narrowed list lands on its last
 * row.
 */
export function picking(index: FontIndex, typed: string, at: number): Picking {
  const offered = matching(index, typed);
  if (offered.length === 0) return { offered, at: -1, commits: undefined };
  const on = Math.min(Math.max(at, 0), offered.length - 1);
  return { offered, at: on, commits: offered[on] };
}

/**
 * The warning for a book set in a font the machine does not have. The
 * engine sets the book in the one it carries and returns no warning
 * for the missing one.
 */
export function missingFont(
  index: FontIndex,
  font: string | undefined,
): string | undefined {
  if (font === undefined || has(index, font)) return undefined;
  return `Missing font: ${font}`;
}

/**
 * The warnings for every font a design names that the machine does not
 * have, one per family: the body font, each heading level's, and the
 * fonts the running heads and the folios are set in.
 */
export function missingFonts(index: FontIndex, design: Design): string[] {
  return designFonts(design).flatMap((font) => missingFont(index, font) ?? []);
}

/**
 * The warnings for the fonts a book adds that the machine does not
 * have, one per family. A font a design key also names warns under the
 * design instead, so it warns once.
 */
export function missingAdded(
  index: FontIndex,
  design: Design,
  added: readonly string[],
): string[] {
  const named = new Set(designFonts(design).map((font) => font.trim().toLowerCase()));
  return added.flatMap((font) =>
    named.has(font.trim().toLowerCase()) ? [] : (missingFont(index, font) ?? []),
  );
}

/**
 * The warning for a stored variant the family on this machine does not
 * have. The book sets in the family's default variant. A font the
 * machine lacks gets the missing-font warning instead.
 */
export function missingVariant(index: FontIndex, use: FontUse): string | undefined {
  if (use.variant === undefined) return undefined;
  const family = familyNamed(index, use.font);
  if (family === undefined || family.variants.length === 0) return undefined;
  const { fellBack } = usedVariant(family, use.variant);
  if (!fellBack) return undefined;
  return `Missing variant: ${family.name} ${use.variant}`;
}

/** The warnings for every variant a design sets that its family lacks, one per font and variant. */
export function missingVariants(index: FontIndex, design: Design): string[] {
  return designUses(design).flatMap((use) => missingVariant(index, use) ?? []);
}

/** The family a row of the picker registers its preview face under, apart from any family the book sets in. */
export function previewFamily(family: string): string {
  return `orca-preview ${family}`;
}

/** The face a variant previews in: its upright face nearest weight 400, or its first face when none is upright. */
export function previewFace(variant: Variant): Face | undefined {
  let best: Face | undefined;
  for (const face of variant.faces) {
    if (face.italic) continue;
    if (best === undefined || Math.abs(face.weight - 400) < Math.abs(best.weight - 400)) {
      best = face;
    }
  }
  return best ?? variant.faces[0];
}

/** The family a Variant row offers the variants of. None when the family has one variant or is not on this machine, and then the row is hidden. */
export function offeredVariants(index: FontIndex, font: string | undefined): Family | undefined {
  if (font === undefined) return undefined;
  const family = familyNamed(index, font);
  return family !== undefined && family.variants.length > 1 ? family : undefined;
}
