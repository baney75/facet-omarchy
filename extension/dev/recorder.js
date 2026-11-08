// Tab recorder. Capture runs in the shared offscreen document at dev/offscreen.html.
// That document also loads native/offscreen.js, so captions and recording coexist in the one allowed document.
import { safeName } from "./util.js";

const OFFSCREEN_URL = "dev/offscreen.html";
const recording = new Map(); // tabId -> title
let creating = null;

async function ensureOffscreen() {
  const want = chrome.runtime.getURL(OFFSCREEN_URL);
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.some((c) => c.documentUrl === want)) return;
  if (creating) return creating;
  creating = (async () => {
    // Only one offscreen document may exist. Replace a stray native/offscreen.html one (see docs/wave2-dev.md).
    if (existing.length) await chrome.offscreen.closeDocument();
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["USER_MEDIA"],
      justification: "Record tab video and audio, and transcribe tab audio for live captions",
    });
  })();
  try { await creating; } finally { creating = null; }
}

export const isRecording = (tabId) => recording.has(tabId);

export async function startRecording(tabId) {
  if (recording.has(tabId)) throw new Error("Already recording this tab");
  const tab = await chrome.tabs.get(tabId);
  await ensureOffscreen();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  recording.set(tabId, tab.title || "tab");
  chrome.runtime.sendMessage({ facetDevRec: "start", tabId, streamId });
  return { recording: true };
}

export async function stopRecording(tabId) {
  if (!recording.has(tabId)) throw new Error("Not recording this tab");
  chrome.runtime.sendMessage({ facetDevRec: "stop", tabId });
  return { stopping: true };
}

export async function toggleRecording(tabId) {
  return recording.has(tabId) ? stopRecording(tabId) : startRecording(tabId);
}

// Called by index.js when the offscreen document hands back a finished file.
export async function saveRecording(msg) {
  const title = recording.get(msg.tabId);
  recording.delete(msg.tabId);
  if (msg.error || !msg.url) return { error: msg.error || "empty recording" };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const id = await chrome.downloads.download({ url: msg.url, filename: `Facet recordings/${safeName(title)}-${stamp}.webm`, saveAs: false });
  chrome.runtime.sendMessage({ facetDevRec: "release", url: msg.url });
  return { downloadId: id };
}

export function onTabClosed(tabId) {
  if (recording.has(tabId)) chrome.runtime.sendMessage({ facetDevRec: "stop", tabId });
}
