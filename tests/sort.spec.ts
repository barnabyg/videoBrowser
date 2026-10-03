// Focused checks of source-video ordering; tests/preferences.spec.ts covers its use.
import { test, expect } from "@playwright/test";
import { sortEntries, type Sortable } from "../src/sort";

const names = (entries: Sortable[]) => entries.map((entry) => entry.filename);

test("filename order is natural, so video2 comes before video10", () => {
  const entries = [
    "video10.mp4",
    "video2.mp4",
    "Video1.mp4",
    "video20.mp4",
  ].map((filename) => ({ filename, modified: 0 }));
  expect(
    names(sortEntries(entries, { field: "name", direction: "ascending" })),
  ).toEqual(["Video1.mp4", "video2.mp4", "video10.mp4", "video20.mp4"]);
  expect(
    names(sortEntries(entries, { field: "name", direction: "descending" })),
  ).toEqual(["video20.mp4", "video10.mp4", "video2.mp4", "Video1.mp4"]);
});

test("modification-date order runs both ways, breaking ties by filename", () => {
  const entries = [
    { filename: "b.mp4", modified: 2_000 },
    { filename: "c.mp4", modified: 1_000 },
    { filename: "a10.mp4", modified: 2_000 },
    { filename: "a9.mp4", modified: 2_000 },
    { filename: "d.mp4", modified: 3_000 },
  ];
  expect(
    names(sortEntries(entries, { field: "modified", direction: "ascending" })),
  ).toEqual(["c.mp4", "a9.mp4", "a10.mp4", "b.mp4", "d.mp4"]);
  // Equal dates stay in filename order rather than reversing.
  expect(
    names(sortEntries(entries, { field: "modified", direction: "descending" })),
  ).toEqual(["d.mp4", "a9.mp4", "a10.mp4", "b.mp4", "c.mp4"]);
});

test("equivalent keys order the same way whatever the input order", () => {
  // Natural comparison treats these pairs as equal.
  const filenames = ["video1.mp4", "video01.mp4", "cafe.mp4", "café.mp4"];
  const expected = {
    ascending: ["cafe.mp4", "café.mp4", "video01.mp4", "video1.mp4"],
    descending: ["video1.mp4", "video01.mp4", "café.mp4", "cafe.mp4"],
  };
  for (const input of [filenames, [...filenames].reverse()]) {
    const entries = input.map((filename) => ({ filename, modified: 5 }));
    for (const direction of ["ascending", "descending"] as const) {
      expect(names(sortEntries(entries, { field: "name", direction }))).toEqual(
        expected[direction],
      );
      // Equal dates fall back to the same filename order in both directions.
      expect(
        names(sortEntries(entries, { field: "modified", direction })),
      ).toEqual(expected.ascending);
    }
  }
});

test("sorting leaves the given entries in place", () => {
  const entries = [
    { filename: "b.mp4", modified: 0 },
    { filename: "a.mp4", modified: 0 },
  ];
  sortEntries(entries, { field: "name", direction: "ascending" });
  expect(names(entries)).toEqual(["b.mp4", "a.mp4"]);
});
