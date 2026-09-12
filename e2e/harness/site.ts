/**
 * The sample vault, opened in a window of its own and painted in the
 * docs site's colors and fonts.
 *
 * The site's tokens file holds the `--o-` keys as literals. They are
 * read out of it here and mapped onto the variables Obsidian paints
 * itself from, so one file settles what the site and the pictures in it
 * look like.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Book } from "./book";
import { Navigator } from "./navigator";
import { PLUGIN } from "./launch";
import { Obsidian, type Scheme } from "./obsidian";
import { Panel } from "./panel";

const root = path.resolve(fileURLToPath(import.meta.url), "../../..");

/** The file the colors and the fonts are read from. */
const TOKENS = path.join(root, "site/src/styles/tokens.css");

/** The file the faces are read from, and where the site installs them. */
const FACES = path.join(root, "site/src/styles/fonts.css");
const MODULES = path.join(root, "site/node_modules");

/**
 * Obsidian's own plugins that have no place in a picture of orca. Sync
 * puts an item in the status bar with a red mark on it until an account
 * is signed in, and the status bar is in the landing picture.
 */
const QUIET = ["sync"];

/** The snippet the sample vault is painted by, by the name it goes under. */
const SNIPPET = "orca-site";

/** The property the snippet sets, which says it has been loaded. */
const MARK = "--orca-site";

/**
 * The book orca is holding, as the plugin holds it. Orca has no export
 * command yet, so the spec takes the bytes off the session the preview
 * is already reading, which is the one session the invariant names.
 */
interface Holding {
  composer?: {
    opened(at: string): Promise<{ session: { pdf(): Promise<Uint8Array> } }> | undefined;
  };
}

/** The block each scheme's tokens are written in. */
const BLOCKS: Record<Scheme, string> = {
  dark: ":root",
  light: ":root[data-theme='light']",
};

/**
 * Obsidian's own variables, each given the site token it takes its
 * value from. Obsidian declares these on `body.theme-dark` and
 * `body.theme-light`, so the snippet claims the same selector and wins
 * by being loaded after the app's own stylesheet.
 */
/** The token the pane is painted from, and the variable it is given to. */
const PANE = "--o-pane";
const PAINTED_PANE = "--background-primary";

const PAINTED: Record<string, string> = {
  "--font-interface": "--o-ui",
  "--font-interface-override": "--o-ui",
  "--font-text": "--o-ui",
  "--background-primary": "--o-pane",
  "--background-primary-alt": "--o-pane",
  "--background-secondary": "--o-side",
  "--background-secondary-alt": "--o-bar",
  "--background-modifier-border": "--o-border",
  "--background-modifier-border-hover": "--o-border",
  "--background-modifier-border-focus": "--o-accent",
  "--background-modifier-hover": "--o-hover",
  "--background-modifier-form-field": "--o-field",
  "--divider-color": "--o-border",
  "--text-normal": "--o-text",
  "--text-muted": "--o-muted",
  "--text-faint": "--o-faint",
  "--text-accent": "--o-accent",
  "--text-on-accent": "--o-knob",
  "--text-selection": "--o-selected",
  "--interactive-accent": "--o-accent",
  "--interactive-accent-hover": "--o-accent",
  "--interactive-normal": "--o-field",
  "--interactive-hover": "--o-hover",
  "--color-accent": "--o-accent",
  "--color-accent-1": "--o-accent",
  "--color-accent-2": "--o-accent",
  "--ribbon-background": "--o-ribbon",
  "--titlebar-background": "--o-side",
  "--titlebar-background-focused": "--o-side",
  "--tab-background-active": "--o-pane",
  "--status-bar-background": "--o-bar",
  "--nav-item-background-selected": "--o-selected",
  "--nav-item-color-selected": "--o-text",
  "--tag-background": "--o-chip",
};

/**
 * Orca's own surfaces, which Obsidian has no variable for. The well
 * behind the pages and the shadow under one are drawn by orca, and the
 * artboards give each its own token.
 */
const SURFACES = [
  ".orca-preview-well { background: var(--o-desk) }",
  ".orca-page svg { box-shadow: var(--o-page-shadow) }",
].join("\n");

/** The declarations of one block of a stylesheet, name to value. */
function block(css: string, selector: string): Map<string, string> {
  const from = css.indexOf(`${selector} {`);
  if (from === -1) throw new Error(`no ${selector} in the tokens`);
  const body = css.slice(from, css.indexOf("\n}", from));
  return new Map(
    [...body.matchAll(/^\s*(--[\w-]+):\s*(.+);$/gm)].map((found) => [
      found[1] ?? "",
      found[2] ?? "",
    ]),
  );
}

/**
 * The site's faces, with every file inlined. A snippet is a stylesheet
 * with no directory of its own, so a relative url in one resolves
 * against Obsidian rather than against the site.
 */
async function faces(): Promise<string> {
  const css = await readFile(FACES, "utf8");
  const files = [...new Set([...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1] ?? ""))];
  const inlined = new Map<string, string>();
  for (const file of files) {
    const bytes = await readFile(path.join(MODULES, file)).catch(() => undefined);
    if (bytes === undefined) {
      throw new Error(`no ${file}; run \`npm ci\` in site to install the faces`);
    }
    inlined.set(file, `data:font/woff2;base64,${bytes.toString("base64")}`);
  }
  return css.replace(/url\('([^']+)'\)/g, (whole, file: string) => {
    const url = inlined.get(file);
    return url === undefined ? whole : `url('${url}')`;
  });
}

/** The site's `--o-` keys for one scheme, as the tokens file writes them. */
export async function tokensOf(scheme: Scheme): Promise<Map<string, string>> {
  const tokens = block(await readFile(TOKENS, "utf8"), BLOCKS[scheme]);
  return new Map([...tokens].filter(([name]) => name.startsWith("--o-")));
}

/** The snippet that paints Obsidian in the site's colors, both schemes in one file. */
export async function snippet(): Promise<string> {
  const css = await readFile(TOKENS, "utf8");
  const schemes = (Object.keys(BLOCKS) as Scheme[]).map((scheme) => {
    const tokens = block(css, BLOCKS[scheme]);
    const site = [...tokens]
      .filter(([name]) => name.startsWith("--o-"))
      .map(([name, value]) => `  ${name}: ${value};`);
    return `body.theme-${scheme} {\n${site.join("\n")}\n}`;
  });
  const mapped = Object.entries(PAINTED).map(
    ([name, token]) => `  ${name}: var(${token});`,
  );
  return [
    await faces(),
    ...schemes,
    `body.theme-dark, body.theme-light {\n  ${MARK}: on;\n${mapped.join("\n")}\n}`,
    SURFACES,
    "",
  ].join("\n\n");
}

/**
 * The sample vault in its own window. The snippet is written into the
 * copy and turned on before the window opens, so the app has the site's
 * colors from its first paint rather than repainting under the camera.
 */
export class Site {
  /** The preview, which paints the pages every picture is taken of. */
  readonly book: Book;
  /** The design panel, which a docs picture crops to one group of. */
  readonly panel: Panel;
  /** The navigator, which stands at the left of the landing picture. */
  readonly navigator: Navigator;

  private constructor(
    readonly obsidian: Obsidian,
    private readonly painted: Map<Scheme, string>,
  ) {
    this.book = new Book(obsidian);
    this.panel = new Panel(obsidian);
    this.navigator = new Navigator(obsidian);
  }

  static async open(from: Obsidian): Promise<Site> {
    const vault = Obsidian.sample();
    const config = path.join(vault, ".obsidian");
    await mkdir(path.join(config, "snippets"), { recursive: true });
    await writeFile(
      path.join(config, "snippets", `${SNIPPET}.css`),
      await snippet(),
    );
    await writeFile(
      path.join(config, "appearance.json"),
      JSON.stringify({ theme: "obsidian", enabledCssSnippets: [SNIPPET] }, null, 2),
    );

    const obsidian = await Obsidian.open(from, vault);
    await obsidian.trust(PLUGIN);
    await obsidian.quieten(QUIET);
    await obsidian.page.waitForFunction(
      (mark) =>
        getComputedStyle(document.body).getPropertyValue(mark).trim() === "on",
      MARK,
    );
    const painted = new Map<Scheme, string>();
    for (const scheme of Object.keys(BLOCKS) as Scheme[]) {
      painted.set(scheme, (await tokensOf(scheme)).get(PANE) ?? "");
    }
    return new Site(obsidian, painted);
  }

  /**
   * Paints the app in one of the two schemes, and waits for the pane to
   * be the color the tokens give it. Obsidian puts its snippets back on
   * the document as it changes theme, so for a moment the window is the
   * app's own colors under the new scheme's class.
   */
  async paint(scheme: Scheme): Promise<void> {
    await this.obsidian.paint(scheme);
    await this.obsidian.page.waitForFunction(
      (want) =>
        getComputedStyle(document.body).getPropertyValue(want.name).trim() ===
        want.value,
      { name: PAINTED_PANE, value: this.painted.get(scheme) ?? "" },
    );
  }

  /**
   * The book at this path as a PDF, exported off the session the
   * preview is reading. The bytes cross as base64: a page evaluate
   * answers in JSON, and an array of numbers is a byte an entry.
   */
  async pdf(at: string): Promise<Buffer> {
    const encoded = await this.obsidian.page.evaluate(
      async ({ id, book }) => {
        const orca = window.app.plugins.plugins[id] as Holding | undefined;
        const typeset = await orca?.composer?.opened(book);
        if (typeset === undefined) throw new Error(`no book is open at ${book}`);
        const bytes = await typeset.session.pdf();
        let said = "";
        for (let at = 0; at < bytes.length; at += 0x8000) {
          said += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
        }
        return btoa(said);
      },
      { id: PLUGIN, book: at },
    );
    return Buffer.from(encoded, "base64");
  }

  async close(): Promise<void> {
    await this.obsidian.shut();
  }
}
