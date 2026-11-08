// Worker side of the page features. Import from background.js and call register().
const PREFIX = "facet-page-";
const MENUS = [
  { id: "reader", title: "Reader mode", contexts: ["page", "selection"] },
  { id: "copyPageMarkdown", title: "Copy page as Markdown", contexts: ["page", "selection"] },
  { id: "copyMarkdownLink", title: "Copy Markdown link", contexts: ["page", "link"] },
  { id: "copyCleanLink", title: "Copy clean link", contexts: ["page", "link"] },
  { id: "copyQuoteLink", title: "Copy link to highlighted quote", contexts: ["selection"] },
  { id: "highlight", title: "Highlight selection", contexts: ["selection"] },
  { id: "removeHighlight", title: "Remove highlight", contexts: ["page", "selection"] },
  { id: "toggleDark", title: "Toggle dark mode for this site", contexts: ["page"] },
  { id: "toggleCalm", title: "Toggle calm mode for this site", contexts: ["page"] },
  { id: "videoFaster", title: "Video: faster", contexts: ["video"], action: "videoSpeed", extra: { delta: 0.25 } },
  { id: "videoSlower", title: "Video: slower", contexts: ["video"], action: "videoSpeed", extra: { delta: -0.25 } },
  { id: "videoReset", title: "Video: normal speed", contexts: ["video"], action: "videoSpeed", extra: { reset: true } },
  { id: "videoPip", title: "Video: picture in picture", contexts: ["video"] },
  { id: "readAloud", title: "Read aloud", contexts: ["page", "selection"] },
  { id: "stopReading", title: "Stop reading", contexts: ["page", "selection"] },
];

function buildMenus() {
  // Only touch our own ids; other modules may own menus too.
  const ids = [PREFIX + "root", ...MENUS.map((m) => PREFIX + m.id)];
  let pending = ids.length;
  const create = () => {
    chrome.contextMenus.create({ id: PREFIX + "root", title: "Facet", contexts: ["all"] }, () => void chrome.runtime.lastError);
    for (const m of MENUS) {
      chrome.contextMenus.create({ id: PREFIX + m.id, parentId: PREFIX + "root", title: m.title, contexts: m.contexts }, () => void chrome.runtime.lastError);
    }
  };
  for (const id of ids) {
    chrome.contextMenus.remove(id, () => { void chrome.runtime.lastError; if (--pending === 0) create(); });
  }
}

// ---- text to speech --------------------------------------------------------
function chunks(text, max = 3000) {
  const out = [];
  let cur = "";
  for (const s of text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*\s*/g) || []) {
    if ((cur + s).length > max && cur) { out.push(cur); cur = ""; }
    cur += s;
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function speak(text) {
  chrome.tts.stop();
  chunks(text).forEach((c, i) => chrome.tts.speak(c, { enqueue: i > 0, rate: 1.0 }));
}

// ---- SponsorBlock ----------------------------------------------------------
const sbCache = new Map();
async function sponsorSegments(videoID, categories) {
  const cats = categories && categories.length ? categories : ["sponsor", "selfpromo", "interaction"];
  const ck = videoID + "|" + cats.join();
  const hit = sbCache.get(ck);
  if (hit && Date.now() - hit.t < 30 * 60e3) return hit.segments;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(videoID));
  const prefix = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 4);
  const url = "https://sponsor.ajay.app/api/skipSegments/" + prefix +
    "?categories=" + encodeURIComponent(JSON.stringify(cats)) + "&actionTypes=" + encodeURIComponent('["skip"]');
  let segments = [];
  const res = await fetch(url, { credentials: "omit" });
  if (res.ok) {
    const data = await res.json();
    const mine = Array.isArray(data) ? data.find((v) => v.videoID === videoID) : null;
    segments = mine ? mine.segments.filter((s) => Array.isArray(s.segment) && s.segment.length === 2) : [];
  } else if (res.status !== 404) throw new Error("SponsorBlock HTTP " + res.status);
  sbCache.set(ck, { t: Date.now(), segments });
  return segments;
}

// ---- link peek -------------------------------------------------------------
const peekCache = new Map();
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => {
  const t = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" }[e.toLowerCase()];
  if (t) return t;
  const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(n) ? String.fromCodePoint(n) : m;
});
function metaOf(html, names) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (key && names.includes(key.toLowerCase())) {
      const c = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
      if (c) return decode(c).trim();
    }
  }
  return "";
}
async function peek(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("bad scheme");
  const hit = peekCache.get(url);
  if (hit && Date.now() - hit.t < 10 * 60e3) return hit.v;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  let html = "", finalUrl = url;
  try {
    const res = await fetch(url, { credentials: "omit", redirect: "follow", signal: ctl.signal, headers: { Accept: "text/html" } });
    finalUrl = res.url || url;
    if (!(res.headers.get("content-type") || "").includes("html")) throw new Error("not html");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    while (html.length < 200000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
  } finally { clearTimeout(timer); }
  const title = metaOf(html, ["og:title", "twitter:title"]) || decode(((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s+/g, " ").trim());
  let image = metaOf(html, ["og:image", "twitter:image"]);
  try { if (image) { const i = new URL(image, finalUrl); image = /^https?:$/.test(i.protocol) ? i.toString() : ""; } } catch (_) { image = ""; }
  const v = { ok: true, url: finalUrl, title, description: metaOf(html, ["og:description", "description", "twitter:description"]), image };
  peekCache.set(url, { t: Date.now(), v });
  return v;
}

// ---- dispatch --------------------------------------------------------------
function toTab(tabId, action, extra) {
  return chrome.tabs.sendMessage(tabId, { type: "facet:page:action", action, ...extra });
}

export async function runAction(tabId, action, info = {}) {
  if (action === "stopReading") { chrome.tts.stop(); return { ok: true }; }
  if (action === "readAloud") {
    let text = info.selectionText;
    if (!text) text = (await toTab(tabId, "getText")).text;
    if (text) speak(text);
    return { ok: !!text };
  }
  if (action === "videoFaster" || action === "videoSlower" || action === "videoReset") {
    const m = MENUS.find((x) => x.id === action);
    return toTab(tabId, m.action, { ...m.extra, ...info });
  }
  return toTab(tabId, action, info);
}

export function register() {
  chrome.runtime.onInstalled.addListener(buildMenus);
  chrome.runtime.onStartup.addListener(buildMenus);

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const id = String(info.menuItemId);
    if (!id.startsWith(PREFIX) || !tab || tab.id == null) return;
    runAction(tab.id, id.slice(PREFIX.length), { linkUrl: info.linkUrl, selectionText: info.selectionText, pageUrl: info.pageUrl })
      .catch((e) => console.warn("facet page action failed", id, e));
  });

  chrome.runtime.onMessage.addListener((m, sender, send) => {
    if (!m || typeof m.type !== "string") return;
    const run = (p) => { p.then((r) => send(r), (e) => send({ ok: false, error: String(e && e.message || e) })); return true; };
    switch (m.type) {
      case "facet:tts": speak(String(m.text || "")); send({ ok: true }); return;
      case "facet:tts-stop": chrome.tts.stop(); send({ ok: true }); return;
      case "facet:sponsor": return run(sponsorSegments(String(m.videoID || ""), m.categories).then((segments) => ({ ok: true, segments })));
      case "facet:peek": return run(peek(String(m.url || "")));
      // Other extension pages (sidebar) can trigger any page action.
      case "facet:page": {
        if (sender.tab) return; // only extension pages, not content scripts
        return run((async () => {
          const tabId = m.tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
          return runAction(tabId, m.action, m.info || {});
        })());
      }
    }
  });
}
