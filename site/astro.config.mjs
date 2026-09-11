// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// GitHub Pages serves the site at its own domain, which public/CNAME holds.
const site = 'https://orca.typeworks.dev';

// The artboards set code in two colors: the key in glacier, the rest in the
// reading color. Shiki takes a TextMate theme, so this is the whole of it.
/** @type {(name: 'dark' | 'light', key: string, text: string) => any} */
const codeTheme = (name, key, text) => ({
  name,
  type: name,
  colors: {},
  settings: [
    { settings: { foreground: text } },
    {
      scope: ['entity.name.tag', 'support.type.property-name', 'variable.other.key'],
      settings: { foreground: key },
    },
  ],
});

export default defineConfig({
  site,
  trailingSlash: 'always',
  markdown: {
    shikiConfig: {
      themes: {
        dark: codeTheme('dark', '#86cfe0', '#e9ece8'),
        light: codeTheme('light', '#1d6b7d', '#0a0c0f'),
      },
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
          items: ['start/install', 'start/make-a-book', 'start/write-with-the-preview'],
        },
        {
          label: 'Design',
          items: [
            'design/page',
            'design/text',
            'design/headings',
            'design/chapter-openings',
            'design/scene-breaks',
            'design/heads-and-folios',
          ],
        },
        { label: 'Export', items: ['export/export-a-pdf'] },
        { label: 'Reference', items: ['reference/design-keys', 'reference/the-book-note'] },
      ],
    }),
  ],
});
