import { defineConfig } from "@playwright/test";
import path from "node:path";

delete process.env.NO_COLOR;
process.env.electron_config_cache = path.resolve(".cache/electron");

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  testIgnore: process.env.VIDEO_BROWSER_PACKAGE_TEST
    ? []
    : ["**/package.spec.ts"],
  timeout: 60_000,
  workers: 1,
  reporter: [["list"], ["./tests/dashboard-reporter.mjs"]],
  use: { trace: "retain-on-failure" },
});
