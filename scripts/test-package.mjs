import { spawnSync } from "node:child_process";
const env = { ...process.env, VIDEO_BROWSER_PACKAGE_TEST: "1" };
delete env.NO_COLOR;
process.exitCode =
  spawnSync(
    "cmd.exe",
    ["/d", "/s", "/c", "playwright test tests/package.spec.ts"],
    { env, stdio: "inherit" },
  ).status ?? 1;
