import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, glob, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";
import { Session, decodeDisplayList, initWasm } from "fleuron";
import { root } from "./bundle.mjs";

const read = (file) => readFile(path.join(root, file), "utf8");

/** The folder the sample book keeps its notes in, inside the sample vault. */
const SAMPLE_DIR = "site/sample/Twenty Thousand Leagues";

/** The sample vault's book note, which the landing page sets its pages from. */
const SAMPLE_BOOK = `${SAMPLE_DIR}/Twenty Thousand Leagues Under the Sea.md`;

/** Every file in a vault, by its path inside it, keyed on its bytes. */
async function vaultFiles(vault) {
  const found = new Map();
  for await (const inside of glob("**/*", { cwd: path.join(root, vault) })) {
    const bytes = await readFile(path.join(root, vault, inside)).catch(() => undefined);
    if (bytes !== undefined) found.set(inside, createHash("sha256").update(bytes).digest("hex"));
  }
  return found;
}

/** A note's frontmatter, as a key to value map. */
function properties(note) {
  const end = note.indexOf("\n---\n", 4);
  return Object.fromEntries(
    [...note.slice(4, end).matchAll(/^([\w-]+): (.+)$/gm)].map((m) => [m[1], m[2]]),
  );
}

/** The entries of one group of the reading order, link and role. */
function entries(note, heading) {
  const from = note.indexOf(`\n# ${heading}\n`);
  assert.notEqual(from, -1, `no ${heading} group`);
  const next = note.indexOf("\n# ", from + 1);
  const group = note.slice(from, next === -1 ? undefined : next);
  return [...group.matchAll(/^- (?:\[\[(.+?)\]\])?(?: ?`(\S+)`)?$/gm)].map((m) => ({
    link: m[1],
    role: m[2],
  }));
}

const [rootPackage, sitePackage, siteLock, tokens, theme, fonts, config, cname, workflow, claude] =
  await Promise.all([
    read("package.json"),
    read("site/package.json"),
    read("site/package-lock.json"),
    read("site/src/styles/tokens.css"),
    read("site/src/styles/theme.css"),
    read("site/src/styles/fonts.css"),
    read("site/astro.config.mjs"),
    read("site/public/CNAME"),
    read(".github/workflows/docs.yml"),
    read("CLAUDE.md"),
  ]);

/** A `:root` block's declarations, as a name to value map. */
function block(css, selector) {
  const from = css.indexOf(`${selector} {`);
  assert.notEqual(from, -1, `no ${selector}`);
  const body = css.slice(from, css.indexOf("\n}", from));
  return Object.fromEntries(
    [...body.matchAll(/^\s*(--[\w-]+):\s*(.+);$/gm)].map((m) => [m[1], m[2]]),
  );
}

test("the site is its own package, and the plugin's build does not install it", () => {
  assert.equal(JSON.parse(sitePackage).name, "orca-site");
  assert.equal(JSON.parse(siteLock).name, "orca-site");
  const plugin = JSON.parse(rootPackage);
  const deps = { ...plugin.dependencies, ...plugin.devDependencies };
  for (const name of ["astro", "@astrojs/starlight"]) {
    assert.equal(deps[name], undefined, `the plugin depends on ${name}`);
  }
  assert.match(JSON.parse(sitePackage).scripts.build, /astro build/);
});

test("one tokens file holds both schemes, and Starlight's variables read from it", () => {
  const dark = block(tokens, ":root");
  const light = block(tokens, ":root[data-theme='light']");
  assert.deepEqual(Object.keys(dark), Object.keys(light));
  assert.equal(dark["--bg"], "#0a0c0f");
  assert.equal(light["--bg"], "#eef0ec");

  const mapped = block(theme, ":root");
  const starlight = Object.entries(mapped).filter(([name]) => name.startsWith("--sl-color"));
  assert.ok(starlight.length > 0, "no Starlight color reads the tokens");
  for (const [name, value] of starlight) {
    const key = /var\((--[\w-]+)\)/.exec(value);
    assert.ok(key, `${name} does not read a token`);
    assert.ok(key[1] in dark, `${name} reads ${key[1]}, which the tokens do not hold`);
  }
});

test("dark is the default, and the toggle writes the key Starlight reads", async () => {
  const boot = /<script is:inline>([\s\S]*?)<\/script>/.exec(
    await read("site/src/components/ThemeBoot.astro"),
  )[1];
  const run = (stored) => {
    const store = new Map(stored === null ? [] : [["starlight-theme", stored]]);
    const window = {
      localStorage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, v),
      },
      document: { documentElement: { dataset: {} }, addEventListener() {} },
    };
    window.window = window;
    vm.runInNewContext(boot, window);
    return { window, store };
  };

  assert.equal(run(null).window.document.documentElement.dataset.theme, "dark");
  assert.equal(run("light").window.document.documentElement.dataset.theme, "light");

  const { window, store } = run(null);
  window.orcaTheme.set("light");
  assert.equal(window.document.documentElement.dataset.theme, "light");
  assert.equal(store.get("starlight-theme"), "light");
});

test("the fonts come from the site, and each one has a fallback", () => {
  const dark = block(tokens, ":root");
  for (const name of ["--display", "--body", "--ui", "--mono", "--o-ui"]) {
    const stack = dark[name].split(",");
    assert.ok(stack.length > 1, `${name} has no fallback`);
    assert.match(fonts, new RegExp(`font-family: ${stack[0]};`), `${name} is not served`);
  }
  for (const sheet of [tokens, theme, fonts]) {
    assert.doesNotMatch(sheet, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  }
});

test("the site's own domain is the one Pages keeps", () => {
  const host = cname.trim();
  assert.match(config, new RegExp(`const site = 'https://${host}';`));
  // A page at the domain root takes no base path.
  assert.doesNotMatch(config, /^\s*base:/m);
});

test("a PR that touches the site builds it, and main goes to GitHub Pages", () => {
  assert.match(workflow, /^on:\n {2}pull_request:\n {4}paths:\n {6}- "site\/\*\*"/m);
  assert.match(workflow, /working-directory: site\n/);
  assert.match(workflow, /- run: npm run build\n/);
  assert.match(workflow, /actions\/upload-pages-artifact@/);
  assert.match(workflow, /actions\/deploy-pages@/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
});

test("CLAUDE.md's CI section lists the docs workflow", () => {
  const section = claude.slice(
    claude.indexOf("## CI scaffolding"),
    claude.indexOf("## Documentation rules"),
  );
  assert.match(section, /docs\.yml/);
  assert.match(section, /GitHub Pages/);
});

test("the sample vault holds one book, and shares no file with the fixture", async () => {
  assert.match(await read(SAMPLE_BOOK), /^---\norca-book: 1\n/);

  const [sample, fixture] = await Promise.all([
    vaultFiles("site/sample"),
    vaultFiles("fixture"),
  ]);
  const shared = new Set(fixture.values());
  for (const [inside, bytes] of sample) {
    assert.equal(shared.has(bytes), false, `${inside} is the fixture's file too`);
  }
  assert.ok(sample.has("images/a-squid-of-colossal-dimensions.jpg"));
});

test("each chapter is a note of its own, under its number and a heading that is its title", async () => {
  const note = await read(SAMPLE_BOOK);
  const body = entries(note, "Body");

  assert.deepEqual(
    body.filter((entry) => entry.role !== undefined).map((entry) => entry.link),
    ["Part One", "Part Two"],
  );
  const headings = new Map();
  for (const { link, role } of body) {
    if (role !== undefined) continue;
    const chapter = await read(`${SAMPLE_DIR}/${link}.md`);
    headings.set(link, [...chapter.matchAll(/^#+ (.+)$/gm)].map((found) => found[1]));
  }
  // Every entry in the body is a chapter but the plate, which carries
  // no words of its own.
  const chapters = [...headings].filter(([, found]) => found.length > 0);
  assert.equal(chapters.length, 46);
  // The count starts again in each part, and the title is set in italic.
  const parts = [23, 23];
  let at = 0;
  for (const [link, found] of chapters) {
    const part = at < parts[0] ? 0 : 1;
    const number = at - (part === 0 ? 0 : parts[0]) + 1;
    at += 1;
    assert.equal(found.length, 2, `${link} has ${found.length} headings`);
    assert.equal(found[0], `CHAPTER ${roman(number)}`, `${link} is not chapter ${number}`);
    // A title with a question mark or a quotation mark in it keeps them
    // in the heading, because a note's name cannot hold them.
    assert.equal(found[1].replace(/^\*(.+)\*$/, "$1").replace(/[?\u201c\u201d]/g, ""), link);
    assert.match(found[1], /^\*.+\*$/, `${link} is not in italic`);
  }
});

test("a plate from the 1871 edition takes the page facing Chapter I", async () => {
  const body = entries(await read(SAMPLE_BOOK), "Body");
  const at = body.findIndex((entry) => entry.link === "A Shifting Reef");
  const plate = body[at - 1];
  assert.ok(plate?.link, "nothing stands before Chapter I");

  // The note holds the embed and nothing else, so the section takes a
  // page of its own and the chapter keeps its opening.
  const note = await read(`${SAMPLE_DIR}/${plate.link}.md`);
  const embed = /^!\[\[(.+)\]\]\n$/.exec(note);
  assert.ok(embed, `${plate.link} is not one embed on its own`);
  await readFile(path.join(root, "site/sample/images", embed[1]));
  assert.doesNotMatch(await read(`${SAMPLE_DIR}/A Shifting Reef.md`), /^!\[\[/);

  const copyright = await read(`${SAMPLE_DIR}/Copyright.md`);
  assert.match(copyright, /Alphonse de Neuville/);
  assert.match(copyright, /edition of 1871/);
  assert.match(copyright, /public domain/);
});

test("each chapter heading sits over a nautilus shell at a quarter strength", async () => {
  const css = /\n```css\n([\s\S]*?)\n```\n/.exec(await read(SAMPLE_BOOK))?.[1];
  assert.ok(css, "the book note has no css fence");
  const rule = /section\.chapter h1::before \{([^}]*)\}/.exec(css)?.[1];
  assert.ok(rule, "no rule draws behind the chapter heading");
  assert.match(rule, /background-image: url\("nautilus\.png"\)/);
  assert.match(rule, /opacity: 0\.25/);
  assert.match(rule, /z-index: -1/);

  // The engine reads no SVG, so the shell ships as a PNG.
  const png = await readFile(path.join(root, "site/sample/images/nautilus.png"));
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
});

test("the shell is centered on a chapter heading and reaches no line of the chapter's text", async () => {
  const { designSheets } = await moduleOf("src/style/sheet.ts");
  const { effective } = await moduleOf("src/style/theme.ts");
  const { readModel } = await moduleOf("src/book/model.ts");
  const { slug } = await moduleOf("src/book/names.ts");

  const require = createRequire(import.meta.url);
  const wasm = path.dirname(require.resolve("fleuron/fleuron_bg.wasm"));
  await initWasm({ module_or_path: await readFile(path.join(wasm, "fleuron_bg.wasm")) });

  const note = await read(SAMPLE_BOOK);
  const { design, metadata } = readModel(note).book;
  const css = /\n```css\n([\s\S]*?)\n```\n/.exec(note)[1];
  const chapter = `${SAMPLE_DIR}/A Shifting Reef.md`;
  const section = { role: "chapter", id: slug("A Shifting Reef", "chapter") };
  const setting = { sections: [section], title: metadata.title, author: metadata.author };
  const generated = designSheets(effective(design), setting).map((sheet) => sheet.css).join("\n");
  const faces = [
    '@font-face { font-family: "EB Garamond"; src: url("EBGaramond[wght].ttf"); font-style: normal; }',
    '@font-face { font-family: "EB Garamond"; src: url("EBGaramond-Italic[wght].ttf"); font-style: italic; }',
  ].join("\n");

  const session = new Session();
  try {
    session.setDialect("obsidian");
    session.setSplit(0);
    for (const face of ["EBGaramond[wght].ttf", "EBGaramond-Italic[wght].ttf"]) {
      session.addFontFile(face, await readFile(path.join(root, "site/sample/fonts", face)));
    }
    session.addImage("nautilus.png", await readFile(path.join(root, "site/sample/images/nautilus.png")));
    session.setSources([chapter], [await read(chapter)], [JSON.stringify({ classes: [section.role], id: section.id })]);
    session.setStyle(["faces.css", "generated.css", "book.css"], [faces, generated, css]);
    const page = decodeDisplayList(session.preview(0, 1)).pages[0];

    const shell = page.items.find((item) => item.kind === "background");
    assert.ok(shell, "nothing is drawn behind the chapter heading");
    const titleSize = Number.parseFloat(properties(note)["heading-1-size"]);
    const title = page.items.find((item) => item.kind === "text" && item.size === titleSize);
    assert.ok(title, "the chapter title is not on the page");
    // A run's ink rises no more than 0.8 of its size above its baseline,
    // the drop cap included.
    const text = page.items.filter((item) => item.kind === "text" && item.y > title.y);
    const top = Math.min(...text.map((run) => run.y - 0.8 * run.size));
    const bottom = shell.tileY + shell.tileH;
    assert.ok(bottom <= top, `the shell ends at ${bottom}pt, below text that starts at ${top}pt`);

    // The heading runs from the top of its first line to the foot of the
    // title's descenders, a quarter of the title's size under its baseline.
    const heading = page.items.filter((item) => item.kind === "text" && item.y <= title.y);
    const headTop = Math.min(...heading.map((run) => run.y - 0.8 * run.size));
    const headMiddle = (headTop + title.y + 0.25 * title.size) / 2;
    const shellMiddle = shell.tileY + shell.tileH / 2;
    assert.ok(
      Math.abs(shellMiddle - headMiddle) <= 3,
      `the shell's middle is at ${shellMiddle}pt and the heading's is at ${headMiddle}pt`,
    );
  } finally {
    session.free();
  }
});

test("the book note carries the design the landing page shows", async () => {
  const design = properties(await read(SAMPLE_BOOK));

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(design).filter(([key]) => key.startsWith("body-") || key.startsWith("chapter-")),
    ),
    {
      "body-font": "EB Garamond",
      "body-size": "10.5pt",
      "body-line-spacing": "14pt",
      "body-align": "justify",
      "body-first-line-indent": "1.2em",
      "body-hyphens": "true",
      "chapter-begins": "next-page",
      "chapter-space-above": "7",
      "chapter-drop-cap": "3",
    },
  );
  assert.equal(design.trim, "5.5in 8.5in");
  assert.deepEqual(entries(await read(SAMPLE_BOOK), "Front matter"), [
    { link: undefined, role: "title-page" },
    { link: "Copyright", role: "copyright" },
    { link: undefined, role: "contents" },
  ]);
});

/** The landing page and its scripts. */
const LANDING = "site/src/pages/index.astro";

const [landing, landingCss, plugin, playwright] = await Promise.all([
  read(LANDING),
  read("site/src/styles/landing.css"),
  read("src/ui/plugin.ts"),
  read("playwright.config.ts"),
]);

/** The page's own stylesheet, which its `<style>` block holds. */
const landingStyle = /<style>([\s\S]*)<\/style>/.exec(landing)[1];

/** The words of a fragment of markup, with the tags taken out. */
function words(html) {
  return html
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every title of a part or a page, in the order it draws them. */
function titles(html) {
  return [...html.matchAll(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((found) => words(found[2]));
}

/** The prose under each title, which the parts mark with `sec-p`. */
/** A count below forty, in capital roman numerals. */
function roman(count) {
  let left = count;
  let written = "";
  for (const [value, numeral] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) {
    for (; left >= value; left -= value) written += numeral;
  }
  return written;
}

function prose(html) {
  return [...html.matchAll(/<p class="sec-p"[^>]*>([\s\S]*?)<\/p>/g)].map((found) =>
    words(found[1]),
  );
}

/** The line under the title, which every artboard opens with. */
function lede(html) {
  return words(/<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/.exec(html)[1]);
}

/** A site module, built and run over the globals a browser would give it. */
async function moduleOf(file, globals = {}) {
  const built = await esbuild.build({
    entryPoints: [path.join(root, file)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "node22",
    alias: { "@": path.join(root, "src") },
  });
  const holder = { exports: {} };
  vm.runInNewContext(built.outputFiles[0].text, {
    module: holder,
    exports: holder.exports,
    structuredClone,
    ...globals,
  });
  return holder.exports;
}

/** A colour's relative luminance, which says which of two is the darker. */
function luminance(hex) {
  const parts = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = parts.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** One length the page declares on `.page`, in pixels. */
function metric(name) {
  const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(landingStyle);
  assert.ok(found, `the page declares no --${name}`);
  const clamped = /clamp\([^,]+,[^,]+,\s*([\d.]+)px\)/.exec(found[1]);
  return Number(clamped ? clamped[1] : /([\d.]+)/.exec(found[1])[1]);
}

test("the surface moves, runs through the second line of the title, and the title inverts", async () => {
  const { seaPath, REST } = await moduleOf("site/src/scripts/sea.ts");
  const wave = { off: 0, lag: 0, kind: "body" };
  assert.notEqual(seaPath(wave, 1440, 0), seaPath(wave, 1440, 2));

  // The band the surface moves inside, measured down the page: the rest
  // line, less the deepest the middle dips, plus the tallest swell.
  const calc = /--sea-top:\s*calc\(([\s\S]*?)\);/.exec(landingStyle)[1];
  const seaTop = Number(
    new Function(
      `return (${calc.replace(/var\(--([\w-]+)\)/g, (whole, name) => String(metric(name))).replace(/px/g, "")})`,
    )(),
  );
  const leading = metric("title-size") * metric("title-leading");
  const title = metric("header-h") + metric("hero-pad");
  const band = [seaTop + REST - 30 - 13, seaTop + REST + 13];
  assert.ok(band[0] > title + leading, `the surface runs above the second line at ${band[0]}`);
  assert.ok(band[1] < title + leading * 2, `the surface runs under the second line at ${band[1]}`);

  // One ink for the title in both schemes, and a difference blend, so
  // the letters turn over where the surface crosses them.
  assert.match(landingStyle, /mix-blend-mode: difference/);
  assert.match(landingStyle, /color: var\(--title-ink\)/);
  assert.equal(landingStyle.match(/--title-ink:/g).length, 1);
});

test("the sea darkens from the surface to the end of the page", () => {
  const body = /\.sea \.body \{([\s\S]*?)\}/.exec(landingStyle)[1];
  assert.match(body, /bottom: 0/);
  assert.match(
    body.replace(/\s+/g, " "),
    /linear-gradient\( to bottom, var\(--sea-0\), var\(--sea-1\) 30%, var\(--sea-2\) 70%, var\(--sea-3\) \)/,
  );

  for (const scheme of [":root", ":root[data-theme='light']"]) {
    const ramp = block(tokens, scheme);
    const deep = [0, 1, 2, 3].map((at) => luminance(ramp[`--sea-${at}`]));
    for (const [at, light] of deep.entries()) {
      if (at === 0) continue;
      assert.ok(light < deep[at - 1], `${scheme} --sea-${at} is no darker than the one above it`);
    }
  }
});

test("with reduced motion on, the sea, the specks and the pane swap hold still", async () => {
  const still = "@media (prefers-reduced-motion:reduce)";
  const rules = landingCss.split(still).slice(1).join(" ");
  assert.match(rules, /\.snow\{animation:none\}/);
  assert.match(rules, /\.sw-ms\{animation:none/);
  assert.match(rules, /\.sw-bk\{animation:none/);

  const drawn = [];
  let frames = 0;
  const { startSea } = await moduleOf("site/src/scripts/sea.ts", {
    window: {
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      addEventListener() {},
      removeEventListener() {},
    },
    requestAnimationFrame: () => (frames += 1),
    cancelAnimationFrame() {},
    performance: { now: () => 0 },
  });
  const path = {
    dataset: { kind: "body", off: "0", lag: "0" },
    setAttribute: (name, value) => drawn.push(value),
  };
  const svg = {
    querySelectorAll: () => [path],
    getBoundingClientRect: () => ({ width: 1440 }),
    setAttribute() {},
  };
  startSea(svg);
  assert.equal(frames, 0, "the sea asked for a frame");
  assert.equal(drawn.length, 1, "the sea drew more than the one still surface");
});

test("the design demo is the plugin's own panel over the plugin's own engine", async () => {
  const { GLYPHS, GROUPS, trims } = await moduleOf("src/ui/groups.ts");
  const demo = await moduleOf("site/src/scripts/demo.ts");

  // A choice writes the value it stands for. A switch writes the
  // opposite of the one the design holds, which is what a switch is.
  const design = demo.opens({ design: { "body-hyphens": true } });
  assert.equal(demo.clicked(design, "body-align", "left"), "left");
  assert.equal(demo.clicked(design, "body-hyphens", undefined), false);
  assert.equal(demo.clicked(demo.opens({ design: {} }), "body-hyphens", undefined), true);

  // The page the demo sets is the engine's, not the browser's. The
  // sheets it sends are the ones the plugin generates.
  const typeset = await read("site/src/scripts/typeset.ts");
  assert.match(typeset, /import \{ designSheets \} from '@\/style\/sheet'/);
  assert.match(typeset, /new Session\(serialized\(/);
  assert.match(typeset, /styleOp\(designSheets\(/);
  // A chapter is one section, so a label over its title stays with it.
  assert.match(typeset, /\{ op: 'split', level: 0 \}/);
  assert.match(typeset, /paintPage\(page, \{ fonts: reading\.fonts/);
  // Nothing about the page is drawn by CSS: the old fake page is gone.
  assert.doesNotMatch(landing, /class="pg-text"|class="pg r"|data-demo-text|data-demo-mark/);

  // The site sets its pages with the engine the plugin is pinned to.
  const plugin = JSON.parse(await read("package.json"));
  const site = JSON.parse(await read("site/package.json"));
  assert.equal(
    site.dependencies.fleuron,
    plugin.dependencies.fleuron,
    "the site and the plugin are pinned to different fleurons",
  );

  // The page names the groups and hands them to the component whole. No
  // row, label or choice is written out here, so none can fall behind
  // the panel's.
  assert.match(landing, /GROUPS\.map\(\(group: Group\) => \(\{/);
  assert.match(landing, /rows: group\.rows\.filter\(\(row\) => row\.of\.some\(offered\)\)/);
  assert.match(landing, /<PanelGroup group=\{group\} values=\{shown\} own=\{own\} faces=\{FACES\} \/>/);

  // Every control those groups hold is one the component draws, and a
  // kind it cannot draw stops the site's build rather than going out as
  // a panel the plugin does not have.
  const component = await read("site/src/components/PanelGroup.astro");
  const drawn = /const DRAWN = new Set\(\[([^\]]+)\]\)/
    .exec(component)[1]
    .split(",")
    .map((kind) => kind.trim().replace(/'/g, ""))
    .filter(Boolean);
  // Every group, so every control the panel offers is one a reader can
  // work rather than a picture of one.
  for (const group of GROUPS) {
    for (const row of group.rows) {
      for (const control of row.of) {
        assert.ok(
          drawn.includes(control.kind),
          `the page cannot draw the ${control.kind} in ${group.name}`,
        );
      }
    }
  }
  assert.match(component, /throw new Error\(\s*`the \$\{group\.name\} group has a/);

  // Every control carries the key it writes, so the script works them
  // all rather than the few it knows by name.
  assert.match(component, /data-key=\{keyOf\(control\)\}/);

  // A reset clears the keys its row sets, so each takes its default, as
  // the panel's does. It is a button, not a picture of one.
  const { effective } = await moduleOf("src/style/theme.ts");
  const { writeDesign: written } = await moduleOf("src/style/design.ts");
  const set = demo.opens({ design: { "body-size": "13pt", "body-align": "left" } });
  const back = demo.cleared(set, ["body-size"]);
  assert.equal(written(back)["body-size"], undefined);
  assert.equal(written(back)["body-align"], "left");
  assert.equal(
    written(effective(back))["body-size"],
    written(effective(demo.opens({ design: {} })))["body-size"],
  );
  assert.match(component, /<button\s+type="button"\s+class="o-reset"/);
  assert.match(component, /data-reset=/);
  // The page hands the demo the note's own keys, so there is a key to clear.
  assert.match(landing, /design: writeDesign\(design\),/);

  // A number is a field with a stepper beside it, the way the panel
  // draws one, and it steps by the plugin's own step.
  assert.match(component, /<div class="o-step">/);
  assert.match(component, /data-step="1"/);
  assert.match(component, /data-step="-1"/);
  const script = await read("site/src/scripts/demo.ts");
  assert.match(script, /import \{[^}]*stepped[^}]*\} from '@\/ui\/groups'/);
  assert.match(script, /stepped\(held, field\.value, by, times, unit\)/);
  // The arrow keys move it too, which is what the panel's field does.
  assert.match(script, /event\.key === 'ArrowUp'/);
  assert.ok(GLYPHS.length > 0 && trims("in").length > 0);
});

test("the sections that show orca's own surfaces show photographs of them", async () => {
  // A hand-built copy of a surface goes stale the moment the surface
  // moves, so every one the page shows is a picture the spec took.
  for (const section of ["vault-shots", "sw-win"]) {
    assert.match(landing, new RegExp(`<div class="${section}">`), `the page has no ${section}`);
  }
  for (const drawn of ["src tree", "src note", "x-win", "x-pane", "x-doc", "ex-dlg"]) {
    assert.doesNotMatch(landing, new RegExp(`class="${drawn}"`), `${drawn} is drawn by hand`);
  }
  for (const shot of ["vault-tree", "vault-note", "write", "read", "inspect", "export"]) {
    for (const scheme of ["dark", "light"]) {
      assert.ok(
        landing.includes(`../shots/${shot}-${scheme}.png`),
        `the page does not show ${shot}-${scheme}`,
      );
    }
  }
});

test("the pages turn on a click, on the arrow buttons and from the keyboard", async () => {
  const flip = await moduleOf("site/src/scripts/flip.ts");

  // Five leaves stand between the first page and the last, so the book
  // reads as six spreads.
  const leaves = 5;
  assert.deepEqual([...flip.spread(0)], [flip.FIRST, flip.FIRST + 1]);
  assert.equal(flip.folio(0), `Pages ${flip.FIRST}–${flip.FIRST + 1}`);
  assert.equal(flip.folio(leaves), `Pages ${flip.FIRST + 10}–${flip.FIRST + 11}`);

  const turned = (at) => flip.layout(leaves, at).filter((leaf) => leaf.turned).length;
  assert.equal(turned(0), 0);
  assert.equal(turned(3), 3);
  assert.equal(turned(leaves), leaves);

  // The leaf in the air stands over the stack on both sides of it.
  const moving = [...flip.layout(leaves, 2, 1)];
  assert.ok(moving[1].z > Math.max(...moving.filter((leaf, at) => at !== 1).map((leaf) => leaf.z)));

  const source = await read("site/src/scripts/flip.ts");
  assert.match(source, /leaf\.addEventListener\('click'/);
  assert.match(source, /'ArrowLeft'/);
  assert.match(source, /'ArrowRight'/);
  // The arrows are buttons, so a keyboard reaches them with no help.
  for (const step of ["-1", "1"]) {
    assert.match(landing, new RegExp(`<button\\s+type="button"\\s+data-turn="${step}"`));
  }
});

test("every picture on the page is one the screenshot spec takes", async () => {
  const sources = [...landing.matchAll(/from '(\.\.\/[^']+\.(?:png|jpe?g|webp|svg))'/g)].map(
    (found) => found[1],
  );
  const globbed = [...landing.matchAll(/import\.meta\.glob<[^>]+>\('([^']+)'/g)].map(
    (found) => found[1],
  );
  assert.ok(sources.length > 0, "the page shows no picture");
  for (const source of [...sources, ...globbed]) {
    assert.match(source, /^\.\.\/shots\//, `${source} is not a picture the spec takes`);
  }
  // Nothing else is fetched: a picture named in the markup would be one
  // the spec never took.
  assert.doesNotMatch(landing, /<img[^>]+src="(?!\{)/);

  // The directory the page reads from is the shots project's snapshots.
  assert.match(playwright, /name: "shots"/);
  assert.match(playwright, /snapshotPathTemplate: "site\/src\/shots\/\{arg\}\{ext\}"/);
  const taken = [];
  for await (const file of glob("site/src/shots/**/*.png", { cwd: root })) taken.push(file);
  assert.ok(taken.length >= 12, "the spec has taken no pages");
});

test("the copy claims no feature the plugin has yet to grow", async () => {
  const said = [
    ...titles(landing),
    ...prose(landing),
    lede(landing),
    ...[...landing.matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((f) => words(f[1])),
  ].join(" ");

  // Each claim, with the file and the line in `src` that would make it
  // true. A claim whose line is not there yet must not be on the page.
  const claims = [
    [/\bexport(s|ed|ing)?\b|\bPDF\b|preflight/i, plugin, /id: "export-pdf"/, "export"],
    [
      /your own CSS|overrides a setting/i,
      await read("src/ui/panels.tsx"),
      /overridden/,
      "an overridden control",
    ],
    [/\binspect/i, await read("src/ui/pane.tsx"), /orca-inspect-pane/, "inspect mode"],
  ];
  for (const [claimed, source, built, what] of claims) {
    if (built.test(source)) continue;
    assert.doesNotMatch(said, claimed, `the page claims ${what}, which orca has not built`);
  }
});

test("the panel section says a control the author's CSS overrides dims and names the line", () => {
  const from = landing.indexOf("in the panel</i>");
  assert.notEqual(from, -1, "no panel section");
  const section = landing.slice(from, landing.indexOf("</section>", from));
  const said = prose(section).join(" ");
  assert.match(said, /your own CSS overrides a setting/);
  assert.match(said, /dims and names the line/);
});

test("the footer carries the tail mark in one flat colour", async () => {
  const mark = await read("site/src/components/Mark.astro");
  assert.match(mark, /fill="currentColor"/);
  assert.doesNotMatch(mark, /fill="(?!currentColor)[^"]+"/);

  const footer = /\.word\.small \{([\s\S]*?)\}/.exec(landingStyle)[1];
  assert.match(footer, /color: var\(--text\)/);
  assert.equal(block(tokens, ":root")["--text"], "#eef0ec");
  assert.equal(block(tokens, ":root[data-theme='light']")["--text"], "#0a0c0f");
});

// What this tier does not cover: whether a docs page matches the SiteDocs
// artboards, which only a render in a browser shows, and whether the
// sample's chapter opening matches the SiteLanding artboard, which the
// pages themselves answer. Nor how the landing page looks: the tier
// reads its source, and a browser is what shows the sea running through
// the title.

/** The chapter the demo sets, and the note that designs it. */
const DEMO_CHAPTER = `${SAMPLE_DIR}/A Shifting Reef.md`;

/**
 * Sets the demo's first page under a design and hands back what the
 * engine put on it. Two designs that lay out the same page give the
 * same string.
 */
function pageUnder(engine, design) {
  const css = engine
    .designSheets(design, engine.setting)
    .map((sheet) => sheet.css)
    .join("\n");
  // The chapter is one section, as the demo and the plugin send it.
  const session = new Session();
  try {
    session.setDialect("obsidian");
    session.setSplit(0);
    session.setSources([DEMO_CHAPTER], [engine.text], [engine.attributes]);
    session.setStyle(["generated.css"], [css]);
    return JSON.stringify(decodeDisplayList(session.preview(0, 1)).pages[0]);
  } finally {
    session.free();
  }
}

test("every control the demo offers changes the page the demo shows", async () => {
  const { GROUPS, atLevel, trims, GLYPHS, withKey } = await moduleOf("src/ui/groups.ts");
  const { readDesign, writeDesign } = await moduleOf("src/style/design.ts");
  const { effective } = await moduleOf("src/style/theme.ts");
  const { designSheets } = await moduleOf("src/style/sheet.ts");
  const { readModel } = await moduleOf("src/book/model.ts");
  const { slug } = await moduleOf("src/book/names.ts");
  const { WORKS } = await moduleOf("site/src/scripts/demo.ts");

  const require = createRequire(import.meta.url);
  const wasm = path.dirname(require.resolve("fleuron/fleuron_bg.wasm"));
  await initWasm({ module_or_path: await readFile(path.join(wasm, "fleuron_bg.wasm")) });

  const { design, metadata } = readModel(await read(SAMPLE_BOOK)).book;
  // The chapter crosses with its role as its class and a slug of its
  // name as its id, as the plugin sends it.
  const section = { role: "chapter", id: slug(path.basename(DEMO_CHAPTER, ".md"), "chapter") };
  const engine = {
    designSheets,
    text: await read(DEMO_CHAPTER),
    setting: { sections: [section], title: metadata.title, author: metadata.author },
    attributes: JSON.stringify({ classes: [section.role], id: section.id }),
  };
  // The demo opens on the design the panel shows, defaults filled in.
  const opens = readDesign(writeDesign(effective(design)));
  const first = pageUnder(engine, opens);

  /** A value for a key other than the one the design holds. */
  const other = (key, control) => {
    const held = String(writeDesign(opens)[key] ?? "");
    if (control.kind === "flag") return writeDesign(opens)[key] !== true;
    if (control.kind === "trim") return trims("in").find((c) => c.value !== held)?.value;
    if (control.kind === "glyph") return GLYPHS.find((glyph) => glyph !== held);
    if (control.choices?.length) return control.choices.find((c) => c.value !== held)?.value;
    if (control.kind === "length") return held.endsWith("em") ? "3em" : "22pt";
    if (control.kind === "count") return String(Number(held || "0") + 5);
    return undefined;
  };

  const controls = new Map();
  for (const group of GROUPS) {
    for (const row of group.rows) {
      for (const control of row.of) {
        if (control.key === undefined) continue;
        controls.set(atLevel(control.key, 1), control);
      }
    }
  }

  assert.ok(WORKS.length > 0, "the demo offers no controls");
  for (const key of WORKS) {
    const control = controls.get(key);
    assert.ok(control, `the design panel has no ${key}`);
    const value = other(key, control);
    assert.notEqual(value, undefined, `no other value to set ${key} to`);
    assert.notEqual(
      pageUnder(engine, withKey(opens, key, value)),
      first,
      `${key} is offered by the demo but changes nothing on the page it shows`,
    );
  }
});

/** The docs pages' directory. */
const DOCS = "site/src/content/docs";

/** Every docs page, by its path under the docs directory. */
async function docsPages() {
  const found = [];
  for await (const file of glob("**/*.{md,mdx}", { cwd: path.join(root, DOCS) })) found.push(file);
  return found.sort();
}

/** The body rows of the table on a page with this header row, cell by cell. */
function table(page, header) {
  const from = page.indexOf(`| ${header.join(" | ")} |`);
  assert.notEqual(from, -1, `no table with the columns ${header.join(", ")}`);
  const rows = [];
  for (const line of page.slice(from).split("\n").slice(2)) {
    if (!line.startsWith("|")) break;
    rows.push(line.trim().slice(1, -1).split("|").map((cell) => cell.trim()));
  }
  return rows;
}

/** A cell's text with the backticks around it taken off. */
const unquoted = (cell) => cell.replace(/^`(.*)`$/, "$1");

/** A file under the repository root exists. */
const exists = (file) =>
  access(path.join(root, file)).then(
    () => true,
    () => false,
  );

test("the design keys page lists every key, in the order the schema writes them", async () => {
  const { DESIGN_KEYS, LEVELS } = await moduleOf("src/style/design.ts");
  const listed = table(await read(`${DOCS}/reference/design-keys.mdx`), ["Key", "Values", "Reference"]).map(
    ([key]) => unquoted(key),
  );

  // A run of `heading-N-` rows stands for those keys at every level.
  const expanded = [];
  let run = [];
  const flush = () => {
    expanded.push(...LEVELS.flatMap((level) => run.map((key) => key.replace("-N-", `-${level}-`))));
    run = [];
  };
  for (const key of listed) {
    if (key.startsWith("heading-N-")) {
      run.push(key);
      continue;
    }
    flush();
    expanded.push(key);
  }
  flush();
  assert.deepEqual(expanded, [...DESIGN_KEYS]);
});

test("each group in the design panel has a page with its controls, their defaults and their keys", async () => {
  const { GROUPS, atLevel, defaultSaid } = await moduleOf("src/ui/groups.ts");
  const { emptyDesign, writeDesign } = await moduleOf("src/style/design.ts");
  const { effective } = await moduleOf("src/style/theme.ts");
  const { LIMITS } = await moduleOf("src/ui/limits.ts");
  const empty = writeDesign(effective(emptyDesign()));

  for (const group of GROUPS) {
    const slug = group.name.toLowerCase().replace(" & ", " and ").replaceAll(" ", "-");
    // The level row picks which heading the rows under it write, and
    // writes no key of its own.
    const rows = table(await read(`${DOCS}/design/${slug}.mdx`), ["#", "Control", "Default", "Key"]).filter(
      ([, , , key]) => key !== "none",
    );
    const controls = group.rows.flatMap((row) => row.of).filter((control) => control.key !== undefined);
    assert.deepEqual(
      rows.map(([, , , key]) => unquoted(key)),
      [...controls.map((control) => control.key)],
      `the ${group.name} page lists other keys than the group writes`,
    );
    for (const [at, control] of controls.entries()) {
      // A variant's default is the default face of the font, which only
      // the faces on the machine name.
      if (control.kind === "variant") continue;
      // The panel draws a count with its word after it.
      const shown = defaultSaid(control, empty[atLevel(control.key, 1)], LIMITS.unit);
      const cell = unquoted(rows[at][2]);
      assert.ok(
        cell === shown || cell.startsWith(`${shown} line`),
        `the ${group.name} page gives ${control.key} the default ${cell}, and the panel shows ${shown}`,
      );
    }
  }
});

test("the number on each mark of a design group's picture is the number of its row", async () => {
  const { GROUPS } = await moduleOf("src/ui/groups.ts");
  for (const group of GROUPS) {
    const slug = group.name.toLowerCase().replace(" & ", " and ").replaceAll(" ", "-");
    const page = await read(`${DOCS}/design/${slug}.mdx`);
    const marks = [.../marks=\{\[([^\]]*)\]\}/.exec(page)[1].matchAll(/'([^']+)'/g)].map((found) => found[1]);
    const numbered = table(page, ["#", "Control", "Default", "Key"])
      .filter(([n]) => n !== "")
      .map(([n, , , key]) => [Number(n), key === "none" ? "heading-level" : unquoted(key).replace("-N-", "-1-")]);
    assert.deepEqual(
      numbered,
      marks.map((id, at) => [at + 1, id]),
      `the ${group.name} page numbers its rows other than its marks`,
    );
  }
});

test("every docs page shows orca only in pictures the screenshot spec took", async () => {
  for (const file of await docsPages()) {
    const page = await read(`${DOCS}/${file}`);
    assert.doesNotMatch(page, /Figure\.astro/, `${file} imports a figure drawn by hand`);
    assert.doesNotMatch(page, /\.(?:png|jpe?g|webp|svg)\b/, `${file} names a picture of its own`);
    assert.doesNotMatch(page, /<img\b|!\[/, `${file} shows a picture outside <Shot>`);

    for (const [, props] of page.matchAll(/<Shot\b([\s\S]*?)\/>/g)) {
      const name = /name="([^"]+)"/.exec(props)?.[1];
      assert.ok(name, `${file} has a <Shot> with no name`);
      for (const scheme of ["dark", "light"]) {
        assert.ok(await exists(`site/src/shots/${name}-${scheme}.png`), `${file} shows ${name}-${scheme}, which the spec has not taken`);
      }
      const marks = /marks=\{\[([^\]]*)\]\}/.exec(props);
      if (marks === null) continue;
      const sidecar = `site/src/shots/${name}.marks.json`;
      assert.ok(await exists(sidecar), `${file} marks ${name}, which has no marks`);
      const measured = JSON.parse(await read(sidecar)).marks;
      for (const [, id] of marks[1].matchAll(/'([^']+)'/g)) {
        assert.ok(id in measured, `${file} marks ${id} on ${name}, which the spec did not measure`);
      }
    }
    for (const [, n] of page.matchAll(/<Page n=\{(\d+)\}/g)) {
      const picture = `site/src/shots/pages/page-${n.padStart(2, "0")}.png`;
      assert.ok(await exists(picture), `${file} shows ${picture}, which the spec has not taken`);
    }
  }

  // The components read the shots directory and nothing else.
  for (const component of ["Shot", "Page"]) {
    const source = await read(`site/src/components/${component}.astro`);
    const globbed = [...source.matchAll(/import\.meta\.glob<[^>]+>\('([^']+)'/g)].map((found) => found[1]);
    assert.ok(globbed.length > 0, `${component} reads no picture`);
    for (const pattern of globbed) assert.match(pattern, /^\.\.\/shots\//);
  }
});

test("every docs page is in the sidebar, and every entry in the sidebar is a page", async () => {
  const listed = [...config.slice(config.indexOf("sidebar:")).matchAll(/'([\w-]+\/[\w-]+)'/g)].map(
    (found) => found[1],
  );
  const pages = (await docsPages()).map((file) => file.replace(/\.mdx?$/, ""));
  assert.deepEqual([...listed].sort(), pages.sort());
});

// What this file does not cover: the pictures themselves, which the
// screenshot spec takes and compares; whether a control the demo leaves
// out would change the page, since a book with a scene break or a facing
// page would answer differently; whether a mark sits over the control it
// names, which the spec measures; the default of a font variant, which
// the faces on the machine decide; and whether the prose of a docs page
// is plain, which the simple-english pass reads.
