import { call } from "./api.js";
import { looksLikeUrl, normalizeUrl } from "./util.js";

const $ = (id) => document.getElementById(id);

function tick() {
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
tick();
setInterval(tick, 10000);

$("search").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("q").value.trim();
  if (!q) return;
  if (looksLikeUrl(q)) location.href = normalizeUrl(q);
  else if (chrome.search?.query) await chrome.search.query({ text: q, disposition: "CURRENT_TAB" });
  else location.href = `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
};

function chip(tag, text, extra = {}) {
  const el = Object.assign(document.createElement(tag), { textContent: text }, extra);
  return el;
}

async function spaces() {
  const w = await chrome.windows.getCurrent();
  const { spaces: list } = await call("shell/spaces/list", { windowId: w.id });
  $("spaces").replaceChildren(
    ...list.map((s) => {
      const b = chip("button", s.name, { className: s.active ? "active" : "" });
      b.onclick = () => call("shell/spaces/switch", { windowId: w.id, spaceId: s.id });
      return b;
    }),
    Object.assign(chip("button", "+ New Space"), { onclick: () => call("shell/spaces/create", { windowId: w.id }) }),
  );
}

async function links() {
  const tree = await chrome.bookmarks.getRecent(12).catch(() => []);
  $("bookmarks").replaceChildren(...tree.filter((b) => b.url).map((b) => chip("a", b.title || b.url, { href: b.url })));
  if (chrome.topSites) {
    const top = await chrome.topSites.get().catch(() => []);
    $("sites").replaceChildren(...top.slice(0, 10).map((s) => chip("a", s.title || s.url, { href: s.url })));
  } else {
    const h = await chrome.history.search({ text: "", maxResults: 10, startTime: 0 }).catch(() => []);
    $("sites").replaceChildren(...h.map((s) => chip("a", s.title || s.url, { href: s.url })));
  }
  const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 6 }).catch(() => []);
  $("recent").replaceChildren(...closed.filter((s) => s.tab).map((s) => chip("a", s.tab.title || s.tab.url, { href: s.tab.url })));
}

chrome.runtime.onMessage.addListener((m) => { if (m?.type === "shell/spaces/changed") spaces(); });
spaces().catch(() => {});
links();
