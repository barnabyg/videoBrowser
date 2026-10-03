// Bounded thumbnail storage and Clear cache, through the real app and its
// cache storage. A smaller test limit makes eviction observable.
import { test, expect, type Page } from "@playwright/test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  callMain,
  expectLaunched,
  expectThumbnails,
  launchApp,
  makeVideo,
  openFolder,
  probed,
  snapshot,
  useCountingProbe,
  videoCard,
} from "./app";
import { createPlayer } from "./player";

function storage(root: string) {
  return path.join(root, "state", "thumbnails");
}

// The source videos whose thumbnails are stored, by their records.
async function cachedSources(root: string): Promise<string[]> {
  const sources = [];
  for (const file of await readdir(storage(root)).catch(() => []))
    if (file.endsWith(".json")) {
      const record = JSON.parse(
        await readFile(path.join(storage(root), file), "utf8"),
      ) as { source: string };
      sources.push(record.source);
    }
  return sources.sort();
}

async function storedBytes(root: string): Promise<number> {
  let total = 0;
  for (const file of await readdir(storage(root)).catch(() => []))
    total += (await stat(path.join(storage(root), file))).size;
  return total;
}

// Folders of the same length, each holding a copy of one clip, so every
// stored thumbnail takes the same space.
async function folders(root: string, names: string[], clip: string) {
  const sample = path.join(root, "sample.mp4");
  makeVideo(sample);
  for (const name of names) {
    await mkdir(path.join(root, name));
    await copyFile(sample, path.join(root, name, clip));
  }
  return names.map((name) => path.join(root, name, clip));
}

function clearButton(page: Page) {
  return page.getByRole("button", { name: "Clear cache", exact: true });
}

// Whether each named entry's shown still has loaded, rather than failed.
async function loaded(page: Page, names: string[]): Promise<boolean[]> {
  const results = [];
  for (const name of names)
    results.push(
      await page
        .getByRole("img", { name: `Thumbnail for ${name}` })
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
    );
  return results;
}

test("stored thumbnails stay within the limit by evicting the least recently used, and revisits keep theirs", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-evict-"));
  const [one, two, three, four] = await folders(
    root,
    ["f1", "f2", "f3", "f4"],
    "clip.mp4",
  );
  const log = path.join(root, "probed.log");
  const { app, page } = await launchApp(root);
  try {
    await useCountingProbe(app, log);
    await openFolder(page, path.dirname(one ?? ""));
    await expectThumbnails(page, ["clip.mp4"]);
    // Room for two thumbnails, not three.
    const limit = Math.floor((await storedBytes(root)) * 2.5);
    await callMain(app, "useFixtureCacheLimit", [limit]);
    for (const source of [two, three]) {
      await openFolder(page, path.dirname(source ?? ""));
      await expectThumbnails(page, ["clip.mp4"]);
    }
    expect(await cachedSources(root)).toEqual([two, three]);
    // Revisiting the second folder reuses its thumbnail and makes it the most
    // recently used, so the third is evicted next.
    await openFolder(page, path.dirname(two ?? ""));
    await expectThumbnails(page, ["clip.mp4"]);
    await openFolder(page, path.dirname(four ?? ""));
    await expectThumbnails(page, ["clip.mp4"]);
    expect(await cachedSources(root)).toEqual([two, four]);
    expect(await probed(log)).toEqual([one, two, three, four]);
    expect(await storedBytes(root)).toBeLessThanOrEqual(limit);
    // An evicted thumbnail is made again on the next visit.
    await openFolder(page, path.dirname(one ?? ""));
    await expectThumbnails(page, ["clip.mp4"]);
    expect(await probed(log)).toEqual([one, two, three, four, one]);
    expect(await cachedSources(root)).toEqual([one, four]);
  } finally {
    await app.close();
  }
});

test("eviction leaves the shown folder's thumbnails and playback working, then trims storage once another folder is shown", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-shown-"));
  const log = path.join(root, "launched.json");
  const player = createPlayer(log);
  try {
    const names = ["a", "b", "c"].map((name) => `${name}${player.extension}`);
    const [single] = await folders(root, ["single"], "clip.mp4");
    const many = path.join(root, "many");
    await mkdir(many);
    for (const name of names)
      await copyFile(single ?? "", path.join(many, name));
    const before = await snapshot(many);
    const { app, page } = await launchApp(root, [player.extension]);
    try {
      await openFolder(page, path.dirname(single ?? ""));
      await expectThumbnails(page, ["clip.mp4"]);
      // Room for one and a half thumbnails.
      const limit = Math.floor((await storedBytes(root)) * 1.5);
      await callMain(app, "useFixtureCacheLimit", [limit]);
      await openFolder(page, many);
      await expectThumbnails(page, names);
      expect(await cachedSources(root)).toEqual(
        names.map((name) => path.join(many, name)),
      );
      await expect.poll(() => loaded(page, names)).toEqual([true, true, true]);
      await videoCard(page, names[1] ?? "").click();
      await expectLaunched(log, path.join(many, names[1] ?? ""));
      // Showing a folder that stores nothing still trims storage, keeping the
      // most recently used thumbnail.
      const empty = path.join(root, "empty");
      await mkdir(empty);
      await openFolder(page, empty);
      await expect(page.getByRole("status")).toHaveText(/empty/);
      await expect.poll(() => storedBytes(root)).toBeLessThanOrEqual(limit);
      expect(await cachedSources(root)).toHaveLength(1);
      expect(await snapshot(many)).toEqual(before);
    } finally {
      await app.close();
    }
  } finally {
    player.remove();
  }
});

test("Clear cache removes stored thumbnails and regenerates them, keeping preferences and source videos", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-clear-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const names = ["a.mp4", "held.mp4"];
  for (const name of names) makeVideo(path.join(folder, name));
  const before = await snapshot(folder);
  const log = path.join(root, "probed.log");
  const preferences = path.join(root, "state", "preferences.json");
  let saved: string | undefined;
  let { app, page } = await launchApp(root);
  try {
    await useCountingProbe(app, log);
    await openFolder(page, folder);
    await expectThumbnails(page, names);
    await page.getByRole("slider", { name: "Thumbnail size" }).fill("480");
    await page
      .getByRole("combobox", { name: "Sort by" })
      .selectOption("modified");
    await page
      .getByRole("combobox", { name: "Order" })
      .selectOption("descending");
    await expect
      .poll(async () => JSON.parse(await readFile(preferences, "utf8")))
      .toEqual({
        folder,
        size: 480,
        sort: { field: "modified", direction: "descending" },
      });
    saved = await readFile(preferences, "utf8");
    expect(await cachedSources(root)).toHaveLength(2);

    // The held source's new extraction waits, so storage can be inspected
    // before it is made again.
    await writeFile(`${log}.hold`, "");
    await clearButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(
      "Cleared cached thumbnails. Thumbnails are being made again.",
    );
    await expect(clearButton(page)).toBeFocused();
    await expect
      .poll(async () => (await probed(log)).sort())
      .toEqual(
        [...names, ...names].map((name) => path.join(folder, name)).sort(),
      );
    await expect(videoCard(page, "held.mp4").locator(".frame")).toHaveText(
      "Loading thumbnail…",
    );
    await expectThumbnails(page, ["a.mp4"]);
    expect(await cachedSources(root)).toEqual([path.join(folder, "a.mp4")]);
    await rm(`${log}.hold`);
    await expectThumbnails(page, names);
    expect(await cachedSources(root)).toEqual(
      names.map((name) => path.join(folder, name)),
    );
    expect(await readFile(preferences, "utf8")).toBe(saved);
  } finally {
    await app.close();
  }
  expect(await readFile(preferences, "utf8")).toBe(saved);
  // The next launch restores the folder, size and sort order.
  ({ app, page } = await launchApp(root));
  try {
    await expect(page.getByText(folder, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("slider", { name: "Thumbnail size" }),
    ).toHaveValue("480");
    await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue(
      "modified",
    );
    await expect(page.getByRole("combobox", { name: "Order" })).toHaveValue(
      "descending",
    );
    await expectThumbnails(page, names);
  } finally {
    await app.close();
  }
  expect(await snapshot(folder)).toEqual(before);
});

test("clearing during an extraction leaves only the regenerated thumbnail", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-clear-held-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const source = path.join(folder, "held.mp4");
  makeVideo(source);
  const log = path.join(root, "probed.log");
  await writeFile(`${log}.hold`, "");
  const { app, page } = await launchApp(root);
  try {
    await useCountingProbe(app, log);
    await openFolder(page, folder);
    await expect.poll(() => probed(log)).toEqual([source]);
    await clearButton(page).click();
    await expect(page.getByRole("status")).toHaveText(
      "Cleared cached thumbnails. Thumbnails are being made again.",
    );
    await expect.poll(() => probed(log)).toEqual([source, source]);
    await rm(`${log}.hold`);
    await expectThumbnails(page, ["held.mp4"]);
    expect(await cachedSources(root)).toEqual([source]);
    // One still and its record, and no temporary files.
    expect(await readdir(storage(root))).toHaveLength(2);
  } finally {
    await app.close();
  }
});

// Makes `file` exactly `size` bytes with a trailing MP4 free box, which
// players and ffprobe skip.
async function padTo(file: string, size: number) {
  const data = await readFile(file);
  const box = Buffer.alloc(size - data.length);
  if (box.length < 8) throw new Error("Not enough room for a free box");
  box.writeUInt32BE(box.length, 0);
  box.write("free", 4, "latin1");
  await writeFile(file, Buffer.concat([data, box]));
}

test("a replacement keeping path, size and modification time reuses the old thumbnail until Clear cache", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-replaced-"));
  const folder = path.join(root, "sources");
  const other = path.join(root, "other");
  await mkdir(folder);
  await mkdir(other);
  const source = path.join(folder, "clip.mp4");
  makeVideo(source, 2);
  // A whole millisecond, so the replacement can be given exactly this time.
  const modified = new Date(Date.UTC(2026, 0, 1));
  await utimes(source, modified, modified);
  const log = path.join(root, "probed.log");
  const { app, page } = await launchApp(root);
  try {
    await useCountingProbe(app, log);
    await openFolder(page, folder);
    await expectThumbnails(page, ["clip.mp4"]);
    await expect(videoCard(page, "clip.mp4").locator(".detail")).toHaveText(
      "0:02",
    );
    // Different contents, one second long, with the same identity.
    const { size } = await stat(source);
    await rm(source);
    makeVideo(source, 1);
    await padTo(source, size);
    await utimes(source, modified, modified);
    await openFolder(page, other);
    await expect(page.getByRole("status")).toHaveText(/empty/);
    await openFolder(page, folder);
    await expectThumbnails(page, ["clip.mp4"]);
    await expect(videoCard(page, "clip.mp4").locator(".detail")).toHaveText(
      "0:02",
    );
    expect(await probed(log)).toEqual([source]);
    await clearButton(page).click();
    await expect(videoCard(page, "clip.mp4").locator(".detail")).toHaveText(
      "0:01",
      { timeout: 30_000 },
    );
    await expectThumbnails(page, ["clip.mp4"]);
    expect(await probed(log)).toEqual([source, source]);
  } finally {
    await app.close();
  }
});
