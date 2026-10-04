// An application folder Windows does not allow writing to, e.g. under
// Program Files: the app still browses, explains that nothing can be saved,
// and writes nowhere else instead.
import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import { expectThumbnails, makeVideo, openFolder } from "./app";

// Windows' own tools, not same-named ones earlier on PATH.
const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const icacls = path.join(system32, "icacls.exe");

// The current user's security identifier, which icacls accepts as *SID.
function currentUser(): string {
  const line = execFileSync(
    path.join(system32, "whoami.exe"),
    ["/user", "/fo", "csv", "/nh"],
    { encoding: "utf8" },
  );
  const sid = /"(S-[\d-]+)"/.exec(line)?.[1];
  if (!sid) throw new Error(`Unexpected whoami output: ${line}`);
  return `*${sid}`;
}

test("a read-only application folder still browses, shows that nothing can be saved, and writes nothing elsewhere", async () => {
  const root = await mkdtemp(path.resolve(".verify/read-only-"));
  const application = path.join(root, "application");
  const localAppData = path.join(root, "local app data");
  const appData = path.join(root, "roaming app data");
  const folder = path.join(root, "source videos");
  for (const created of [application, localAppData, appData, folder])
    await mkdir(created);
  makeVideo(path.join(folder, "clip.mp4"));
  const user = currentUser();
  // Denies creating files and folders in, and writing below, the application folder.
  execFileSync(icacls, [application, "/deny", `${user}:(OI)(CI)(W)`]);
  try {
    const app = await electron.launch({
      args: ["."],
      env: {
        ...process.env,
        VIDEO_BROWSER_STATE: path.join(application, "data"),
        LOCALAPPDATA: localAppData,
        APPDATA: appData,
      },
    });
    try {
      const page = await app.firstWindow();
      await expect(page.getByRole("alert")).toHaveText(
        /^Preferences and stored thumbnails cannot be saved/,
      );
      await openFolder(page, folder);
      await expectThumbnails(page, ["clip.mp4"]);
      await page.getByLabel("Thumbnail size").focus();
      await page.keyboard.press("ArrowRight");
      await page
        .getByRole("button", { name: "Clear cache", exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveText(
        "Cleared cached thumbnails. Thumbnails are being made again.",
      );
      await expectThumbnails(page, ["clip.mp4"]);
      expect(app.process().exitCode).toBeNull();
    } finally {
      await app.close();
    }
  } finally {
    execFileSync(icacls, [application, "/remove:d", user]);
  }
  expect(await readdir(application)).toEqual([]);
  expect(await readdir(localAppData)).toEqual([]);
  expect(await readdir(appData)).toEqual([]);
  expect(await readdir(folder)).toEqual(["clip.mp4"]);
});

test("a writable data folder shows no storage message", async () => {
  const root = await mkdtemp(path.resolve(".verify/writable-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, VIDEO_BROWSER_STATE: path.join(root, "data") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText(
      "Select a folder to begin.",
    );
    await expect(page.getByRole("alert")).toBeHidden();
  } finally {
    await app.close();
  }
});
