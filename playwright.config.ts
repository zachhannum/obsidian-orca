import { defineConfig, type ReporterDescription } from "@playwright/test";

const ci = process.env["CI"] !== undefined;

/**
 * One Obsidian for the whole run, so the specs are serial on a single
 * worker. Timeouts here bound a hang; no assertion waits on a clock.
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
  reporter: [
    ci ? ["github"] : ["list"],
    ["html", { open: "never" }],
    ["./e2e/harness/report.ts"],
  ] satisfies ReporterDescription[],
});
