import { defineConfig } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

delete process.env.NO_COLOR;
process.env.electron_config_cache = path.resolve(".cache/electron");
mkdirSync(path.resolve(".verify"), { recursive: true });

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
