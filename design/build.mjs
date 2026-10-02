import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sizes = JSON.parse(readFileSync('sizes.json', 'utf8'));
const sheets = {};
const sheet = (file) => (sheets[file] ??= readFileSync(file, 'utf8'));

// The Google Fonts families each stylesheet's parts are set in.
const FONTS = {
  'chrome.css': ['EB+Garamond:ital,wght@0,400;0,500;1,400'],
  'site.css': [
    'Archivo:wdth,wght@62..125,100..900',
    'Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700',
    'Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900',
    'DM+Mono:wght@400;500',
    'EB+Garamond:ital,wght@0,400;0,500;1,400',
  ],
};

const THEME = `class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme ?? 'dark' };
  }
}`;

// `--into <dir>` builds a folder a browser opens: one page per artboard and
// an index that marks the ones changed against `--against <ref>`.
const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};
const into = flag('--into');
const against = flag('--against');

const changedFiles = () => {
  if (!against) return new Set();
  const out = execFileSync('git', ['diff', '--name-only', `${against}...HEAD`, '--', '.'], {
    encoding: 'utf8',
  });
  return new Set(out.split('\n').filter(Boolean).map((f) => f.replace(/^design\//, '')));
};

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const standalone = (name, s) => {
  const css = s.sheet ?? 'chrome.css';
  const site = css !== 'chrome.css';
  const fonts = FONTS[css].map((f) => `family=${f}`).join('&');
  const body = readFileSync(`parts/${name}.html`, 'utf8').trimEnd();
  const script = s.script ? `<script>\n${readFileSync(`parts/${s.script}`, 'utf8')}\n</script>` : '';
  // A plugin part draws dark unless the index link says light.
  const frame = site ? '' : ' class="orca" data-theme="dark"';
  const theme = site
    ? ''
    : `<script>document.querySelector('.orca').dataset.theme = new URLSearchParams(location.search).get('theme') ?? 'dark';</script>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
  <style>
    body { margin: 0; }
    a { color: hsl(258, 88%, 66%); }
${sheet(css).replace(/^/gm, '    ')}
  </style>
</head>
<body>
<div${frame} style="width: ${s.w}px; height: ${s.h}px; overflow: hidden;">
${body}
</div>
${theme}
${script}
</body>
</html>
`;
};

const buildInto = (dir) => {
  mkdirSync(dir, { recursive: true });
  const changed = changedFiles();
  const rows = Object.entries(sizes).map(([name, s]) => {
    writeFileSync(`${dir}/${name}.html`, standalone(name, s));
    const touched = [`parts/${name}.html`, s.script && `parts/${s.script}`, s.sheet ?? 'chrome.css'];
    const mark = touched.some((f) => f && changed.has(f));
    const theme = (s.sheet ?? 'chrome.css') === 'chrome.css' ? ` · <a href="${name}.html?theme=light">light</a>` : '';
    return { mark, html: `<li${mark ? ' class="changed"' : ''}><a href="${name}.html">${escape(name)}</a>${theme}${mark ? ' <b>changed</b>' : ''}</li>` };
  });
  const list = [...rows.filter((r) => r.mark), ...rows.filter((r) => !r.mark)];
  const note = against ? `Changed against ${escape(against)}.` : 'No base to compare with, so none is marked.';
  writeFileSync(`${dir}/index.html`, `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>orca design</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
    ul { padding-left: 1.2rem; }
    b { font-size: 0.75em; text-transform: uppercase; color: #b45309; }
    .changed { font-weight: 600; }
  </style>
</head>
<body>
<h1>The v1 design</h1>
<p>${note}</p>
<ul>
${list.map((r) => r.html).join('\n')}
</ul>
</body>
</html>
`);
  process.stdout.write(`${rows.length} artboards in ${dir}\n`);
};

if (into) {
  buildInto(into);
  process.exit(0);
}

for (const [name, s] of Object.entries(sizes)) {
  const css = s.sheet ?? 'chrome.css';
  const body = readFileSync(`parts/${name}.html`, 'utf8').trimEnd();
  const fonts = FONTS[css].map((f) => `family=${f}`).join('&');
  const preview = { width: s.w, height: s.h };
  // A plugin part takes the theme tweak. A site part sets its scheme in its
  // own markup, and can bring a script and tweaks of its own.
  const site = css !== 'chrome.css';
  const props = JSON.stringify(site
    ? { ...s.props, $preview: preview }
    : { theme: { editor: 'enum', options: ['dark', 'light'], default: 'dark' }, $preview: preview });
  const logic = s.script
    ? readFileSync(`parts/${s.script}`, 'utf8').trimEnd()
    : site ? 'class Component extends DCLogic {}' : THEME;
  const frame = site ? '' : ' class="orca" data-theme="{{theme}}"';
  const out = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts}&display=swap">
  <style>
    body { margin: 0; }
    a { color: hsl(258, 88%, 66%); }
    a:hover { color: hsl(255, 90%, 76%); }
${sheet(css).replace(/^/gm, '    ')}
  </style>
</helmet>
<div${frame} style="width: ${s.w}px; height: ${s.h}px; overflow: hidden;">
${body}
</div>
</x-dc>
<script data-dc-script data-props='${props}'>
${logic}
</script>
</body>
</html>
`;
  writeFileSync(`${name}.dc.html`, out);
  process.stdout.write(`${name}.dc.html  ${s.w}x${s.h}\n`);
}
