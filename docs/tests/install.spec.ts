import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

/** Orca's page in Obsidian's community directory. */
const DIRECTORY = 'https://community.obsidian.md/plugins/orca';

/** The repository of BRAT, the plugin that installs a plugin from its repository. */
const BRAT = 'https://github.com/TfTHacker/obsidian42-brat';

/** The path through Obsidian's settings to the community directory. */
const PATH = ['Settings', 'Community plugins', 'Browse'];

/** The selector of what follows a heading of the install page, which Starlight wraps. */
const under = (id: string, what: string): string => `.sl-heading-wrapper:has(#${id}) ~ ${what}`;

test('the install page installs orca from the community directory', async ({ page }) => {
  await page.goto('/start/install/');
  const steps = page.locator(under('install-orca', 'ol')).first();
  for (const name of PATH) await expect(steps.locator('code', { hasText: name }).first()).toBeVisible();
  await expect(steps.locator('code', { hasText: /^Install$/ })).toBeVisible();
});

test('another version of orca installs with BRAT', async ({ page }) => {
  await page.goto('/start/install/');
  const said = page.locator(under('install-another-version', 'p'));
  await expect(said.getByRole('link', { name: 'BRAT' })).toHaveAttribute('href', BRAT);
  await expect(said.locator('code', { hasText: 'zachhannum/obsidian-orca' })).toBeVisible();
});

test("the landing page's install buttons open orca's page in the community directory", async ({ page }) => {
  await page.goto('/');
  const buttons = page.getByRole('link', { name: 'Install in Obsidian' });
  await expect(buttons).toHaveCount(2);
  for (const button of await buttons.all()) await expect(button).toHaveAttribute('href', DIRECTORY);
});

test('the README installs orca the way the install page does', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  expect(readme).toContain(PATH.map((name) => `\`${name}\``).join(', '));
  expect(readme).not.toContain('not in the list of community plugins');
});

// What this file does not cover: the directory itself, so a page that
// Obsidian moves is not found here. It does not cover Obsidian's own
// labels, which the steps name and no test reads from the application.
