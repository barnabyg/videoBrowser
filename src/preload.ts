import { contextBridge, ipcRenderer } from "electron";
import type { BrowserApi, ThumbnailResult } from "./contract";
const api: BrowserApi = {
  preferences: () => ipcRenderer.invoke("preferences"),
  storageProblem: () => ipcRenderer.invoke("storage-problem"),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  openFolder: (folder) => ipcRenderer.invoke("open-folder", folder),
  refresh: () => ipcRenderer.invoke("refresh"),
  clearCache: () => ipcRenderer.invoke("clear-cache"),
  sort: (order) => ipcRenderer.invoke("sort", order),
  setSize: (width) => ipcRenderer.send("set-size", width),
  launch: (id) => ipcRenderer.invoke("launch", id),
  prioritize: (ids) => ipcRenderer.send("prioritize", ids),
  onThumbnail: (callback) => {
    ipcRenderer.on("thumbnail", (_event, result: ThumbnailResult) =>
      callback(result),
    );
  },
};
contextBridge.exposeInMainWorld("browser", api);
