import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, cp, glob, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import esbuild from "esbuild";
import { Session, decodeDisplayList, initWasm } from "fleuron";
import { root } from "./bundle.mjs";

const read = (file) => readFile(path.join(root, file), "utf8");

/** The folder the sample book keeps its notes in, inside the sample vault. */
const SAMPLE_DIR = "docs/sample/Twenty Thousand Leagues";

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

const [rootPackage, sitePackage, siteLock, tokens, theme, fonts, config, cname, workflow, preview, shots, claude] =
  await Promise.all([
    read("package.json"),
    read("docs/package.json"),
    read("docs/package-lock.json"),
    read("docs/src/styles/tokens.css"),
    read("docs/src/styles/theme.css"),
    read("docs/src/styles/fonts.css"),
    read("docs/astro.config.mjs"),
    read("docs/public/CNAME"),
    read(".github/workflows/docs.yml"),
    read(".github/workflows/preview.yml"),
    read(".github/workflows/shots.yml"),
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
  assert.equal(dark["--bg"], "#000000");
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
    await read("docs/src/components/ThemeBoot.astro"),
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
  // A page at the domain root takes no base path, and a preview sets one.
  assert.match(config, /const base = process\.env\.SITE_BASE \|\| '\/';/);
});

test("a PR that touches the site builds it, and main goes to GitHub Pages", () => {
  assert.match(workflow, /^on:\n {2}pull_request:\n {4}paths:\n {6}- "docs\/\*\*"/m);
  assert.match(workflow, /working-directory: docs\n/);
  assert.match(workflow, /- run: npm run build\n/);
  assert.match(workflow, /JamesIves\/github-pages-deploy-action@/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
});

test("the Pages branch is served as written, so Astro's underscore folder loads", async () => {
  await access(path.join(root, "docs/public/.nojekyll"));
});

test("a deploy on main keeps the open previews, and checks the live docs", () => {
  assert.match(workflow, /branch: gh-pages\n\s+folder: docs\/dist\n\s+clean-exclude: pr-preview\/\n/);
  assert.match(workflow, /name: check the live docs\n/);
  assert.match(workflow, /group: pages-branch\n\s+cancel-in-progress: false\n/);
});

test("the docs build checks the tokens against design/site.spec.css", () => {
  assert.match(sitePackage, /"build": "node scripts\/check-tokens\.mjs && /);
});

test("a PR that touches the site or the design gets a preview in a folder of the Pages branch", () => {
  const from = preview.indexOf("  pull_request:");
  const paths = preview.slice(from, preview.indexOf("\nconcurrency:"));
  assert.match(paths, /types: \[opened, reopened, synchronize, closed\]/);
  assert.match(paths, /- "docs\/\*\*"/);
  assert.match(paths, /- "design\/\*\*"/);
  assert.match(preview, /rossjrw\/pr-preview-action@v1/);
  assert.match(preview, /preview-branch: gh-pages\n\s+umbrella-dir: pr-preview\n/);
  // One comment, found again by its header, holds the link.
  assert.match(preview, /sticky-pull-request-comment@v2\n\s+with:\n\s+header: preview\n/);
  assert.match(preview, /SITE_BASE: \/pr-preview\/pr-\$\{\{ github\.event\.pull_request\.number \}\}/);
});

test("a preview builds the docs, the artboards or both, and never the pictures of a failed run", () => {
  assert.match(preview, /node build\.mjs --into \.\.\/docs\/dist\/design --against /);
  assert.match(preview, /gh run download "\$run" --name shots --dir "\$RUNNER_TEMP\/shots"/);
  assert.match(preview, /cp -r "\$RUNNER_TEMP\/shots\/\." docs\/src\/shots\//);
  assert.match(preview, /conclusion -q \.conclusion\)" = success/);
  assert.match(preview, /stale\) echo; echo "The pictures were not taken again/);
  assert.doesNotMatch(preview, /git (add|commit)/);
});

test("the artboards sit on a canvas that marks the ones a branch changed", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "design-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  await cp(path.join(root, "design"), path.join(repo, "design"), {
    recursive: true,
    filter: (from) => !from.endsWith(".dc.html"),
  });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  git("checkout", "-qb", "branch");
  const part = path.join(repo, "design/parts/Navigator.html");
  await writeFile(part, `${await readFile(part, "utf8")}\n<!-- changed -->\n`);
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "change");

  const out = path.join(repo, "out");
  execFileSync("node", ["build.mjs", "--into", out, "--against", "main"], {
    cwd: path.join(repo, "design"),
  });
  const index = await readFile(path.join(out, "index.html"), "utf8");
  const sizes = JSON.parse(await read("design/sizes.json"));
  for (const name of Object.keys(sizes)) await access(path.join(out, `${name}.html`));
  const marked = /const CHANGED = (\[.*\]);/.exec(index);
  assert.ok(marked, "no list of changed artboards");
  assert.deepEqual(JSON.parse(marked[1]), ["Navigator"]);
  // Every artboard the canvas places has a page to open.
  const canvas = JSON.parse(await read("design/canvas.json"));
  for (const board of canvas.artboards) {
    await access(path.join(out, board.file.replace(".dc.html", ".html")));
  }
  await rm(repo, { recursive: true });
});

test("the preview waits on the shots workflow for the paths that start it", () => {
  const paths = (text) => [...text.matchAll(/^\s+- "([^"]+)"$/gm)].map((m) => m[1]);
  const shotsOn = shots.slice(shots.indexOf("  pull_request:"), shots.indexOf("  push:"));
  const surface = /grep -qE '(\^\(src[^']*)' <<<"\$changed" && surface=true/.exec(preview);
  assert.ok(surface, "no surface test");
  const regex = new RegExp(surface[1]);
  for (const glob of paths(shotsOn)) {
    const file = glob.replace("**", "x");
    assert.ok(regex.test(file), `${glob} does not start the wait`);
  }
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
    vaultFiles("docs/sample"),
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
  await readFile(path.join(root, "docs/sample/images", embed[1]));
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
  const png = await readFile(path.join(root, "docs/sample/images/nautilus.png"));
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
    for (const face of [
      "EBGaramond[wght].ttf",
      "EBGaramond-Italic[wght].ttf",
      "IMFeENrm28P.ttf",
      "IMFeENit28P.ttf",
    ]) {
      session.addFontFile(face, await readFile(path.join(root, "docs/sample/fonts", face)));
    }
    session.addImage("nautilus.png", await readFile(path.join(root, "docs/sample/images/nautilus.png")));
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
      "body-hanging-punctuation": "true",
      "chapter-begins": "next-page",
      "chapter-drop-cap": "3",
      "chapter-drop-cap-font": "IM FELL English",
      "chapter-first-line-caps": "small-caps",
      "chapter-first-line-letter-spacing": "0.04em",
      "chapter-title-from": "h1",
    },
  );
  // The chapter opens on its label, which is a level 2 heading.
  assert.equal(design["heading-2-space-above"], "7");
  assert.equal(design.trim, "5.5in 8.5in");
  assert.deepEqual(entries(await read(SAMPLE_BOOK), "Front matter"), [
    { link: undefined, role: "title-page" },
    { link: "Copyright", role: "copyright" },
    { link: undefined, role: "contents" },
  ]);
});

/** The landing page and its scripts. */
const LANDING = "docs/src/pages/index.astro";

const [landing, landingCss, plugin, playwright] = await Promise.all([
  read(LANDING),
  read("docs/src/styles/landing.css"),
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
/** The value of a sum of products of numbers, which is all a calc() here holds. */
function arithmetic(expression) {
  assert.doesNotMatch(expression, /[()]/, `a calc() with brackets: ${expression}`);
  const tokens = expression.match(/[\d.]+|[-+*/]/g);
  assert.ok(tokens, `no arithmetic in ${expression}`);
  let sum = 0;
  let sign = 1;
  let product = Number(tokens[0]);
  for (let i = 1; i < tokens.length; i += 2) {
    const [op, next] = [tokens[i], Number(tokens[i + 1])];
    if (op === "*") product *= next;
    else if (op === "/") product /= next;
    else {
      sum += sign * product;
      sign = op === "-" ? -1 : 1;
      product = next;
    }
  }
  return sum + sign * product;
}

function metric(name) {
  const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(landingStyle);
  assert.ok(found, `the page declares no --${name}`);
  const clamped = /clamp\([^,]+,[^,]+,\s*([\d.]+)px\)/.exec(found[1]);
  return Number(clamped ? clamped[1] : /([\d.]+)/.exec(found[1])[1]);
}

test("the surface moves, runs through the second line of the title, and the title inverts", async () => {
  const { seaPath, REST } = await moduleOf("docs/src/scripts/sea.ts");
  const wave = { off: 0, lag: 0, kind: "body" };
  assert.notEqual(seaPath(wave, 1440, 0), seaPath(wave, 1440, 2));

  // The band the surface moves inside, measured down the page: the rest
  // line, less the deepest the middle dips, plus the tallest swell.
  const calc = /--sea-top:\s*calc\(([\s\S]*?)\);/.exec(landingStyle)[1];
  const seaTop = arithmetic(
    calc.replace(/var\(--([\w-]+)\)/g, (whole, name) => String(metric(name))).replace(/px/g, ""),
  );
  const leading = metric("title-size") * metric("title-leading");
  const title = metric("header-h") + metric("hero-pad");
  const band = [seaTop + REST - 30 - 13, seaTop + REST + 13];
  assert.ok(band[0] > title + leading, `the surface runs above the second line at ${band[0]}`);
  assert.ok(band[1] < title + leading * 2, `the surface runs under the second line at ${band[1]}`);

  // The title is set twice from the one string, in the sky's reading ink
  // and the sea's, and the sea's copy is clipped to the water. A blend
  // mode would read the sea out of the backdrop, and a browser drops the
  // backdrop once an ancestor of the blended element is on a layer of
  // its own, which leaves the title in one flat ink.
  assert.doesNotMatch(landingStyle, /mix-blend-mode/);
  const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(landing)[1];
  assert.equal(h1.match(/set:html=\{title\}/g).length, 2);
  assert.match(h1, /class="sunk"[^>]*data-sea-cut/);
  assert.match(/\n {2}h1 \{([\s\S]*?)\n {2}\}/.exec(landingStyle)[1], /color: var\(--sky-text\)/);
  const sunk = /\n {2}h1 \.sunk \{([\s\S]*?)\n {2}\}/.exec(landingStyle)[1];
  assert.match(sunk, /color: var\(--text\)/);
  assert.match(sunk, /clip-path:/);

  // The level cut the page falls back to is the line the module rests on.
  assert.equal(metric("sea-rest"), REST);
});

test("the sea never lightens from the surface to the end of the page", () => {
  const body = /\.sea \.body \{([\s\S]*?)\}/.exec(landingStyle)[1];
  assert.match(body, /bottom: 0/);
  // The body reaches up under the lip, so no sky shows where they meet.
  assert.match(body, /top: calc\(var\(--sea-lip\) - 1px\)/);
  assert.match(
    body.replace(/\s+/g, " "),
    /linear-gradient\( to bottom, var\(--sea-0\), var\(--sea-1\) 30%, var\(--sea-2\) 70%, var\(--sea-3\) \)/,
  );

  for (const scheme of [":root", ":root[data-theme='light']"]) {
    const ramp = block(tokens, scheme);
    const deep = [0, 1, 2, 3].map((at) => luminance(ramp[`--sea-${at}`]));
    for (const [at, light] of deep.entries()) {
      if (at === 0) continue;
      // The dark sea is black from top to bottom, so a stop may match the one above it.
      assert.ok(light <= deep[at - 1], `${scheme} --sea-${at} is lighter than the one above it`);
    }
  }
});

test("with reduced motion on, the sea and the specks hold still", async () => {
  const still = "@media (prefers-reduced-motion:reduce)";
  const rules = landingCss.split(still).slice(1).join(" ");
  assert.match(rules, /\.snow\{animation:none\}/);

  const drawn = [];
  let frames = 0;
  const requestAnimationFrame = () => (frames += 1);
  const cancelAnimationFrame = () => {};
  const { startSea } = await moduleOf("docs/src/scripts/sea.ts", {
    window: {
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame,
      cancelAnimationFrame,
    },
    requestAnimationFrame,
    cancelAnimationFrame,
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

test("the working design demo is gone, and the site does not depend on fleuron", async () => {
  for (const file of [
    "docs/src/components/PanelGroup.astro",
    "docs/src/scripts/demo.ts",
    "docs/src/scripts/typeset.ts",
    "docs/src/scripts/typeset.worker.ts",
    "docs/src/styles/panel.css",
  ]) {
    const there = await access(path.join(root, file)).then(
      () => true,
      () => false,
    );
    assert.equal(there, false, `${file} is still in the site`);
  }
  const site = JSON.parse(sitePackage);
  const deps = { ...site.dependencies, ...site.devDependencies };
  assert.equal(deps.fleuron, undefined, "the site depends on fleuron");
  assert.equal(
    JSON.parse(siteLock).packages["node_modules/fleuron"],
    undefined,
    "the site's lockfile installs fleuron",
  );
  for (const file of ["docs/astro.config.mjs", "docs/tsconfig.json", LANDING]) {
    assert.doesNotMatch(await read(file), /fleuron|panel\.css|PanelGroup|data-demo/, file);
  }
});

test("the sections that show orca's own surfaces show photographs of them", async () => {
  // A hand-built copy of a surface goes stale the moment the surface
  // moves, so every one the page shows is a picture the spec took.
  // The book note, the pane that is written in and then set, and the
  // export are reels of frames.
  for (const scene of ["chapters", "write", "export"]) {
    assert.match(landing, new RegExp(`<Reel\\s+scene="${scene}"`), `the page has no ${scene} reel`);
  }
  for (const drawn of ["src tree", "src note", "x-win", "x-pane", "x-doc", "ex-dlg"]) {
    assert.doesNotMatch(landing, new RegExp(`class="${drawn}"`), `${drawn} is drawn by hand`);
  }
});

test("the pages turn on a click, on the arrow buttons and from the keyboard", async () => {
  const flip = await moduleOf("docs/src/scripts/flip.ts");

  // Five leaves stand between the first page and the last, so the book
  // reads as six spreads.
  const leaves = 5;
  // The book opens closed, on the title page alone.
  assert.deepEqual([...flip.spread(0)], [0, 1]);
  assert.equal(flip.folio(0), "Page 1");
  assert.equal(flip.folio(1), "Pages 2–3");
  assert.equal(flip.folio(leaves), "Pages 10–11");

  const turned = (at) => flip.layout(leaves, at).filter((leaf) => leaf.turned).length;
  assert.equal(turned(0), 0);
  assert.equal(turned(3), 3);
  assert.equal(turned(leaves), leaves);

  // The leaf in the air stands over the stack on both sides of it.
  const moving = [...flip.layout(leaves, 2, 1)];
  assert.ok(moving[1].z > Math.max(...moving.filter((leaf, at) => at !== 1).map((leaf) => leaf.z)));

  const source = await read("docs/src/scripts/flip.ts");
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
  assert.ok(sources.length + globbed.length > 0, "the page shows no picture");
  for (const source of [...sources, ...globbed]) {
    assert.match(source, /^\.\.\/shots\//, `${source} is not a picture the spec takes`);
  }
  // Nothing else is fetched: a picture named in the markup would be one
  // the spec never took.
  assert.doesNotMatch(landing, /<img[^>]+src="(?!\{)/);

  // The directory the page reads from is the shots project's snapshots.
  assert.match(playwright, /name: "shots"/);
  assert.match(playwright, /snapshotPathTemplate: "docs\/src\/shots\/\{arg\}\{ext\}"/);
  const taken = [];
  for await (const file of glob("docs/src/shots/**/*.png", { cwd: root })) taken.push(file);
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

test("the panel section and the CSS section each play a reel of real Obsidian", () => {
  for (const [heading, scene] of [["in the panel</i>", "design"], ["CSS styling</i>", "css"]]) {
    const from = landing.indexOf(heading);
    assert.notEqual(from, -1, `no section ${heading}`);
    const section = landing.slice(from, landing.indexOf("</section>", from));
    assert.match(section, new RegExp(`<Reel\\s+scene="${scene}"`), `the section does not play the ${scene} reel`);
    assert.match(section, /alt="[^"]{20,}"/);
    assert.doesNotMatch(section, /<(?:img|button|input|select|script)\b/, "the section draws a picture or a control of its own");
  }
  assert.doesNotMatch(landing, /panel-shots|inspect-shot|shots\/(?:panel|inspect)-/);
});

test("a section says orca runs on a phone and a tablet, and plays a reel of each", async () => {
  const from = landing.indexOf("and a tablet</i>");
  assert.notEqual(from, -1, "no section on phones and tablets");
  const section = landing.slice(from, landing.indexOf("</section>", from));
  for (const scene of ["phone", "tablet"]) {
    assert.match(section, new RegExp(`<Reel\\s+scene="${scene}"`), `the section does not play the ${scene} reel`);
  }
  assert.equal([...section.matchAll(/alt="[^"]{20,}"/g)].length, 2);
  assert.match(prose(section).join(" "), /runs in Obsidian on a phone and a tablet/);
  // The plugin's manifest is what lets Obsidian load orca on one.
  assert.equal(JSON.parse(await read("manifest.json")).isDesktopOnly, false);
  // Each is in a frame of its device.
  assert.match(section, /class="device device-tablet">\s*<Reel\s+scene="tablet"/);
  assert.match(section, /class="device device-phone">\s*<Reel\s+scene="phone"/);
  // It stands between the export and the pages that turn.
  assert.ok(landing.indexOf("for the printer</i>") < from && from < landing.indexOf("the pages</i>"));
  assert.doesNotMatch(landing, /Desktop only/i);
});

test("no width of the screen decides what a reel plays", async () => {
  const stage = await read("docs/src/reel/stage.ts");
  // Reduced motion is the one thing the player asks the screen.
  const asked = [...stage.matchAll(/matchMedia\(\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(asked, ["(prefers-reduced-motion: reduce)"]);
  // The stage is measured, and the still under it is placed by the same measure.
  assert.match(stage, /ResizeObserver/);
  const styles = `${await read("docs/src/styles/reel.css")}\n${await read("docs/src/components/Reel.astro")}`;
  assert.doesNotMatch(styles, /@media[^{]*width/);
  // A stage reads its reel when it first comes on screen, and not before.
  assert.match(stage, /near\.observe\(stage\)/);
  assert.match(stage, /void drawn\(stage\)\.then\(\(\) => startReel\(stage\)\)/);
  // Every reel on a desktop is wide enough to show its whole window.
  assert.doesNotMatch(landing, /row-reel/);
  // The page holds no second picture for a narrow screen, and no clip.
  assert.doesNotMatch(landing, /<video|<picture/);
});

test("the footer carries the tail mark in one flat colour", async () => {
  const mark = await read("docs/src/components/Mark.astro");
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

/** The docs pages' directory. */
const DOCS = "docs/src/content/docs";

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
    const rows = table(page, ["#", "Control", "Default", "Key"]);
    // The sample's fonts have one variant each, so the picture draws no
    // Variant row. Every other row is in the picture and takes a mark.
    for (const [, , , key] of rows.filter(([n]) => n === "")) {
      assert.match(unquoted(key), /-font-variant$/, `the ${group.name} page marks no ${key}`);
    }
    const numbered = rows
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
        assert.ok(await exists(`docs/src/shots/${name}-${scheme}.png`), `${file} shows ${name}-${scheme}, which the spec has not taken`);
      }
      const marks = /marks=\{\[([^\]]*)\]\}/.exec(props);
      if (marks === null) continue;
      const sidecar = `docs/src/shots/${name}.marks.json`;
      assert.ok(await exists(sidecar), `${file} marks ${name}, which has no marks`);
      const measured = JSON.parse(await read(sidecar)).marks;
      for (const [, id] of marks[1].matchAll(/'([^']+)'/g)) {
        assert.ok(id in measured, `${file} marks ${id} on ${name}, which the spec did not measure`);
      }
    }
    for (const [, n] of page.matchAll(/<Page n=\{(\d+)\}/g)) {
      const picture = `docs/src/shots/pages/page-${n.padStart(2, "0")}.png`;
      assert.ok(await exists(picture), `${file} shows ${picture}, which the spec has not taken`);
    }
  }

  // The component reads the shots directory and nothing else.
  for (const component of ["Shot"]) {
    const source = await read(`docs/src/components/${component}.astro`);
    const globbed = [...source.matchAll(/import\.meta\.glob<[^>]+>\('([^']+)'/g)].map((found) => found[1]);
    assert.ok(globbed.length > 0, `${component} reads no picture`);
    for (const pattern of globbed) assert.match(pattern, /^\.\.\/shots\//);
  }
});

test("a button a docs page names is orca's own button, drawn with orca's icon", async () => {
  const actions = await read("src/ui/actions.ts");
  const component = await read("docs/src/components/Action.astro");
  const icons = [...actions.matchAll(/icon: "([^"]+)"/g)].map((found) => found[1]);
  assert.ok(icons.length > 0, "ui/actions names no icon");
  for (const icon of icons) {
    assert.match(
      component,
      new RegExp(`lucide-static/icons/${icon}\\.svg`),
      `Action.astro draws no ${icon}`,
    );
  }

  for (const file of await docsPages()) {
    const page = await read(`${DOCS}/${file}`);
    const named = [...page.matchAll(/<Action name="([^"]+)"/g)].map((found) => found[1]);
    for (const name of named) {
      assert.match(
        actions,
        new RegExp(`\\n  ${name}: `),
        `${file} names the button ${name}, which ui/actions does not hold`,
      );
    }
    if (named.length > 0) {
      assert.match(page, /^import Action from/m, `${file} draws a button it does not import`);
    }
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
// screenshot spec takes and compares; whether the glyph the site draws
// for a button is the glyph Obsidian draws, since Obsidian ships a
// Lucide build of its own; whether a mark sits over the control it
// names, which the spec measures; the default of a font variant, which
// the faces on the machine decide; and whether the prose of a docs page
// is plain, which the simple-english pass reads.
