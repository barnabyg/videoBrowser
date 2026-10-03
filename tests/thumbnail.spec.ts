import { test, expect, type ElectronApplication } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expectLaunched,
  launchApp,
  makeVideo,
  openFolder,
  snapshot,
  useStalledProbe,
  videoCard,
} from "./app";
import { createPlayer } from "./player";

const ffmpeg = path.resolve(".tools/ffmpeg/bin/ffmpeg.exe");

function generate(args: string[]): void {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args]);
}

// Counts native modal dialogs the main process tries to show from now on.
async function countDialogs(app: ElectronApplication) {
  await app.evaluate(({ dialog }) => {
    const counter = globalThis as { dialogs?: number };
    counter.dialogs = 0;
    const count = () => {
      counter.dialogs = (counter.dialogs ?? 0) + 1;
    };
    Object.assign(dialog, {
      showErrorBox: count,
      showMessageBox: count,
      showMessageBoxSync: count,
    });
  });
  return () =>
    app.evaluate(() => (globalThis as { dialogs?: number }).dialogs ?? 0);
}

// Process ids of stalled probes started so far, in start order.
async function readPids(log: string): Promise<number[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map(Number);
}

async function readPid(log: string): Promise<number> {
  let pid = 0;
  await expect
    .poll(async () => {
      pid = (await readPids(log))[0] ?? 0;
      return pid;
    })
    .toBeGreaterThan(0);
  return pid;
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("generated media establishes thumbnail fit, long seeking, dark-frame fallback and unknown duration", async () => {
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
    generate([
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
  generate([
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
  generate([
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
  const before = await snapshot(folder);
  const { app, page } = await launchApp(root);
  try {
    await page.getByLabel("Folder path").fill(folder);
    const start = performance.now();
    await page
      .getByRole("button", { name: "Open folder", exact: true })
      .click();
    const evidence = [];
    // Only entries near the viewport hold an image.
    for (const fixture of fixtures) {
      await videoCard(page, fixture.name).scrollIntoViewIfNeeded();
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
    await videoCard(page, "black-start.mp4").scrollIntoViewIfNeeded();
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
    await videoCard(page, "unknown.h264").scrollIntoViewIfNeeded();
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
    ).toHaveText("2:00:00");
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
  // Reading thumbnails leaves source bytes, modification times and the folder unchanged.
  expect(await snapshot(folder)).toEqual(before);
});

test("unsupported, damaged and unreadable source videos get placeholders with distinct explanations and no dialogs", async () => {
  const root = await mkdtemp(path.resolve(".verify/thumbnail-failures-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  makeVideo(path.join(folder, "playable.mp4"), 2);
  generate([
    "-f",
    "lavfi",
    "-i",
    "sine=duration=2",
    "-c:a",
    "aac",
    path.join(folder, "audio only.mp4"),
  ]);
  await writeFile(
    path.join(folder, "unrecognised.mp4"),
    Buffer.from(Array.from({ length: 20_000 }, (_, i) => (i * 37) % 251)),
  );
  // Zeroing the media data keeps the container readable but no frame decodable.
  makeVideo(path.join(folder, "damaged.mp4"), 2);
  const damaged = await readFile(path.join(folder, "damaged.mp4"));
  const mdat = damaged.indexOf("mdat");
  damaged.fill(0, mdat + 4, mdat - 4 + damaged.readUInt32BE(mdat - 4));
  await writeFile(path.join(folder, "damaged.mp4"), damaged);
  const locked = path.join(folder, "locked.mp4");
  makeVideo(locked, 2);
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  execFileSync("icacls.exe", [locked, "/deny", `${user}:(RD)`]);
  try {
    const { app, page } = await launchApp(root);
    try {
      const dialogs = await countDialogs(app);
      await openFolder(page, folder);
      await expect(
        videoCard(page, "playable.mp4").locator(".frame"),
      ).toHaveText("Loading thumbnail…");
      await expect(
        page.getByRole("img", { name: "Thumbnail for playable.mp4" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        videoCard(page, "playable.mp4").locator(".detail"),
      ).toHaveText("0:02");
      const explanations: [string, RegExp][] = [
        ["audio only.mp4", /no video picture/],
        ["unrecognised.mp4", /not recognised as a supported video/],
        ["damaged.mp4", /could not decode a picture/],
        ["locked.mp4", /cannot be read/],
      ];
      for (const [name, explanation] of explanations) {
        // Only entries near the viewport show results; a small screen may
        // leave some below it.
        await videoCard(page, name).scrollIntoViewIfNeeded();
        await expect(videoCard(page, name).locator(".frame")).toHaveText(
          new RegExp(`^Thumbnail unavailable: .*${explanation.source}`),
          { timeout: 30_000 },
        );
        await expect(videoCard(page, name).getByRole("img")).toHaveCount(0);
        await expect(videoCard(page, name).locator(".detail")).toContainText(
          "You can still open it",
        );
        await expect(videoCard(page, name)).toBeEnabled();
      }
      // A reliably known duration is still shown when no picture can be decoded.
      await expect(
        videoCard(page, "damaged.mp4").locator(".detail"),
      ).toHaveText(/^0:02 /);
      await expect(
        videoCard(page, "unrecognised.mp4").locator(".detail"),
      ).toHaveText(/^Thumbnail unavailable/);
      expect(await dialogs()).toBe(0);
    } finally {
      await app.close();
    }
  } finally {
    execFileSync("icacls.exe", [locked, "/remove:d", user]);
  }
});

test("a stalled extraction stops at the 30-second budget, releases its process and later source videos continue", async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.resolve(".verify/thumbnail-timeout-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const log = path.join(root, "launch.json");
  const pidLog = path.join(root, "probe.pid");
  const player = createPlayer(log);
  try {
    // The stalled source holds one of the bounded extraction slots for its budget.
    const stalled = `a stalled${player.extension}`;
    const later = `b later${player.extension}`;
    makeVideo(path.join(folder, stalled), 2);
    makeVideo(path.join(folder, later), 2);
    const { app, page } = await launchApp(root, [player.extension]);
    try {
      const dialogs = await countDialogs(app);
      await useStalledProbe(app, pidLog);
      await openFolder(page, folder);
      const pid = await readPid(pidLog);
      const started = performance.now();
      await expect(videoCard(page, stalled).locator(".frame")).toHaveText(
        "Loading thumbnail…",
      );
      await expect(videoCard(page, stalled).locator(".frame")).toHaveText(
        /^Thumbnail unavailable: .*longer than 30 seconds/,
        { timeout: 45_000 },
      );
      const elapsed = performance.now() - started;
      expect(elapsed).toBeGreaterThan(25_000);
      expect(elapsed).toBeLessThan(35_000);
      await expect.poll(() => running(pid)).toBe(false);
      await expect(
        page.getByRole("img", { name: `Thumbnail for ${later}` }),
      ).toBeVisible({ timeout: 30_000 });
      await videoCard(page, stalled).click();
      await expectLaunched(log, path.join(folder, stalled));
      expect(await dialogs()).toBe(0);
    } finally {
      await app.close();
    }
  } finally {
    player.remove();
  }
});

test("changing the selected folder stops the previous extraction and its results never reach the new grid", async () => {
  const root = await mkdtemp(path.resolve(".verify/thumbnail-cancel-"));
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  await mkdir(first);
  await mkdir(second);
  const pidLog = path.join(root, "probe.pid");
  makeVideo(path.join(first, "stalled.mp4"));
  makeVideo(path.join(second, "clip.mp4"));
  const { app, page } = await launchApp(root);
  try {
    await useStalledProbe(app, pidLog);
    await openFolder(page, first);
    const pid = await readPid(pidLog);
    await openFolder(page, second);
    // Cancellation is prompt, well inside the 30-second budget.
    await expect.poll(() => running(pid), { timeout: 5_000 }).toBe(false);
    await expect(
      page.getByRole("img", { name: "Thumbnail for clip.mp4" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("stalled.mp4")).toHaveCount(0);
    await expect(page.getByText(/Thumbnail unavailable/)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("extraction runs a bounded number of jobs at once and closing the app stops them", async () => {
  const root = await mkdtemp(path.resolve(".verify/thumbnail-bounded-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const pidLog = path.join(root, "probe.pid");
  for (const name of ["stalled 1.mp4", "stalled 2.mp4", "stalled 3.mp4"])
    makeVideo(path.join(folder, name));
  const { app, page } = await launchApp(root);
  let pids: number[] = [];
  try {
    await useStalledProbe(app, pidLog);
    await openFolder(page, folder);
    await expect.poll(() => readPids(pidLog)).toHaveLength(2);
    // The third job waits for a free slot rather than starting alongside them.
    await page.waitForTimeout(3_000);
    pids = await readPids(pidLog);
    expect(pids).toHaveLength(2);
    expect(pids.every(running)).toBe(true);
  } finally {
    await app.close();
  }
  await expect.poll(() => pids.some(running), { timeout: 5_000 }).toBe(false);
});
