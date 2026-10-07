/**
 * The rules the Obsidian plugin review applies, held over the site as
 * over the plugin.
 */

import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["**/node_modules/", "dist/", ".astro/", "sample/"],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The build's own scripts run in Node and never reach a reader.
    files: ["*.mjs", "scripts/*.mjs", "playwright.config.ts", "tests/*.ts"],
    languageOptions: { globals: { process: "readonly", Buffer: "readonly" } },
    rules: { "obsidianmd/no-nodejs-modules": "off" },
  },
  {
    // Playwright reads a test's fixtures from the pattern of its first
    // argument, so a test that takes none still writes the pattern.
    files: ["tests/*.ts"],
    rules: { "no-empty-pattern": "off" },
  },
  {
    // The player runs in a reader's browser, which has none of the
    // element helpers Obsidian adds.
    files: ["src/reel/*.ts"],
    rules: { "obsidianmd/prefer-create-el": "off" },
  },
]);
