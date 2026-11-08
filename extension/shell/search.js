// Palette search over tabs, history, bookmarks, commands and Spaces. Runs in an extension page.
import { COMMANDS, dynamicCommands } from "./commands.js";
import { looksLikeUrl, normalizeUrl } from "./util.js";
import { call } from "./api.js";

function score(query, title, url) {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const t = (title || "").toLowerCase();
  const u = (url || "").toLowerCase();
  let total = 0;
  for (const tok of q.split(/\s+/)) {
    if (t.startsWith(tok)) total += 6;
    else if (t.includes(` ${tok}`)) total += 5;
    else if (t.includes(tok)) total += 4;
    else if (u.includes(tok)) total += 2;
    else return 0;
  }
  return total;
}

const PREFIX = { "t ": "tab", "h ": "history", "b ": "bookmark", "> ": "command", "s ": "space" };

export async function searchAll(raw, { windowId, limit = 8 } = {}) {
  let query = raw;
  let only = null;
  for (const [p, kind] of Object.entries(PREFIX)) {
    if (raw.toLowerCase().startsWith(p)) { only = kind; query = raw.slice(p.length); break; }
  }
  if (raw.startsWith(">")) { only = "command"; query = raw.slice(1).trim(); }
  const want = (k) => !only || only === k;
  const results = [];
  const openUrls = new Set();

  if (want("tab")) {
    const tabs = await chrome.tabs.query({});
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    for (const t of tabs) {
      openUrls.add(t.url);
      const s = score(query, t.title, t.url);
      if (s) results.push({ kind: "tab", id: String(t.id), tabId: t.id, windowId: t.windowId, title: t.title || t.url, subtitle: t.url, score: s + 3 });
    }
  }
  if (want("space")) {
    try {
      const { spaces, activeId } = await call("shell/spaces/list", { windowId });
      for (const sp of spaces) {
        const s = score(query, sp.name, "space");
        if (s && sp.id !== activeId && query) results.push({ kind: "space", id: sp.id, title: `Switch to Space: ${sp.name}`, subtitle: `${sp.tabCount ?? 0} tabs`, score: s + 2 });
      }
    } catch {}
  }
  if (want("command")) {
    for (const c of [...dynamicCommands(query), ...COMMANDS]) {
      const s = c.args ? 20 : score(query, c.title, "");
      if (s) results.push({ kind: "command", id: c.id, args: c.args, title: c.title, subtitle: "Command", score: s + 1 });
    }
  }
  if (want("bookmark")) {
    const found = query.trim() ? await chrome.bookmarks.search(query.trim()) : await chrome.bookmarks.getRecent(8);
    for (const b of found) {
      if (!b.url) continue;
      results.push({ kind: "bookmark", id: b.id, url: b.url, title: b.title || b.url, subtitle: b.url, score: score(query, b.title, b.url) || 1 });
    }
  }
  if (want("history")) {
    const items = await chrome.history.search({ text: query.trim(), maxResults: 30, startTime: 0 });
    for (const h of items) {
      if (openUrls.has(h.url)) continue;
      results.push({ kind: "history", id: h.url, url: h.url, title: h.title || h.url, subtitle: h.url, score: (score(query, h.title, h.url) || 1) });
    }
  }

  const perKind = {};
  const order = { tab: 0, space: 1, command: 2, bookmark: 3, history: 4 };
  results.sort((a, b) => b.score - a.score || order[a.kind] - order[b.kind]);
  const out = results.filter((r) => (perKind[r.kind] = (perKind[r.kind] || 0) + 1) <= (only ? 30 : limit));

  const q = query.trim();
  if (q && !only) {
    out.push(looksLikeUrl(q)
      ? { kind: "web", id: "url", url: normalizeUrl(q), title: `Open ${q}`, subtitle: "Go to address" }
      : { kind: "web", id: "search", query: q, title: `Search the web for "${q}"`, subtitle: "Default search engine" });
  }
  return out;
}

export async function runResult(r, windowId) {
  switch (r.kind) {
    case "tab":
      await chrome.tabs.update(r.tabId, { active: true });
      await chrome.windows.update(r.windowId, { focused: true });
      return;
    case "history":
    case "bookmark":
      await chrome.tabs.create({ windowId, url: r.url });
      return;
    case "command":
      await call("shell/command", { id: r.id, windowId, args: r.args });
      return;
    case "space":
      await call("shell/spaces/switch", { windowId, spaceId: r.id });
      return;
    case "web":
      if (r.id === "url") await chrome.tabs.create({ windowId, url: r.url });
      else if (chrome.search?.query) await chrome.search.query({ text: r.query, disposition: "NEW_TAB" });
      else await chrome.tabs.create({ windowId, url: `https://duckduckgo.com/?q=${encodeURIComponent(r.query)}` });
      return;
  }
}
