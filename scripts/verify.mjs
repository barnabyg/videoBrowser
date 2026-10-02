import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { gates, optionalDashboard, updateState } from "./dashboard.mjs";

const dashboard =
  !process.env.CI && !process.argv.includes("--no-dashboard")
    ? await optionalDashboard()
    : undefined;
if (dashboard) console.log(`TEST_DASHBOARD_URL=${dashboard.url}`);
const commands = [
  "npm.cmd run format:check",
  "npm.cmd run lint",
  "npm.cmd run typecheck",
  "npm.cmd run analyze",
  "npm.cmd run test:dashboard && npm.cmd test",
  "npm.cmd audit --audit-level=low && node scripts/check-source.mjs",
  "npm.cmd run package && npm.cmd run test:package",
];
let exitCode = 0;
for (let i = 0; i < commands.length; i++) {
  const stage = gates[i];
  console.log(`\n${stage}`);
  if (dashboard) updateState(dashboard.state, { stage });
  exitCode = await new Promise((resolve) => {
    const env = {
      ...process.env,
      TEST_DASHBOARD_EVENTS: dashboard?.events ?? "",
    };
    // Playwright sets FORCE_COLOR on its workers; avoid Node's conflicting-color diagnostic.
    delete env.NO_COLOR;
    const child = spawn("cmd.exe", ["/d", "/s", "/c", commands[i]], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        process.stdout.write(chunk);
        if (dashboard)
          updateState(dashboard.state, { output: chunk.toString() });
      });
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (exitCode) break;
}
if (dashboard) {
  updateState(dashboard.state, { status: exitCode ? "failed" : "passed" });
  await mkdir(".verify", { recursive: true });
  await writeFile(
    ".verify/verification.json",
    JSON.stringify(dashboard.state, null, 2),
  );
  console.log(
    `Verification ${dashboard.state.status}. Dashboard stays available for 15 seconds.`,
  );
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  await dashboard.close();
}
process.exitCode = exitCode;
