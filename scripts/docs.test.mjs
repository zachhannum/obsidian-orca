import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { root } from "./bundle.mjs";

const read = (file) => readFile(path.join(root, file), "utf8");

/** The sample vault's book note, which the landing page sets its pages from. */
const SAMPLE_BOOK = "site/sample/Twenty Thousand Leagues Under the Sea.md";

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
  assert.ok(sample.has("images/the-scotia-in-dry-dock.jpg"));
});

test("each chapter is a note of its own, under one heading that is its title", async () => {
  const note = await read(SAMPLE_BOOK);
  const body = entries(note, "Body");
  const chapters = body.filter((entry) => entry.role === undefined);

  assert.equal(chapters.length, 46);
  assert.deepEqual(
    body.filter((entry) => entry.role !== undefined).map((entry) => entry.link),
    ["Part One", "Part Two"],
  );
  for (const { link } of chapters) {
    const chapter = await read(`site/sample/${link}.md`);
    const headings = [...chapter.matchAll(/^#+ (.+)$/gm)].map((found) => found[1]);
    assert.deepEqual(headings.length, 1, `${link} has ${headings.length} headings`);
    // A title with a question mark or a quotation mark in it keeps them
    // in the heading, because a note's name cannot hold them.
    assert.equal(headings[0].replace(/[?\u201c\u201d]/g, ""), link);
  }
});

test("Chapter I opens on an engraving the copyright page credits", async () => {
  const chapter = await read("site/sample/A Shifting Reef.md");
  const embed = /^!\[\[(.+)\]\]\n\n# A Shifting Reef\n/.exec(chapter);
  assert.ok(embed, "the note does not open on an embed above its heading");
  await readFile(path.join(root, "site/sample/images", embed[1]));

  const copyright = await read("site/sample/Copyright.md");
  assert.match(copyright, /\u00c9douard Riou/);
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

// What this tier does not cover: whether a docs page matches the SiteDocs
// artboards, which only a render in a browser shows, and whether the
// sample's chapter opening matches the SiteLanding artboard, which the
// pages themselves answer.
