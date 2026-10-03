// Focused checks of the thumbnail cache; tests/cache.spec.ts covers its use.
import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { openCache, type SourceIdentity } from "../src/cache";

async function folder() {
  return path.join(await mkdtemp(path.resolve(".verify/cache-store-")), "c");
}

const identity: SourceIdentity = {
  source: "D:\\Videos\\clip.mp4",
  size: 1234,
  modified: Date.UTC(2026, 0, 1),
};
const image = Buffer.from("not really a png");

test("a stored thumbnail is found again after reopening the cache", async () => {
  const location = await folder();
  await openCache(location, "recipe 1").store(identity, {
    image,
    duration: 65,
    reason: "Only dark frames were found.",
  });
  const found = await openCache(location, "recipe 1").lookup(identity);
  expect(found).toMatchObject({
    duration: 65,
    reason: "Only dark frames were found.",
  });
  expect(await readFile(found?.still ?? "")).toEqual(image);
});

test("a different path, size or modification time is a different source video", async () => {
  const cache = openCache(await folder(), "recipe 1");
  await cache.store(identity, { image });
  for (const changed of [
    { ...identity, source: "D:\\Videos\\renamed.mp4" },
    { ...identity, size: 1235 },
    { ...identity, modified: identity.modified + 1 },
  ])
    expect(await cache.lookup(changed)).toBeUndefined();
  // Windows paths differ only in case for the same file.
  expect(
    await cache.lookup({ ...identity, source: "d:\\videos\\CLIP.mp4" }),
  ).toBeDefined();
});

test("thumbnails from another recipe or a damaged record are not reused", async () => {
  const location = await folder();
  const stored = openCache(location, "recipe 1");
  const still = await stored.store(identity, { image });
  expect(
    await openCache(location, "recipe 2").lookup(identity),
  ).toBeUndefined();
  await writeFile(still.replace(/\.png$/, ".json"), "{ damaged");
  expect(await stored.lookup(identity)).toBeUndefined();
});

test("a record whose still is missing is not reused", async () => {
  const cache = openCache(await folder(), "recipe 1");
  await rm(await cache.store(identity, { image }));
  expect(await cache.lookup(identity)).toBeUndefined();
});
