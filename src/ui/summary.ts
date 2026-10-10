/**
 * The read-only summary of the design on the book note's page. It has
 * one block for each group of the panel. A block holds the rows the
 * panel marks `summed`, and every other row the book moves off its
 * default. A row is under its own label, in the words the panel draws.
 * The author edits the design in the panel in the right sidebar.
 */

import {
  LEVELS,
  emptyDesign,
  writeDesign,
  type Design,
  type Level,
  type PageUnit,
  type Written,
} from "@/style/design";
import { effective } from "@/style/theme";
import {
  GROUPS,
  atLevel,
  defaultSaid,
  inUnit,
  type Control,
  type Group,
  type Row,
} from "@/ui/groups";

/** One value of the design, under the label of the panel row that sets it. */
export interface Fact {
  /** The design key, at its level for a heading. */
  key: string;
  label: string;
  value: string;
  /** True when the book sets the key to something other than its default. */
  set: boolean;
  /**
   * True when the fact begins a line of the block: the first of a
   * heading level, and the first of a row with several controls.
   */
  starts: boolean;
  /** True for a trim, whose name and sides need the room of two facts. */
  wide: boolean;
}

/** One group of the panel, as the summary shows it. */
export interface Summed {
  /** The name of the panel group. */
  label: string;
  facts: Fact[];
}

/** A design with every default filled in, and the keys the book moved off them. */
interface Reading {
  full: Readonly<Record<string, Written>>;
  changed: ReadonlySet<string>;
  unit: PageUnit;
}

/** Sums up the design a book is set in, one block for each group of the panel, with every default filled in. */
export function summary(design: Design, unit: PageUnit): Summed[] {
  const full = writeDesign(effective(design));
  const defaults = writeDesign(effective(emptyDesign()));
  const changed = new Set(
    Object.entries(writeDesign(design))
      .filter(([key, value]) => value !== defaults[key])
      .map(([key]) => key),
  );
  const reading: Reading = { full, changed, unit };
  return GROUPS.map((group) => ({
    label: group.name,
    facts: leveled(group)
      ? LEVELS.flatMap((level) => facts(group, reading, level))
      : facts(group, reading, undefined),
  }));
}

function leveled(group: Group): boolean {
  return group.rows.some((row) => row.of.some((control) => control.kind === "level"));
}

/**
 * The facts of one group, or of one heading level of it. Level 1 is
 * the chapter title, so it is shown as any other group is. A deeper
 * level is shown once the book sets a key at it.
 */
function facts(group: Group, reading: Reading, level: Level | undefined): Fact[] {
  const keyed = group.rows.flatMap((row) =>
    row.of.flatMap((control) =>
      control.key === undefined
        ? []
        : [{ row, control, key: level === undefined ? control.key : atLevel(control.key, level) }],
    ),
  );
  const touched = keyed.some(({ key }) => reading.changed.has(key));
  if (level !== undefined && level !== 1 && !touched) return [];
  return keyed
    .filter(({ row, key }) => row.summed === true || reading.changed.has(key))
    .filter(({ key }) => !idle(key, reading.full))
    .map(({ row, control, key }, at, shown) => ({
      key,
      label: labelOf(row, control, level),
      value: valueOf(control, reading.full[key], reading.unit),
      set: reading.changed.has(key),
      starts:
        (level !== undefined && at === 0) ||
        (row.of.length > 1 && shown[at - 1]?.row !== row),
      wide: control.kind === "trim",
    }));
}

/** True for a key that sets nothing as the design stands: the glyph of a scene break that is a space. */
function idle(key: string, full: Readonly<Record<string, Written>>): boolean {
  return key === "scene-break-ornament" && full["scene-break-mark"] === "space";
}

/** A row's label. A row of several controls adds each control's word, and a heading its level. */
function labelOf(row: Row, control: Control, level: Level | undefined): string {
  const said = control.said ?? "";
  const label =
    row.label === "" ? said : row.of.length > 1 ? `${row.label} ${said}` : row.label;
  return level === undefined ? label : `H${String(level)} ${label.toLowerCase()}`;
}

/** A value in the panel's words: a count with its unit, a switch as On or Off, and an unnamed trim as its sides. */
function valueOf(control: Control, value: Written | undefined, unit: PageUnit): string {
  const said = defaultSaid(control, value, unit);
  if (control.kind === "trim" && said === String(value)) {
    // A trim the panel has no name for is its two sides.
    return said
      .split(/\s+/)
      .map((side) => inUnit(side, unit))
      .join(" × ");
  }
  if (control.kind === "flag") return said === "on" ? "On" : "Off";
  if (control.kind === "count" && control.said !== undefined) {
    return said === "1" ? `1 ${control.said.replace(/s$/, "")}` : `${said} ${control.said}`;
  }
  return said;
}
