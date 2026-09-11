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

const design = readFileSync(new URL('../../design/site.css', import.meta.url), 'utf8');
const site = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

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
