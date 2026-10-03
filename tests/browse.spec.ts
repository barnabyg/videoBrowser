import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { expectLaunched, launchApp, makeVideo, openFolder } from "./app";
import { createPlayer } from "./player";

async function snapshot(folder: string) {
  const files = (await readdir(folder)).sort();
  return Promise.all(
    files.map(async (file) => {
      const source = path.join(folder, file);
      const info = await stat(source);
      return {
        file,
        modified: info.isFile() ? info.mtimeMs : 0,
        hash: info.isFile()
          ? createHash("sha256")
              .update(await readFile(source))
              .digest("hex")
          : "folder",
      };
    }),
  );
}

test("folder states have distinct messages and leave folder selection usable", async () => {
  const root = await mkdtemp(path.resolve(".verify/browse-states-"));
  const empty = path.join(root, "empty");
  const noVideos = path.join(root, "no videos");
  const locked = path.join(root, "locked");
  const videos = path.join(root, "videos");
  for (const folder of [empty, noVideos, locked, videos]) await mkdir(folder);
  await mkdir(path.join(noVideos, "nested"));
  await writeFile(path.join(noVideos, "nested", "inside.mp4"), "x");
  await writeFile(path.join(noVideos, "notes.txt"), "x");
  await mkdir(path.join(videos, "season 2"));
  await writeFile(path.join(videos, "season 2", "episode.mp4"), "x");
  await mkdir(path.join(videos, "folder.mp4"));
  for (const file of ["Clip A.MP4", "clip b.mkv", "poster.jpg", "notes.txt"])
    await writeFile(path.join(videos, file), "not a real video");
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  execFileSync("icacls.exe", [locked, "/deny", `${user}:(RD)`]);
  const { app, page } = await launchApp(root);
  try {
    const status = page.getByRole("status");
    const grid = page.getByRole("list", { name: "Source videos" });
    const states: [string, RegExp][] = [
      [empty, /This folder is empty/],
      [noVideos, /No recognised video files.*Subfolders are not included/],
      [path.join(root, "missing"), /cannot be found.*USB drive/],
      [path.join(videos, "Clip A.MP4"), /file, not a folder/],
      [locked, /denied access/],
      ["\\\\media-server\\videos", /Network folders are not supported/],
      ["videos", /Enter a full folder path/],
    ];
    const messages = new Set<string>();
    for (const [folder, message] of states) {
      await openFolder(page, folder);
      await expect(status).toHaveText(message);
      messages.add((await status.textContent()) ?? "");
      await expect(grid.getByRole("listitem")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Choose folder…" }),
      ).toBeEnabled();
    }
    expect(messages.size).toBe(states.length);

    await openFolder(page, videos);
    await expect(page.getByLabel("Selected folder")).toHaveText(videos);
    await expect(status).toContainText("2 source videos");
    await expect(grid.getByRole("listitem")).toHaveCount(2);
    for (const name of ["Open Clip A.MP4", "Open clip b.mkv"])
      await expect(
        grid.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    // Recognised but undecodable files stay listed with a placeholder.
    await expect(
      grid.getByRole("button").filter({ hasText: "Thumbnail unavailable" }),
    ).toHaveCount(2, { timeout: 30_000 });
  } finally {
    await app.close();
    execFileSync("icacls.exe", [locked, "/remove:d", user]);
  }
});

test("a single click on a thumbnail, placeholder or filename launches the source and keeps the browsing position", async () => {
  const root = await mkdtemp(path.resolve(".verify/browse-launch-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const log = path.join(root, "launch.json");
  const player = createPlayer(log);
  try {
    const playable = `film one ÆØ 日本${player.extension}`;
    const corrupt = `damaged clip${player.extension}`;
    const unreadable = `locked clip${player.extension}`;
    makeVideo(path.join(folder, playable));
    await writeFile(path.join(folder, corrupt), "not a video");
    makeVideo(path.join(folder, unreadable));
    const filler = (index: number) =>
      `zz filler ${String(index).padStart(2, "0")}${player.extension}`;
    for (let index = 0; index < 40; index++)
      await writeFile(path.join(folder, filler(index)), "x");
    const before = await snapshot(folder);
    const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    execFileSync("icacls.exe", [
      path.join(folder, unreadable),
      "/deny",
      `${user}:(RD)`,
    ]);
    try {
      const { app, page } = await launchApp(root, [player.extension]);
      try {
        await openFolder(page, folder);
        const card = (name: string) =>
          page.getByRole("button", { name: `Open ${name}`, exact: true });

        await expect(
          page.getByRole("img", { name: `Thumbnail for ${playable}` }),
        ).toBeVisible({ timeout: 30_000 });
        await page
          .getByRole("img", { name: `Thumbnail for ${playable}` })
          .click();
        await expectLaunched(log, path.join(folder, playable));
        await expect(page.getByRole("status")).toContainText(
          `Opened ${playable}`,
        );

        // The placeholder is the first copy of the reason; the detail line repeats it.
        await card(corrupt).getByText("Thumbnail unavailable").first().click();
        await expectLaunched(log, path.join(folder, corrupt));

        // The unreadable source keeps the rest of the folder and stays launchable.
        await expect(
          card(unreadable)
            .getByText(/unavailable/)
            .first(),
        ).toBeVisible({ timeout: 30_000 });
        await card(unreadable).getByText(unreadable, { exact: true }).click();
        await expectLaunched(log, path.join(folder, unreadable));

        // Launch from deep in the grid keeps the selected folder and scroll position.
        await writeFile(log, "{}");
        // Measure once thumbnail loading has stopped changing the layout.
        await expect(page.getByText("Loading thumbnail…")).toHaveCount(0, {
          timeout: 30_000,
        });
        const grid = page.getByRole("main");
        const scrollTop = () => grid.evaluate((element) => element.scrollTop);
        await grid.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const position = await scrollTop();
        expect(position).toBeGreaterThan(0);
        await card(filler(39)).getByText(filler(39), { exact: true }).click();
        await expectLaunched(log, path.join(folder, filler(39)));
        expect(await scrollTop()).toBe(position);
        // Enter on a focused entry is the keyboard playback action. Focusing
        // may scroll the entry into view, so measure after focus.
        await card(filler(20)).focus();
        const focused = await scrollTop();
        await page.keyboard.press("Enter");
        await expectLaunched(log, path.join(folder, filler(20)));
        expect(await scrollTop()).toBe(focused);
        await expect(page.getByLabel("Selected folder")).toHaveText(folder);
        expect(app.process().exitCode).toBeNull();
      } finally {
        await app.close();
      }
    } finally {
      execFileSync("icacls.exe", [
        path.join(folder, unreadable),
        "/remove:d",
        user,
      ]);
    }
    expect(await snapshot(folder)).toEqual(before);
  } finally {
    player.remove();
  }
});

test("missing sources and absent or broken default applications produce clear launch errors", async () => {
  const root = await mkdtemp(path.resolve(".verify/browse-failures-"));
  const folder = path.join(root, "sources");
  await mkdir(folder);
  const log = path.join(root, "launch.json");
  const player = createPlayer(log);
  const broken = createPlayer(
    log,
    path.join(root, "Missing Player", "player.exe"),
  );
  const absent = `.vbf${randomUUID().replaceAll("-", "")}`;
  try {
    const names = {
      playable: `playable${player.extension}`,
      missing: `moved away${player.extension}`,
      absent: `no player${absent}`,
      broken: `broken player${broken.extension}`,
    };
    for (const name of Object.values(names))
      await writeFile(path.join(folder, name), "not a video");
    const { app, page } = await launchApp(root, [
      player.extension,
      broken.extension,
      absent,
    ]);
    try {
      await openFolder(page, folder);
      const status = page.getByRole("status");
      const open = (name: string) =>
        page.getByRole("button", { name: `Open ${name}`, exact: true }).click();

      await rm(path.join(folder, names.missing));
      await open(names.missing);
      await expect(status).toHaveText(
        new RegExp(`Cannot open ${names.missing}: .*no longer available`),
      );
      await open(names.absent);
      await expect(status).toHaveText(
        new RegExp(`Cannot open ${names.absent}: .*no default application`),
      );
      await open(names.broken);
      await expect(status).toHaveText(
        new RegExp(`Cannot open ${names.broken}: .*cannot be started`),
      );
      // The browser stays usable after each failure.
      await open(names.playable);
      await expectLaunched(log, path.join(folder, names.playable));
      await expect(page.getByLabel("Selected folder")).toHaveText(folder);
      expect(app.process().exitCode).toBeNull();
    } finally {
      await app.close();
    }
  } finally {
    player.remove();
    broken.remove();
  }
});
