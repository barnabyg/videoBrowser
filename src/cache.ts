// Keeps generated thumbnails in application-managed per-user storage, so an
// unchanged source video is not extracted again on a later visit or launch.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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
  /** The stored thumbnail of exactly this identity and recipe, if there is one. */
  lookup(identity: SourceIdentity): Promise<CachedThumbnail | undefined>;
  /** Stores a generated thumbnail and resolves with its still. */
  store(
    identity: SourceIdentity,
    thumbnail: { image: Buffer; duration?: number; reason?: string },
  ): Promise<string>;
}

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

// Windows paths are case-insensitive.
function sourceKey(source: string): string {
  return path.resolve(source).toLowerCase();
}

/**
 * Opens the cache in `folder`. `recipe` describes how thumbnails are
 * generated; thumbnails stored under another recipe or format are never reused.
 */
export function openCache(folder: string, recipe: string): ThumbnailCache {
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
      still: path.join(folder, `${name}.png`),
      record: path.join(folder, `${name}.json`),
    };
  };
  return {
    async lookup(identity) {
      const { still, record } = files(identity);
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
      return {
        still,
        ...(typeof saved.duration === "number"
          ? { duration: saved.duration }
          : {}),
        ...(typeof saved.reason === "string" ? { reason: saved.reason } : {}),
      };
    },
    async store(identity, { image, duration, reason }) {
      const { still, record } = files(identity);
      const saved: StoredRecord = {
        format,
        recipe,
        source: identity.source,
        size: identity.size,
        modified: identity.modified,
        duration,
        reason,
      };
      await mkdir(folder, { recursive: true });
      // Each file is replaced whole, and the record is written last, so an
      // interrupted store is never found.
      const replace = async (file: string, data: string | Buffer) => {
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, data);
        await rename(temporary, file);
      };
      await replace(still, image);
      await replace(record, JSON.stringify(saved));
      return still;
    },
  };
}
