import { readFileSync, writeFileSync } from 'node:fs';

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
  console.log(`${name}.dc.html  ${s.w}x${s.h}`);
}
