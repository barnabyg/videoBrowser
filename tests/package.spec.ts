import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { extract } from "@electron-internal/extract-zip";
import { createPlayer } from "./player";

test("extracted zip uses its bundled runtime and tools for thumbnails and Windows launch", async () => {
  const root = await mkdtemp(path.resolve(".verify/package-"));
  await extract(path.resolve("dist/VideoBrowser-win32-x64.zip"), { dir: root });
  const folder = path.join(root, "source videos");
  await mkdir(folder);
  const log = path.join(root, "launch.json");
  const player = createPlayer(log);
  const filename = `packaged café${player.extension}`;
  const source = path.join(folder, filename);
  const packageRoot = path.join(root, "VideoBrowser-win32-x64");
  try {
    execFileSync(path.join(packageRoot, "resources/tools/ffmpeg.exe"), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=10",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-f",
      "mp4",
      source,
    ]);
    const before = await readFile(source);
    const app = await electron.launch({
      executablePath: path.join(packageRoot, "VideoBrowser.exe"),
      env: {
        ...process.env,
        PATH: process.env.SystemRoot + "\\System32",
        VIDEO_BROWSER_STATE: path.join(root, "state"),
      },
    });
    try {
      expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
      await app.evaluate(({ app }, extension) => {
        process
          .getBuiltinModule("module")
          .createRequire(`${app.getAppPath()}/package.json`)(
            `${app.getAppPath()}/build/main.js`,
          )
          .addFixtureExtension(extension);
      }, player.extension);
      const page = await app.firstWindow();
      await page.getByLabel("Folder path").fill(folder);
      await page
        .getByRole("button", { name: "Open folder", exact: true })
        .click();
      await expect(
        page.getByRole("img", { name: `Thumbnail for ${filename}` }),
      ).toBeVisible({ timeout: 30_000 });
      await page
        .getByRole("button", { name: `Open ${filename}`, exact: true })
        .click();
      await expect
        .poll(async () => {
          try {
            return JSON.parse(await readFile(log, "utf8")).source;
          } catch {
            return undefined;
          }
        })
        .toBe(source);
      expect(app.process().exitCode).toBeNull();
      expect(await readFile(source)).toEqual(before);
      expect(await readdir(folder)).toEqual([filename]);
      await page.screenshot({ path: path.join(root, "packaged.png") });
    } finally {
      await app.close();
    }
  } finally {
    player.remove();
  }
});
