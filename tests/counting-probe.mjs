// Stands in for ffprobe in desktop cache tests: node counting-probe.mjs <log> <ffprobe> ...args.
// Appends each probed source as a line to <log>, then runs the real ffprobe. A
// source whose filename contains "held" waits while the file <log>.hold exists,
// so a test can act while its extraction is under way.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

const [log, ffprobe, ...args] = process.argv.slice(2);
const source = args.at(-1) ?? "";
appendFileSync(log, `${source}\n`);
const held = () =>
  path.basename(source).includes("held") && existsSync(`${log}.hold`);
const timer = setInterval(() => {
  if (held()) return;
  clearInterval(timer);
  const child = spawn(ffprobe, args, { stdio: "inherit", windowsHide: true });
  child.on("close", (code) => process.exit(code ?? 1));
}, 50);
