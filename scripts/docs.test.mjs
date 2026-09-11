import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { root } from "./bundle.mjs";

const read = (file) => readFile(path.join(root, file), "utf8");

const [rootPackage, sitePackage, siteLock, tokens, theme, fonts, workflow, claude] =
  await Promise.all([
    read("package.json"),
    read("site/package.json"),
    read("site/package-lock.json"),
    read("site/src/styles/tokens.css"),
    read("site/src/styles/theme.css"),
    read("site/src/styles/fonts.css"),
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

// What this tier does not cover: whether a docs page matches the SiteDocs
// artboards, which only a render in a browser shows.
