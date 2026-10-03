// Lists the source videos directly contained in a selected folder. Listing depends
// only on the filename extension; decoding and playback are separate capabilities.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceIdentity } from "./cache";
import type { FolderStatus } from "./contract";

export const videoExtensions = new Set([
  ".mp4",
  ".m4v",
  ".mkv",
  ".webm",
  ".mov",
  ".avi",
  ".wmv",
  ".mpg",
  ".mpeg",
  ".ts",
  ".mts",
  ".m2ts",
  ".3gp",
  ".h264",
]);

/** Size and modification time are 0 when they cannot be read. */
export interface ListedVideo extends SourceIdentity {
  filename: string;
}

export interface FolderListing {
  status: FolderStatus;
  entries: ListedVideo[];
}

// UNC paths (\\server\share, \\?\UNC\server\share) are network shares; device
// paths to a drive letter (\\?\C:\, \\.\C:\) are local.
function isNetworkPath(folder: string): boolean {
  return /^[\\/]{2}/.test(folder) && !/^[\\/]{2}[?.][\\/][a-z]:/i.test(folder);
}

const failures: Record<string, FolderStatus> = {
  ENOENT: "not-found",
  ENOTDIR: "not-a-folder",
  EACCES: "access-denied",
  EPERM: "access-denied",
};

export async function listFolder(folder: string): Promise<FolderListing> {
  if (!path.isAbsolute(folder)) return { status: "invalid-path", entries: [] };
  if (isNetworkPath(folder)) return { status: "network", entries: [] };
  let files;
  try {
    files = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    return { status: failures[code] ?? "unreadable", entries: [] };
  }
  if (!files.length) return { status: "empty", entries: [] };
  const entries = await Promise.all(
    files
      .filter(
        (file) =>
          file.isFile() &&
          videoExtensions.has(path.extname(file.name).toLowerCase()),
      )
      .map(async (file) => {
        const source = path.join(folder, file.name);
        // A source whose details cannot be read stays listed and launchable.
        const { size, modified } = await stat(source).then(
          (info) => ({ size: info.size, modified: info.mtimeMs }),
          () => ({ size: 0, modified: 0 }),
        );
        return { filename: file.name, source, size, modified };
      }),
  );
  return { status: entries.length ? "videos" : "no-videos", entries };
}
