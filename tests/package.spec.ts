import { test, expect, _electron as electron } from "@playwright/test";
import {
  cp,
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

// Per-user folders the app must leave alone: %LOCALAPPDATA% and %APPDATA%.
interface Profile {
  localAppData: string;
  appData: string;
}

// Handing a video to its default player makes Windows' shell create this empty
// folder of its own in a fresh %LOCALAPPDATA%; every real profile has it.
const shellFolders = [
  "Microsoft",
  path.join("Microsoft", "Windows"),
  path.join("Microsoft", "Windows", "Caches"),
];

// The app saved nothing in the per-user folders: no files, and no folders
// except the shell's own.
async function expectProfileUntouched(profile: Profile) {
  for (const folder of [profile.localAppData, profile.appData]) {
    const entries = await readdir(folder, {
      recursive: true,
      withFileTypes: true,
    });
    const written = entries.map((entry) =>
      path.relative(folder, path.join(entry.parentPath, entry.name)),
    );
    expect(written.filter((entry) => !shellFolders.includes(entry))).toEqual(
      [],
    );
    expect(entries.filter((entry) => !entry.isDirectory())).toEqual([]);
  }
}

// Starts the extracted executable as a clean machine would: Windows' own
// PATH, no developer environment and fresh per-user folders, from `cwd` as
// a shortcut with another starting folder would.
function launchPackage(packageRoot: string, profile: Profile, cwd: string) {
  const windows = process.env.SystemRoot ?? "C:\\Windows";
  return electron.launch({
    executablePath: path.join(packageRoot, "VideoBrowser.exe"),
    cwd,
    env: {
      SystemRoot: windows,
      SystemDrive: process.env.SystemDrive ?? "C:",
      windir: windows,
      PATH: `${windows}\\System32`,
      USERPROFILE: process.env.USERPROFILE ?? "",
      APPDATA: profile.appData,
      LOCALAPPDATA: profile.localAppData,
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
  // The data folder is made on first run; the package ships no user data.
  expect(await readdir(packageRoot)).not.toContain("data");
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
    "`data` folder",
    "read-only",
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

test("the extracted package browses, refreshes, clears its cache and restores preferences offline, keeping all its data in its own folder and leaving the source videos alone", async () => {
  test.setTimeout(300_000);
  const root = await mkdtemp(path.resolve(".verify/package-workflow-"));
  await extract(path.resolve("dist/VideoBrowser-win32-x64.zip"), { dir: root });
  const packageRoot = path.join(root, "VideoBrowser-win32-x64");
  const profile: Profile = {
    localAppData: path.join(root, "local app data"),
    appData: path.join(root, "roaming app data"),
  };
  const elsewhere = path.join(root, "another starting folder");
  const data = path.join(packageRoot, "data");
  const thumbnails = path.join(data, "thumbnails");
  const preferences = path.join(data, "preferences.json");
  const folder = path.join(root, "source videos");
  for (const created of [
    profile.localAppData,
    profile.appData,
    elsewhere,
    folder,
  ])
    await mkdir(created);
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

    let app = await launchPackage(packageRoot, profile, packageRoot);
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

    // A later launch from another starting folder restores the folder, size
    // and sort order and reuses the stored thumbnails without extracting them
    // again.
    const stored = await storedStills();
    app = await launchPackage(packageRoot, profile, elsewhere);
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
    // Everything was written to the package's data folder: nothing else in
    // the package changed, the per-user folders stay empty, and Refresh,
    // Clear cache and the restart left the sources' bytes and times alone.
    const dataPrefix = "data" + path.sep;
    expect(
      (await tree(packageRoot)).filter(
        ({ file }) => !file.startsWith(dataPrefix),
      ),
    ).toEqual(packaged);
    expect(await readdir(data)).toEqual(
      expect.arrayContaining(["preferences.json", "thumbnails", "session"]),
    );
    await expectProfileUntouched(profile);
    expect(await snapshot(folder)).toEqual(sources);

    // A copy of the whole folder elsewhere keeps the preferences and stored
    // thumbnails.
    const copy = path.join(root, "moved", "VideoBrowser-win32-x64");
    await cp(packageRoot, copy, { recursive: true });
    const copied = path.join(copy, "data", "thumbnails");
    app = await launchPackage(copy, profile, elsewhere);
    try {
      await callMain(app, "addFixtureExtension", [player.extension]);
      const page = await app.firstWindow();
      await expect(page.getByLabel("Folder path")).toHaveValue(folder);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(page.getByLabel("Thumbnail size")).toHaveValue("360");
      await expect(page.getByLabel("Order")).toHaveValue("descending");
      await expectThumbnails(page, [first.filename, added.filename]);
      expect(
        (await tree(copied)).filter(({ file }) => file.endsWith(".png")),
      ).toEqual(stored);
    } finally {
      await app.close();
    }
    await expectProfileUntouched(profile);
  } finally {
    player.remove();
  }
});
