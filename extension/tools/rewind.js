// Rewind: full-text index of pages seen, in IndexedDB. Worker side captures; any context can search.
const DB_NAME = "facet-rewind";
const STORE = "pages";
const MAX_TEXT = 150000;
const MAX_TERMS = 4000;

let dbPromise = null;
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "url" });
      s.createIndex("terms", "terms", { multiEntry: true });
      s.createIndex("time", "time");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
const asPromise = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export function tokenize(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]{2,}/gu) || [];
}

export async function indexPage({ url, title = "", text = "", time = Date.now() }) {
  if (!/^https?:/i.test(url)) return false;
  const body = String(text).slice(0, MAX_TEXT);
  const terms = [...new Set(tokenize(`${title} ${body}`))].slice(0, MAX_TERMS);
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put({ url, title, text: body, terms, time });
  await done(tx);
  return true;
}

function snippet(text, tokens) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of tokens) { at = lower.indexOf(t); if (at >= 0) break; }
  if (at < 0) return text.slice(0, 140);
  const start = Math.max(0, at - 60);
  return (start ? "…" : "") + text.slice(start, at + 100).replace(/\s+/g, " ");
}

export async function search(query, { limit = 25 } = {}) {
  const tokens = tokenize(query);
  const db = await openDb();
  if (!tokens.length) {
    const rows = await asPromise(db.transaction(STORE).objectStore(STORE).index("time").getAll());
    return rows.reverse().slice(0, limit).map(({ url, title, time, text }) => ({ url, title, time, snippet: text.slice(0, 140) }));
  }
  const lead = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  const range = IDBKeyRange.bound(lead, lead + "￿");
  const rows = await asPromise(db.transaction(STORE).objectStore(STORE).index("terms").getAll(range));
  const seen = new Map();
  for (const r of rows) seen.set(r.url, r);
  const hits = [];
  for (const r of seen.values()) {
    if (!tokens.every((t) => r.terms.some((x) => x.startsWith(t)))) continue;
    const titleHit = tokens.filter((t) => tokenize(r.title).some((x) => x.startsWith(t))).length;
    hits.push({ url: r.url, title: r.title, time: r.time, score: titleHit * 10 + r.time / 1e13, snippet: snippet(r.text, tokens) });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export async function forget(url) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(url);
  await done(tx);
}

export async function count() {
  const db = await openDb();
  return asPromise(db.transaction(STORE).objectStore(STORE).count());
}

// Runs inside the page via chrome.scripting.executeScript.
function readPage() {
  return { title: document.title, text: (document.body?.innerText || "").replace(/\s+/g, " ").trim() };
}

export async function capture(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || tab.incognito || !/^https?:/i.test(tab.url || "")) return false;
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: readPage });
  if (!res?.result) return false;
  return indexPage({ url: tab.url, title: res.result.title || tab.title || "", text: res.result.text });
}

export function startCapture() {
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "complete") capture(tabId).catch(() => {});
  });
}

// History hits that were never indexed (visited before install), titles and urls only.
export async function historySearch(query, limit = 25) {
  const items = await chrome.history.search({ text: query, maxResults: limit, startTime: 0 });
  return items.map((h) => ({ url: h.url, title: h.title || h.url, time: h.lastVisitTime, snippet: "", source: "history" }));
}

export async function rewindSearch(query, opts = {}) {
  const limit = opts.limit || 25;
  const indexed = await search(query, { limit });
  const urls = new Set(indexed.map((h) => h.url));
  let extra = [];
  try { extra = (await historySearch(query, limit)).filter((h) => !urls.has(h.url)); } catch { /* no history API here */ }
  return [...indexed.map((h) => ({ ...h, source: "index" })), ...extra].slice(0, limit);
}
