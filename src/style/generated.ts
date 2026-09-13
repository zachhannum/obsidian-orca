/**
 * The layer a design generates: the settings as CSS, sent between the
 * theme and the author's own sheet.
 *
 * A role cannot be written as a class, because the engine's sections
 * carry neither a class nor an id. Orca counts the reading order
 * instead, so a role reaches the sheet as a page name and a set of
 * `:nth-child()` positions. Position works because orca owns the order
 * it counts. The layer is generated again whenever that order moves.
 *
 * Nothing here is written to the vault.
 */

import type { Role } from "@/book/roles";
import {
  LEVELS,
  written,
  type Begins,
  type Design,
  type HeaderDesign,
  type HeaderSlot,
  type NumberFormat,
  type SceneDesign,
  type TypeSpec,
} from "@/style/design";

/** The reading order and the names a generated layer is written against. */
export interface Setting {
  /** The role of each section that crosses, in reading order. */
  roles: readonly Role[];
  /** The book's title, which a running head can name. */
  title?: string;
  /** The book's author, which a running head can name. */
  author?: string;
  /** The book's publisher, which the title page sets apart from the author. */
  publisher?: string;
}

/**
 * The design as CSS, counted against the order the book is in. Every
 * declaration comes from a field the design sets, with some exceptions.
 * The page names, and the page where the count starts again at 1, come
 * from the roles. The title page is laid out the same way in every
 * design.
 */
export function generatedCss(design: Design, setting: Setting): string {
  return [
    ...pageRules(design, setting),
    ...bodyRules(design),
    ...headingRules(design),
    ...sectionRules(design, setting),
    ...titlePageRules(design, setting),
    ...sceneRules(design),
  ]
    .filter((rule) => rule !== "")
    .join("\n");
}

/** The CSS break for each opening. */
const BREAKS: Readonly<Record<Begins, string>> = {
  "right-page": "recto",
  "next-page": "page",
  "same-page": "auto",
};

/** The CSS counter style for each folio format. */
const COUNTERS: Readonly<Record<NumberFormat, string>> = {
  arabic: "decimal",
  roman: "lower-roman",
};

/** The margin boxes orca clears before it sets the ones it uses. */
const BOXES = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

type Box = (typeof BOXES)[number];

/** Every heading level, as one selector. */
const HEADINGS = ":is(h1, h2, h3, h4, h5, h6)";

/** The heading a section opens on, whichever level it is written at. */
const OPENING = `${HEADINGS}:first-child`;

/**
 * The points a section's text can start at: after its opening heading, or
 * after up to two more stacked under it, such as a title under a label.
 */
const TEXT_START = [OPENING, `${OPENING} + ${HEADINGS}`, `${OPENING} + ${HEADINGS} + ${HEADINGS}`];

function pageRules(design: Design, setting: Setting): string[] {
  const { page, headers } = design;
  const { margins } = page;
  const root: string[] = [];
  if (page.trim !== undefined) {
    root.push(
      declared("size", `${written(page.trim.width)} ${written(page.trim.height)}`),
    );
  }
  root.push(...set("margin-top", written(margins.top)));
  root.push(...set("margin-bottom", written(margins.bottom)));
  const left: string[] = [];
  const right: string[] = [];
  if (page.mirrored === true) {
    left.push(...sideMargins(written(margins.outside), written(margins.inside)));
    right.push(...sideMargins(written(margins.inside), written(margins.outside)));
  } else {
    root.push(...sideMargins(written(margins.inside), written(margins.outside)));
  }

  // Orca owns the running heads and the folio as soon as the design
  // sets anything about them. Orca clears the boxes it does not use
  // rather than leave them to the engine's own folio.
  const placed = placement(headers, setting);
  const rootBoxes = new Map<Box, string>(
    owned(headers) ? BOXES.map((box) => [box, "none"]) : [],
  );
  for (const [box, content] of placed.both) rootBoxes.set(box, content);

  return [
    block("@page", [...root, ...boxes(rootBoxes)]),
    block("@page :left", [...left, ...boxes(placed.left)]),
    block("@page :right", [...right, ...boxes(placed.right)]),
    ...frontPages(placed, setting),
    ...openingPages(headers, placed, setting),
  ];
}

/** The content of the margin boxes the design prints in, by the pages they print on. */
interface Placement {
  both: Map<Box, string>;
  left: Map<Box, string>;
  right: Map<Box, string>;
  /** The boxes that hold the folio, and not a running head. */
  folio: Set<Box>;
}

/**
 * The margin boxes the running heads and the folio print in. A head
 * sits at the outside corner or in the center. A folio at the top
 * takes the center. When the heads are centered, it takes the outside
 * corner, so a head and a folio never share a box.
 */
function placement(headers: HeaderDesign, setting: Setting): Placement {
  const placed: Placement = {
    both: new Map(),
    left: new Map(),
    right: new Map(),
    folio: new Set(),
  };
  const centered = headers.position === "center";
  const folio = folioContent(headers);
  if (folio !== undefined) {
    const at = (pages: Map<Box, string>, box: Box) => {
      pages.set(box, folio);
      placed.folio.add(box);
    };
    if (headers.pageNumber === "top" && centered) {
      at(placed.left, "top-left");
      at(placed.right, "top-right");
    }
    if (headers.pageNumber === "top" && !centered) at(placed.both, "top-center");
    if (headers.pageNumber === "bottom") at(placed.both, "bottom-center");
    if (headers.pageNumber === "outside") {
      at(placed.left, "bottom-left");
      at(placed.right, "bottom-right");
    }
  }
  if (headers.leftPage !== undefined && headers.leftPage !== "none") {
    placed.left.set(
      centered ? "top-center" : "top-left",
      slotContent(headers.leftPage, setting),
    );
  }
  if (headers.rightPage !== undefined && headers.rightPage !== "none") {
    placed.right.set(
      centered ? "top-center" : "top-right",
      slotContent(headers.rightPage, setting),
    );
  }
  return placed;
}

/**
 * The front matter's pages, which number their folio in lower-case
 * roman whatever format the body uses. A rule on a role and side joins
 * the boxes of the `:left` or `:right` rule, so only the folio's boxes
 * are set again. An opening's rule still clears them.
 */
function frontPages(placed: Placement, setting: Setting): string[] {
  if (placed.folio.size === 0) return [];
  const roman = (pages: ReadonlyMap<Box, string>): string[] =>
    boxes(
      new Map(
        [...pages.keys()]
          .filter((box) => placed.folio.has(box))
          .map((box) => [box, "counter(page, lower-roman)"]),
      ),
    );
  return front(setting.roles).flatMap((role) => [
    block(`@page ${role}`, roman(placed.both)),
    block(`@page ${role}:left`, roman(placed.left)),
    block(`@page ${role}:right`, roman(placed.right)),
  ]);
}

/**
 * The page each role opens on, which carries no running head and no
 * folio. A head names the section under it. A section's first page
 * falls under the head of the section before it.
 */
function openingPages(
  headers: HeaderDesign,
  placed: Placement,
  setting: Setting,
): string[] {
  if (headers.suppressOnOpenings === false) return [];
  const cleared = printed(placed);
  if (cleared.length === 0) return [];
  return used(setting.roles).map((role) =>
    block(
      `@page ${role}:first`,
      cleared.map((box) => boxed(box, "none")),
    ),
  );
}

/** The margin boxes the design prints something in, in the order `BOXES` has them. */
function printed(placed: Placement): Box[] {
  return BOXES.filter(
    (box) => placed.both.has(box) || placed.left.has(box) || placed.right.has(box),
  );
}

/** The margin boxes of one page rule, in the order the rule sets them. */
function boxes(content: ReadonlyMap<Box, string>): string[] {
  return BOXES.flatMap((box) => {
    const found = content.get(box);
    return found === undefined ? [] : [boxed(box, found)];
  });
}

/**
 * The first-line indent sits on a paragraph that follows another. The
 * engine declares its own indent there, and an indent inherited from
 * `book` loses to it.
 */
function bodyRules(design: Design): string[] {
  const { body } = design;
  const lines: string[] = [];
  if (body.font !== undefined) {
    lines.push(declared("font-family", `${quoted(body.font)}, serif`));
  }
  lines.push(...set("font-size", written(body.size)));
  lines.push(...set("line-height", written(body.lineSpacing)));
  lines.push(...set("text-align", body.align));
  lines.push(...set("hyphens", flagged(body.hyphens, "auto", "manual")));
  lines.push(
    ...set(
      "hanging-punctuation",
      flagged(body.hangingPunctuation, "first allow-end last", "none"),
    ),
  );
  lines.push(...set("orphans", counted(body.orphans)));
  lines.push(...set("widows", counted(body.widows)));
  return [
    block("book", lines),
    block("p + p", [...set("text-indent", written(body.indent))]),
    block("hr + p", [...set("text-indent", afterBreak(design))]),
    block(HEADINGS, [
      ...set("break-after", flagged(body.keepHeadings, "avoid", "auto")),
    ]),
  ];
}

/**
 * The indent on the paragraph after a scene break. A design that turns
 * the indent on gives it the body's first-line indent.
 */
function afterBreak(design: Design): string | undefined {
  const { indentAfterBreak, indent } = design.body;
  if (indentAfterBreak === undefined) return undefined;
  return indentAfterBreak ? written(indent) : "0";
}

function headingRules(design: Design): string[] {
  return LEVELS.map((level) =>
    block(`h${level}`, typeLines(design.headings[level])),
  );
}

function typeLines(type: TypeSpec): string[] {
  const lines: string[] = [];
  if (type.font !== undefined) {
    lines.push(declared("font-family", `${quoted(type.font)}, serif`));
  }
  lines.push(...set("font-size", written(type.size)));
  lines.push(...set("text-align", type.align));
  return lines;
}

function sectionRules(design: Design, setting: Setting): string[] {
  const rules = used(setting.roles).map((role) => {
    const lines = [declared("page", role)];
    if (role === "chapter" && design.chapter.begins !== undefined) {
      lines.push(declared("break-before", BREAKS[design.chapter.begins]));
    }
    return block(positions(setting.roles, role) ?? "", lines);
  });
  return [...rules, ...restart(setting), ...chapterRules(design, setting)];
}

/**
 * The body's first page, which is page 1 however many pages of front
 * matter come before it. A book with no front matter counts from its
 * first page already.
 */
function restart(setting: Setting): string[] {
  const start = bodyStart(setting.roles);
  if (start === undefined || start === 0) return [];
  return [block(`section:nth-child(${start + 1})`, [declared("counter-reset", "page 1")])];
}

/**
 * The chapter openings. The drop cap falls on the paragraph the
 * opening headings lead into, so a note with text before its first
 * heading takes no drop cap.
 *
 * A sink is the blank space above a chapter's title, written in lines
 * of body text. Where the design sets a line height, a sink is that
 * many line heights. Where it does not, a sink is that many heading
 * ems. A sink is padding, since the engine drops the top margin of a
 * box that starts a page.
 */
function chapterRules(design: Design, setting: Setting): string[] {
  const chapters = positions(setting.roles, "chapter");
  if (chapters === undefined) return [];
  const { spaceAbove, spaceBelow, dropCap } = design.chapter;
  const sink =
    spaceAbove === undefined ? undefined : bodyLines(spaceAbove, design);
  const below =
    spaceBelow === undefined ? undefined : bodyLines(spaceBelow, design);
  return [
    block(`${chapters} > ${OPENING}`, [
      ...set("padding-top", sink),
      ...set("margin-bottom", below),
    ]),
    block(TEXT_START.map((start) => `${chapters} > ${start} + p::first-letter`).join(",\n"), [
      ...set(
        "initial-letter",
        dropCap === undefined || dropCap < 2 ? undefined : String(dropCap),
      ),
    ]),
  ];
}

/** The body lines above a title page's first block. */
const TITLE_SINK = 6;

/** The body lines between a title page's author and its publisher. */
const IMPRINT_GAP = 10;

/**
 * The title page, which orca writes as the series, the title, the
 * author and the publisher, each one optional. The page reaches each
 * block by where it sits. The engine places nothing at the foot of a
 * page, so the publisher sits a set number of lines under the author.
 */
function titlePageRules(design: Design, setting: Setting): string[] {
  const page = positions(setting.roles, "title-page");
  if (page === undefined) return [];
  const line = bodyLines(1, design);
  const rules = [
    block(`${page} > *`, [declared("text-align", "center"), declared("text-indent", "0")]),
    block(`${page} > :first-child`, [declared("padding-top", bodyLines(TITLE_SINK, design))]),
    block(`${page} > p + h1,\n${page} > h1 + p`, [declared("padding-top", line)]),
  ];
  if (setting.publisher !== undefined && setting.publisher !== "") {
    rules.push(
      block(`${page} > p:last-child`, [
        declared("padding-top", bodyLines(IMPRINT_GAP, design)),
      ]),
    );
  }
  return rules;
}

function sceneRules(design: Design): string[] {
  const { scene } = design;
  const lines = [...set("content", sceneContent(scene))];
  if (scene.mark === "word" && scene.word !== undefined) {
    lines.push(declared("text-align", "center"));
  }
  lines.push(
    ...set(
      "margin-top",
      scene.spaceAbove === undefined
        ? undefined
        : bodyLines(scene.spaceAbove, design),
    ),
  );
  lines.push(
    ...set(
      "margin-bottom",
      scene.spaceBelow === undefined
        ? undefined
        : bodyLines(scene.spaceBelow, design),
    ),
  );
  return [block("hr", lines)];
}

/**
 * The text a scene break prints. A design with no mark set prints its
 * ornament.
 */
function sceneContent(scene: SceneDesign): string | undefined {
  const { mark, ornament, word } = scene;
  if (mark === "space") return "none";
  if (mark === "word") return word === undefined ? undefined : quoted(word);
  return ornament === undefined ? undefined : quoted(ornament);
}

/** The places a role sits, as one selector, or nothing when it sits nowhere. */
function positions(roles: readonly Role[], role: Role): string | undefined {
  const found = roles.flatMap((each, index) =>
    each === role ? [`section:nth-child(${index + 1})`] : [],
  );
  if (found.length === 0) return undefined;
  return found.length === 1 ? found[0] : `:is(${found.join(", ")})`;
}

/** The index of the first part or chapter, where the body starts. */
function bodyStart(roles: readonly Role[]): number | undefined {
  const found = roles.findIndex((role) => role === "part" || role === "chapter");
  return found === -1 ? undefined : found;
}

/**
 * The roles that sit only before the body. A book with no part and no
 * chapter has no front matter.
 */
function front(roles: readonly Role[]): Role[] {
  const start = bodyStart(roles);
  if (start === undefined) return [];
  return used(roles).filter((role) => roles.lastIndexOf(role) < start);
}

/** The roles the book uses, in the order it first reaches each of them. */
function used(roles: readonly Role[]): Role[] {
  return [...new Set(roles)];
}

function owned(headers: HeaderDesign): boolean {
  return (
    headers.leftPage !== undefined ||
    headers.rightPage !== undefined ||
    headers.pageNumber !== undefined
  );
}

function folioContent(headers: HeaderDesign): string | undefined {
  if (headers.pageNumber === undefined) return undefined;
  return `counter(page, ${COUNTERS[headers.pageNumberFormat ?? "arabic"]})`;
}

/**
 * The text a running-head slot prints. The title and the author are
 * the book's own, so they cross as plain strings. A chapter title
 * changes down the book, so it crosses as the string the engine
 * keeps.
 */
function slotContent(slot: HeaderSlot, setting: Setting): string {
  if (slot === "none") return "none";
  if (slot === "chapter-title") return "string(chapter)";
  const named = slot === "author" ? setting.author : setting.title;
  return named === undefined ? "none" : quoted(named);
}

function sideMargins(left: string | undefined, right: string | undefined): string[] {
  return [...set("margin-left", left), ...set("margin-right", right)];
}

function bodyLines(count: number, design: Design): string {
  const spacing = design.body.lineSpacing;
  if (spacing === undefined) return `${trimmed(count)}em`;
  return `${trimmed(count * spacing.value)}${spacing.unit}`;
}

function flagged(
  flag: boolean | undefined,
  yes: string,
  no: string,
): string | undefined {
  if (flag === undefined) return undefined;
  return flag ? yes : no;
}

function counted(count: number | undefined): string | undefined {
  return count === undefined ? undefined : String(count);
}

function set(property: string, value: string | undefined): string[] {
  return value === undefined ? [] : [declared(property, value)];
}

function declared(property: string, value: string): string {
  return `${property}: ${value};`;
}

function boxed(box: string, content: string): string {
  return `@${box} { ${declared("content", content)} }`;
}

/** One rule, or nothing at all when the design sets none of its declarations. */
function block(selector: string, lines: readonly string[]): string {
  if (selector === "" || lines.length === 0) return "";
  return `${selector} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}\n`;
}

function trimmed(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * A string as CSS. A font name comes from a font file's own name
 * table, and an ornament comes from the author. A quote or a backslash
 * in either one is escaped.
 */
function quoted(text: string): string {
  return `"${text.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}
