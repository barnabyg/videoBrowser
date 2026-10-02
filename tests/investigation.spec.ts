import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";

const ffmpeg = path.resolve(".tools/ffmpeg/bin/ffmpeg.exe");
test("generated media establishes preview fit, long seeking, dark-frame fallback and unknown duration", async () => {
  const root = await mkdtemp(path.resolve(".verify/media-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const fixtures = [
    {
      name: "landscape.mp4",
      size: "320x180",
      seconds: "2",
      codec: "libx264",
      width: 640,
      height: 360,
    },
    {
      name: "portrait.mp4",
      size: "180x320",
      seconds: "2",
      codec: "libx264",
      width: 360,
      height: 640,
    },
    {
      name: "low.mp4",
      size: "64x36",
      seconds: "2",
      codec: "libx264",
      width: 640,
      height: 360,
    },
    {
      name: "4k.mp4",
      size: "3840x2160",
      seconds: "1",
      codec: "libx264",
      width: 640,
      height: 360,
    },
    {
      name: "short.mp4",
      size: "160x90",
      seconds: "0.2",
      codec: "libx264",
      width: 640,
      height: 360,
    },
    {
      name: "long.avi",
      size: "64x36",
      seconds: "7200",
      codec: "mpeg4",
      width: 640,
      height: 360,
    },
    {
      name: "vp9.webm",
      size: "160x90",
      seconds: "2",
      codec: "libvpx-vp9",
      width: 640,
      height: 360,
    },
    {
      name: "hevc.mkv",
      size: "160x90",
      seconds: "2",
      codec: "libx265",
      width: 640,
      height: 360,
    },
  ];
  for (const fixture of fixtures) {
    const extra =
      fixture.codec === "libx265" ? ["-x265-params", "log-level=error"] : [];
    execFileSync(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${fixture.size}:rate=${fixture.name === "short.mp4" ? 10 : 1}`,
      "-t",
      fixture.seconds,
      "-c:v",
      fixture.codec,
      ...extra,
      "-threads",
      "2",
      path.join(folder, fixture.name),
    ]);
  }
  execFileSync(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:size=160x90:rate=1",
    "-t",
    "10",
    "-vf",
    "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='gte(t,3)'",
    "-c:v",
    "libx264",
    path.join(folder, "black-start.mp4"),
  ]);
  execFileSync(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    path.join(folder, "landscape.mp4"),
    "-c:v",
    "copy",
    "-bsf:v",
    "h264_mp4toannexb",
    "-f",
    "h264",
    path.join(folder, "unknown.h264"),
  ]);
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
    const evidence = [];
    for (const fixture of fixtures) {
      const image = page.getByRole("img", {
        name: `Thumbnail for ${fixture.name}`,
      });
      await expect(image).toBeVisible({ timeout: 30_000 });
      expect(
        await image.evaluate((image: HTMLImageElement) => ({
          width: image.naturalWidth,
          height: image.naturalHeight,
        })),
      ).toEqual({ width: fixture.width, height: fixture.height });
      expect(
        await image.evaluate((image) => getComputedStyle(image).objectFit),
      ).toBe("contain");
      evidence.push({
        ...fixture,
        observedAtMs: Math.round(performance.now() - start),
      });
    }
    const black = page.getByRole("img", {
      name: "Thumbnail for black-start.mp4",
    });
    await expect(black).toBeVisible();
    expect(
      await black.evaluate((image: HTMLImageElement) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.drawImage(image, 0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[0];
      }),
    ).toBeGreaterThan(200);
    await expect(
      page.getByRole("img", { name: "Thumbnail for unknown.h264" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Open unknown.h264", exact: true })
        .locator(".detail"),
    ).toHaveText("");
    await expect(
      page
        .getByRole("button", { name: "Open long.avi", exact: true })
        .locator(".detail"),
    ).toHaveText("120:00");
    await writeFile(
      path.join(root, "evidence.json"),
      JSON.stringify(
        {
          fixtures: evidence,
          blackFallback: "white frame",
          unavailableDuration: "image without duration",
        },
        null,
        2,
      ),
    );
    console.log(`MEDIA_EVIDENCE=${path.join(root, "evidence.json")}`);
    await page.screenshot({
      path: path.join(root, "media.png"),
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});

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
