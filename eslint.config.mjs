/**
 * The rules the Obsidian plugin review applies. `site/` is its own
 * package, so its own config applies the same rules there.
 */

import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
  {
    ignores: [
      "**/node_modules/",
      "main.js",
      "build/",
      "test-results/",
      "playwright-report/",
      "site/",
      "fixture/",
      // The loop's page runs in a browser on its own, never in Obsidian,
      // and the frames it plays are written by the film spec.
      "loop/js/",
      "loop/assets/",
      ".*",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "*.mjs",
            "*.ts",
            "scripts/*.mjs",
            "loop/*.mjs",
            "design/*.mjs",
            "design/parts/*.js",
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 32,
        },
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { brands: ["Orca"] }],
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    languageOptions: {
      parserOptions: { projectService: false, project: "./tsconfig.review.json" },
    },
  },
  {
    // These run in Node and never reach the bundle, so Node is there.
    files: [
      "*.mjs",
      "*.ts",
      "scripts/**",
      "loop/**",
      "design/**",
      "e2e/**",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/assets/directory.ts",
    ],
    languageOptions: { globals: globals.node },
    rules: { "obsidianmd/no-nodejs-modules": "off" },
  },
  {
    // node:test hands back a promise the runner already waits on.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs"],
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "describe", "it"] },
          ],
        },
      ],
      // A test's strings are the book's text, not orca's.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
]);
