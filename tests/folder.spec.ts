import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { listFolder } from "../src/folder";

async function fixture(files: string[], folders: string[] = []) {
  const root = await mkdtemp(path.resolve(".verify/folder-"));
  for (const folder of folders) await mkdir(path.join(root, folder));
  for (const file of files) await writeFile(path.join(root, file), "x");
  return root;
}

test("lists only recognised video files directly in the selected folder", async () => {
  const root = await fixture(
    [
      "b clip.MP4",
      "a café.mkv",
      "notes.txt",
      "nested/deep.mp4",
      "cover.jpg",
      "noextension",
    ],
    ["nested", "folder.mp4"],
  );
  const listing = await listFolder(root);
  expect(listing.status).toBe("videos");
  expect(listing.entries.map((entry) => entry.filename).sort()).toEqual([
    "a café.mkv",
    "b clip.MP4",
  ]);
  expect(listing.entries.map((entry) => entry.source).sort()).toEqual([
    path.join(root, "a café.mkv"),
    path.join(root, "b clip.MP4"),
  ]);
});

test("lists each source video's size and modification time for sorting and cache reuse", async () => {
  const root = await fixture(["clip.mp4"]);
  const modified = new Date(Date.UTC(2025, 5, 1, 8, 30));
  await utimes(path.join(root, "clip.mp4"), modified, modified);
  expect((await listFolder(root)).entries).toEqual([
    {
      filename: "clip.mp4",
      source: path.join(root, "clip.mp4"),
      size: 1,
      modified: modified.getTime(),
    },
  ]);
});

test("distinguishes an empty folder from one without recognised videos", async () => {
  expect(await listFolder(await fixture([]))).toMatchObject({
    status: "empty",
    entries: [],
  });
  expect(
    await listFolder(await fixture(["notes.txt"], ["holiday.mp4"])),
  ).toMatchObject({ status: "no-videos", entries: [] });
});

test("reports why a selected folder cannot be listed", async () => {
  const root = await fixture(["clip.mp4"], ["locked"]);
  const locked = path.join(root, "locked");
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  execFileSync("icacls.exe", [locked, "/deny", `${user}:(RD)`]);
  try {
    expect(await listFolder(locked)).toMatchObject({
      status: "access-denied",
      entries: [],
    });
  } finally {
    execFileSync("icacls.exe", [locked, "/remove:d", user]);
  }
  expect(await listFolder(path.join(root, "missing"))).toMatchObject({
    status: "not-found",
  });
  expect(await listFolder(path.join(root, "clip.mp4"))).toMatchObject({
    status: "not-a-folder",
  });
  expect(await listFolder("relative\\videos")).toMatchObject({
    status: "invalid-path",
  });
  for (const share of ["\\\\server\\videos", "\\\\?\\UNC\\server\\videos"])
    expect(await listFolder(share)).toMatchObject({ status: "network" });
});
