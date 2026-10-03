// Focused checks of preference storage; tests/preferences.spec.ts covers restarts.
import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { initialPreferences, openPreferences } from "../src/preferences";

async function file() {
  return path.join(
    await mkdtemp(path.resolve(".verify/preferences-store-")),
    "preferences.json",
  );
}

test("a fresh profile starts with 320 pixels, filename ascending and no folder", async () => {
  const store = await openPreferences(await file());
  expect(store.current()).toEqual({
    size: 320,
    sort: { field: "name", direction: "ascending" },
  });
  expect(store.current()).toEqual(initialPreferences);
});

test("changes are saved and reopened", async () => {
  const location = await file();
  const store = await openPreferences(location);
  store.update({ folder: "D:\\Videos" });
  store.update({ size: 480 });
  store.update({ sort: { field: "modified", direction: "descending" } });
  await store.saved();
  const expected = {
    folder: "D:\\Videos",
    size: 480,
    sort: { field: "modified", direction: "descending" },
  };
  expect(JSON.parse(await readFile(location, "utf8"))).toEqual(expected);
  expect((await openPreferences(location)).current()).toEqual(expected);
});

test("unreadable or invalid values fall back to the initial ones individually", async () => {
  const location = await file();
  await writeFile(location, "{ not json");
  expect((await openPreferences(location)).current()).toEqual(
    initialPreferences,
  );
  await writeFile(
    location,
    JSON.stringify({
      folder: 7,
      size: 999,
      sort: { field: "modified", direction: "sideways" },
    }),
  );
  expect((await openPreferences(location)).current()).toEqual(
    initialPreferences,
  );
  await writeFile(
    location,
    JSON.stringify({ folder: "E:\\Clips", size: 200, sort: "name" }),
  );
  expect((await openPreferences(location)).current()).toEqual({
    ...initialPreferences,
    folder: "E:\\Clips",
    size: 200,
  });
});

test("a failed save keeps the preferences for the rest of the session", async () => {
  // The parent of this location is a file, so it cannot be written.
  const parent = await file();
  await writeFile(parent, "");
  const store = await openPreferences(path.join(parent, "preferences.json"));
  store.update({ size: 560 });
  await store.saved();
  expect(store.current().size).toBe(560);
});

// Opens `location` from another process without delete sharing, as a virus
// scanner or indexer may briefly do, and resolves once it is held.
function holdOpen(location: string, ms: number): Promise<void> {
  const holder = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$f = [IO.File]::Open('${location}', 'Open', 'Read', 'Read'); 'held'; Start-Sleep -Milliseconds ${ms}; $f.Close()`,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  return new Promise((resolve, reject) => {
    holder.stdout.once("data", () => resolve());
    holder.once("error", reject);
  });
}

test("a preferences change made while another program briefly holds the file is still saved", async () => {
  const location = await file();
  const store = await openPreferences(location);
  store.update({ sort: { field: "modified", direction: "ascending" } });
  await store.saved();
  await holdOpen(location, 500);
  store.update({ sort: { field: "modified", direction: "descending" } });
  await store.saved();
  expect(JSON.parse(await readFile(location, "utf8"))).toMatchObject({
    sort: { field: "modified", direction: "descending" },
  });
});
