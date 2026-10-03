import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// Runs `name` from the app's own main module, the exported test boundary.
export async function callMain(
  app: ElectronApplication,
  name: string,
  args: unknown[],
): Promise<void> {
  await app.evaluate(
    ({ app }, [name, args]) => {
      const main = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/package.json`)(
        `${app.getAppPath()}/build/main.js`,
      ) as Record<string, (...args: unknown[]) => void>;
      main[name]?.(...args);
    },
    [name, args] as const,
  );
}

// Starts the real desktop app with isolated state. Fixture extensions are added
// to the app's recognised set so disposable Windows associations can be used.
export async function launchApp(root: string, extensions: string[] = []) {
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, VIDEO_BROWSER_STATE: path.join(root, "state") },
  });
  for (const extension of extensions)
    await callMain(app, "addFixtureExtension", [extension]);
  return { app, page: await app.firstWindow() };
}

// Replaces ffprobe with tests/stalled-probe.mjs, which never finishes for
// sources whose filename contains "stalled" and appends its process id to `log`.
export async function useStalledProbe(
  app: ElectronApplication,
  log: string,
): Promise<void> {
  await callMain(app, "useFixtureProbe", [
    process.execPath,
    [
      path.resolve("tests/stalled-probe.mjs"),
      log,
      path.resolve(".tools/ffmpeg/bin/ffprobe.exe"),
    ],
  ]);
}

// Replaces ffprobe with tests/counting-probe.mjs, which appends each probed
// source to `log` before running the real ffprobe. Every extraction probes once.
export async function useCountingProbe(
  app: ElectronApplication,
  log: string,
): Promise<void> {
  await callMain(app, "useFixtureProbe", [
    process.execPath,
    [
      path.resolve("tests/counting-probe.mjs"),
      log,
      path.resolve(".tools/ffmpeg/bin/ffprobe.exe"),
    ],
  ]);
}

export async function openFolder(page: Page, folder: string): Promise<void> {
  await page.getByLabel("Folder path").fill(folder);
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
}

// The playback button for a listed source video.
export function videoCard(page: Page, filename: string) {
  return page.getByRole("button", { name: `Open ${filename}`, exact: true });
}

export function makeVideo(target: string, seconds = 1, size = "320x180"): void {
  execFileSync(path.resolve(".tools/ffmpeg/bin/ffmpeg.exe"), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${size}:rate=10`,
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-f",
    "mp4",
    target,
  ]);
}

// Records each file's bytes and modification time, to show sources are unchanged.
export async function snapshot(folder: string) {
  const files = (await readdir(folder)).sort();
  // One file at a time, so large folders do not exhaust file handles.
  const result = [];
  for (const file of files) {
    const source = path.join(folder, file);
    const info = await stat(source);
    result.push({
      file,
      modified: info.isFile() ? info.mtimeMs : 0,
      hash: info.isFile()
        ? createHash("sha256")
            .update(await readFile(source))
            .digest("hex")
        : "folder",
    });
  }
  return result;
}

// Waits until the controlled default handler records the expected source path.
export async function expectLaunched(log: string, source: string) {
  await expect
    .poll(async () => {
      try {
        return (JSON.parse(await readFile(log, "utf8")) as { source: string })
          .source;
      } catch {
        return undefined;
      }
    })
    .toBe(source);
}
