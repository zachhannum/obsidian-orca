import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const css = readFileSync('chrome.css', 'utf8');
const sizes = JSON.parse(readFileSync('sizes.json', 'utf8'));

for (const [name, s] of Object.entries(sizes)) {
  const body = readFileSync(`parts/${name}.html`, 'utf8').trimEnd();
  const props = JSON.stringify({
    theme: { editor: 'enum', options: ['dark', 'light'], default: 'dark' },
    $preview: { width: s.w, height: s.h },
  });
  const out = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
  <style>
    body { margin: 0; }
    a { color: hsl(258, 88%, 66%); }
    a:hover { color: hsl(255, 90%, 76%); }
${css.replace(/^/gm, '    ')}
  </style>
</helmet>
<div class="orca" data-theme="{{theme}}" style="width: ${s.w}px; height: ${s.h}px; overflow: hidden;">
${body}
</div>
</x-dc>
<script data-dc-script data-props='${props}'>
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme ?? 'dark' };
  }
}
</script>
</body>
</html>
`;
  writeFileSync(`${name}.dc.html`, out);
  console.log(`${name}.dc.html  ${s.w}x${s.h}`);
}
