import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";
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

test("each chapter is a note of its own, under one heading that is its title", async () => {
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
  for (const [link, found] of chapters) {
    assert.equal(found.length, 1, `${link} has ${found.length} headings`);
    // A title with a question mark or a quotation mark in it keeps them
    // in the heading, because a note's name cannot hold them.
    assert.equal(found[0].replace(/[?\u201c\u201d]/g, ""), link);
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

/** The landing page, its scripts, and the artboards that draw it. */
const LANDING = "site/src/pages/index.astro";

const [landing, landingCss, siteLanding, siteLandingLight, siteLandingPhone, plugin, playwright] =
  await Promise.all([
    read(LANDING),
    read("site/src/styles/landing.css"),
    read("design/parts/SiteLanding.html"),
    read("design/parts/SiteLandingLight.html"),
    read("design/parts/SiteLandingPhone.html"),
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

test("the page draws the sections its three artboards draw, in their words", () => {
  assert.deepEqual(titles(landing), titles(siteLanding));
  assert.deepEqual(prose(landing), prose(siteLanding));
  assert.equal(lede(landing), lede(siteLanding));

  // The light and the phone artboards draw the hero alone, and the page
  // opens on the same words in both.
  for (const part of [siteLandingLight, siteLandingPhone]) {
    assert.deepEqual(titles(part), titles(landing).slice(0, 1));
    assert.equal(lede(part), lede(landing));
  }
  for (const label of ["Install in Obsidian", "Read the docs", "Desktop only"]) {
    assert.ok(landing.includes(label), `the page does not offer ${label}`);
    assert.ok(siteLandingPhone.includes(label), `the phone artboard does not offer ${label}`);
  }
});

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
  assert.match(landing, /GROUPS\.map\(\(one: Group\) => one\.name\)/);
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
  assert.ok(GLYPHS.length > 0 && trims("in").length > 0);
});

test("the sections that show orca's own surfaces show photographs of them", async () => {
  // A hand-built copy of a surface goes stale the moment the surface
  // moves, so every one the page shows is a picture the spec took.
  for (const section of ["vault-shots", "sw-win"]) {
    assert.match(landing, new RegExp(`<div class="${section}">`), `the page has no ${section}`);
  }
  for (const drawn of ["src tree", "src note", "x-win", "x-pane", "x-doc"]) {
    assert.doesNotMatch(landing, new RegExp(`class="${drawn}"`), `${drawn} is drawn by hand`);
  }
  for (const shot of ["vault-tree", "vault-note", "write", "read"]) {
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

  // Each claim, with the line in `src` that would make it true. A claim
  // whose line is not there yet may not be on the page.
  const claims = [
    [/\bexport(s|ed|ing)?\b|\bPDF\b|preflight/i, /"orca:export/, "export"],
    [/your own CSS|takes over a setting/i, /overridden|overrides layer/, "an overridden control"],
  ];
  for (const [claimed, built, what] of claims) {
    if (built.test(plugin)) continue;
    assert.doesNotMatch(said, claimed, `the page claims ${what}, which orca has not built`);
  }
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
