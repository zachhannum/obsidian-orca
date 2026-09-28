/**
 * The rules the Obsidian plugin review applies. `site/` is its own
 * package, so its own config applies the same rules there.
 */

import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "**/node_modules/",
      "main.js",
      "build/",
      "test-results/",
      "playwright-report/",
      "site/",
      "video/",
      "fixture/",
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
