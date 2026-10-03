// Stands in for ffprobe in desktop timeout tests: node stalled-probe.mjs <log> <ffprobe> ...args.
// A source whose filename contains "stalled" appends this process id as a line to
// <log> and never finishes; any other source passes through to the real ffprobe.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";

const [log, ffprobe, ...args] = process.argv.slice(2);
if (path.basename(args.at(-1) ?? "").includes("stalled")) {
  appendFileSync(log, `${process.pid}\n`);
  setInterval(() => undefined, 60_000);
} else {
  const child = spawn(ffprobe, args, { stdio: "inherit", windowsHide: true });
  child.on("close", (code) => process.exit(code ?? 1));
}
