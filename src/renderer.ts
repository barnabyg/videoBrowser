type ThumbnailResult = import("./contract").ThumbnailResult;
type FolderStatus = import("./contract").FolderStatus;

const messages: Record<Exclude<FolderStatus, "videos">, string> = {
  empty: "This folder is empty. Choose another folder.",
  "no-videos":
    "No recognised video files in this folder. Subfolders are not included; choose the folder that directly contains your videos.",
  "invalid-path": "Enter a full folder path, such as C:\\Videos.",
  network:
    "Network folders are not supported. Choose a folder on this computer or on a USB drive.",
  "not-found":
    "This folder cannot be found. If it is on a USB drive, check that the drive is connected, or choose another folder.",
  "not-a-folder": "This path is a file, not a folder. Choose a folder.",
  "access-denied":
    "Windows denied access to this folder. Choose a folder you have permission to open.",
  unreadable:
    "Cannot read this folder. Check that it is connected and accessible, or choose another folder.",
};

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing UI element: ${id}`);
  return value as T;
}
const folderInput = element<HTMLInputElement>("folder");
const grid = element<HTMLUListElement>("grid");
const statusMessage = element<HTMLParagraphElement>("status");
const selected = element<HTMLSpanElement>("selected");
const scroller = element<HTMLElement>("browse");
const cards = new Map<string, HTMLButtonElement>();
const earlyResults = new Map<string, ThumbnailResult>();
let selection = 0;

async function selectFolder(folder: string): Promise<void> {
  const current = ++selection;
  cards.clear();
  earlyResults.clear();
  grid.replaceChildren();
  scroller.scrollTop = 0;
  statusMessage.textContent = "Reading folder…";
  const result = await window.browser.openFolder(folder);
  if (current !== selection) return;
  selected.textContent = result.folder;
  statusMessage.textContent =
    result.status === "videos"
      ? `${result.entries.length} source ${result.entries.length === 1 ? "video" : "videos"}. Click a video to open it in your default player.`
      : messages[result.status];
  const fragment = document.createDocumentFragment();
  for (const entry of result.entries) {
    const card = document.createElement("button");
    card.className = "video";
    card.setAttribute("aria-label", `Open ${entry.filename}`);
    const frame = document.createElement("div");
    frame.className = "frame";
    frame.textContent = "Loading thumbnail…";
    const name = document.createElement("span");
    name.className = "filename";
    name.textContent = entry.filename;
    name.title = entry.filename;
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.id = `detail-${entry.id}`;
    card.setAttribute("aria-describedby", detail.id);
    card.append(frame, name, detail);
    card.addEventListener("click", () => {
      void window.browser.launch(entry.id).then((error) => {
        statusMessage.textContent = error
          ? `Cannot open ${entry.filename}: ${error}`
          : `Opened ${entry.filename} in your default player.`;
      });
    });
    cards.set(entry.id, card);
    const item = document.createElement("li");
    item.append(card);
    fragment.append(item);
  }
  grid.append(fragment);
  for (const result of earlyResults.values()) showThumbnail(result);
  earlyResults.clear();
}

function showThumbnail(result: ThumbnailResult): void {
  const card = cards.get(result.id);
  if (!card) {
    earlyResults.set(result.id, result);
    return;
  }
  const frame = card.querySelector(".frame");
  const detail = card.querySelector(".detail");
  if (!frame || !detail) return;
  if (result.image) {
    const image = document.createElement("img");
    image.src = result.image;
    image.alt = `Thumbnail for ${card.querySelector(".filename")?.textContent ?? ""}`;
    frame.replaceChildren(image);
  } else frame.textContent = result.reason ?? "Thumbnail unavailable";
  const duration = result.duration;
  detail.textContent = duration
    ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
    : "";
  if (result.reason) {
    detail.textContent += ` ${result.reason}`;
  }
}
element<HTMLFormElement>("folder-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void selectFolder(folderInput.value);
});
element<HTMLButtonElement>("choose").addEventListener("click", () => {
  void window.browser.chooseFolder().then((folder) => {
    if (folder) {
      folderInput.value = folder;
      void selectFolder(folder);
    }
  });
});
window.browser.onThumbnail(showThumbnail);
