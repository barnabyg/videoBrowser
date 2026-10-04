// Focused checks of where application data is kept and whether it can be saved;
// tests/package.spec.ts and tests/read-only.spec.ts cover the running app.
import { test, expect } from "@playwright/test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkWritable, dataFolder } from "../src/storage";

test("a packaged app keeps its data in a data folder beside its executable", () => {
  expect(
    dataFolder({
      packaged: true,
      executable: "D:\\Apps\\VideoBrowser-win32-x64\\VideoBrowser.exe",
      appPath: "D:\\Apps\\VideoBrowser-win32-x64\\resources\\app",
    }),
  ).toBe("D:\\Apps\\VideoBrowser-win32-x64\\data");
});

test("a development run keeps its data in the checkout's ignored .state folder", () => {
  expect(
    dataFolder({
      packaged: false,
      executable: "C:\\repo\\node_modules\\electron\\dist\\electron.exe",
      appPath: "C:\\repo",
    }),
  ).toBe("C:\\repo\\.state");
});

test("an override takes precedence and is resolved to a full path", () => {
  expect(
    dataFolder({
      override: "D:\\Temp\\state",
      packaged: true,
      executable: "D:\\Apps\\VideoBrowser.exe",
      appPath: "D:\\Apps\\resources\\app",
    }),
  ).toBe("D:\\Temp\\state");
  expect(
    dataFolder({
      override: "state",
      packaged: false,
      executable: "C:\\electron.exe",
      appPath: "C:\\repo",
    }),
  ).toBe(path.resolve("state"));
});

test("a new data folder is created and found writable, leaving nothing else in it", async () => {
  const root = await mkdtemp(path.resolve(".verify/storage-"));
  const folder = path.join(root, "data");
  expect(await checkWritable(folder)).toBe(true);
  expect(await readdir(folder)).toEqual([]);
});

test("a data folder that cannot be created is not writable", async () => {
  const root = await mkdtemp(path.resolve(".verify/storage-"));
  const blocked = path.join(root, "data");
  await writeFile(blocked, "a file where the folder belongs");
  expect(await checkWritable(blocked)).toBe(false);
});
