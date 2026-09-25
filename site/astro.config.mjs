// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { codeThemes } from './src/code-theme.mjs';

// The landing page draws the design panel from the same table the plugin
// draws it from, so the panel on the page cannot fall behind the plugin's.
// The table is read at build time only; none of it reaches the browser.
const plugin = fileURLToPath(new URL('../src', import.meta.url));

// The plugin's own source imports `fleuron` by name, and it sits outside
// this package, so it would look for the engine in the plugin's
// `node_modules` rather than in the site's. The site installs its own.
const fleuron = fileURLToPath(import.meta.resolve('fleuron'));

// GitHub Pages serves the site at its own domain, which public/CNAME holds.
const site = 'https://orca.typeworks.dev';

export default defineConfig({
  site,
  trailingSlash: 'always',
  vite: { resolve: { alias: { '@': plugin, fleuron } } },
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
        './src/styles/panel.css',
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
          items: ['start/install', 'start/anatomy', 'start/make-a-book', 'start/the-preview'],
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
            'design/heads-and-folios',
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
