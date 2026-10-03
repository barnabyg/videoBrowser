import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { checkAssociation } from "./association";
import { listFolder, videoExtensions } from "./folder";
import { startQueue, type ThumbnailQueue } from "./queue";
import { bundledTools, extractPreview, type Tools } from "./thumbnail";
import type { FolderResult, VideoEntry, ThumbnailResult } from "./contract";

let window: BrowserWindow;
let work = new AbortController();
let sources = new Map<string, string>();
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
  work = new AbortController();
  sources = new Map();
  stills = new Map();
  queue = undefined;
  priorities = [];
  const signal = work.signal;
  if (typeof folder !== "string")
    return { folder: "", status: "invalid-path", entries: [] };
  const listing = await listFolder(folder);
  if (signal.aborted) return { folder, status: listing.status, entries: [] };
  const entries: VideoEntry[] = listing.entries.map((video) => {
    const id = randomUUID();
    sources.set(id, video.source);
    return { id, filename: video.filename };
  });
  const cache = path.join(app.getPath("userData"), "thumbnails");
  // Start after the IPC response, allowing the renderer to display filenames first.
  // Storage only enables display and later reuse; a failed mkdir still extracts.
  setTimeout(() => {
    void mkdir(cache, { recursive: true })
      .catch(() => undefined)
      .then(() => {
        if (signal.aborted) return;
        queue = startQueue(
          sources,
          (id, source) => processThumbnail(id, source, cache, signal),
          concurrency,
          signal,
        );
        queue.prioritize(priorities);
      });
  }, 0);
  return { folder, status: listing.status, entries };
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

async function processThumbnail(
  id: string,
  source: string,
  cache: string,
  signal: AbortSignal,
): Promise<void> {
  const preview = await extractPreview(source, tools, signal);
  if (signal.aborted || window.isDestroyed()) return;
  const result: ThumbnailResult = {
    id,
    duration: preview.duration,
    reason: preview.reason,
  };
  if (preview.image) {
    // The renderer loads stored stills only while their entries are near the
    // viewport, so the folder's images are not all held in memory.
    const still = path.join(cache, `${id}.png`);
    try {
      await writeFile(still, preview.image);
      if (signal.aborted) return;
      stills.set(id, still);
      result.image = `thumbnail://${id}`;
    } catch {
      result.image = `data:image/png;base64,${preview.image.toString("base64")}`;
    }
  }
  // The folder may have changed while the still was being stored.
  if (signal.aborted || window.isDestroyed()) return;
  window.webContents.send("thumbnail", result);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "thumbnail",
    privileges: { standard: true, secure: true, corsEnabled: true },
  },
]);

void app.whenReady().then(async () => {
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
    const source = typeof id === "string" ? sources.get(id) : undefined;
    return source
      ? launch(source)
      : "This entry is no longer in the selected folder.";
  });
  await window.loadFile(path.join(__dirname, "index.html"));
});
app.on("window-all-closed", () => {
  work.abort();
  app.quit();
});
