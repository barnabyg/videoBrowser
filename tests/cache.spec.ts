// Disk thumbnail reuse and Refresh, through the real app and its cache storage.
import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  callMain,
  launchApp,
  makeVideo,
  openFolder,
  snapshot,
  useCountingProbe,
  videoCard,
} from "./app";

// Sources probed so far, one line per extraction.
async function probed(log: string): Promise<string[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text.split("\n").filter(Boolean);
}

async function expectThumbnails(page: Page, names: string[]) {
  for (const name of names)
    await expect(
      page.getByRole("img", { name: `Thumbnail for ${name}` }),
    ).toBeVisible({ timeout: 30_000 });
}

test("revisiting a folder, also after restarting, reuses stored thumbnails without extracting again", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-revisit-"));
  const folder = path.join(root, "sources");
  const other = path.join(root, "other");
  await mkdir(folder);
  await mkdir(other);
  const names = ["a.mp4", "b.mp4", "c.mp4"];
  for (const name of names) makeVideo(path.join(folder, name));
  const before = await snapshot(folder);
  const log = path.join(root, "probed.log");
  let { app, page } = await launchApp(root);
  try {
    await useCountingProbe(app, log);
    await openFolder(page, folder);
    await expectThumbnails(page, names);
    expect((await probed(log)).sort()).toEqual(
      names.map((name) => path.join(folder, name)),
    );
    await openFolder(page, other);
    await expect(page.getByRole("status")).toHaveText(/empty/);
    await openFolder(page, folder);
    await expectThumbnails(page, names);
  } finally {
    await app.close();
  }
  // Without saved preferences the app does not reopen the folder by itself,
  // so the counting probe is in place before the folder is selected again.
  await rm(path.join(root, "state", "preferences.json"));
  ({ app, page } = await launchApp(root));
  try {
    await useCountingProbe(app, log);
    await openFolder(page, folder);
    await expectThumbnails(page, names);
    await expect(
      page.getByRole("button", { name: "Open b.mp4" }).locator(".detail"),
    ).toHaveText("0:01");
  } finally {
    await app.close();
  }
  expect(await probed(log)).toHaveLength(names.length);
  // Generated data lives in the app's own state, not beside the source videos.
  expect(
    (await readdir(path.join(root, "state", "thumbnails"))).length,
  ).toBeGreaterThanOrEqual(names.length);
  expect(await snapshot(folder)).toEqual(before);
});

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

// Filenames in grid order.
function shown(page: Page) {
  return page
    .getByRole("list", { name: "Source videos" })
    .getByRole("button")
    .evaluateAll((cards) =>
      cards.map((card) =>
        (card.getAttribute("aria-label") ?? "").replace(/^Open /, ""),
      ),
    );
}

test("Refresh updates the grid for added, removed and changed source videos and extracts only those", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-refresh-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const names = [
    "changed.mp4",
    "kept.mp4",
    "removed.mp4",
    "renamed.mp4",
    "resized.mp4",
    "touched.mp4",
  ];
  for (const name of names) makeVideo(path.join(folder, name));
  const log = path.join(root, "probed.log");
  const { app, page } = await launchApp(root);
  try {
    const dialogs = await countDialogs(app);
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await expect(refresh).toBeDisabled();
    await useCountingProbe(app, log);
    await openFolder(page, folder);
    await expectThumbnails(page, names);
    // Marks the kept entry's image, to show Refresh leaves it in place.
    await page
      .getByRole("img", { name: "Thumbnail for kept.mp4" })
      .evaluate((image) => image.setAttribute("data-marked", ""));
    const extracted = (await probed(log)).length;

    makeVideo(path.join(folder, "added.mp4"));
    await rm(path.join(folder, "removed.mp4"));
    // A different size: two seconds instead of one.
    await rm(path.join(folder, "changed.mp4"));
    makeVideo(path.join(folder, "changed.mp4"), 2);
    // A different size with the same modification time.
    const resized = path.join(folder, "resized.mp4");
    const { mtime } = await stat(resized);
    await rm(resized);
    makeVideo(resized, 2);
    await utimes(resized, mtime, mtime);
    const later = new Date(Date.now() + 60_000);
    await utimes(path.join(folder, "touched.mp4"), later, later);
    await rename(
      path.join(folder, "renamed.mp4"),
      path.join(folder, "renamed again.mp4"),
    );
    const before = await snapshot(folder);

    await refresh.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(
      "Refreshed. 6 source videos: 2 added, 2 removed, 3 changed.",
    );
    await expect
      .poll(() => shown(page))
      .toEqual([
        "added.mp4",
        "changed.mp4",
        "kept.mp4",
        "renamed again.mp4",
        "resized.mp4",
        "touched.mp4",
      ]);
    await expectThumbnails(page, [
      "added.mp4",
      "changed.mp4",
      "kept.mp4",
      "renamed again.mp4",
      "resized.mp4",
      "touched.mp4",
    ]);
    await expect(videoCard(page, "changed.mp4").locator(".detail")).toHaveText(
      "0:02",
    );
    await expect(
      page.getByRole("img", { name: "Thumbnail for kept.mp4" }),
    ).toHaveAttribute("data-marked", "");
    expect((await probed(log)).slice(extracted).sort()).toEqual(
      [
        "added.mp4",
        "changed.mp4",
        "renamed again.mp4",
        "resized.mp4",
        "touched.mp4",
      ].map((name) => path.join(folder, name)),
    );
    expect(await dialogs()).toBe(0);
    expect(await snapshot(folder)).toEqual(before);
  } finally {
    await app.close();
  }
});

test("thumbnails from another generation recipe or a damaged cache record are never reused", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-recipe-"));
  const folder = path.join(root, "sources");
  const other = path.join(root, "other");
  await mkdir(folder);
  await mkdir(other);
  const names = ["a.mp4", "b.mp4"];
  for (const name of names) makeVideo(path.join(folder, name));
  const log = path.join(root, "probed.log");
  let { app, page } = await launchApp(root);
  try {
    await openFolder(page, folder);
    await expectThumbnails(page, names);
  } finally {
    await app.close();
  }
  await rm(path.join(root, "state", "preferences.json"));
  ({ app, page } = await launchApp(root));
  try {
    // A release that generates thumbnails differently.
    await callMain(app, "useFixtureRecipe", ["a later recipe"]);
    await useCountingProbe(app, log);
    await openFolder(page, folder);
    await expectThumbnails(page, names);
    expect(await probed(log)).toHaveLength(2);
    // Every stored record is damaged, e.g. by an older or interrupted release.
    const cache = path.join(root, "state", "thumbnails");
    for (const file of await readdir(cache))
      if (file.endsWith(".json"))
        await writeFile(path.join(cache, file), "{ damaged");
    await openFolder(page, other);
    await expect(page.getByRole("status")).toHaveText(/empty/);
    await openFolder(page, folder);
    await expectThumbnails(page, names);
    expect(await probed(log)).toHaveLength(4);
  } finally {
    await app.close();
  }
});

test("a source video changed during its extraction never shows the obsolete thumbnail, and Refresh replaces it", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-changed-"));
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
    await rm(source);
    makeVideo(source, 2);
    await rm(`${log}.hold`);
    await expect(videoCard(page, "held.mp4").locator(".frame")).toHaveText(
      /^Thumbnail unavailable: this video changed while its thumbnail was being made/,
      { timeout: 30_000 },
    );
    await expect(videoCard(page, "held.mp4").getByRole("img")).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Refreshed. 1 source video: 1 changed.",
    );
    await expectThumbnails(page, ["held.mp4"]);
    await expect(videoCard(page, "held.mp4").locator(".detail")).toHaveText(
      "0:02",
    );
  } finally {
    await app.close();
  }
});

test("Refresh during extraction, and a folder change during Refresh, attach no earlier result to current entries", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-race-"));
  const folder = path.join(root, "sources");
  const other = path.join(root, "other");
  await mkdir(folder);
  await mkdir(other);
  const source = path.join(folder, "held.mp4");
  makeVideo(source);
  makeVideo(path.join(other, "elsewhere.mp4"));
  const log = path.join(root, "probed.log");
  await writeFile(`${log}.hold`, "");
  const { app, page } = await launchApp(root);
  try {
    const dialogs = await countDialogs(app);
    await useCountingProbe(app, log);
    await openFolder(page, folder);
    await expect.poll(() => probed(log)).toEqual([source]);
    // The source changes while its first job is held, and Refresh replaces the entry.
    await rm(source);
    makeVideo(source, 2);
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await refresh.click();
    await expect(page.getByRole("status")).toHaveText(
      "Refreshed. 1 source video: 1 changed.",
    );
    await expect.poll(() => probed(log)).toEqual([source, source]);
    await rm(`${log}.hold`);
    await expectThumbnails(page, ["held.mp4"]);
    await expect(videoCard(page, "held.mp4").locator(".detail")).toHaveText(
      "0:02",
    );
    await expect(page.getByText(/changed while/)).toHaveCount(0);

    // Selecting another folder straight after Refresh shows only that folder.
    await refresh.click();
    await openFolder(page, other);
    await expectThumbnails(page, ["elsewhere.mp4"]);
    await expect.poll(() => shown(page)).toEqual(["elsewhere.mp4"]);
    await expect(page.getByRole("status")).toHaveText(/^1 source video\./);
    expect(await dialogs()).toBe(0);
  } finally {
    await app.close();
  }
});

test("Refresh explains a folder that is no longer available and recovers once it returns", async () => {
  const root = await mkdtemp(path.resolve(".verify/cache-missing-"));
  const folder = path.join(root, "sources");
  const away = path.join(root, "away");
  await mkdir(folder);
  makeVideo(path.join(folder, "clip.mp4"));
  const { app, page } = await launchApp(root);
  try {
    const dialogs = await countDialogs(app);
    const refresh = page.getByRole("button", { name: "Refresh", exact: true });
    await openFolder(page, folder);
    await expectThumbnails(page, ["clip.mp4"]);
    // As when its USB drive is disconnected.
    await rename(folder, away);
    await refresh.click();
    await expect(page.getByRole("status")).toHaveText(
      /^Refreshed\. This folder cannot be found/,
    );
    await expect.poll(() => shown(page)).toEqual([]);
    await expect(refresh).toBeEnabled();
    await rename(away, folder);
    await refresh.click();
    await expect(page.getByRole("status")).toHaveText(
      "Refreshed. 1 source video: 1 added.",
    );
    await expectThumbnails(page, ["clip.mp4"]);
    expect(await dialogs()).toBe(0);
  } finally {
    await app.close();
  }
});
