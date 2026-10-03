import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { extract } from "@electron-internal/extract-zip";
import {
  callMain,
  expectLaunched,
  expectThumbnails,
  openFolder,
  snapshot,
  videoCard,
} from "./app";
import { createPlayer } from "./player";

// Makes a playable clip with the package's own thumbnail tools, so the test
// needs nothing from the development checkout's tool folder.
function makePackagedVideo(packageRoot: string, target: string): void {
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
    "-pix_fmt",
    "yuv420p",
    "-f",
    "mp4",
    target,
  ]);
}

// Every file below `folder`, by relative path, with its size and modification time.
async function tree(folder: string) {
  const result = [];
  for (const entry of await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  }))
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      const info = await stat(file);
      result.push({
        file: path.relative(folder, file),
        size: info.size,
        modified: info.mtimeMs,
      });
    }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}

// Starts the extracted executable as a clean machine would: Windows' own
// PATH, no developer environment, and a fresh per-user local folder.
function launchPackage(packageRoot: string, localAppData: string) {
  const windows = process.env.SystemRoot ?? "C:\\Windows";
  return electron.launch({
    executablePath: path.join(packageRoot, "VideoBrowser.exe"),
    env: {
      SystemRoot: windows,
      SystemDrive: process.env.SystemDrive ?? "C:",
      windir: windows,
      PATH: `${windows}\\System32`,
      USERPROFILE: process.env.USERPROFILE ?? "",
      APPDATA: process.env.APPDATA ?? "",
      LOCALAPPDATA: localAppData,
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
    },
  });
}

test("the package holds its runtime, compiled app, thumbnail tools and notices, and no development files", async () => {
  const root = await mkdtemp(path.resolve(".verify/package-contents-"));
  await extract(path.resolve("dist/VideoBrowser-win32-x64.zip"), { dir: root });
  expect(await readdir(root)).toEqual(["VideoBrowser-win32-x64"]);
  const packageRoot = path.join(root, "VideoBrowser-win32-x64");
  const files = (await tree(packageRoot)).map(({ file }) => file);
  for (const required of [
    "VideoBrowser.exe",
    "LICENSE",
    "LICENSES.chromium.html",
    "README.md",
    "THIRD-PARTY-NOTICES.md",
    path.join("licenses", "ffmpeg", "LICENSE"),
    path.join("licenses", "ffmpeg", "README.txt"),
    path.join("resources", "tools", "ffmpeg.exe"),
    path.join("resources", "tools", "ffprobe.exe"),
    path.join("resources", "app", "package.json"),
    path.join("resources", "app", "build", "main.js"),
    path.join("resources", "app", "build", "index.html"),
  ])
    expect(files).toContain(required);
  const app = files.filter((file) =>
    file.startsWith(path.join("resources", "app") + path.sep),
  );
  // Only the compiled application: no sources, tests, dependencies or tools.
  for (const file of app)
    expect(file).toMatch(
      /^resources\\app\\(package\.json|build\\[\w-]+\.(js|html|css))$/,
    );
  const readme = await readFile(path.join(packageRoot, "README.md"), "utf8");
  for (const topic of [
    "Windows 11 x64",
    "Refresh",
    "Clear cache",
    "%LOCALAPPDATA%\\video-browser",
    ".h264",
  ])
    expect(readme).toContain(topic);
});

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
    makePackagedVideo(packageRoot, source);
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
      await callMain(app, "addFixtureExtension", [player.extension]);
      const page = await app.firstWindow();
      await openFolder(page, folder);
      await expectThumbnails(page, [filename]);
      await videoCard(page, filename).click();
      await expectLaunched(log, source);
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

test("the extracted package browses, refreshes, clears its cache and restores preferences offline, keeping its storage apart from the package and source videos", async () => {
  test.setTimeout(240_000);
  const root = await mkdtemp(path.resolve(".verify/package-workflow-"));
  await extract(path.resolve("dist/VideoBrowser-win32-x64.zip"), { dir: root });
  const packageRoot = path.join(root, "VideoBrowser-win32-x64");
  const localAppData = path.join(root, "local app data");
  const state = path.join(localAppData, "video-browser");
  const thumbnails = path.join(state, "thumbnails");
  const preferences = path.join(state, "preferences.json");
  const folder = path.join(root, "source videos");
  await mkdir(localAppData);
  await mkdir(folder);
  const log = path.join(root, "launch.json");
  const player = createPlayer(log);
  type Source = { filename: string; source: string };
  const [first, second, damaged, added] = [
    "clip 1 café",
    "clip 10",
    "damaged",
    "clip 2 added",
  ].map((name) => {
    const filename = `${name}${player.extension}`;
    return { filename, source: path.join(folder, filename) };
  }) as [Source, Source, Source, Source];
  try {
    makePackagedVideo(packageRoot, first.source);
    makePackagedVideo(packageRoot, second.source);
    await writeFile(damaged.source, Buffer.alloc(4096, 7));
    const packaged = await tree(packageRoot);
    const requests: string[] = [];
    // The sources as they were once the last change was made.
    let sources: Awaited<ReturnType<typeof snapshot>> = [];
    const storedStills = async () =>
      (await tree(thumbnails).catch(() => [])).filter(({ file }) =>
        file.endsWith(".png"),
      );

    let app = await launchPackage(packageRoot, localAppData);
    try {
      expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
      await callMain(app, "addFixtureExtension", [player.extension]);
      const page = await app.firstWindow();
      page.on("request", (request) => requests.push(request.url()));
      await expect(page.getByRole("status")).toHaveText(
        "Select a folder to begin.",
      );
      await openFolder(page, folder);
      await expectThumbnails(page, [first.filename, second.filename]);
      // A file that cannot be previewed keeps an explanation and its playback action.
      await expect(
        videoCard(page, damaged.filename),
      ).toHaveAccessibleDescription(/not recognised as a supported video/, {
        timeout: 30_000,
      });
      await videoCard(page, damaged.filename).click();
      await expectLaunched(log, damaged.source);
      await videoCard(page, first.filename).click();
      await expectLaunched(log, first.source);
      expect(app.process().exitCode).toBeNull();

      // Browsing choices to restore later.
      await page.getByLabel("Thumbnail size").focus();
      await page.keyboard.press("ArrowRight");
      await page.getByLabel("Order").selectOption("descending");
      await expect(
        page.getByRole("list", { name: "Source videos" }).getByRole("button"),
      ).toHaveText([/damaged/, /clip 10/, /clip 1 café/]);

      // Refresh picks up an added source and reports a removed one; opening
      // a removed source explains the failure and leaves the browser usable.
      makePackagedVideo(packageRoot, added.source);
      await rm(second.source);
      sources = await snapshot(folder);
      await videoCard(page, second.filename).click();
      await expect(page.getByRole("status")).toHaveText(
        /^Cannot open .*clip 10.*no longer available/,
      );
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText(
        "Refreshed. 3 source videos: 1 added, 1 removed.",
      );
      await expectThumbnails(page, [added.filename]);
      await expect(videoCard(page, second.filename)).toHaveCount(0);
      // The removed source's still stays stored until eviction or Clear cache.
      expect(await storedStills()).toHaveLength(3);

      // Clear cache removes stored thumbnails and makes them again; the
      // preferences file survives.
      await expect
        .poll(async () =>
          JSON.parse(await readFile(preferences, "utf8").catch(() => "{}")),
        )
        .toMatchObject({
          folder,
          size: 360,
          sort: { field: "name", direction: "descending" },
        });
      await page
        .getByRole("button", { name: "Clear cache", exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveText(
        "Cleared cached thumbnails. Thumbnails are being made again.",
      );
      await expectThumbnails(page, [first.filename, added.filename]);
      await expect.poll(storedStills).toHaveLength(2);
      expect(await readFile(preferences, "utf8")).toContain("descending");
    } finally {
      await app.close();
    }

    // A later launch restores the folder, size and sort order and reuses the
    // stored thumbnails without extracting them again.
    const stored = await storedStills();
    app = await launchPackage(packageRoot, localAppData);
    try {
      await callMain(app, "addFixtureExtension", [player.extension]);
      const page = await app.firstWindow();
      page.on("request", (request) => requests.push(request.url()));
      await expect(page.getByLabel("Folder path")).toHaveValue(folder);
      // The fixture extension may arrive after the startup listing.
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(page.getByLabel("Thumbnail size")).toHaveValue("360");
      await expect(page.getByLabel("Order")).toHaveValue("descending");
      await expectThumbnails(page, [first.filename, added.filename]);
      expect(await storedStills()).toEqual(stored);
    } finally {
      await app.close();
    }

    // Offline: the window loaded only its own files and stored thumbnails.
    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) expect(url).toMatch(/^(file|thumbnail|data):/);
    // Nothing was written beside the application or the source videos, and
    // Refresh, Clear cache and the restart left the sources' bytes and times alone.
    expect(await tree(packageRoot)).toEqual(packaged);
    expect(await snapshot(folder)).toEqual(sources);
    expect(await readdir(state)).toEqual(
      expect.arrayContaining(["preferences.json", "thumbnails"]),
    );
  } finally {
    player.remove();
  }
});
