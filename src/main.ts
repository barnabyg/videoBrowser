import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { checkAssociation } from "./association";
import { listFolder, videoExtensions } from "./folder";
import { extractPreview } from "./thumbnail";
import type { FolderResult, VideoEntry, ThumbnailResult } from "./contract";

let window: BrowserWindow;
let work = new AbortController();
let sources = new Map<string, string>();
// A separate test entry point uses this exported app boundary to select a disposable extension.
export function addFixtureExtension(extension: string): void {
  videoExtensions.add(extension);
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
  const signal = work.signal;
  if (typeof folder !== "string")
    return { folder: "", status: "invalid-path", entries: [] };
  const listing = await listFolder(folder);
  if (signal.aborted) return { folder, status: listing.kind, entries: [] };
  const entries: VideoEntry[] = listing.entries.map((video) => {
    const id = randomUUID();
    sources.set(id, video.source);
    return { id, filename: video.filename };
  });
  const pending = new Map(sources);
  // Start after the IPC response, allowing the renderer to display filenames first.
  setTimeout(() => {
    void processThumbnails(pending, signal);
  }, 0);
  return { folder, status: listing.kind, entries };
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

async function processThumbnails(
  pending: Map<string, string>,
  signal: AbortSignal,
): Promise<void> {
  const tools = app.isPackaged
    ? path.join(process.resourcesPath, "tools")
    : path.resolve(".tools/ffmpeg/bin");
  const cache = path.join(app.getPath("userData"), "thumbnails");
  try {
    await mkdir(cache, { recursive: true });
    for (const [id, source] of pending) {
      if (signal.aborted) break;
      const preview = await extractPreview(source, tools, signal);
      if (signal.aborted || window.isDestroyed()) break;
      const result: ThumbnailResult = {
        id,
        duration: preview.duration,
        reason: preview.reason,
      };
      if (preview.image) {
        await writeFile(path.join(cache, `${id}.png`), preview.image);
        result.image = `data:image/png;base64,${preview.image.toString("base64")}`;
      }
      window.webContents.send("thumbnail", result);
    }
  } catch {
    if (!signal.aborted && !window.isDestroyed())
      for (const id of pending.keys())
        window.webContents.send("thumbnail", {
          id,
          reason:
            "Thumbnail storage is unavailable. You can still open this video.",
        });
  }
}

void app.whenReady().then(async () => {
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
  function validateSender(event: Electron.IpcMainInvokeEvent): void {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("Untrusted IPC sender");
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
