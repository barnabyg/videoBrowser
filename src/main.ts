import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { checkAssociation } from "./association";
import { defaultLimit, openCache, type ThumbnailCache } from "./cache";
import { listFolder, videoExtensions } from "./folder";
import {
  openPreferences,
  validSize,
  validSort,
  type PreferenceStore,
} from "./preferences";
import { reconcile, type KnownEntry } from "./reconcile";
import { sortEntries } from "./sort";
import { startQueue, type ThumbnailQueue } from "./queue";
import {
  bundledTools,
  extractPreview,
  processesStopped,
  recipe,
  type Tools,
} from "./thumbnail";
import type { FolderResult, FolderStatus, ThumbnailResult } from "./contract";

let window: BrowserWindow;
let work = new AbortController();
// The folder last opened, which Refresh lists again.
let selectedFolder: string | undefined;
// The selected folder's entries by id, in the order they were first queued.
let entries = new Map<string, KnownEntry>();
// Entries whose result has been sent to the renderer.
let settled = new Set<string>();
let preferences: PreferenceStore;
// Folders remembered for the next session: those that could be listed.
const listable = new Set<FolderStatus>(["videos", "empty", "no-videos"]);
// Stored stills of the selected folder's entries, served as thumbnail://<id>.
let stills = new Map<string, string>();
let queue: ThumbnailQueue | undefined;
let priorities: readonly string[] = [];
/** Extraction jobs running at once; each uses one decoder thread. */
const concurrency = 2;
// A separate test entry point uses this exported app boundary to select a disposable extension.
export function addFixtureExtension(extension: string): void {
  videoExtensions.add(extension);
}
let tools: Tools = bundledTools(
  app.isPackaged
    ? path.join(process.resourcesPath, "tools")
    : path.resolve(".tools/ffmpeg/bin"),
);
let generation = recipe;
let cacheLimit = defaultLimit;
// One cache serves every listing, so clearing it also covers earlier work.
let cache: ThumbnailCache | undefined;
function thumbnailCache(): ThumbnailCache {
  cache ??= openCache(
    path.join(app.getPath("userData"), "thumbnails"),
    generation,
    // The selected folder's stills stay while they can be shown.
    { limit: cacheLimit, inUse: () => stills.values() },
  );
  return cache;
}
/** Test boundary: stands in for a release that generates thumbnails differently. */
export function useFixtureRecipe(value: string): void {
  generation = value;
  cache = undefined;
}
/** Test boundary: a smaller storage limit, in bytes, makes eviction observable. */
export function useFixtureCacheLimit(bytes: number): void {
  cacheLimit = bytes;
  cache = undefined;
}
/** Test boundary: substitutes a controlled probe process, e.g. one that stalls. */
export function useFixtureProbe(command: string, args: string[]): void {
  tools = { ...tools, probe: { command, args } };
}
const state = process.env.VIDEO_BROWSER_STATE;
app.setPath(
  "userData",
  path.resolve(
    state ??
      path.join(
        process.env.LOCALAPPDATA ?? app.getPath("appData"),
        "video-browser",
      ),
  ),
);

async function openFolder(folder: unknown): Promise<FolderResult> {
  work.abort();
  selectedFolder = undefined;
  entries = new Map();
  settled = new Set();
  stills = new Map();
  queue = undefined;
  priorities = [];
  // The previous folder's stills may have kept storage over its limit.
  void thumbnailCache()
    .trim()
    .catch(() => undefined);
  if (typeof folder !== "string")
    return { folder: "", status: "invalid-path", entries: [] };
  selectedFolder = folder;
  return list(folder, []);
}

// Lists the selected folder again, keeping the entries of unchanged source videos.
function refresh(): Promise<FolderResult> {
  if (selectedFolder === undefined)
    return Promise.resolve({ folder: "", status: "invalid-path", entries: [] });
  return list(selectedFolder, [...entries.values()], true);
}

// Lists `folder`, matching it to the `known` entries, and queues extraction for
// entries without a result. Earlier work is stopped first, so no result of an
// earlier listing reaches the new one.
async function list(
  folder: string,
  known: KnownEntry[],
  refreshing = false,
): Promise<FolderResult> {
  work.abort();
  work = new AbortController();
  queue = undefined;
  const signal = work.signal;
  const listing = await listFolder(folder);
  if (signal.aborted) return { folder, status: listing.status, entries: [] };
  if (listable.has(listing.status)) preferences.update({ folder });
  // Sources are queued for extraction in the order they are shown.
  const { entries: listed, changes } = reconcile(
    known,
    sortEntries(listing.entries, preferences.current().sort),
    randomUUID,
  );
  entries = new Map(
    listed.map((entry) => [entry.id, { ...entry, failed: false }]),
  );
  for (const id of settled) if (!entries.has(id)) settled.delete(id);
  for (const id of stills.keys()) if (!entries.has(id)) stills.delete(id);
  extract(
    listed.filter((entry) => !settled.has(entry.id)),
    signal,
  );
  return {
    folder,
    status: listing.status,
    entries: listed.map(({ id, filename }) => ({ id, filename })),
    ...(refreshing ? { changes } : {}),
  };
}

// Queues extraction for these entries once the current IPC response is sent,
// allowing the renderer to display filenames, or reset its results, first.
function extract(
  pending: readonly { id: string; source: string }[],
  signal: AbortSignal,
): void {
  const cache = thumbnailCache();
  const sources = new Map(pending.map((entry) => [entry.id, entry.source]));
  setTimeout(() => {
    if (signal.aborted) return;
    queue = startQueue(
      sources,
      (id) => processThumbnail(id, cache, signal),
      concurrency,
      signal,
    );
    queue.prioritize(priorities);
  }, 0);
}

// Removes every stored thumbnail, then makes the selected folder's thumbnails
// again, visible ones first. Resolves with a user-facing reason the cache could
// not be cleared, or "". Earlier work is stopped first and cannot store again.
async function clearCache(): Promise<string> {
  work.abort();
  work = new AbortController();
  queue = undefined;
  const signal = work.signal;
  settled = new Set();
  stills = new Map();
  for (const entry of entries.values()) entry.failed = false;
  const error = await thumbnailCache()
    .clear()
    .then(
      () => "",
      () =>
        "Some stored thumbnails could not be removed. Close other programs that may be using them and try again.",
    );
  // A folder opened meanwhile extracts its own entries.
  if (!signal.aborted) extract([...entries.values()], signal);
  return error;
}

// Resolves with a user-facing reason the source cannot be opened, or "" once
// Windows has started its default application.
async function launch(source: string): Promise<string> {
  try {
    if (!(await stat(source)).isFile()) throw new Error("Not a file");
  } catch {
    return "This video is no longer available. It may have been moved or deleted, or its drive disconnected.";
  }
  const extension = path.extname(source).toLowerCase();
  // An unexpected registry failure still attempts the launch.
  const association = await checkAssociation(extension).catch(() => "ok");
  if (association === "absent")
    return `Windows has no default application for ${extension} files. Choose one in Windows Settings > Apps > Default apps.`;
  if (association === "broken")
    return `The Windows default application for ${extension} files cannot be started. Reinstall it or choose another in Windows Settings > Apps > Default apps.`;
  const error = await shell.openPath(source);
  return error ? `Windows could not open this video: ${error}` : "";
}

const changedReason =
  "Thumbnail unavailable: this video changed while its thumbnail was being made. Choose Refresh to update it. You can still open it in your default player.";

// Whether the entry's source video still has the size and modification time it
// was listed with. Undefined when it cannot be examined now or was not then.
async function unchanged(entry: KnownEntry): Promise<boolean | undefined> {
  const current = await stat(entry.source).catch(() => undefined);
  if (!current || !entry.modified) return undefined;
  return current.size === entry.size && current.mtimeMs === entry.modified;
}

// Shows the entry's stored thumbnail, or generates and stores one. The entry
// is its source video's identity as listed.
async function processThumbnail(
  id: string,
  cache: ThumbnailCache,
  signal: AbortSignal,
): Promise<void> {
  const entry = entries.get(id);
  if (!entry) return;
  const deliver = (result: ThumbnailResult) => {
    // The folder may have changed or been refreshed meanwhile.
    if (signal.aborted || window.isDestroyed()) return;
    settled.add(id);
    if (!result.image) entry.failed = true;
    window.webContents.send("thumbnail", result);
  };
  // A source video changed since it was listed, or during the job, may give a
  // still of another version, so none is shown or stored for this entry.
  if ((await unchanged(entry)) === false)
    return deliver({ id, reason: changedReason });
  const stored = await cache.lookup(entry).catch(() => undefined);
  if (stored) {
    if (signal.aborted) return;
    stills.set(id, stored.still);
    return deliver({
      id,
      image: `thumbnail://${id}`,
      duration: stored.duration,
      reason: stored.reason,
    });
  }
  const preview = await extractPreview(entry.source, tools, signal);
  if (signal.aborted || window.isDestroyed()) return;
  const identified = await unchanged(entry);
  if (identified === false) return deliver({ id, reason: changedReason });
  const result: ThumbnailResult = {
    id,
    duration: preview.duration,
    reason: preview.reason,
  };
  if (preview.image && identified)
    try {
      const still = await cache.store(
        entry,
        {
          image: preview.image,
          duration: preview.duration,
          reason: preview.reason,
        },
        signal,
      );
      if (signal.aborted) return;
      // The renderer loads stored stills only while their entries are near the
      // viewport, so the folder's images are not all held in memory.
      stills.set(id, still);
      result.image = `thumbnail://${id}`;
    } catch {
      // Shown inline below.
    }
  // A still that cannot be stored, or whose source video cannot be identified
  // for reuse, is shown inline instead.
  if (preview.image && !result.image)
    result.image = `data:image/png;base64,${preview.image.toString("base64")}`;
  deliver(result);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "thumbnail",
    privileges: { standard: true, secure: true, corsEnabled: true },
  },
]);

void app.whenReady().then(async () => {
  preferences = await openPreferences(
    path.join(app.getPath("userData"), "preferences.json"),
  );
  // Serves only stills of the selected folder's entries.
  protocol.handle("thumbnail", async (request) => {
    const still = stills.get(new URL(request.url).hostname);
    const image = still
      ? await readFile(still).catch(() => undefined)
      : undefined;
    return image
      ? new Response(new Uint8Array(image), {
          // Keeps stills readable as ordinary page images, e.g. in a canvas.
          headers: {
            "content-type": "image/png",
            "access-control-allow-origin": "*",
          },
        })
      : new Response(null, { status: 404 });
  });
  window = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: "Video Browser",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  function trusted(
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ): boolean {
    return (
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame
    );
  }
  function validateSender(event: Electron.IpcMainInvokeEvent): void {
    if (!trusted(event)) throw new Error("Untrusted IPC sender");
  }
  ipcMain.handle("preferences", (event) => {
    validateSender(event);
    return preferences.current();
  });
  ipcMain.handle("sort", (event, order: unknown) => {
    validateSender(event);
    if (!validSort(order)) throw new Error("Invalid sort order");
    preferences.update({ sort: order });
    return sortEntries([...entries.values()], order).map((entry) => entry.id);
  });
  ipcMain.on("set-size", (event, width: unknown) => {
    if (trusted(event) && validSize(width)) preferences.update({ size: width });
  });
  ipcMain.handle("choose-folder", async (event) => {
    validateSender(event);
    const result = await dialog.showOpenDialog(window, {
      title: "Select a video folder",
      properties: ["openDirectory"],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("open-folder", (event, folder: unknown) => {
    validateSender(event);
    return openFolder(folder);
  });
  ipcMain.handle("refresh", (event) => {
    validateSender(event);
    return refresh();
  });
  ipcMain.handle("clear-cache", (event) => {
    validateSender(event);
    return clearCache();
  });
  // Entries near the viewport, nearest first; ignored unless well-formed.
  ipcMain.on("prioritize", (event, ids: unknown) => {
    if (
      !trusted(event) ||
      !Array.isArray(ids) ||
      !ids.every((id) => typeof id === "string")
    )
      return;
    priorities = ids as string[];
    queue?.prioritize(priorities);
  });
  ipcMain.handle("launch", (event, id: unknown) => {
    validateSender(event);
    const source = typeof id === "string" ? entries.get(id)?.source : undefined;
    return source
      ? launch(source)
      : "This entry is no longer in the selected folder.";
  });
  await window.loadFile(path.join(__dirname, "index.html"));
});
app.on("window-all-closed", () => {
  work.abort();
  // A process still being started is stopped once its id is known, and the
  // last preference change is saved before quitting.
  void Promise.all([processesStopped(5_000), preferences.saved()]).then(() =>
    app.quit(),
  );
});
