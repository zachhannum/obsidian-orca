/**
 * The design as the book note's page shows it: a few lines, read-only,
 * in the words the panel draws them with. The panel in the right
 * sidebar is where the design is edited.
 */

import { writeDesign, type Design, type PageUnit, type Written } from "@/style/design";
import { effective } from "@/style/theme";
import { GROUPS, defaultSaid, inUnit, trims } from "@/ui/groups";

/** One line of the summary. */
export interface Summed {
  label: string;
  value: string;
}

/** The design a book is set in, every default filled in, as a few lines. */
export function summary(design: Design, unit: PageUnit): Summed[] {
  const full = writeDesign(effective(design));
  const said = (key: string): string => {
    const control = GROUPS.flatMap((group) => group.rows)
      .flatMap((row) => row.of)
      .find((each) => each.key === key);
    return control === undefined
      ? String(full[key] ?? "")
      : defaultSaid(control, full[key], unit);
  };
  const lower = (key: string): string => said(key).toLowerCase();
  const left = full["header-left-page"];
  const right = full["header-right-page"];
  return [
    { label: "Trim", value: trimSaid(full["trim"], unit) },
    {
      label: "Margins",
      value: `${said("margin-inside")} inside, ${said("margin-outside")} outside, ${said("margin-top")} top, ${said("margin-bottom")} bottom`,
    },
    {
      label: "Text",
      value: `${said("body-font")}, ${said("body-size")} on ${said("body-line-spacing")}, ${lower("body-align")}`,
    },
    { label: "Chapters begin on", value: said("chapter-begins") },
    { label: "Scene breaks", value: sceneSaid(full) },
    {
      label: "Running heads",
      value:
        left === "none" && right === "none"
          ? "None"
          : `${lower("header-left-page")} on left pages, ${lower("header-right-page")} on right pages`,
    },
    {
      label: "Page numbers",
      value: `${said("page-number-position")} (${said("page-number-format")})`,
    },
  ];
}

/** A trim by the name the panel offers it under, or by its sides. */
function trimSaid(trim: Written | undefined, unit: PageUnit): string {
  if (trim === undefined) return "none";
  const named = trims(unit).find((choice) => choice.value === String(trim));
  if (named !== undefined) return named.label;
  return String(trim)
    .split(/\s+/)
    .map((side) => inUnit(side, unit))
    .join(" × ");
}

function sceneSaid(full: Readonly<Record<string, Written>>): string {
  const mark = full["scene-break-mark"];
  if (mark === "space") return "A blank line";
  if (mark === "word") return String(full["scene-break-word"] ?? "A word");
  return String(full["scene-break-ornament"] ?? "An ornament");
}
