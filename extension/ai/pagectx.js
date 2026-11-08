// Extract page text, selection and title from tabs via chrome.scripting.
const MAX_CHARS = 12000;

function grab() {
  const sel = String(getSelection() || "");
  const text = (document.body && document.body.innerText) || "";
  return { title: document.title, url: location.href, selection: sel, text };
}

export async function getPage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: grab });
    const r = res && res.result;
    if (!r) throw new Error("no result");
    return { tabId, ...r, text: r.text.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS) };
  } catch (e) {
    return { tabId, title: tab.title || "", url: tab.url || "", selection: "", text: "", error: String(e.message || e) };
  }
}

export function isReadable(tab) {
  return /^https?:|^file:/.test(tab.url || "");
}

export async function activeTab() {
  const q = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabs = q.filter((t) => isReadable(t));
  if (tabs.length) return tabs[0];
  const all = await chrome.tabs.query({});
  const ok = all.filter(isReadable).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return ok[0] || null;
}

export async function allReadableTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(isReadable);
}

export function formatPage(p, i) {
  const head = `[Tab${i === undefined ? "" : " " + (i + 1)}] ${p.title}\nURL: ${p.url}`;
  return `${head}\n${p.text || "(no readable text)"}`;
}
