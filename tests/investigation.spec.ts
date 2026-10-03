import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";

const ffmpeg = path.resolve(".tools/ffmpeg/bin/ffmpeg.exe");
test("1000 playable copies produce a grid before thumbnail completion", async () => {
  const root = await mkdtemp(path.resolve(".verify/scale-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const seed = path.join(root, "seed.mp4");
  execFileSync(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=1",
    "-t",
    "1",
    "-c:v",
    "libx264",
    seed,
  ]);
  await Promise.all(
    Array.from({ length: 1000 }, (_, index) =>
      copyFile(seed, path.join(folder, `video${index}.mp4`)),
    ),
  );
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, VIDEO_BROWSER_STATE: path.join(root, "state") },
  });
  try {
    const page = await app.firstWindow();
    await page.getByLabel("Folder path").fill(folder);
    const start = performance.now();
    await page
      .getByRole("button", { name: "Open folder", exact: true })
      .click();
    await expect(page.getByRole("button", { name: /^Open video/ })).toHaveCount(
      1000,
    );
    const elapsedMs = Math.round(performance.now() - start);
    expect(elapsedMs).toBeLessThan(10_000);
    const thumbnails = await page.getByRole("img").count();
    expect(thumbnails).toBeLessThan(1000);
    await page
      .getByRole("button", { name: "Open video999.mp4", exact: true })
      .scrollIntoViewIfNeeded();
    await page.getByLabel("Folder path").fill(root);
    await page
      .getByRole("button", { name: "Open folder", exact: true })
      .click();
    await expect(page.getByRole("button", { name: /^Open video/ })).toHaveCount(
      0,
    );
    await writeFile(
      path.join(root, "evidence.json"),
      JSON.stringify(
        {
          count: 1000,
          elapsedMs,
          thumbnailsAtGrid: thumbnails,
          cache: "fresh isolated state",
          fixture: "1000 playable H264/MP4 copies, 160x90, 1 second",
          targetMs: 2000,
          targetMet: elapsedMs <= 2000,
        },
        null,
        2,
      ),
    );
    console.log(
      `GRID_EVIDENCE=${path.join(root, "evidence.json")}; elapsed=${elapsedMs}ms`,
    );
  } finally {
    await app.close();
  }
});
