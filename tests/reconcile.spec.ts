// Focused checks of matching a refreshed listing to the entries already shown;
// tests/cache.spec.ts covers Refresh in the app.
import { test, expect } from "@playwright/test";
import { reconcile, type KnownEntry } from "../src/reconcile";

const video = (filename: string, size = 100, modified = 1) => ({
  filename,
  source: `D:\\Videos\\${filename}`,
  size,
  modified,
});

const known = (
  id: string,
  filename: string,
  failed = false,
  size = 100,
  modified = 1,
): KnownEntry => ({ id, ...video(filename, size, modified), failed });

function ids() {
  let next = 0;
  return () => `new${++next}`;
}

test("unchanged source videos keep their entries; added ones get new entries", () => {
  const result = reconcile(
    [known("a", "a.mp4"), known("b", "b.mp4")],
    [video("a.mp4"), video("b.mp4"), video("c.mp4")],
    ids(),
  );
  expect(result.entries.map((entry) => [entry.filename, entry.id])).toEqual([
    ["a.mp4", "a"],
    ["b.mp4", "b"],
    ["c.mp4", "new1"],
  ]);
  expect(result.changes).toEqual({ added: 1, removed: 0, changed: 0 });
});

test("removed source videos are counted and their entries dropped", () => {
  const result = reconcile(
    [known("a", "a.mp4"), known("b", "b.mp4")],
    [video("b.mp4")],
    ids(),
  );
  expect(result.entries.map((entry) => entry.id)).toEqual(["b"]);
  expect(result.changes).toEqual({ added: 0, removed: 1, changed: 0 });
});

test("a changed size or modification time replaces the entry", () => {
  const result = reconcile(
    [known("a", "a.mp4"), known("b", "b.mp4")],
    [video("a.mp4", 101), video("b.mp4", 100, 2)],
    ids(),
  );
  expect(result.entries.map((entry) => entry.id)).toEqual(["new1", "new2"]);
  expect(result.entries[0]).toMatchObject({ size: 101, modified: 1 });
  expect(result.changes).toEqual({ added: 0, removed: 0, changed: 2 });
});

test("an unchanged entry whose thumbnail failed is replaced so it is tried again", () => {
  const result = reconcile(
    [known("a", "a.mp4", true)],
    [video("a.mp4")],
    ids(),
  );
  expect(result.entries.map((entry) => entry.id)).toEqual(["new1"]);
  expect(result.changes).toEqual({ added: 0, removed: 0, changed: 0 });
});
