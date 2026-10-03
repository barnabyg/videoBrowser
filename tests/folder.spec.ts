import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  expect(listing.kind).toBe("videos");
  expect(listing.entries.map((entry) => entry.filename).sort()).toEqual([
    "a café.mkv",
    "b clip.MP4",
  ]);
  expect(listing.entries.map((entry) => entry.source).sort()).toEqual([
    path.join(root, "a café.mkv"),
    path.join(root, "b clip.MP4"),
  ]);
});

test("distinguishes an empty folder from one without recognised videos", async () => {
  expect(await listFolder(await fixture([]))).toMatchObject({
    kind: "empty",
    entries: [],
  });
  expect(
    await listFolder(await fixture(["notes.txt"], ["holiday.mp4"])),
  ).toMatchObject({ kind: "no-videos", entries: [] });
});

test("reports why a selected folder cannot be listed", async () => {
  const root = await fixture(["clip.mp4"], ["locked"]);
  const locked = path.join(root, "locked");
  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  execFileSync("icacls.exe", [locked, "/deny", `${user}:(RD)`]);
  try {
    expect(await listFolder(locked)).toMatchObject({
      kind: "access-denied",
      entries: [],
    });
  } finally {
    execFileSync("icacls.exe", [locked, "/remove:d", user]);
  }
  expect(await listFolder(path.join(root, "missing"))).toMatchObject({
    kind: "not-found",
  });
  expect(await listFolder(path.join(root, "clip.mp4"))).toMatchObject({
    kind: "not-a-folder",
  });
  expect(await listFolder("relative\\videos")).toMatchObject({
    kind: "invalid-path",
  });
  for (const share of ["\\\\server\\videos", "\\\\?\\UNC\\server\\videos"])
    expect(await listFolder(share)).toMatchObject({ kind: "network" });
});
