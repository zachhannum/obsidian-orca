// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { codeThemes } from './src/code-theme.mjs';

// The docs name orca's buttons from the plugin's own table, so a button
// renamed in the plugin is renamed on the site. The table is read at
// build time only; none of it reaches the browser.
const plugin = fileURLToPath(new URL('../src', import.meta.url));

// GitHub Pages serves the site at its own domain, which public/CNAME holds.
const site = 'https://orca.typeworks.dev';

// A pull request's preview is a folder of the Pages site, so its job sets
// the folder as the base. The deploy on main leaves it unset.
const base = process.env.SITE_BASE || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  vite: { resolve: { alias: { '@': plugin } } },
  markdown: {
    shikiConfig: {
      themes: codeThemes,
      defaultColor: false,
    },
  },
  integrations: [
    starlight({
      title: 'orca',
      description: 'A book designer that runs inside Obsidian.',
      // Expressive Code draws a frame and a copy button the artboards do not.
      expressiveCode: false,
      favicon: '/favicon.svg',
      customCss: [
        './src/styles/fonts.css',
        './src/styles/tokens.css',
        './src/styles/theme.css',
      ],
      components: {
        // Dark is the default, and the toggle is one button rather than a
        // select. Everything else is Starlight's own.
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        SocialIcons: './src/components/SocialIcons.astro',
        PageTitle: './src/components/PageTitle.astro',
      },
      sidebar: [
        {
          label: 'Start here',
          items: ['start/install', 'start/anatomy', 'start/make-a-book', 'start/roles', 'start/the-preview'],
        },
        {
          label: 'Design',
          items: [
            'design/overview',
            'design/page',
            'design/text',
            'design/headings',
            'design/fonts',
            'design/chapter-openings',
            'design/scene-breaks',
            'design/headers-and-page-numbers',
            'design/page-breaks',
            'design/custom-css',
            'design/inspect',
          ],
        },
        { label: 'Export', items: ['export/export-to-pdf'] },
        {
          label: 'Reference',
          items: ['reference/design-keys', 'reference/the-book-note', 'reference/markdown'],
        },
      ],
    }),
  ],
});
