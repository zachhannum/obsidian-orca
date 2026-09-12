import { defineConfig, type ReporterDescription } from "@playwright/test";

const ci = process.env["CI"] !== undefined;

/**
 * One Obsidian for the whole run, so the specs are serial on a single
 * worker. The timeouts here bound a hang rather than pace an assertion.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/harness/launch.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  timeout: 120_000,
  expect: {
    timeout: 30_000,
    toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.01 },
  },
  // The pictures the docs site ships are the shots project's own
  // snapshots, so they are written where the site reads them rather
  // than beside the spec.
  projects: [
    {
      name: "orca",
      testIgnore: "**/shots.spec.ts",
      // A project of its own would otherwise put its name in the path,
      // and the snapshots beside the specs were taken without one.
      snapshotPathTemplate:
        "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{platform}{ext}",
    },
    {
      name: "shots",
      testMatch: "**/shots.spec.ts",
      snapshotPathTemplate: "site/src/shots/{arg}{ext}",
      // Setting the sample book costs a second, so a wait here that
      // runs past a few is a spec waiting on something that is never
      // coming. The bound is short enough to say so while a person is
      // still watching.
      timeout: 30_000,
      expect: { timeout: 10_000 },
    },
  ],
  reporter: [
    ci ? ["github"] : ["list"],
    ["html", { open: "never" }],
    ["./e2e/harness/report.ts"],
  ] satisfies ReporterDescription[],
});
