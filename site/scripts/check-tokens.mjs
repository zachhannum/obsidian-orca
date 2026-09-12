// The artboards and the site draw from the same values, so a change to one
// without the other stops the build.
import { readFileSync } from 'node:fs';

const block = (css, selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} in the stylesheet`);
  const end = css.indexOf('\n}', start);
  return css
    .slice(start, end)
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
};

/** Every top-level rule of a stylesheet, each as its whole text. */
function rules(css) {
  const found = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    if (open < 0) break;
    let depth = 1;
    let end = open + 1;
    while (depth > 0 && end < css.length) {
      if (css[end] === '{') depth += 1;
      if (css[end] === '}') depth -= 1;
      end += 1;
    }
    const whole = css.slice(at, end).trim();
    // A comment before a rule belongs to the file that carries it.
    found.push(whole.replace(/^\/\*[\s\S]*?\*\/\s*/, ''));
    at = end;
  }
  return found;
}

const here = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const design = here('../../design/site.css');
const site = here('../src/styles/tokens.css');

const pairs = [
  ['.site-dark', ':root'],
  ['.site-light', ":root[data-theme='light']"],
];

for (const [from, to] of pairs) {
  if (block(design, from) !== block(site, to)) {
    console.error(
      `design/site.css ${from} and site/src/styles/tokens.css ${to} hold different values.`
    );
    process.exit(1);
  }
}

// The stylesheets that copy their component classes out of the artboards.
const COPIES = ['../src/styles/panel.css', '../src/styles/landing.css'];

const drawn = rules(design);
for (const file of COPIES) {
  for (const rule of rules(here(file))) {
    const at = drawn.indexOf(rule);
    if (at < 0) {
      console.error(
        `site/src/styles/${file.split('/').pop()} holds a rule design/site.css does not:\n${rule.slice(0, 120)}`
      );
      process.exit(1);
    }
    drawn.splice(at, 1);
  }
}
