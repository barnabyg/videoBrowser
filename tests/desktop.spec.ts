import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createPlayer } from "./player";

test("select a folder, recognise a real thumbnail and delegate playback without changing the source", async () => {
  const root = await mkdtemp(path.resolve(".verify/desktop-"));
  const folder = path.join(root, "source videos");
  await mkdir(folder);
  const source = path.join(folder, "clip café 01.mp4");
  execFileSync(path.resolve(".tools/ffmpeg/bin/ffmpeg.exe"), [
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
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  const before = {
    hash: createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
    modified: (await stat(source)).mtimeMs,
  };
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, VIDEO_BROWSER_STATE: path.join(root, "state") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel("Folder path")).toBeVisible();
    await page.getByLabel("Folder path").fill(folder);
    await page
      .getByRole("button", { name: "Open folder", exact: true })
      .click();
    await expect(page.getByText(folder, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Thumbnail for clip café 01.mp4" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("0:02", { exact: true })).toBeVisible();
    expect(app.process().exitCode).toBeNull();
    expect(
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
    ).toBe(before.hash);
    expect((await stat(source)).mtimeMs).toBe(before.modified);
    expect(await readdir(folder)).toEqual(["clip café 01.mp4"]);
    await page.screenshot({ path: path.join(root, "desktop.png") });
  } finally {
    await app.close();
  }
});

test("single click reaches a controlled Windows default handler and leaves the browser open", async () => {
  const root = await mkdtemp(path.resolve(".verify/player-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const log = path.join(root, "launch.json");
  const player = createPlayer(log);
  const filename = `movie café 01${player.extension}`;
  const source = path.join(folder, filename);
  try {
    execFileSync(path.resolve(".tools/ffmpeg/bin/ffmpeg.exe"), [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=10",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-f",
      "mp4",
      source,
    ]);
    const app = await electron.launch({
      args: ["."],
      env: { ...process.env, VIDEO_BROWSER_STATE: path.join(root, "state") },
    });
    try {
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
      await expect(page.getByRole("status")).toContainText(
        `Opened ${filename}`,
      );
      expect(app.process().exitCode).toBeNull();
      await expect(
        page.getByRole("button", { name: `Open ${filename}`, exact: true }),
      ).toBeVisible();
    } finally {
      await app.close();
    }
  } finally {
    player.remove();
  }
});
