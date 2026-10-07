// A link in the docs that starts with a slash names a page of the site.
// Astro puts the base on the links it builds and leaves these as written,
// so a build under a base prefixes them here.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = (process.env.SITE_BASE ?? '').replace(/\/+$/, '');
if (base === '') process.exit(0);

const dist = new URL('../dist', import.meta.url).pathname;
const link = /(\shref=")\/(?!\/)([^"]*")/g;

for (const entry of await readdir(dist, { recursive: true })) {
  if (!entry.endsWith('.html')) continue;
  const file = join(dist, entry);
  const html = await readFile(file, 'utf8');
  const moved = html.replace(link, (hit, head, tail) =>
    `/${tail}`.startsWith(`${base}/`) ? hit : `${head}${base}/${tail}`,
  );
  if (moved !== html) await writeFile(file, moved);
}
