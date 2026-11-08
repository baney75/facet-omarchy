// Background-side registration for the AI feature. Call register() once from background.js.
const PANEL = "ai/panel.html";

async function openPanel(tab, pending) {
  if (pending) await chrome.storage.session.set({ aiPending: { ...pending, at: Date.now() } });
  try {
    if (tab && tab.id != null) {
      await chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL, enabled: true });
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (e) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(PANEL) });
  }
}

export function register() {
  chrome.runtime.onInstalled.addListener(() => {
    const items = [
      ["facet-ai-selection", "Ask AI about selection", ["selection"]],
      ["facet-ai-page", "Ask AI about this page", ["page", "frame"]],
      ["facet-ai-summarize", "Summarize this page", ["page", "frame"]],
    ];
    for (const [id, title, contexts] of items) chrome.contextMenus.create({ id, title, contexts });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "facet-ai-selection") openPanel(tab, { act: "selection", selection: info.selectionText || "" });
    else if (info.menuItemId === "facet-ai-page") openPanel(tab, { act: "page" });
    else if (info.menuItemId === "facet-ai-summarize") openPanel(tab, { act: "summarize" });
  });
  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg && msg.type === "facet-ai-open") {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => openPanel(t, msg.act ? { act: msg.act } : null)).then(() => send({ ok: true }));
      return true;
    }
  });
}

export const panelPath = PANEL;
