// Focused checks of the thumbnail cache; tests/cache.spec.ts covers its use.
import { test, expect } from "@playwright/test";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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

// Stored files of a cache folder, without temporary ones.
async function files(location: string): Promise<string[]> {
  const names = await readdir(location).catch(() => []);
  return names.filter((name) => !name.endsWith(".tmp")).sort();
}

function clip(name: string): SourceIdentity {
  return { ...identity, source: `D:\\Videos\\${name}.mp4` };
}

// Each still is 1000 bytes and each record about 150, so two thumbnails fit
// in 2500 bytes and three do not.
const still = Buffer.alloc(1000, 1);
const limit = 2500;

test("the least recently used thumbnail is evicted to stay within the limit", async () => {
  const location = await folder();
  const cache = openCache(location, "recipe 1", { limit });
  const a = await cache.store(clip("a"), { image: still });
  await cache.store(clip("b"), { image: still });
  await cache.store(clip("c"), { image: still });
  expect(await cache.lookup(clip("a"))).toBeUndefined();
  expect(await cache.lookup(clip("b"))).toBeDefined();
  expect(await cache.lookup(clip("c"))).toBeDefined();
  expect(await files(location)).toHaveLength(4);
  await expect(stat(a)).rejects.toThrow();
});

test("a cache hit keeps a thumbnail ahead of older unused ones, also after reopening", async () => {
  const location = await folder();
  let cache = openCache(location, "recipe 1", { limit });
  await cache.store(clip("a"), { image: still });
  await cache.store(clip("b"), { image: still });
  expect(await cache.lookup(clip("a"))).toBeDefined();
  cache = openCache(location, "recipe 1", { limit });
  await cache.store(clip("c"), { image: still });
  expect(await cache.lookup(clip("b"))).toBeUndefined();
  expect(await cache.lookup(clip("a"))).toBeDefined();
  expect(await cache.lookup(clip("c"))).toBeDefined();
});

test("thumbnails in use are not evicted", async () => {
  const location = await folder();
  const inUse = new Set<string>();
  const cache = openCache(location, "recipe 1", {
    limit,
    inUse: () => inUse,
  });
  inUse.add(await cache.store(clip("a"), { image: still }));
  inUse.add(await cache.store(clip("b"), { image: still }));
  await cache.store(clip("c"), { image: still });
  for (const name of ["a", "b", "c"])
    expect(await cache.lookup(clip(name))).toBeDefined();
  // Once no longer in use, the oldest are evicted by the next store.
  inUse.clear();
  await cache.store(clip("d"), { image: still });
  expect(await files(location)).toHaveLength(4);
  expect(await cache.lookup(clip("d"))).toBeDefined();
});

test("clearing removes every stored thumbnail, also one being stored meanwhile", async () => {
  const location = await folder();
  const cache = openCache(location, "recipe 1");
  await cache.store(clip("a"), { image: still });
  const storing = cache.store(clip("b"), { image: still });
  await cache.clear();
  await storing;
  expect(await files(location)).toEqual([]);
  expect(await cache.lookup(clip("a"))).toBeUndefined();
  expect(await cache.lookup(clip("b"))).toBeUndefined();
  // The cache is usable again afterwards.
  await cache.store(clip("c"), { image: still });
  expect(await cache.lookup(clip("c"))).toBeDefined();
});

test("a store whose work was aborted, e.g. by clearing, writes nothing", async () => {
  const location = await folder();
  const cache = openCache(location, "recipe 1");
  const work = new AbortController();
  work.abort();
  await expect(
    cache.store(clip("a"), { image: still }, work.signal),
  ).rejects.toThrow();
  expect(await files(location)).toEqual([]);
});

test("trimming evicts thumbnails no longer in use without storing another", async () => {
  const location = await folder();
  const inUse = new Set<string>();
  const cache = openCache(location, "recipe 1", {
    limit,
    inUse: () => inUse,
  });
  for (const name of ["a", "b", "c"])
    inUse.add(await cache.store(clip(name), { image: still }));
  expect(await files(location)).toHaveLength(6);
  inUse.clear();
  await cache.trim();
  expect(await files(location)).toHaveLength(4);
  expect(await cache.lookup(clip("a"))).toBeUndefined();
});
