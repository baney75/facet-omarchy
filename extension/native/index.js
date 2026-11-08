// Local transcription and translation through the native host.
const HOST = "app.facet_omarchy.host";
const pending = new Map();
let port = null;
let nextId = 1;
const captionTabs = new Set();

function hostPort() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((reply) => {
    const entry = pending.get(reply.id);
    if (!entry) return;
    pending.delete(reply.id);
    reply.ok ? entry.resolve(reply.result) : entry.reject(new Error(reply.error));
  });
  port.onDisconnect.addListener(() => {
    const error = new Error(chrome.runtime.lastError?.message || "native host disconnected");
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    port = null;
  });
  return port;
}

export function callHost(action, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    hostPort().postMessage({ id, action, ...params });
  });
}

async function targetLanguage() {
  const { translateTarget } = await chrome.storage.local.get("translateTarget");
  return translateTarget || "en";
}

async function translatePage(tabId) {
  const target = await targetLanguage();
  const [{ result: texts }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (walker.currentNode.nodeValue.trim().length > 1 && !parent.closest("script,style,noscript,code,pre,textarea")) nodes.push(walker.currentNode);
      }
      window.__facetTranslateNodes = nodes;
      return nodes.map((n) => n.nodeValue);
    },
  });
  const out = [];
  for (const text of texts) out.push((await callHost("translate", { text, target })).text);
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [out],
    func: (translated) => window.__facetTranslateNodes.forEach((n, i) => { n.nodeValue = translated[i]; }),
  });
}

async function translateSelection(tabId, text) {
  const target = await targetLanguage();
  const result = await callHost("translate", { text, target });
  await chrome.scripting.executeScript({ target: { tabId }, args: [result.text], func: showBubble });
}

function showBubble(text) {
  const id = "facet-bubble";
  document.getElementById(id)?.remove();
  const bubble = document.createElement("div");
  bubble.id = id;
  bubble.textContent = text;
  bubble.style.cssText = "position:fixed;left:50%;bottom:48px;transform:translateX(-50%);max-width:70vw;padding:10px 14px;border-radius:10px;background:rgba(0,0,0,.85);color:#fff;font:16px system-ui;z-index:2147483647";
  document.documentElement.append(bubble);
  setTimeout(() => { if (bubble.dataset.live !== "1") bubble.remove(); }, 12000);
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "dev/offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record tab audio for local live captions",
  });
}

async function toggleCaptions(tabId) {
  await ensureOffscreen();
  if (captionTabs.delete(tabId)) {
    chrome.runtime.sendMessage({ facetOffscreen: "stop", tabId });
    return;
  }
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  captionTabs.add(tabId);
  chrome.runtime.sendMessage({ facetOffscreen: "start", tabId, streamId });
}

export function register() {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: "facet-translate-selection", title: "Translate selection", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "facet-translate-page", title: "Translate page", contexts: ["page"] });
    chrome.contextMenus.create({ id: "facet-live-captions", title: "Toggle live captions", contexts: ["page", "video", "audio"] });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === "facet-translate-selection") translateSelection(tab.id, info.selectionText).catch(console.error);
    if (info.menuItemId === "facet-translate-page") translatePage(tab.id).catch(console.error);
    if (info.menuItemId === "facet-live-captions") toggleCaptions(tab.id).catch(console.error);
  });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.facetCaptionAudio) {
      callHost("transcribe", { audio: msg.audio })
        .then(({ text }) => text && chrome.scripting.executeScript({ target: { tabId: msg.tabId }, args: [text], func: showBubble }))
        .catch(console.error);
      return;
    }
    if (msg.facetNative) {
      callHost(msg.facetNative, msg.params).then((result) => sendResponse({ ok: true, result }), (e) => sendResponse({ ok: false, error: e.message }));
      return true;
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (captionTabs.delete(tabId)) chrome.runtime.sendMessage({ facetOffscreen: "stop", tabId });
  });
}
