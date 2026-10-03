import {
  test,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  expectLaunched,
  launchApp,
  makeVideo,
  openFolder,
  useStalledProbe,
  videoCard,
} from "./app";
import { createPlayer } from "./player";

function sizeControl(page: Page) {
  return page.getByRole("slider", { name: "Thumbnail size" });
}

// Sets the size of the window's page area. The window is at least 640 pixels
// wide, as set in src/main.ts.
function resizeWindow(app: ElectronApplication, width: number, height: number) {
  return app.evaluate(
    ({ BrowserWindow }, [width, height]) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(width, height),
    [width, height] as const,
  );
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("Element is not rendered");
  return value;
}

// Whether the element's own text is clipped by its box.
function clipped(locator: Locator) {
  return locator.evaluate(
    (element) =>
      element.scrollHeight > element.clientHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1,
  );
}

// Whether the element is fully inside the scrolling grid's visible area.
function inView(locator: Locator) {
  return locator.evaluate((element) => {
    const view = document.getElementById("browse")?.getBoundingClientRect();
    const own = element.getBoundingClientRect();
    return !!view && own.top >= view.top - 1 && own.bottom <= view.bottom + 1;
  });
}

// Hovers an entry and, when its full text extends below the grid on a short
// screen, scrolls with the wheel as a mouse user would. The pointer stays over
// the entry, so the text stays expanded.
async function hoverAndRead(page: Page, card: Locator, text: Locator) {
  await card.hover();
  const below = await text.evaluate((element) => {
    const view = document.getElementById("browse")?.getBoundingClientRect();
    return view ? element.getBoundingClientRect().bottom - view.bottom : 0;
  });
  if (below > 0) await page.mouse.wheel(0, Math.ceil(below) + 2);
  await expect.poll(() => clipped(text)).toBe(false);
  await expect.poll(() => inView(text)).toBe(true);
}

function topInView(locator: Locator) {
  return locator.evaluate((element) => {
    const view = document.getElementById("browse")?.getBoundingClientRect();
    const top = element.getBoundingClientRect().top;
    return !!view && top >= view.top - 1 && top < view.bottom;
  });
}

async function focusedName(page: Page) {
  return page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? "",
  );
}

test("thumbnail size starts near 320 pixels, adjusts from 160 to 640 and fits portrait and landscape thumbnails without cropping", async () => {
  const root = await mkdtemp(path.resolve(".verify/presentation-size-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  makeVideo(path.join(folder, "a landscape.mp4"), 2, "320x180");
  makeVideo(path.join(folder, "b portrait.mp4"), 2, "180x320");
  const { app, page } = await launchApp(root);
  try {
    await openFolder(page, folder);
    const size = sizeControl(page);
    await expect(size).toHaveValue("320");
    await expect(size).toHaveAttribute("min", "160");
    await expect(size).toHaveAttribute("max", "640");
    for (const name of ["a landscape.mp4", "b portrait.mp4"])
      await expect(
        page.getByRole("img", { name: `Thumbnail for ${name}` }),
      ).toBeVisible({ timeout: 30_000 });

    const check = async (width: number) => {
      await expect(
        page.getByText(`${width} px`, { exact: true }),
      ).toBeVisible();
      const frames: { x: number; y: number; width: number; height: number }[] =
        [];
      for (const name of ["a landscape.mp4", "b portrait.mp4"]) {
        // At 640 pixels a short screen may hold only one entry.
        await videoCard(page, name).scrollIntoViewIfNeeded();
        const image = page.getByRole("img", { name: `Thumbnail for ${name}` });
        await expect(image).toBeVisible();
        const frame = await box(videoCard(page, name).locator(".frame"));
        const shown = await box(image);
        expect(Math.abs(frame.width - width)).toBeLessThanOrEqual(4);
        // The image element fills the frame and `contain` scales the whole
        // still inside it, so neither axis is cropped or stretched.
        expect(shown.x).toBeGreaterThanOrEqual(frame.x - 0.5);
        expect(shown.y).toBeGreaterThanOrEqual(frame.y - 0.5);
        expect(shown.x + shown.width).toBeLessThanOrEqual(
          frame.x + frame.width + 0.5,
        );
        expect(shown.y + shown.height).toBeLessThanOrEqual(
          frame.y + frame.height + 0.5,
        );
        expect(
          await image.evaluate(
            (element) => getComputedStyle(element).objectFit,
          ),
        ).toBe("contain");
        frames.push(frame);
      }
      // Entries are aligned: equal frames in one row, or in one column once
      // the window fits a single entry per row.
      const [landscape, portrait] = frames;
      if (!landscape || !portrait) throw new Error("Missing frames");
      if (Math.abs(portrait.y - landscape.y) > 0.5)
        expect(portrait.x).toBeCloseTo(landscape.x, 0);
      expect(portrait.width).toBeCloseTo(landscape.width, 0);
      expect(portrait.height).toBeCloseTo(landscape.height, 0);
      await page.screenshot({ path: path.join(root, `size-${width}.png`) });
    };
    await check(320);
    // The size control works from the keyboard.
    await size.focus();
    await page.keyboard.press("Home");
    await expect(size).toHaveValue("160");
    await check(160);
    await page.keyboard.press("End");
    await expect(size).toHaveValue("640");
    await check(640);
  } finally {
    await app.close();
  }
});

test("changing size during extraction updates the live grid without reprocessing source videos", async () => {
  const root = await mkdtemp(path.resolve(".verify/presentation-resize-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const log = path.join(root, "launch.json");
  const pidLog = path.join(root, "probe.pid");
  const player = createPlayer(log);
  try {
    // One extraction slot stays busy while the size changes; the other has
    // already stored a real thumbnail.
    makeVideo(path.join(folder, `a stalled${player.extension}`), 2);
    makeVideo(path.join(folder, `b clip${player.extension}`), 2);
    for (let index = 0; index < 300; index++)
      await writeFile(
        path.join(
          folder,
          `z filler ${String(index).padStart(3, "0")}${player.extension}`,
        ),
        "x",
      );
    const { app, page } = await launchApp(root, [player.extension]);
    try {
      await useStalledProbe(app, pidLog);
      await openFolder(page, folder);
      const probes = async () =>
        (await readFile(pidLog, "utf8").catch(() => ""))
          .split("\n")
          .filter(Boolean).length;
      await expect.poll(probes).toBe(1);
      const first = videoCard(page, `a stalled${player.extension}`);
      await expect(first.locator(".frame")).toHaveText("Loading thumbnail…");
      const clip = page.getByRole("img", {
        name: `Thumbnail for b clip${player.extension}`,
      });
      await expect(clip).toBeVisible({ timeout: 30_000 });
      // Stored stills, by path and modification time.
      const stored = async () => {
        const folder = path.join(root, "state", "thumbnails");
        const files = await readdir(folder, { recursive: true });
        const result = [];
        for (const file of files.sort())
          result.push(
            `${file} ${(await stat(path.join(folder, file))).mtimeMs}`,
          );
        return result;
      };
      const before = await stored();
      expect(before.length).toBeGreaterThan(0);

      const size = sizeControl(page);
      await size.focus();
      for (const [key, width] of [
        ["End", 640],
        ["Home", 160],
        ["ArrowRight", 160 + 40],
      ] as const) {
        const started = performance.now();
        await page.keyboard.press(key);
        await expect
          .poll(async () =>
            Math.round((await box(first.locator(".frame"))).width),
          )
          .toBeGreaterThanOrEqual(width - 4);
        expect(
          Math.abs((await box(first.locator(".frame"))).width - width),
        ).toBeLessThanOrEqual(4);
        // A live update, not a wait for extraction.
        expect(performance.now() - started).toBeLessThan(1_000);
      }
      // No source was reprocessed: the stalled job was not restarted and the
      // stored thumbnail was neither rewritten nor joined by another.
      await page.waitForTimeout(1_000);
      expect(await probes()).toBe(1);
      expect(await stored()).toEqual(before);
      await expect(first.locator(".frame")).toHaveText("Loading thumbnail…");
      await expect(clip).toBeVisible();
      // Browsing and playback stay usable.
      const last = videoCard(page, `z filler 299${player.extension}`);
      await last.scrollIntoViewIfNeeded();
      await last.click();
      await expectLaunched(
        log,
        path.join(folder, `z filler 299${player.extension}`),
      );
    } finally {
      await app.close();
    }
  } finally {
    player.remove();
  }
});

test("long filenames stay visible and can be read in full by mouse, keyboard and accessible name", async () => {
  const root = await mkdtemp(path.resolve(".verify/presentation-names-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const long = `A ${"summer holiday at the coast with the whole family ".repeat(4)}final edit.mp4`;
  await writeFile(path.join(folder, long), "x");
  await writeFile(path.join(folder, "short.mp4"), "x");
  const { app, page } = await launchApp(root);
  try {
    await openFolder(page, folder);
    const card = videoCard(page, long);
    await expect(card).toBeVisible();
    const name = card.locator(".filename");
    await expect(name).toHaveText(long);
    await expect(name).toBeVisible();
    // Long names are shortened in the grid so entries stay aligned.
    expect(await clipped(name)).toBe(true);
    const short = await box(videoCard(page, "short.mp4"));
    expect((await box(card)).height).toBeCloseTo(short.height, 0);

    await hoverAndRead(page, card, name);
    await page.mouse.move(0, 0);
    expect(await clipped(name)).toBe(true);

    // Keyboard focus also reveals the whole name, scrolling it into view: at
    // 640 pixels in a short window the name starts below the visible grid.
    await resizeWindow(app, 1120, 560);
    await sizeControl(page).fill("640");
    expect(await inView(name)).toBe(false);
    // The grid follows the order control.
    await page.getByRole("combobox", { name: "Order" }).focus();
    await page.keyboard.press("Tab");
    expect(await focusedName(page)).toBe(`Open ${long}`);
    expect(await clipped(name)).toBe(false);
    await expect.poll(() => inView(name)).toBe(true);
    await expect(card).toHaveAccessibleName(`Open ${long}`);
  } finally {
    await app.close();
  }
});

test("the header stays compact so the grid gets most of the window, and wraps without overflowing when narrow", async () => {
  const root = await mkdtemp(path.resolve(".verify/presentation-header-"));
  const folder = path.join(root, "Videos");
  const long = path.join(root, `holiday videos ${"from the coast ".repeat(4)}`);
  for (const each of [folder, long]) {
    await mkdir(each);
    await writeFile(path.join(each, "clip.mp4"), "x");
  }
  const { app, page } = await launchApp(root);
  try {
    const controls = [
      page.getByLabel("Folder path"),
      ...["Open folder", "Choose folder…", "Refresh", "Clear cache"].map(
        (name) => page.getByRole("button", { name, exact: true }),
      ),
      sizeControl(page),
      page.getByRole("combobox", { name: "Sort by" }),
      page.getByRole("combobox", { name: "Order" }),
      page.getByLabel("Selected folder"),
      page.getByRole("status"),
    ];
    const header = page.locator("header");
    const viewportWidth = () =>
      page.evaluate(() => document.documentElement.clientWidth);
    // Every control is shown, inside the header and the window.
    const expectAllShown = async () => {
      const bounds = await box(header);
      const right = await viewportWidth();
      for (const control of controls) {
        await expect(control).toBeVisible();
        const own = await box(control);
        expect(own.y).toBeGreaterThanOrEqual(bounds.y - 1);
        expect(own.y + own.height).toBeLessThanOrEqual(
          bounds.y + bounds.height + 1,
        );
        expect(own.x + own.width).toBeLessThanOrEqual(right + 1);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    };

    // In a typical desktop window, sized to fit a 1024 by 768 screen, the
    // header leaves at least three quarters of the height to the grid.
    await resizeWindow(app, 1024, 640);
    await expect.poll(viewportWidth).toBeLessThanOrEqual(1024);
    await openFolder(page, folder);
    await expect(page.getByRole("status")).toContainText("1 source video");
    await expectAllShown();
    const height = await page.evaluate(() => window.innerHeight);
    expect(height).toBeGreaterThanOrEqual(600);
    expect((await box(header)).height).toBeLessThanOrEqual(height / 4);
    await expect(
      page.getByRole("heading", { name: "Video Browser" }),
    ).toBeAttached();

    // The narrowest window wraps the controls and a long selected folder
    // instead of overflowing.
    await resizeWindow(app, 640, 640);
    await openFolder(page, long);
    await expect(page.getByLabel("Selected folder")).toHaveText(long);
    await expect.poll(viewportWidth).toBeLessThanOrEqual(640);
    await expectAllShown();
  } finally {
    await app.close();
  }
});

test("the whole workflow runs from the keyboard with visible focus, and only Enter launches", async () => {
  const root = await mkdtemp(path.resolve(".verify/presentation-keyboard-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const log = path.join(root, "launch.json");
  const player = createPlayer(log);
  try {
    const entry = (index: number) =>
      `clip ${String(index).padStart(2, "0")}${player.extension}`;
    for (let index = 0; index < 60; index++)
      await writeFile(path.join(folder, entry(index)), "x");
    const { app, page } = await launchApp(root, [player.extension]);
    try {
      const expectFocusVisible = async () => {
        const outline = await page.evaluate(() => {
          const style = getComputedStyle(document.activeElement as Element);
          return {
            style: style.outlineStyle,
            width: parseFloat(style.outlineWidth),
          };
        });
        expect(outline.style).not.toBe("none");
        expect(outline.width).toBeGreaterThanOrEqual(2);
      };
      // Folder selection.
      await expect(page.getByLabel("Folder path")).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.getByLabel("Folder path")).toBeFocused();
      await expectFocusVisible();
      await page.keyboard.type(folder);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status")).toContainText("60 source videos");
      for (const name of [
        "Open folder",
        "Choose folder…",
        "Refresh",
        "Clear cache",
      ]) {
        await page.keyboard.press("Tab");
        await expect(
          page.getByRole("button", { name, exact: true }),
        ).toBeFocused();
        await expectFocusVisible();
      }
      await page.keyboard.press("Tab");
      await expect(sizeControl(page)).toBeFocused();
      await expectFocusVisible();
      for (const name of ["Sort by", "Order"]) {
        await page.keyboard.press("Tab");
        await expect(page.getByRole("combobox", { name })).toBeFocused();
        await expectFocusVisible();
      }

      // One Tab enters the grid at its first entry.
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe(`Open ${entry(0)}`);
      await expectFocusVisible();
      const columns = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".video")];
        const top = cards[0]?.getBoundingClientRect().top;
        return cards.filter((card) => card.getBoundingClientRect().top === top)
          .length;
      });
      expect(columns).toBeGreaterThan(1);
      await page.keyboard.press("ArrowRight");
      expect(await focusedName(page)).toBe(`Open ${entry(1)}`);
      await page.keyboard.press("ArrowDown");
      expect(await focusedName(page)).toBe(`Open ${entry(1 + columns)}`);
      await page.keyboard.press("ArrowLeft");
      expect(await focusedName(page)).toBe(`Open ${entry(columns)}`);
      await page.keyboard.press("ArrowUp");
      expect(await focusedName(page)).toBe(`Open ${entry(0)}`);
      await page.keyboard.press("End");
      expect(await focusedName(page)).toBe(`Open ${entry(59)}`);
      await expect(videoCard(page, entry(59))).toBeInViewport();
      await page.keyboard.press("Home");
      expect(await focusedName(page)).toBe(`Open ${entry(0)}`);
      for (let step = 0; step < 4; step++)
        await page.keyboard.press("ArrowDown");
      const target = entry(4 * columns);
      expect(await focusedName(page)).toBe(`Open ${target}`);
      await expectFocusVisible();

      // Navigation never launches playback.
      await page.waitForTimeout(500);
      expect(await readFile(log, "utf8").catch(() => "")).toBe("");

      // Resizing keeps the current entry in view and Tab returns to it.
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(sizeControl(page)).toBeFocused();
      await page.keyboard.press("End");
      await expect(sizeControl(page)).toHaveValue("640");
      // At 640 pixels an entry can be taller than the grid; its top stays in view.
      expect(await topInView(videoCard(page, target))).toBe(true);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      expect(await focusedName(page)).toBe(`Open ${target}`);

      // Enter launches through the same path as a click.
      await page.keyboard.press("Enter");
      await expectLaunched(log, path.join(folder, target));
      await expect(page.getByRole("status")).toContainText(`Opened ${target}`);
    } finally {
      await app.close();
    }
  } finally {
    player.remove();
  }
});

test("entries describe loading, duration and failures to assistive technology", async () => {
  const root = await mkdtemp(path.resolve(".verify/presentation-describe-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  makeVideo(path.join(folder, "clip.mp4"), 2, "320x180");
  await writeFile(path.join(folder, "damaged.mp4"), "not a video");
  makeVideo(path.join(folder, "stalled.mp4"), 2, "320x180");
  const { app, page } = await launchApp(root);
  try {
    await useStalledProbe(app, path.join(root, "probe.pid"));
    await openFolder(page, folder);
    await expect(videoCard(page, "stalled.mp4")).toHaveAccessibleDescription(
      "Loading thumbnail…",
    );
    await expect(videoCard(page, "clip.mp4")).toHaveAccessibleDescription(
      "Duration 2 seconds",
      { timeout: 30_000 },
    );
    await expect(videoCard(page, "clip.mp4").locator(".detail")).toHaveText(
      "0:02",
    );
    await expect(videoCard(page, "damaged.mp4")).toHaveAccessibleDescription(
      /^Thumbnail unavailable/,
      { timeout: 30_000 },
    );
    // The visible reason can be read in full on hover, even at the smallest size.
    const damaged = videoCard(page, "damaged.mp4");
    await sizeControl(page).fill("160");
    expect(await clipped(damaged.locator(".detail"))).toBe(true);
    await hoverAndRead(page, damaged, damaged.locator(".detail"));
    await expect(sizeControl(page)).toHaveAccessibleName("Thumbnail size");
  } finally {
    await app.close();
  }
});
