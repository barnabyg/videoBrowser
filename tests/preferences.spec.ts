import { test, expect, type Page } from "@playwright/test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  utimes,
  writeFile,
} from "node:fs/promises";
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

function controls(page: Page) {
  return {
    size: page.getByRole("slider", { name: "Thumbnail size" }),
    field: page.getByRole("combobox", { name: "Sort by" }),
    direction: page.getByRole("combobox", { name: "Order" }),
  };
}

// Writes placeholder sources modified at the given minutes past a fixed time.
async function sources(folder: string, files: Record<string, number>) {
  await mkdir(folder, { recursive: true });
  for (const [file, minutes] of Object.entries(files)) {
    const source = path.join(folder, file);
    await access(source).catch(() => writeFile(source, "x"));
    const time = new Date(Date.UTC(2026, 0, 1, 12, minutes));
    await utimes(source, time, time);
  }
}

test("a fresh profile offers folder selection and starts with 320 pixels and filename ascending", async () => {
  const root = await mkdtemp(path.resolve(".verify/preferences-fresh-"));
  const folder = path.join(root, "sources");
  await sources(folder, { "video10.mp4": 1, "video2.mp4": 2, "video1.mp4": 3 });
  const { app, page } = await launchApp(root);
  try {
    const { size, field, direction } = controls(page);
    await expect(page.getByRole("status")).toHaveText(
      "Select a folder to begin.",
    );
    await expect(page.getByLabel("Folder path")).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Choose folder…" }),
    ).toBeEnabled();
    await expect(size).toHaveValue("320");
    await expect(field).toHaveValue("name");
    await expect(direction).toHaveValue("ascending");
    await expect(direction.locator("option:checked")).toHaveText("A to Z");
    await openFolder(page, folder);
    await expect
      .poll(() => shown(page))
      .toEqual(["video1.mp4", "video2.mp4", "video10.mp4"]);
  } finally {
    await app.close();
  }
});

test("every sort combination orders entries from the keyboard, with equivalent keys in a fixed order", async () => {
  const root = await mkdtemp(path.resolve(".verify/preferences-sort-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  makeVideo(path.join(folder, "video2.mp4"), 2);
  // Natural comparison treats video1/video01 and cafe/café as equal; three
  // entries share one modification time.
  await sources(folder, {
    "video10.mp4": 5,
    "video2.mp4": 3,
    "video1.mp4": 3,
    "video01.mp4": 9,
    "cafe.mp4": 3,
    "café.mp4": 1,
  });
  const before = await snapshot(folder);
  const { app, page } = await launchApp(root);
  try {
    await openFolder(page, folder);
    const image = page.getByRole("img", { name: "Thumbnail for video2.mp4" });
    // Only entries near the viewport show results; a small screen may hold
    // few entries.
    await videoCard(page, "video2.mp4").scrollIntoViewIfNeeded();
    await expect(image).toBeVisible({ timeout: 30_000 });
    const byName = [
      "cafe.mp4",
      "café.mp4",
      "video01.mp4",
      "video1.mp4",
      "video2.mp4",
      "video10.mp4",
    ];
    await expect.poll(() => shown(page)).toEqual(byName);

    // The sort controls follow the size control in the tab order.
    const { size, field, direction } = controls(page);
    await size.focus();
    await page.keyboard.press("Tab");
    await expect(field).toBeFocused();
    await expect(field).toHaveAccessibleName("Sort by");
    await page.keyboard.press("Tab");
    await expect(direction).toBeFocused();
    await expect(direction).toHaveAccessibleName("Order");

    // Filename descending reverses the whole order.
    await page.keyboard.press("ArrowDown");
    await expect(direction).toHaveValue("descending");
    await expect.poll(() => shown(page)).toEqual([...byName].reverse());

    // Date modified, newest first; equal dates keep filename order.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("ArrowDown");
    await expect(field).toHaveValue("modified");
    await expect(direction.locator("option:checked")).toHaveText(
      "Newest first",
    );
    await expect
      .poll(() => shown(page))
      .toEqual([
        "video01.mp4",
        "video10.mp4",
        "cafe.mp4",
        "video1.mp4",
        "video2.mp4",
        "café.mp4",
      ]);
    await expect(page.getByRole("status")).toHaveText(
      "Sorted by date modified, newest first.",
    );

    // Date modified, oldest first.
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowUp");
    await expect(direction).toHaveValue("ascending");
    await expect
      .poll(() => shown(page))
      .toEqual([
        "café.mp4",
        "cafe.mp4",
        "video1.mp4",
        "video2.mp4",
        "video10.mp4",
        "video01.mp4",
      ]);

    // Filename ascending again; Tab enters the grid at its new first entry.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("ArrowUp");
    await expect(field).toHaveValue("name");
    await expect.poll(() => shown(page)).toEqual(byName);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(videoCard(page, "cafe.mp4")).toBeFocused();

    // Sorting kept the thumbnail and changed no source.
    await videoCard(page, "video2.mp4").scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    expect(await snapshot(folder)).toEqual(before);
  } finally {
    await app.close();
  }
});

test("folder, size and sort order are restored after a restart, with thumbnails and playback intact", async () => {
  const root = await mkdtemp(path.resolve(".verify/preferences-restore-"));
  const folder = path.join(root, "sources");
  const log = path.join(root, "launch.json");
  const player = createPlayer(log);
  try {
    const clip = `clip${player.extension}`;
    await mkdir(folder);
    makeVideo(path.join(folder, clip), 2);
    await sources(folder, {
      [clip]: 2,
      [`older${player.extension}`]: 1,
      [`newer${player.extension}`]: 3,
    });
    const before = await snapshot(folder);
    const first = await launchApp(root, [player.extension]);
    try {
      const { size, field, direction } = controls(first.page);
      await openFolder(first.page, folder);
      await expect(first.page.getByRole("status")).toContainText(
        "3 source videos",
      );
      await size.fill("480");
      await field.selectOption("modified");
      await direction.selectOption("descending");
      await expect
        .poll(() => shown(first.page))
        .toEqual([
          `newer${player.extension}`,
          clip,
          `older${player.extension}`,
        ]);
    } finally {
      await first.app.close();
    }

    // Preferences are saved in the data folder, not beside the sources.
    expect(
      JSON.parse(
        await readFile(path.join(root, "state", "preferences.json"), "utf8"),
      ),
    ).toEqual({
      folder,
      size: 480,
      sort: { field: "modified", direction: "descending" },
    });
    expect(await snapshot(folder)).toEqual(before);

    const { app, page } = await launchApp(root, [player.extension]);
    try {
      const { size, field, direction } = controls(page);
      // The folder reopens without being reselected.
      await expect(page.getByLabel("Selected folder")).toHaveText(folder);
      await expect(page.getByLabel("Folder path")).toHaveValue(folder);
      await expect(page.getByRole("status")).toContainText("3 source videos");
      await expect(size).toHaveValue("480");
      await expect(page.getByText("480 px", { exact: true })).toBeVisible();
      await expect(field).toHaveValue("modified");
      await expect(direction).toHaveValue("descending");
      await expect(direction.locator("option:checked")).toHaveText(
        "Newest first",
      );
      await expect
        .poll(() => shown(page))
        .toEqual([
          `newer${player.extension}`,
          clip,
          `older${player.extension}`,
        ]);
      const frame = await videoCard(page, clip).locator(".frame").boundingBox();
      expect(Math.abs((frame?.width ?? 0) - 480)).toBeLessThanOrEqual(4);
      await videoCard(page, clip).scrollIntoViewIfNeeded();
      await expect(
        page.getByRole("img", { name: `Thumbnail for ${clip}` }),
      ).toBeVisible({ timeout: 30_000 });
      await videoCard(page, clip).click();
      await expectLaunched(log, path.join(folder, clip));
    } finally {
      await app.close();
    }
    expect(await snapshot(folder)).toEqual(before);
  } finally {
    player.remove();
  }
});

test("an unavailable last folder is explained at startup and the folder chooser is offered", async () => {
  const root = await mkdtemp(path.resolve(".verify/preferences-missing-"));
  const folder = path.join(root, "usb");
  await sources(folder, { "a.mp4": 1, "b.mp4": 2 });
  const first = await launchApp(root);
  try {
    await openFolder(first.page, folder);
    await expect(first.page.getByRole("status")).toContainText(
      "2 source videos",
    );
    // The size is chosen from the keyboard: 160, then one step up.
    await controls(first.page).size.focus();
    await first.page.keyboard.press("Home");
    await first.page.keyboard.press("ArrowRight");
    await expect(controls(first.page).size).toHaveValue("200");
    await controls(first.page).direction.selectOption("descending");
    await expect.poll(() => shown(first.page)).toEqual(["b.mp4", "a.mp4"]);
    // A folder that cannot be listed does not replace the remembered one.
    await openFolder(first.page, path.join(root, "missing"));
    await expect(first.page.getByRole("status")).toContainText(
      "cannot be found",
    );
  } finally {
    await first.app.close();
  }

  // As if the USB drive were disconnected.
  const moved = path.join(root, "unplugged");
  await rename(folder, moved);
  const { app, page } = await launchApp(root);
  try {
    const { size, direction } = controls(page);
    await expect(page.getByRole("status")).toHaveText(
      /^Your last selected folder is not available\. This folder cannot be found\. If it is on a USB drive/,
    );
    await expect(page.getByLabel("Selected folder")).toHaveText(folder);
    await expect(
      page.getByRole("list", { name: "Source videos" }).getByRole("listitem"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Choose folder…" }),
    ).toBeFocused();
    await expect(size).toHaveValue("200");
    await expect(direction).toHaveValue("descending");

    // Reconnecting and selecting the folder again applies the restored order.
    await rename(moved, folder);
    await openFolder(page, folder);
    await expect.poll(() => shown(page)).toEqual(["b.mp4", "a.mp4"]);
  } finally {
    await app.close();
  }
});
