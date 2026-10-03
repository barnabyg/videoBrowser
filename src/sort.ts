// Orders a selected folder's source videos for the grid.
import type { SortOrder } from "./contract";

export interface Sortable {
  filename: string;
  /** Modification time in milliseconds since the epoch. */
  modified: number;
}

// Natural order: video2 before video10, ignoring case and accents.
const natural = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
}).compare;

// Filenames in natural order, with names that compare equal (video1 and
// video01, cafe and café) in code-unit order so the result is deterministic.
function byName(a: Sortable, b: Sortable): number {
  const order = natural(a.filename, b.filename);
  if (order) return order;
  return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0;
}

/**
 * Returns a sorted copy. Filename order reverses entirely when descending;
 * entries with equal modification times stay in ascending filename order in
 * both directions.
 */
export function sortEntries<T extends Sortable>(
  entries: readonly T[],
  { field, direction }: SortOrder,
): T[] {
  const sign = direction === "ascending" ? 1 : -1;
  const compare =
    field === "name"
      ? (a: T, b: T) => sign * byName(a, b)
      : (a: T, b: T) => sign * (a.modified - b.modified) || byName(a, b);
  return [...entries].sort(compare);
}
