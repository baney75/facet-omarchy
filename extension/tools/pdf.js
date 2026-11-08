// PDF links: open in a tab (Chromium's viewer) or save, from the link context menu.
export const isPdfUrl = (u) => {
  try { return /\.pdf$/i.test(new URL(u).pathname); } catch { return false; }
};
const PATTERNS = ["http://*/*.pdf", "https://*/*.pdf", "http://*/*.pdf?*", "https://*/*.pdf?*"];

export function registerPdfMenus() {
  chrome.contextMenus.create({ id: "tools-pdf-open", title: "Open PDF in new tab", contexts: ["link"], targetUrlPatterns: PATTERNS });
  chrome.contextMenus.create({ id: "tools-pdf-save", title: "Save PDF", contexts: ["link"], targetUrlPatterns: PATTERNS });
}

export async function openPdf(url, { background = false } = {}) {
  return chrome.tabs.create({ url, active: !background });
}

export async function onPdfMenu(info) {
  if (!info.linkUrl) return;
  if (info.menuItemId === "tools-pdf-open") await openPdf(info.linkUrl);
  else if (info.menuItemId === "tools-pdf-save") await chrome.downloads.download({ url: info.linkUrl });
}
