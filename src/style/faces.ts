/**
 * The faces a book registers with the engine, as `@font-face` rules. A
 * variant of a font is registered under a family of its own, so a
 * heading set in a narrow cut and a body set in the regular one never
 * share a name the engine matches faces within.
 */

import { useKey, type FontUse } from "@/style/design";
import { quoted } from "@/style/quoted";

/** weight and italic are absent for a variable face: a rule that declares neither lets the file register every named instance. */
export interface FaceRule {
  url: string;
  weight?: number;
  italic?: boolean;
}

/** A font and variant, the family its faces are registered under, and those faces. */
export interface Registered {
  font: string;
  variant: string | undefined;
  family: string;
  faces: readonly FaceRule[];
}

/** One `@font-face` rule per face, in order. A family registered twice is written once. */
export function faceCss(registered: readonly Registered[]): string {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const each of registered) {
    if (seen.has(each.family)) continue;
    seen.add(each.family);
    for (const face of each.faces) rules.push(faceRule(each.family, face));
  }
  return rules.join("");
}

/** The family a font and variant is registered under, matched without case. */
export function familyFor(
  registered: readonly Registered[],
  use: FontUse,
): string | undefined {
  const key = useKey(use);
  return registered.find((each) => useKey(each) === key)?.family;
}

function faceRule(family: string, face: FaceRule): string {
  const lines = [
    `font-family: ${quoted(family)};`,
    `src: url(${quoted(face.url)});`,
  ];
  if (face.weight !== undefined) lines.push(`font-weight: ${face.weight};`);
  if (face.italic !== undefined) {
    lines.push(`font-style: ${face.italic ? "italic" : "normal"};`);
  }
  return `@font-face {\n${lines.map((line) => `  ${line}`).join("\n")}\n}\n`;
}
