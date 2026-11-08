// Worker side of the developer features. Import from background.js and call register().
import { ACTIONS, runAction, describeActions } from "./actions.js";
import { githubActions } from "./github.js";
import { resolveShortcut, setShortcut, removeShortcut, listShortcuts } from "./shortcuts.js";
import { importBookmarksHtml } from "./bookmarks.js";
import { saveRecording, onTabClosed } from "./recorder.js";
import { externalAppLink } from "./applinks.js";

const PALETTE_URL = "dev/palette.html";
const MENU = "facet-dev-";

export async function openDevPalette() {
  const url = chrome.runtime.getURL(PALETTE_URL);
  return chrome.windows.create({ url, type: "popup", width: 560, height: 520, focused: true });
}

// Message API (also used by tests): { facetDev: "<verb>", ... } answered with { ok, result | error }.
const VERBS = {
  run: (m, sender) => runAction(m.id, sender?.tab, m.args),
  list: async (m) => describeActions(m.tabId ? await chrome.tabs.get(m.tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]),
  githubFor: async (m) => githubActions(m.url),
  appLinkFor: async (m) => externalAppLink(m.url),
  resolveShortcut: (m) => resolveShortcut(m.input),
  setShortcut: (m) => setShortcut(m.keyword, m.template),
  removeShortcut: (m) => removeShortcut(m.keyword),
  listShortcuts: () => listShortcuts(),
  importBookmarks: (m) => importBookmarksHtml(m.html, m.folderName),
};

export function register() {
  chrome.runtime.onInstalled.addListener(() => {
    const menus = [
      { id: "palette", title: "Developer palette", contexts: ["page", "action"] },
      { id: "popOut", title: "Pop out tab", contexts: ["page"] },
      { id: "record", title: "Record tab / stop recording", contexts: ["page", "video", "audio"] },
      { id: "splitLink", title: "Open link side by side", contexts: ["link"] },
      { id: "popupLink", title: "Open link in popup window", contexts: ["link"] },
    ];
    for (const m of menus) chrome.contextMenus.create({ ...m, id: MENU + m.id }, () => void chrome.runtime.lastError);
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!String(info.menuItemId).startsWith(MENU) || !tab?.id) return;
    const id = String(info.menuItemId).slice(MENU.length);
    const done = (p) => p.catch(console.error);
    if (id === "palette") done(openDevPalette());
    if (id === "record") done(runAction("tab.record", tab)); // a menu click is the invocation tabCapture needs
    if (id === "popOut") done(runAction("tab.popOut", tab));
    if (id === "splitLink") done(runAction("split.link", tab, { url: info.linkUrl }));
    if (id === "popupLink") done(runAction("popup.open", tab, { url: info.linkUrl }));
  });
  // Active only if manifest.json declares a "dev-palette" command.
  chrome.commands.onCommand.addListener((command) => { if (command === "dev-palette") openDevPalette().catch(console.error); });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.facetDevRecDone) { saveRecording(msg).catch(console.error); return; }
    const verb = msg && msg.facetDev && VERBS[msg.facetDev];
    if (!verb) return;
    Promise.resolve(verb(msg, sender)).then((result) => sendResponse({ ok: true, result }), (e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  });
  chrome.tabs.onRemoved.addListener(onTabClosed);
}

export { ACTIONS };
