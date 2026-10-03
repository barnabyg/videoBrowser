// Large-folder workloads through the desktop app: the 1,000-entry acceptance
// target and the 10,000-entry stress workload. Each run writes timing evidence.
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  expectLaunched,
  launchApp,
  makeVideo,
  openFolder,
  snapshot,
  videoCard,
} from "./app";
import { createPlayer } from "./player";

// Describes the volume holding `folder`, best effort.
function storage(folder: string): string {
  const letter = path.parse(path.resolve(folder)).root[0] ?? "C";
  try {
    return execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$v = Get-Volume -DriveLetter ${letter}; $d = Get-Partition -DriveLetter ${letter} | Get-Disk; ` +
          `$p = Get-PhysicalDisk | Where-Object DeviceId -eq $d.Number; ` +
          `"${letter}: $($v.DriveType) $($v.FileSystem), $($d.FriendlyName), $($p.MediaType) $($d.BusType)"`,
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return `${letter}: unknown`;
  }
}

// The card of the entry `index` places down the grid (folder order).
function card(page: Page, index: number) {
  return page.locator(".video").nth(index);
}

// Stills the app has stored so far, whether or not their entries are on screen.
async function stored(root: string): Promise<number> {
  const stills = await readdir(path.join(root, "state", "thumbnails")).catch(
    () => [],
  );
  return stills.length;
}

function since(start: number): number {
  return Math.round(performance.now() - start);
}

async function browseLargeFolder(
  count: number,
  base: string,
  label: string,
): Promise<Record<string, unknown>> {
  const root = await mkdtemp(path.join(base, `scale-${count}-`));
  const folder = path.join(root, "sources");
  const other = path.join(root, "other");
  await mkdir(folder);
  await mkdir(other);
  const log = path.join(root, "launch.json");
  const player = createPlayer(log);
  try {
    // Repeated copies of one playable clip exercise entry count, not format coverage.
    const seed = path.join(root, `seed${player.extension}`);
    makeVideo(seed, 1);
    for (let start = 0; start < count; start += 500)
      await Promise.all(
        Array.from({ length: Math.min(500, count - start) }, (_, offset) =>
          copyFile(
            seed,
            path.join(folder, `video${start + offset}${player.extension}`),
          ),
        ),
      );
    makeVideo(path.join(other, "clip.mp4"), 1);
    const before = await snapshot(folder);
    const { app, page } = await launchApp(root, [player.extension]);
    const timings: Record<string, number> = {};
    let imagesAttached = 0;
    let storedWhenAttachedCounted = 0;
    let storedWhenLastShown = 0;
    try {
      await page.getByLabel("Folder path").fill(folder);
      const start = performance.now();
      await page
        .getByRole("button", { name: "Open folder", exact: true })
        .click();
      await expect(page.locator(".video")).toHaveCount(count, {
        timeout: 30_000,
      });
      await expect(page.getByRole("status")).toContainText(
        `${count} source videos`,
      );
      timings.gridMs = since(start);
      // The grid does not wait for extraction.
      expect(await stored(root)).toBeLessThan(count);

      // Entries the user scrolls to are extracted ahead of the folder order.
      const last = card(page, count - 1);
      const scrolled = performance.now();
      await last.scrollIntoViewIfNeeded();
      await expect(last.getByRole("img")).toBeVisible({ timeout: 15_000 });
      timings.lastEntryThumbnailMs = since(scrolled);
      storedWhenLastShown = await stored(root);
      expect(storedWhenLastShown).toBeLessThan(count / 2);

      const middle = card(page, Math.floor(count / 2));
      const rescrolled = performance.now();
      await middle.scrollIntoViewIfNeeded();
      await expect(middle.getByRole("img")).toBeVisible({ timeout: 15_000 });
      timings.middleEntryThumbnailMs = since(rescrolled);

      // Keyboard focus deep in the grid brings that entry's thumbnail too.
      const focused = card(page, Math.floor(count / 4));
      await focused.focus();
      await expect(focused.getByRole("img")).toBeVisible({ timeout: 15_000 });

      // Images are held only near the viewport, however many stills exist.
      await expect
        .poll(() => stored(root), { timeout: 60_000 })
        .toBeGreaterThanOrEqual(200);
      imagesAttached = await page.locator("img").count();
      storedWhenAttachedCounted = await stored(root);
      expect(imagesAttached).toBeGreaterThan(0);
      expect(imagesAttached).toBeLessThanOrEqual(60);

      // Playback stays available while thumbnails are still loading.
      const name = (await middle.locator(".filename").textContent()) ?? "";
      const clicked = performance.now();
      await middle.click();
      await expectLaunched(log, path.join(folder, name));
      timings.launchMs = since(clicked);
      await expect(page.getByRole("status")).toHaveText(
        `Opened ${name} in your default player.`,
      );

      // Rapid folder changes leave only the last folder's entries and results.
      const changed = performance.now();
      await openFolder(page, other);
      await openFolder(page, folder);
      await openFolder(page, other);
      await expect(page.locator(".video")).toHaveCount(1);
      await expect(
        page.getByRole("img", { name: "Thumbnail for clip.mp4" }),
      ).toBeVisible({ timeout: 15_000 });
      timings.folderChangeMs = since(changed);
      await page.waitForTimeout(1_000);
      await expect(page.locator(".video")).toHaveCount(1);
      await expect(videoCard(page, "clip.mp4").locator(".detail")).toHaveText(
        "0:01",
      );

      // Returning to the large folder is as usable as the first visit.
      const reopened = performance.now();
      await openFolder(page, folder);
      await expect(page.locator(".video")).toHaveCount(count, {
        timeout: 30_000,
      });
      timings.reopenGridMs = since(reopened);
    } finally {
      await app.close();
    }
    // Browsing, extraction and launch leave source videos unchanged.
    expect(await snapshot(folder)).toEqual(before);
    const evidence = {
      label,
      count,
      measuredOn: new Date().toISOString(),
      hardware: `${os.cpus()[0]?.model ?? "unknown CPU"}, ${os.availableParallelism()} logical processors, ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM`,
      windows: `${os.version()} ${os.release()}`,
      storage: storage(folder),
      fixture: `${count} copies of one playable 1-second 320x180 H.264/MP4 clip`,
      cache: "fresh isolated application state",
      timings,
      storedWhenLastShown,
      imagesAttached,
      storedWhenAttachedCounted,
    };
    await writeFile(
      path.join(root, "evidence.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(`SCALE_EVIDENCE=${path.join(root, "evidence.json")}`);
    return evidence;
  } finally {
    player.remove();
  }
}

test("1,000 source videos on the local SSD show a usable grid within two seconds and visible entries come first", async () => {
  test.setTimeout(180_000);
  const evidence = await browseLargeFolder(
    1_000,
    path.resolve(".verify"),
    "acceptance",
  );
  const { gridMs } = evidence.timings as { gridMs: number };
  expect(gridMs).toBeLessThanOrEqual(2_000);
});

test("10,000 source videos remain browsable, launchable and replaceable", async () => {
  test.setTimeout(600_000);
  await browseLargeFolder(10_000, path.resolve(".verify"), "stress");
});
