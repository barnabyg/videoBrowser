import { _electron as electron, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Starts the real desktop app with isolated state. Fixture extensions are added
// to the app's recognised set so disposable Windows associations can be used.
export async function launchApp(root: string, extensions: string[] = []) {
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, VIDEO_BROWSER_STATE: path.join(root, "state") },
  });
  for (const extension of extensions)
    await app.evaluate(({ app }, extension) => {
      process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/package.json`)(
          `${app.getAppPath()}/build/main.js`,
        )
        .addFixtureExtension(extension);
    }, extension);
  return { app, page: await app.firstWindow() };
}

export async function openFolder(page: Page, folder: string): Promise<void> {
  await page.getByLabel("Folder path").fill(folder);
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
}

export function makeVideo(target: string, seconds = 1): void {
  execFileSync(path.resolve(".tools/ffmpeg/bin/ffmpeg.exe"), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=10",
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
