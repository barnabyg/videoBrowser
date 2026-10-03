// Remembers browsing choices between sessions in a per-user JSON file, kept
// apart from the application folder and the selected folders.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Preferences, SortOrder } from "./contract";
import { replaceFile } from "./replace";

export const initialPreferences: Preferences = {
  size: 320,
  sort: { field: "name", direction: "ascending" },
};

export interface PreferenceStore {
  current(): Preferences;
  /** Applies the change now and saves it in the background. */
  update(change: Partial<Preferences>): void;
  /** Resolves once every earlier change has been saved or has failed to save. */
  saved(): Promise<void>;
}

/** The thumbnail widths the size control offers. */
export function validSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 160 &&
    value <= 640 &&
    value % 40 === 0
  );
}

export function validSort(value: unknown): value is SortOrder {
  const sort = value as Partial<SortOrder> | null;
  return (
    typeof sort === "object" &&
    sort !== null &&
    (sort.field === "name" || sort.field === "modified") &&
    (sort.direction === "ascending" || sort.direction === "descending")
  );
}

// Keeps each saved value that is still valid; a damaged or missing file means
// a fresh profile rather than a startup failure.
function parse(text: string): Preferences {
  let saved: Partial<Record<keyof Preferences, unknown>> = {};
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null) saved = value;
  } catch {
    // Treated as no saved preferences.
  }
  return {
    ...(typeof saved.folder === "string" && saved.folder
      ? { folder: saved.folder }
      : {}),
    size: validSize(saved.size) ? saved.size : initialPreferences.size,
    sort: validSort(saved.sort)
      ? { field: saved.sort.field, direction: saved.sort.direction }
      : initialPreferences.sort,
  };
}

export async function openPreferences(file: string): Promise<PreferenceStore> {
  let preferences = parse(await readFile(file, "utf8").catch(() => ""));
  let writes = Promise.resolve();
  return {
    current: () => preferences,
    update(change) {
      preferences = { ...preferences, ...change };
      const text = JSON.stringify(preferences, null, 2);
      // One write at a time, each replacing the file whole.
      writes = writes.then(async () => {
        try {
          await mkdir(path.dirname(file), { recursive: true });
          await replaceFile(file, text);
        } catch {
          // Preferences still apply for this session.
        }
      });
    },
    saved: () => writes,
  };
}
