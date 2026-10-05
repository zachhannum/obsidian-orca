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
    // The build's own scripts and the browser suite run in Node and
    // never reach a reader.
    files: ["*.mjs", "scripts/*.mjs", "playwright.config.ts", "tests/*.ts"],
    languageOptions: { globals: { process: "readonly" } },
    rules: { "obsidianmd/no-nodejs-modules": "off" },
  },
]);
