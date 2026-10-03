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
// Results may arrive before their cards are built.
const results = new Map<string, ThumbnailResult>();
// Entries within a viewport's height of the visible area.
const near = new Set<string>();
let selection = 0;

// Only entries near the viewport show their results. This bounds decoded image
// memory, and keeps extraction from re-laying out a large grid for offscreen
// entries; scrolling back shows stored results and reloads stills.
const observer = new IntersectionObserver(
  (changes) => {
    for (const change of changes) {
      const id = (change.target as HTMLElement).dataset.id ?? "";
      if (change.isIntersecting) {
        near.add(id);
        present(id);
      } else if (near.delete(id))
        cards.get(id)?.querySelector(".frame img")?.remove();
    }
    prioritizeNear();
  },
  { root: scroller, rootMargin: "100% 0px" },
);

// Asks for the missing thumbnails nearest the middle of the viewport first.
function prioritizeNear(): void {
  const view = scroller.getBoundingClientRect();
  const middle = view.top + view.height / 2;
  const distance = (id: string) => {
    const box = cards.get(id)?.getBoundingClientRect();
    return box ? Math.abs(box.top + box.height / 2 - middle) : Infinity;
  };
  const wanted = [...near].filter((id) => !results.has(id));
  const order = new Map(wanted.map((id) => [id, distance(id)]));
  window.browser.prioritize(
    wanted.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
  );
}

async function selectFolder(folder: string): Promise<void> {
  const current = ++selection;
  observer.disconnect();
  cards.clear();
  results.clear();
  near.clear();
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
    card.dataset.id = entry.id;
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
  for (const card of cards.values()) observer.observe(card);
}

// Shows an entry's thumbnail or reason, and its duration, if it is near the viewport.
function present(id: string): void {
  const card = cards.get(id);
  const result = results.get(id);
  const frame = card?.querySelector(".frame");
  const detail = card?.querySelector(".detail");
  if (!near.has(id) || !result || !frame || !detail) return;
  if (!result.image)
    frame.textContent = result.reason ?? "Thumbnail unavailable";
  else if (!frame.querySelector("img")) {
    const image = document.createElement("img");
    image.crossOrigin = "anonymous";
    image.src = result.image;
    image.alt = `Thumbnail for ${card?.querySelector(".filename")?.textContent ?? ""}`;
    frame.replaceChildren(image);
  }
  // The duration label is omitted when it is not reliably known.
  const duration = result.duration;
  detail.textContent = [
    duration
      ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}`
      : "",
    result.reason ?? "",
  ]
    .filter(Boolean)
    .join(" ");
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
window.browser.onThumbnail((result) => {
  results.set(result.id, result);
  present(result.id);
});
