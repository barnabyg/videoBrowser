// Matches a refreshed listing of the selected folder to the entries already
// shown, so unchanged source videos keep their entries and results.
import type { FolderChanges } from "./contract";
import type { ListedVideo } from "./folder";

export interface KnownEntry extends ListedVideo {
  id: string;
  /** Its thumbnail could not be generated; Refresh tries it again. */
  failed: boolean;
}

/**
 * Returns the listing in its order, each with an id: the known entry's id when
 * its source video is unchanged and its thumbnail did not fail, otherwise a new
 * one from `newId`, so no earlier result can attach to a changed source video.
 */
export function reconcile<T extends ListedVideo>(
  known: readonly KnownEntry[],
  listing: readonly T[],
  newId: () => string,
): { entries: (T & { id: string })[]; changes: FolderChanges } {
  const previous = new Map(known.map((entry) => [entry.source, entry]));
  const changes: FolderChanges = { added: 0, removed: 0, changed: 0 };
  const entries = listing.map((video) => {
    const entry = previous.get(video.source);
    previous.delete(video.source);
    if (!entry) changes.added++;
    else if (entry.size !== video.size || entry.modified !== video.modified)
      changes.changed++;
    else if (!entry.failed) return { ...video, id: entry.id };
    return { ...video, id: newId() };
  });
  changes.removed = previous.size;
  return { entries, changes };
}
