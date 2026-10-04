// Keeps generated thumbnails in the data folder (see storage.ts), so an
// unchanged source video is not extracted again on a later visit or launch.
// The storage is bounded: the least recently used thumbnails are evicted.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { replaceFile } from "./replace";

/** What identifies a source video's content for reuse: its path, size and modification time. */
export interface SourceIdentity {
  source: string;
  size: number;
  /** Milliseconds since the epoch. */
  modified: number;
}

export interface CachedThumbnail {
  /** The stored still. */
  still: string;
  duration?: number;
  reason?: string;
}

export interface ThumbnailCache {
  /** The stored thumbnail of exactly this identity and recipe, if there is one. Finding it makes it the most recently used. */
  lookup(identity: SourceIdentity): Promise<CachedThumbnail | undefined>;
  /**
   * Stores a generated thumbnail, evicting the least recently used others
   * as needed, and resolves with its still. Rejects without storing anything
   * once `signal` is aborted.
   */
  store(
    identity: SourceIdentity,
    thumbnail: { image: Buffer; duration?: number; reason?: string },
    signal?: AbortSignal,
  ): Promise<string>;
  /** Evicts the least recently used thumbnails not in use, as needed, e.g. once others are no longer shown. */
  trim(): Promise<void>;
  /** Removes every stored thumbnail, including any being stored meanwhile. */
  clear(): Promise<void>;
}

export interface CacheOptions {
  /** The most bytes stored thumbnails may occupy. */
  limit?: number;
  /** Stills currently shown, which eviction leaves in place. */
  inUse?: () => Iterable<string>;
}

/** 1 GB, as Windows counts it. */
export const defaultLimit = 1024 ** 3;

/** Changes whenever the stored layout changes; older entries are then ignored. */
const format = 1;

interface StoredRecord {
  format: number;
  recipe: string;
  source: string;
  size: number;
  modified: number;
  duration?: number;
  reason?: string;
}

/** A stored thumbnail's files, by the name they share. */
interface Stored {
  bytes: number;
  /** When it was last stored or found, in milliseconds since the epoch. */
  used: number;
}

// Windows paths are case-insensitive.
function sourceKey(source: string): string {
  return path.resolve(source).toLowerCase();
}

/**
 * Opens the cache in `folder`, which holds nothing else. `recipe` describes
 * how thumbnails are generated; thumbnails stored under another recipe or
 * format are never reused. One cache at a time should use a folder.
 */
export function openCache(
  folder: string,
  recipe: string,
  { limit = defaultLimit, inUse = () => [] }: CacheOptions = {},
): ThumbnailCache {
  const files = (identity: SourceIdentity) => {
    const name = createHash("sha256")
      .update(
        JSON.stringify([
          format,
          recipe,
          sourceKey(identity.source),
          identity.size,
          identity.modified,
        ]),
      )
      .digest("hex");
    return {
      name,
      still: path.join(folder, `${name}.png`),
      record: path.join(folder, `${name}.json`),
    };
  };

  // Stored thumbnails by name, loaded from the folder when first needed.
  // Records' modification times keep recency between sessions.
  let index: Map<string, Stored> | undefined;
  async function load(): Promise<Map<string, Stored>> {
    if (index) return index;
    const loaded = new Map<string, Stored>();
    for (const file of await readdir(folder).catch(() => [])) {
      const location = path.join(folder, file);
      // No store is under way, so a temporary file was left by an interrupted one.
      if (file.endsWith(".tmp")) {
        await rm(location, { force: true }).catch(() => undefined);
        continue;
      }
      const info = await stat(location).catch(() => undefined);
      if (!info?.isFile()) continue;
      const name = path.parse(file).name;
      const stored = loaded.get(name) ?? { bytes: 0, used: 0 };
      stored.bytes += info.size;
      if (file === `${name}.json` || !stored.used) stored.used = info.mtimeMs;
      loaded.set(name, stored);
    }
    index = loaded;
    return loaded;
  }

  // Strictly increasing, so recency has no ties within a session.
  let last = 0;
  const now = () => (last = Math.max(Date.now(), last + 1));
  const touch = async (record: string, stored: Stored) => {
    stored.used = now();
    const time = new Date(stored.used);
    await utimes(record, time, time).catch(() => undefined);
  };

  // Lookups, stores and clearing run one at a time, so clearing cannot miss
  // a thumbnail being stored and eviction cannot remove one being found.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }

  // Removes the least recently used thumbnails, except `kept` and those in
  // use, until the stored bytes are within the limit.
  async function evict(stored: Map<string, Stored>, kept?: string) {
    let total = 0;
    for (const { bytes } of stored.values()) total += bytes;
    if (total <= limit) return;
    const shown = new Set(
      [...inUse()].map((still) => path.basename(still, ".png")),
    );
    const candidates = [...stored]
      .filter(([name]) => name !== kept && !shown.has(name))
      .sort(([, a], [, b]) => a.used - b.used);
    for (const [name, { bytes }] of candidates) {
      if (total <= limit) return;
      try {
        // The record first, so a still left behind is never found.
        for (const extension of [".json", ".png"])
          await rm(path.join(folder, `${name}${extension}`), { force: true });
      } catch {
        // Counted until a later store can remove it.
        continue;
      }
      stored.delete(name);
      total -= bytes;
    }
  }

  return {
    lookup: (identity) =>
      exclusive(async () => {
        const { name, still, record } = files(identity);
        let saved: Partial<StoredRecord>;
        try {
          saved = JSON.parse(
            await readFile(record, "utf8"),
          ) as Partial<StoredRecord>;
          if (!(await stat(still)).isFile()) return undefined;
        } catch {
          return undefined;
        }
        // The record, not only its name, must describe this identity and recipe.
        if (
          saved.format !== format ||
          saved.recipe !== recipe ||
          typeof saved.source !== "string" ||
          sourceKey(saved.source) !== sourceKey(identity.source) ||
          saved.size !== identity.size ||
          saved.modified !== identity.modified
        )
          return undefined;
        const stored = (await load()).get(name);
        if (stored) await touch(record, stored);
        return {
          still,
          ...(typeof saved.duration === "number"
            ? { duration: saved.duration }
            : {}),
          ...(typeof saved.reason === "string" ? { reason: saved.reason } : {}),
        };
      }),
    store: (identity, { image, duration, reason }, signal) =>
      exclusive(async () => {
        signal?.throwIfAborted();
        const { name, still, record } = files(identity);
        const saved: StoredRecord = {
          format,
          recipe,
          source: identity.source,
          size: identity.size,
          modified: identity.modified,
          duration,
          reason,
        };
        const text = JSON.stringify(saved);
        const stored = await load();
        await mkdir(folder, { recursive: true });
        // Each file is replaced whole, and the record is written last, so an
        // interrupted store is never found.
        await replaceFile(still, image);
        await replaceFile(record, text);
        const entry = {
          bytes: image.length + Buffer.byteLength(text),
          used: 0,
        };
        stored.set(name, entry);
        await touch(record, entry);
        await evict(stored, name);
        return still;
      }),
    trim: () => exclusive(async () => evict(await load())),
    clear: () =>
      exclusive(async () => {
        // Reloaded from what remains if something cannot be removed.
        index = undefined;
        await rm(folder, { recursive: true, force: true, maxRetries: 3 });
        index = new Map();
      }),
  };
}
