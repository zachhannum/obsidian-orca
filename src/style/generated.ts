/**
 * The layer a design generates: the settings as CSS, sent between the
 * theme and the author's own sheet.
 *
 * Each section crosses with its role as its class and a slug of its
 * name as its id. A role reaches the sheet as a page name and as the
 * ids of the sections that take it. The layer is generated again
 * whenever the order moves or a section is renamed.
 *
 * Nothing here is written to the vault.
 */

import type { Named } from "@/book/names";
import type { Role } from "@/book/roles";
import {
  LEVELS,
  written,
  type Begins,
  type Design,
  type HeaderDesign,
  type HeaderSlot,
  type Level,
  type NumberFormat,
  type SceneDesign,
  type TypeSpec,
} from "@/style/design";

/** The reading order and the names a generated layer is written against. */
export interface Setting {
  /** The role and id of each section that crosses, in reading order. */
  sections: readonly Named[];
  /** The book's title, which a running head can name. */
  title?: string;
  /** The book's author, which a running head can name. */
  author?: string;
  /** The book's publisher, which the title page sets apart from the author. */
  publisher?: string;
}

/**
 * The origin of one generated rule. `keys` are the book-note setting keys
 * whose values the rule reads, and are empty for a rule orca sets the
 * same way in every design. `role` is the section role the rule is
 * written for, when the reading order and not a setting put it there.
 */
export interface RuleFrom {
  keys: readonly string[];
  role?: Role;
}

/** One rule of the generated sheet. `line` counts from 1, and `lines` is how many it spans. */
export interface GeneratedRule {
  css: string;
  line: number;
  lines: number;
  from: RuleFrom;
}

/**
 * The design as CSS, counted against the order the book is in. Every
 * declaration comes from a field the design sets, with some exceptions.
 * The page names, and the page where the count starts again at 1, come
 * from the roles. The title page and the contents are laid out the same
 * way in every design.
 */
export function generatedCss(design: Design, setting: Setting): string {
  return generatedRules(design, setting)
    .map((rule) => rule.css)
    .join("\n");
}

/** The rules `generatedCss` joins, in order, each with the line it starts on. */
export function generatedRules(design: Design, setting: Setting): GeneratedRule[] {
  const rules = [
    ...pageRules(design, setting),
    ...bodyRules(design),
    ...headingRules(design),
    ...sectionRules(design, setting),
    ...titlePageRules(design, setting),
    ...contentsRules(design, setting),
    ...sceneRules(design),
  ].filter((rule) => rule !== undefined);
  let line = 1;
  return rules.map(({ css, from }) => {
    // A rule ends on a newline, and the join adds a blank line after it.
    const lines = css.split("\n").length - 1;
    const rule = { css, line, lines, from };
    line += lines + 1;
    return rule;
  });
}

/** A rule before it is placed in the sheet. */
interface Rule {
  css: string;
  from: RuleFrom;
}

/** A declaration, and the setting keys its value reads. */
interface Declaration {
  text: string;
  keys: readonly string[];
}

/** The text a margin box prints, and the setting keys that put it there. */
interface Content {
  content: string;
  keys: readonly string[];
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

function pageRules(design: Design, setting: Setting): (Rule | undefined)[] {
  const { page, headers } = design;
  const { margins } = page;
  const root: Declaration[] = [];
  if (page.trim !== undefined) {
    root.push(
      declared("size", `${written(page.trim.width)} ${written(page.trim.height)}`, ["trim"]),
    );
  }
  root.push(...set("margin-top", written(margins.top), ["margin-top"]));
  root.push(...set("margin-bottom", written(margins.bottom), ["margin-bottom"]));
  const mirrored = page.mirrored === undefined ? [] : ["mirrored"];
  const inside = { value: written(margins.inside), keys: ["margin-inside", ...mirrored] };
  const outside = { value: written(margins.outside), keys: ["margin-outside", ...mirrored] };
  const left: Declaration[] = [];
  const right: Declaration[] = [];
  if (page.mirrored === true) {
    left.push(...sideMargins(outside, inside));
    right.push(...sideMargins(inside, outside));
  } else {
    root.push(...sideMargins(inside, outside));
  }

  // Orca owns the running heads and the folio as soon as the design
  // sets anything about them. Orca clears the boxes it does not use
  // rather than leave them to the engine's own folio.
  const placed = placement(headers, setting);
  const cleared = { content: "none", keys: ownedKeys(headers) };
  const rootBoxes = new Map<Box, Content>(
    owned(headers) ? BOXES.map((box) => [box, cleared]) : [],
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
  both: Map<Box, Content>;
  left: Map<Box, Content>;
  right: Map<Box, Content>;
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
  const position = headers.position === undefined ? [] : ["header-position"];
  const folio = folioContent(headers);
  if (folio !== undefined) {
    const at = (pages: Map<Box, Content>, box: Box) => {
      pages.set(box, {
        content: folio.content,
        keys: headers.pageNumber === "top" ? [...folio.keys, ...position] : folio.keys,
      });
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
    placed.left.set(centered ? "top-center" : "top-left", {
      content: slotContent(headers.leftPage, setting),
      keys: ["header-left-page", ...position],
    });
  }
  if (headers.rightPage !== undefined && headers.rightPage !== "none") {
    placed.right.set(centered ? "top-center" : "top-right", {
      content: slotContent(headers.rightPage, setting),
      keys: ["header-right-page", ...position],
    });
  }
  return placed;
}

/**
 * The front matter's pages, which number their folio in lower-case
 * roman whatever format the body uses. A rule on a role and side joins
 * the boxes of the `:left` or `:right` rule, so only the folio's boxes
 * are set again. An opening's rule still clears them.
 */
function frontPages(placed: Placement, setting: Setting): (Rule | undefined)[] {
  if (placed.folio.size === 0) return [];
  const roman = (pages: ReadonlyMap<Box, Content>): Declaration[] =>
    boxes(
      new Map(
        [...pages]
          .filter(([box]) => placed.folio.has(box))
          .map(([box, { keys }]) => [
            box,
            {
              content: "counter(page, lower-roman)",
              keys: keys.filter((key) => key !== "page-number-format"),
            },
          ]),
      ),
    );
  return front(roles(setting)).flatMap((role) => [
    block(`@page ${role}`, roman(placed.both), role),
    block(`@page ${role}:left`, roman(placed.left), role),
    block(`@page ${role}:right`, roman(placed.right), role),
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
): (Rule | undefined)[] {
  if (headers.suppressOnOpenings === false) return [];
  const cleared = printed(placed);
  if (cleared.length === 0) return [];
  const suppress = headers.suppressOnOpenings === undefined ? [] : ["suppress-head-on-openings"];
  return used(roles(setting)).map((role) =>
    block(
      `@page ${role}:first`,
      cleared.map((box) =>
        boxed(box, "none", [
          ...suppress,
          ...[placed.both, placed.left, placed.right].flatMap(
            (pages) => pages.get(box)?.keys ?? [],
          ),
        ]),
      ),
      role,
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
function boxes(content: ReadonlyMap<Box, Content>): Declaration[] {
  return BOXES.flatMap((box) => {
    const found = content.get(box);
    return found === undefined ? [] : [boxed(box, found.content, found.keys)];
  });
}

/**
 * The first-line indent sits on a paragraph that follows another. The
 * engine declares its own indent there, and an indent inherited from
 * `book` loses to it.
 */
function bodyRules(design: Design): (Rule | undefined)[] {
  const { body } = design;
  const lines: Declaration[] = [];
  if (body.font !== undefined) {
    lines.push(declared("font-family", `${quoted(body.font)}, serif`, ["body-font"]));
  }
  lines.push(...set("font-size", written(body.size), ["body-size"]));
  lines.push(...set("line-height", written(body.lineSpacing), ["body-line-spacing"]));
  lines.push(...set("text-align", body.align, ["body-align"]));
  lines.push(...set("hyphens", flagged(body.hyphens, "auto", "manual"), ["body-hyphens"]));
  lines.push(
    ...set(
      "hanging-punctuation",
      flagged(body.hangingPunctuation, "first allow-end last", "none"),
      ["body-hanging-punctuation"],
    ),
  );
  lines.push(...set("orphans", counted(body.orphans), ["body-orphans"]));
  lines.push(...set("widows", counted(body.widows), ["body-widows"]));
  return [
    block("book", lines),
    block("p + p", [...set("text-indent", written(body.indent), ["body-first-line-indent"])]),
    block("hr + p", [...set("text-indent", afterBreak(design), afterBreakKeys(design))]),
    block(HEADINGS, [
      ...set("break-after", flagged(body.keepHeadings, "avoid", "auto"), [
        "keep-heading-with-text",
      ]),
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

function afterBreakKeys(design: Design): string[] {
  return design.body.indentAfterBreak === true
    ? ["body-indent-after-break", "body-first-line-indent"]
    : ["body-indent-after-break"];
}

function headingRules(design: Design): (Rule | undefined)[] {
  return LEVELS.map((level) =>
    block(`h${level}`, typeLines(design.headings[level], level)),
  );
}

function typeLines(type: TypeSpec, level: Level): Declaration[] {
  const lines: Declaration[] = [];
  if (type.font !== undefined) {
    lines.push(
      declared("font-family", `${quoted(type.font)}, serif`, [`heading-${level}-font`]),
    );
  }
  lines.push(...set("font-size", written(type.size), [`heading-${level}-size`]));
  lines.push(...set("text-align", type.align, [`heading-${level}-align`]));
  return lines;
}

function sectionRules(design: Design, setting: Setting): (Rule | undefined)[] {
  const rules = used(roles(setting)).map((role) => {
    const lines = [declared("page", role)];
    if (role === "chapter" && design.chapter.begins !== undefined) {
      lines.push(declared("break-before", BREAKS[design.chapter.begins], ["chapter-begins"]));
    }
    return block(sectionsOf(setting.sections, role) ?? "", lines, role);
  });
  return [...rules, ...restart(setting), ...chapterRules(design, setting)];
}

/**
 * The body's first page, which is page 1 however many pages of front
 * matter come before it. A book with no front matter counts from its
 * first page already.
 */
function restart(setting: Setting): (Rule | undefined)[] {
  const start = bodyStart(roles(setting));
  const opening = start === undefined ? undefined : setting.sections[start];
  if (start === 0 || opening === undefined) return [];
  return [
    block(
      `section#${opening.id}`,
      [declared("counter-reset", "page 1")],
      opening.role,
    ),
  ];
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
function chapterRules(design: Design, setting: Setting): (Rule | undefined)[] {
  const chapters = sectionsOf(setting.sections, "chapter");
  if (chapters === undefined) return [];
  const { dropCap } = design.chapter;
  return [
    block(`${chapters} > ${OPENING}`, openingSpace(design), "chapter"),
    block(
      TEXT_START.map((start) => `${chapters} > ${start} + p::first-letter`).join(",\n"),
      [
        ...set(
          "initial-letter",
          dropCap === undefined || dropCap < 2 ? undefined : String(dropCap),
          ["chapter-drop-cap"],
        ),
      ],
      "chapter",
    ),
  ];
}

/** The space a chapter's design sets above and below an opening title. */
function openingSpace(design: Design): Declaration[] {
  const { spaceAbove, spaceBelow } = design.chapter;
  return [
    ...set(
      "padding-top",
      spaceAbove === undefined ? undefined : bodyLines(spaceAbove, design),
      ["chapter-space-above", ...spacing(design)],
    ),
    ...set(
      "margin-bottom",
      spaceBelow === undefined ? undefined : bodyLines(spaceBelow, design),
      ["chapter-space-below", ...spacing(design)],
    ),
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
function titlePageRules(design: Design, setting: Setting): (Rule | undefined)[] {
  const page = sectionsOf(setting.sections, "title-page");
  if (page === undefined) return [];
  const role = "title-page";
  const line = bodyLines(1, design);
  const lines = spacing(design);
  const rules = [
    block(
      `${page} > *`,
      [declared("text-align", "center"), declared("text-indent", "0")],
      role,
    ),
    block(
      `${page} > :first-child`,
      [declared("padding-top", bodyLines(TITLE_SINK, design), lines)],
      role,
    ),
    block(`${page} > p + h1,\n${page} > h1 + p`, [declared("padding-top", line, lines)], role),
  ];
  if (setting.publisher !== undefined && setting.publisher !== "") {
    rules.push(
      block(
        `${page} > p:last-child`,
        [declared("padding-top", bodyLines(IMPRINT_GAP, design), lines)],
        role,
      ),
    );
  }
  return rules;
}

/**
 * The contents, which orca writes as tagged paragraphs. A part is one
 * `.part` title. A chapter is an `.entry` title, then a `.folio` whose
 * empty link prints the page it lands on in the body's folio format.
 * The title sinks like a chapter's.
 *
 * The folio is a paragraph of its own, so it rises half a body line to
 * sit flush right on the title's last line. The engine ignores a
 * negative margin, so the folio moves by relative position instead.
 */
function contentsRules(design: Design, setting: Setting): (Rule | undefined)[] {
  const contents = sectionsOf(setting.sections, "contents");
  if (contents === undefined) return [];
  const role = "contents";
  const format = COUNTERS[design.headers.pageNumberFormat ?? "arabic"];
  const formatKeys = design.headers.pageNumberFormat === undefined ? [] : ["page-number-format"];
  const lines = spacing(design);
  return [
    block(`${contents} > ${OPENING}`, openingSpace(design), role),
    block(
      `${contents} p`,
      [
        declared("text-indent", "0"),
        declared("text-align", "left"),
        declared("hyphens", "manual"),
        declared("margin", "0"),
      ],
      role,
    ),
    block(
      `${contents} p.entry`,
      [
        declared("margin-left", "1em"),
        declared("padding-left", "1em"),
        declared("padding-right", "3em"),
        declared("text-indent", "-1em"),
      ],
      role,
    ),
    block(
      `${contents} p.folio`,
      [
        declared("text-align", "right"),
        declared("line-height", "0"),
        declared("position", "relative"),
        declared("top", `-${bodyLines(0.5, design)}`, lines),
        declared("break-before", "avoid"),
      ],
      role,
    ),
    block(
      `${contents} p.folio a::after`,
      [declared("content", `target-counter(attr(href url), page, ${format})`, formatKeys)],
      role,
    ),
    block(
      `${contents} p.part`,
      [
        declared("font-variant-caps", "small-caps"),
        declared("letter-spacing", "0.08em"),
        declared("margin-top", bodyLines(1, design), lines),
        declared("margin-bottom", bodyLines(0.5, design), lines),
        declared("break-after", "avoid"),
      ],
      role,
    ),
  ];
}

function sceneRules(design: Design): (Rule | undefined)[] {
  const { scene } = design;
  const lines = [...set("content", sceneContent(scene), sceneKeys(scene))];
  if (scene.mark === "word" && scene.word !== undefined) {
    lines.push(declared("text-align", "center", ["scene-break-mark", "scene-break-word"]));
  }
  lines.push(
    ...set(
      "margin-top",
      scene.spaceAbove === undefined
        ? undefined
        : bodyLines(scene.spaceAbove, design),
      ["scene-break-space-above", ...spacing(design)],
    ),
  );
  lines.push(
    ...set(
      "margin-bottom",
      scene.spaceBelow === undefined
        ? undefined
        : bodyLines(scene.spaceBelow, design),
      ["scene-break-space-below", ...spacing(design)],
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

function sceneKeys(scene: SceneDesign): string[] {
  const mark = scene.mark === undefined ? [] : ["scene-break-mark"];
  if (scene.mark === "space") return mark;
  if (scene.mark === "word") return [...mark, "scene-break-word"];
  return [...mark, "scene-break-ornament"];
}

/** The sections a role sits in, as one selector by id, or nothing when it sits nowhere. */
function sectionsOf(sections: readonly Named[], role: Role): string | undefined {
  const found = sections.flatMap((each) =>
    each.role === role ? [`section#${each.id}`] : [],
  );
  if (found.length === 0) return undefined;
  return found.length === 1 ? found[0] : `:is(${found.join(", ")})`;
}

function roles(setting: Setting): Role[] {
  return setting.sections.map((section) => section.role);
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
  return ownedKeys(headers).length > 0;
}

/** The keys of the header settings that make orca own the margin boxes. */
function ownedKeys(headers: HeaderDesign): string[] {
  return [
    ...(headers.leftPage === undefined ? [] : ["header-left-page"]),
    ...(headers.rightPage === undefined ? [] : ["header-right-page"]),
    ...(headers.pageNumber === undefined ? [] : ["page-number-position"]),
  ];
}

function folioContent(headers: HeaderDesign): Content | undefined {
  if (headers.pageNumber === undefined) return undefined;
  return {
    content: `counter(page, ${COUNTERS[headers.pageNumberFormat ?? "arabic"]})`,
    keys:
      headers.pageNumberFormat === undefined
        ? ["page-number-position"]
        : ["page-number-position", "page-number-format"],
  };
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

interface Side {
  value: string | undefined;
  keys: readonly string[];
}

function sideMargins(left: Side, right: Side): Declaration[] {
  return [
    ...set("margin-left", left.value, left.keys),
    ...set("margin-right", right.value, right.keys),
  ];
}

function bodyLines(count: number, design: Design): string {
  const spacing = design.body.lineSpacing;
  if (spacing === undefined) return `${trimmed(count)}em`;
  return `${trimmed(count * spacing.value)}${spacing.unit}`;
}

/** The key a count of body lines reads, when the design sets a line spacing. */
function spacing(design: Design): string[] {
  return design.body.lineSpacing === undefined ? [] : ["body-line-spacing"];
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

function set(
  property: string,
  value: string | undefined,
  keys: readonly string[] = [],
): Declaration[] {
  return value === undefined ? [] : [declared(property, value, keys)];
}

function declared(
  property: string,
  value: string,
  keys: readonly string[] = [],
): Declaration {
  return { text: `${property}: ${value};`, keys };
}

function boxed(box: string, content: string, keys: readonly string[]): Declaration {
  return { text: `@${box} { content: ${content}; }`, keys };
}

/**
 * One rule, or nothing at all when the design sets none of its
 * declarations. Its keys are those of its declarations, each once.
 */
function block(
  selector: string,
  lines: readonly Declaration[],
  role?: Role,
): Rule | undefined {
  if (selector === "" || lines.length === 0) return undefined;
  const keys = [...new Set(lines.flatMap((line) => line.keys))];
  return {
    css: `${selector} {\n${lines.map((line) => `  ${line.text}`).join("\n")}\n}\n`,
    from: role === undefined ? { keys } : { keys, role },
  };
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
