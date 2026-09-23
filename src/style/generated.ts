/**
 * The layer a design generates: the settings as CSS, sent between the
 * theme and the author's own sheet.
 *
 * Each section crosses with its role as its class and a slug of its
 * name as its id. A role reaches the sheet as a page name and as the
 * ids of the sections that have that role. The layer is generated again
 * when the order changes or a section is renamed.
 *
 * Nothing here is written to the vault.
 */

import type { Named } from "@/book/names";
import type { Role } from "@/book/roles";
import {
  LEVELS,
  written,
  type Begins,
  type Caps,
  type ChapterTitle,
  type Design,
  type FontStyle,
  type HeaderDesign,
  type HeaderSlot,
  type Length,
  type Level,
  type NumberFormat,
  type SceneDesign,
  type TypeSpec,
} from "@/style/design";
import { familyFor, type Registered } from "@/style/faces";
import { quoted } from "@/style/quoted";

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
  /** The selector list, or the whole `@page` prelude for a page rule. */
  selector: string;
  declarations: readonly DeclarationFrom[];
}

/** One declaration of a generated rule. `box` names the margin box it sits in, inside a page rule. */
export interface DeclarationFrom {
  property: string;
  box?: string;
  keys: readonly string[];
}

/**
 * The design as CSS, counted against the order the book is in. Every
 * declaration comes from a field the design sets, with some exceptions.
 * The page names, and the page where the count starts again at 1, come
 * from the roles. The title page and the contents are laid out the same
 * way in every design. A font a face is registered for is named by the
 * family it is registered under.
 */
export function generatedCss(
  design: Design,
  setting: Setting,
  registered: readonly Registered[] = [],
): string {
  return generatedRules(design, setting, registered)
    .map((rule) => rule.css)
    .join("\n");
}

/** The rules `generatedCss` joins, in order, each with the line it starts on. */
export function generatedRules(
  design: Design,
  setting: Setting,
  registered: readonly Registered[] = [],
): GeneratedRule[] {
  const rules = [
    ...pageRules(design, setting, registered),
    ...bodyRules(design, registered),
    ...headingRules(design, registered),
    ...sectionRules(design, setting, registered),
    ...titleRules(design),
    ...titlePageRules(design, setting),
    ...contentsRules(design, setting),
    ...sceneRules(design, registered),
  ].filter((rule) => rule !== undefined);
  let line = 1;
  return rules.map(({ css, from, selector, declarations }) => {
    // A rule ends on a newline, and the join adds a blank line after it.
    const lines = css.split("\n").length - 1;
    const rule = { css, line, lines, from, selector, declarations };
    line += lines + 1;
    return rule;
  });
}

/** A rule before it is placed in the sheet. */
interface Rule {
  css: string;
  from: RuleFrom;
  selector: string;
  declarations: readonly DeclarationFrom[];
}

/** A declaration, and the setting keys its value reads. */
interface Declaration extends DeclarationFrom {
  text: string;
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

function pageRules(
  design: Design,
  setting: Setting,
  registered: readonly Registered[],
): (Rule | undefined)[] {
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
  const inside = { value: written(margins.inside), keys: ["margin-inside"] };
  const outside = { value: written(margins.outside), keys: ["margin-outside"] };
  // The side margins mirror, so the inside one prints at the spine on
  // either page.
  const left = sideMargins(outside, inside);
  const right = sideMargins(inside, outside);

  // Orca owns the running heads and the folio as soon as the design
  // sets anything about them. Orca clears the boxes it does not use
  // rather than leave them to the engine's own folio.
  const placed = placement(headers, setting);
  const cleared = { content: "none", keys: ownedKeys(headers) };
  const rootBoxes = new Map<Box, Content>(
    owned(headers) ? BOXES.map((box) => [box, cleared]) : [],
  );
  for (const [box, content] of placed.both) rootBoxes.set(box, content);

  const type = (pages: ReadonlyMap<Box, Content>): Declaration[] =>
    boxes(pages, headers, placed.folio, registered);

  return [
    block("@page", [...root, ...type(rootBoxes)]),
    block("@page :left", [...left, ...type(placed.left)]),
    block("@page :right", [...right, ...type(placed.right)]),
    ...frontPages(headers, placed, setting, registered),
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
function frontPages(
  headers: HeaderDesign,
  placed: Placement,
  setting: Setting,
  registered: readonly Registered[],
): (Rule | undefined)[] {
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
      headers,
      placed.folio,
      registered,
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
        boxed(box, "content", "none", [
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

/**
 * The margin boxes of one page rule, in the order the rule sets them. A
 * box that prints is set in the type the heads are set in, in the head's
 * font or the folio's by what it holds. A box that prints nothing takes
 * none of it.
 */
function boxes(
  content: ReadonlyMap<Box, Content>,
  headers: HeaderDesign,
  folio: ReadonlySet<Box>,
  registered: readonly Registered[],
): Declaration[] {
  return BOXES.flatMap((box) => {
    const found = content.get(box);
    if (found === undefined) return [];
    const prints = boxed(box, "content", found.content, found.keys);
    return found.content === "none"
      ? [prints]
      : [prints, ...inBox(box, headLines(headers, folio.has(box), registered))];
  });
}

/**
 * The type one margin box is set in. The heads and the folio are set
 * in one face and one style each, and take the same case and tracking.
 */
function headLines(
  headers: HeaderDesign,
  folio: boolean,
  registered: readonly Registered[],
): Declaration[] {
  const font = folio ? headers.folioFont : headers.font;
  return [
    ...set(
      "font-family",
      font === undefined ? undefined : family(font, undefined, registered),
      [folio ? "folio-font" : "header-font"],
    ),
    ...typeset(headers.caps, headers.letterSpacing, "header"),
    ...styled(folio ? headers.folioStyle : headers.style, folio ? "folio-style" : "header-style"),
  ];
}

/**
 * The case and the letter spacing one place is set in. Small caps is
 * the font's feature and all caps the text transformed, so one key
 * sets both properties, the normal case included. A control that
 * declared nothing at its default would leave the place to whatever
 * else sets it, and the panel would go on saying Normal.
 */
function typeset(
  caps: Caps | undefined,
  spacing: Length | undefined,
  key: string,
): Declaration[] {
  const lines: Declaration[] = [];
  if (caps !== undefined) {
    lines.push(
      declared("font-variant-caps", caps === "small-caps" ? "small-caps" : "normal", [
        `${key}-caps`,
      ]),
      declared("text-transform", caps === "all-caps" ? "uppercase" : "none", [`${key}-caps`]),
    );
  }
  lines.push(...set("letter-spacing", written(spacing), [`${key}-letter-spacing`]));
  return lines;
}

/**
 * The weight and the slope one place is set in. One key names both, so
 * a place set in the normal style declares that rather than leaving
 * the style to whatever else sets it.
 */
function styled(style: FontStyle | undefined, key: string): Declaration[] {
  if (style === undefined) return [];
  const bold = style === "bold" || style === "bold-italic";
  const italic = style === "italic" || style === "bold-italic";
  return [
    declared("font-weight", bold ? "bold" : "normal", [key]),
    declared("font-style", italic ? "italic" : "normal", [key]),
  ];
}

/**
 * The first-line indent sits on a paragraph that follows another. The
 * engine declares its own indent there, and an indent inherited from
 * `book` loses to it.
 */
function bodyRules(design: Design, registered: readonly Registered[]): (Rule | undefined)[] {
  const { body } = design;
  const lines: Declaration[] = [];
  if (body.font !== undefined) {
    lines.push(
      declared("font-family", family(body.font, body.fontVariant, registered), [
        "body-font",
        ...(body.fontVariant === undefined ? [] : ["body-font-variant"]),
      ]),
    );
  }
  lines.push(...styled(body.style, "body-style"));
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

function headingRules(
  design: Design,
  registered: readonly Registered[],
): (Rule | undefined)[] {
  return LEVELS.flatMap((level) => [
    block(`h${level}`, typeLines(design.headings[level], level, design, registered)),
    block(`section > h${level}:first-child`, openingSpace(design, level)),
  ]);
}

/** A level with no font of its own declares none, so it inherits the body's family whole. */
function typeLines(
  type: TypeSpec,
  level: Level,
  design: Design,
  registered: readonly Registered[],
): Declaration[] {
  const lines: Declaration[] = [];
  if (type.font !== undefined) {
    lines.push(
      declared("font-family", family(type.font, type.fontVariant, registered), [
        `heading-${level}-font`,
        ...(type.fontVariant === undefined ? [] : [`heading-${level}-font-variant`]),
      ]),
    );
  }
  lines.push(...styled(type.style, `heading-${level}-style`));
  lines.push(...set("font-size", written(type.size), [`heading-${level}-size`]));
  lines.push(...typeset(type.caps, type.letterSpacing, `heading-${level}`));
  lines.push(...set("text-align", type.align, [`heading-${level}-align`]));
  lines.push(
    ...set("margin-top", lined(type.spaceAbove, design), [
      `heading-${level}-space-above`,
      ...spacing(design),
    ]),
  );
  lines.push(
    ...set("margin-bottom", lined(type.spaceBelow, design), [
      `heading-${level}-space-below`,
      ...spacing(design),
    ]),
  );
  return lines;
}

/**
 * The heading a section opens on, which is the heading that starts a
 * page. The engine drops the top margin of a box that starts a page,
 * so the space above is padding there. The margin is cleared with it,
 * so a section that opens below the one before it takes the space once.
 */
function openingSpace(design: Design, level: Level): Declaration[] {
  const above = design.headings[level].spaceAbove;
  if (above === undefined) return [];
  const keys = [`heading-${level}-space-above`, ...spacing(design)];
  return [
    declared("padding-top", bodyLines(above, design), keys),
    declared("margin-top", "0", keys),
  ];
}

/** A count of body lines as a length, and nothing for a count the design leaves unset. */
function lined(count: number | undefined, design: Design): string | undefined {
  return count === undefined ? undefined : bodyLines(count, design);
}

function sectionRules(
  design: Design,
  setting: Setting,
  registered: readonly Registered[],
): (Rule | undefined)[] {
  const rules = used(roles(setting)).map((role) => {
    const lines = [declared("page", role)];
    if (role === "chapter" && design.chapter.begins !== undefined) {
      lines.push(declared("break-before", BREAKS[design.chapter.begins], ["chapter-begins"]));
    }
    return block(sectionsOf(setting.sections, role) ?? "", lines, role);
  });
  return [...rules, ...restart(setting), ...chapterRules(design, setting, registered)];
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
 * The heading the chapter title is read from. The engine reads the
 * section's first heading, whatever level it is written at, so a
 * chapter that opens on a title and a subhead takes whichever comes
 * first. A design that picks a level reads the heading at that level
 * instead, and a section with no heading there keeps the engine's own
 * reading.
 */
function titleRules(design: Design): (Rule | undefined)[] {
  const from = design.headers.chapterTitle;
  if (from === undefined) return [];
  return [
    block(titleSource(from), [
      declared("string-set", "chapter content()", ["chapter-title-from"]),
    ]),
  ];
}

/** The headings one pick reads, which are the ones a section opens on. */
function titleSource(from: ChapterTitle): string {
  if (from === "first") return `section > ${OPENING}`;
  return [
    `section > ${from}:first-child`,
    `section > ${OPENING} + ${from}`,
    `section > ${OPENING} + ${HEADINGS} + ${from}`,
  ].join(",\n");
}

/**
 * The chapter openings. The drop cap falls on the paragraph the
 * opening headings lead into, so a note with text before its first
 * heading takes no drop cap. A chapter with no drop cap sets no font on
 * its first letter, since the font is the cap's.
 */
function chapterRules(
  design: Design,
  setting: Setting,
  registered: readonly Registered[],
): (Rule | undefined)[] {
  const chapters = sectionsOf(setting.sections, "chapter");
  if (chapters === undefined) return [];
  const { chapter } = design;
  const { dropCap, dropCapFont } = chapter;
  const falls = dropCap !== undefined && dropCap >= 2;
  const starts = (suffix: string): string =>
    TEXT_START.map((start) => `${chapters} > ${start}${suffix}`).join(",\n");
  return [
    block(
      starts(" + p::first-letter"),
      [
        ...set("initial-letter", falls ? String(dropCap) : undefined, [
          "chapter-drop-cap",
        ]),
        ...set(
          "font-family",
          !falls || dropCapFont === undefined
            ? undefined
            : family(dropCapFont, undefined, registered),
          ["chapter-drop-cap-font"],
        ),
        ...styled(chapter.dropCapStyle, "chapter-drop-cap-style"),
      ],
      "chapter",
    ),
    block(
      starts(" + p::first-line"),
      typeset(chapter.firstLineCaps, chapter.firstLineLetterSpacing, "chapter-first-line"),
      "chapter",
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
 *
 * Every block on the page takes no margin, so the space a design sets
 * around a heading level leaves the title page as orca lays it out.
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
      [
        declared("text-align", "center"),
        declared("text-indent", "0"),
        declared("margin", "0"),
      ],
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

/** A scene break with no font or size of its own declares neither, so it inherits the body's. */
function sceneRules(design: Design, registered: readonly Registered[]): (Rule | undefined)[] {
  const { scene } = design;
  const lines: Declaration[] = [];
  if (scene.font !== undefined) {
    lines.push(
      declared("font-family", family(scene.font, undefined, registered), ["scene-break-font"]),
    );
  }
  lines.push(...styled(scene.style, "scene-break-style"));
  lines.push(...set("font-size", written(scene.size), ["scene-break-size"]));
  lines.push(...set("content", sceneContent(scene), sceneKeys(scene)));
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
  const { mark, ornament } = scene;
  if (mark === "space") return "none";
  return ornament === undefined ? undefined : quoted(ornament);
}

function sceneKeys(scene: SceneDesign): string[] {
  const mark = scene.mark === undefined ? [] : ["scene-break-mark"];
  if (scene.mark === "space") return mark;
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

/**
 * A count of body lines as a length. Where the design sets a line
 * spacing, a line is that spacing. Where it does not, a line is one em
 * of the box's own type.
 */
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
  return { text: `${property}: ${value};`, property, keys };
}

function boxed(
  box: string,
  property: string,
  value: string,
  keys: readonly string[],
): Declaration {
  return { text: `${property}: ${value};`, property, box, keys };
}

/** The declarations of one margin box, each carrying the box it sits in. */
function inBox(box: string, lines: readonly Declaration[]): Declaration[] {
  return lines.map((line) => ({ ...line, box }));
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
    css: `${selector} {\n${ruleLines(lines).join("\n")}\n}\n`,
    from: role === undefined ? { keys } : { keys, role },
    selector,
    declarations: lines.map(({ property, box, keys: read }) =>
      box === undefined ? { property, keys: read } : { property, box, keys: read },
    ),
  };
}

/** The lines of a rule. The declarations of one margin box are written as that box. */
function ruleLines(lines: readonly Declaration[]): string[] {
  const out: string[] = [];
  for (let at = 0; at < lines.length; ) {
    const line = lines[at];
    if (line === undefined) break;
    if (line.box === undefined) {
      out.push(`  ${line.text}`);
      at += 1;
      continue;
    }
    const box = line.box;
    const held: string[] = [];
    for (; at < lines.length && lines[at]?.box === box; at += 1) {
      const each = lines[at];
      if (each !== undefined) held.push(each.text);
    }
    out.push(`  @${box} { ${held.join(" ")} }`);
  }
  return out;
}

function trimmed(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** A font's family, which is the family its variant is registered under where there is one. */
function family(font: string, variant: string | undefined, registered: readonly Registered[]): string {
  return `${quoted(familyFor(registered, { font, variant }) ?? font)}, serif`;
}
