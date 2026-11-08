// Downloads panel backend: list, tidy-by-type suggestions, rename.
// chrome.downloads cannot move or rename a finished file, so:
//  - suggestions are advice computed from the file type;
//  - renameDownload and relocate re-download from the source URL under the new path (caller may drop the old record);
//  - auto-tidy and queued renames apply to NEW downloads through onDeterminingFilename.
const TYPES = {
  Images: "jpg jpeg png gif webp svg bmp heic avif ico tiff",
  Documents: "pdf doc docx odt txt rtf md epub xls xlsx ods csv ppt pptx odp",
  Archives: "zip tar gz tgz bz2 xz 7z rar zst",
  Video: "mp4 mkv mov webm avi m4v",
  Audio: "mp3 flac wav ogg m4a aac opus",
  Installers: "dmg pkg deb rpm appimage exe msi apk flatpak",
  Code: "js ts json py rs go c h cpp sh html css yaml yml toml",
};
const BY_EXT = {};
for (const [folder, exts] of Object.entries(TYPES)) for (const e of exts.split(" ")) BY_EXT[e] = folder;

export const baseName = (p) => String(p).split(/[\\/]/).pop();
export function folderFor(filename) {
  const ext = baseName(filename).split(".").pop().toLowerCase();
  return BY_EXT[ext] || "Other";
}
export function sanitize(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, 200);
}

const pendingRenames = new Map(); // download url -> filename
let autoTidy = false;

export async function listDownloads(limit = 100) {
  const items = await chrome.downloads.search({ orderBy: ["-startTime"], limit });
  return items.map((d) => ({
    id: d.id, url: d.finalUrl || d.url, filename: d.filename, name: baseName(d.filename || ""),
    state: d.state, bytes: d.fileSize || d.totalBytes || 0, exists: d.exists !== false, time: d.startTime,
    folder: d.filename ? folderFor(d.filename) : "Other",
  }));
}

export function tidySuggestions(items) {
  const out = [];
  for (const d of items) {
    if (d.state !== "complete" || !d.exists || !d.filename) continue;
    const dir = d.filename.slice(0, d.filename.length - d.name.length).replace(/[\\/]$/, "");
    const parent = baseName(dir);
    if (parent === d.folder) continue; // already in its type folder
    out.push({ id: d.id, name: d.name, folder: d.folder, target: `${d.folder}/${d.name}` });
  }
  return out;
}

export async function tidyPreview() {
  const items = await listDownloads(500);
  const groups = {};
  for (const s of tidySuggestions(items)) (groups[s.folder] ||= []).push(s);
  return groups;
}

// Re-download under a Downloads-relative path. Returns the new download id.
export async function relocate(id, relativePath) {
  const [d] = await chrome.downloads.search({ id });
  if (!d) throw new Error("no such download");
  const filename = relativePath.split("/").map(sanitize).filter(Boolean).join("/");
  if (!filename) throw new Error("empty name");
  const url = d.finalUrl || d.url;
  // Our own onDeterminingFilename listener answers for this URL; the filename option alone loses to it.
  pendingRenames.set(url, filename);
  const newId = await chrome.downloads.download({ url, filename, conflictAction: "uniquify" });
  return { newId, filename, oldId: id };
}

export function renameDownload(id, newName) { return relocate(id, sanitize(newName)); }

export async function removeOld(id) {
  await chrome.downloads.removeFile(id).catch(() => {});
  await chrome.downloads.erase({ id });
}

export function queueRename(url, filename) { pendingRenames.set(url, filename.split("/").map(sanitize).filter(Boolean).join("/")); }
export function setAutoTidy(on) { autoTidy = !!on; return chrome.storage.local.set({ "tools/autoTidy": autoTidy }); }

export function startDownloads() {
  chrome.storage.local.get("tools/autoTidy").then((v) => { autoTidy = !!v["tools/autoTidy"]; }).catch(() => {});
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const queued = pendingRenames.get(item.url) || pendingRenames.get(item.finalUrl);
    if (queued) {
      pendingRenames.delete(item.url);
      suggest({ filename: queued, conflictAction: "uniquify" });
      return;
    }
    if (autoTidy) {
      suggest({ filename: `${folderFor(item.filename)}/${baseName(item.filename)}`, conflictAction: "uniquify" });
      return;
    }
    suggest();
  });
}
