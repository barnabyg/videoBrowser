// Locates the application's data folder: preferences, stored thumbnails and
// the runtime's own session data. A packaged app keeps it beside its
// executable, so the extracted folder is self-contained and portable.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface DataLocation {
  /** A folder chosen by the environment, e.g. by tests; takes precedence. */
  override?: string;
  packaged: boolean;
  /** The running executable, VideoBrowser.exe once packaged. */
  executable: string;
  /** The application's own folder: the checkout in development. */
  appPath: string;
}

/**
 * The data folder: `data` beside the packaged executable, or the checkout's
 * git-ignored `.state` in development. Never the current working directory,
 * so a shortcut or another starting folder finds the same data.
 */
export function dataFolder({
  override,
  packaged,
  executable,
  appPath,
}: DataLocation): string {
  if (override) return path.resolve(override);
  return packaged
    ? path.join(path.dirname(executable), "data")
    : path.join(appPath, ".state");
}

/**
 * Creates `folder` if needed and resolves whether files can be saved in it,
 * leaving nothing behind. An application folder may be read-only, e.g. under
 * Program Files or on a write-protected drive.
 */
export async function checkWritable(folder: string): Promise<boolean> {
  const probe = path.join(folder, `${randomUUID()}.tmp`);
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(probe, "");
  } catch {
    return false;
  }
  await rm(probe, { force: true }).catch(() => undefined);
  return true;
}
