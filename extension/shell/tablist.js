// Reusable tab list: pinned section, group headers, search filter, drag reorder.
// Usage: import { mountTabList } from "./shell/tablist.js"; mountTabList(ulElement, { filterInput });
import { call } from "./api.js";

let dragId = null;

// Final index to pass to chrome.tabs.move when dropping `dragged` before/after `target`.
export function dropIndex(dragged, target, after) {
  let idx = target.index + (after ? 1 : 0);
  if (dragged.index < idx) idx -= 1;
  return idx;
}

export async function performDrop(dragTabId, targetTabId, after) {
  if (dragTabId === targetTabId) return;
  const [dragged, target] = await Promise.all([chrome.tabs.get(dragTabId), chrome.tabs.get(targetTabId)]);
  if (dragged.windowId !== target.windowId) {
    await chrome.tabs.move(dragTabId, { windowId: target.windowId, index: target.index + (after ? 1 : 0) });
    return;
  }
  if (dragged.pinned !== target.pinned) await chrome.tabs.update(dragTabId, { pinned: target.pinned });
  const fresh = await chrome.tabs.get(dragTabId);
  if (target.groupId !== fresh.groupId) {
    if (target.groupId > -1) await chrome.tabs.group({ tabIds: [dragTabId], groupId: target.groupId });
    else await chrome.tabs.ungroup([dragTabId]);
  }
  const d = await chrome.tabs.get(dragTabId);
  const t = await chrome.tabs.get(targetTabId);
  await chrome.tabs.move(dragTabId, { index: dropIndex(d, t, after) });
}

export function mountTabList(root, { filterInput, windowId } = {}) {
  async function render() {
    const needle = (filterInput?.value || "").toLowerCase().trim();
    const query = windowId ? { windowId } : { currentWindow: true };
    const tabs = (await chrome.tabs.query(query)).sort((a, b) => a.index - b.index);
    const groups = new Map((await chrome.tabGroups.query(windowId ? { windowId } : {})).map((g) => [g.id, g]));
    const rows = [];
    let lastGroup = -2;
    let sawPinned = false, sawLoose = false;
    for (const t of tabs) {
      if (needle && !`${t.title} ${t.url}`.toLowerCase().includes(needle)) continue;
      if (t.pinned && !sawPinned) { rows.push(heading("Pinned")); sawPinned = true; }
      if (!t.pinned && !sawLoose) { if (sawPinned) rows.push(heading("Tabs")); sawLoose = true; }
      if (!t.pinned && t.groupId !== lastGroup) {
        if (t.groupId > -1) rows.push(groupHeader(groups.get(t.groupId), t.groupId));
        lastGroup = t.groupId;
      }
      if (t.groupId > -1 && groups.get(t.groupId)?.collapsed && !needle) continue;
      rows.push(tabRow(t, groups.get(t.groupId)));
    }
    root.replaceChildren(...rows);
  }

  function heading(text) {
    const li = document.createElement("li");
    li.className = "heading";
    li.textContent = text;
    return li;
  }

  function groupHeader(g, id) {
    const li = document.createElement("li");
    li.className = "group-header";
    li.dataset.groupId = id;
    li.style.borderLeft = `4px solid ${groupCss(g?.color)}`;
    li.textContent = `${g?.collapsed ? "▸" : "▾"} ${g?.title || "Group"}`;
    li.onclick = () => chrome.tabGroups.update(id, { collapsed: !g?.collapsed });
    return li;
  }

  function tabRow(t, g) {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.tabId = t.id;
    li.className = [t.active ? "active" : "", t.pinned ? "pinned" : "", t.groupId > -1 ? "grouped" : ""].join(" ").trim();
    if (g) li.style.borderLeft = `4px solid ${groupCss(g.color)}`;
    const title = document.createElement("span");
    title.textContent = t.title || t.url;
    const pin = document.createElement("button");
    pin.textContent = t.pinned ? "Unpin" : "Pin";
    pin.onclick = (e) => { e.stopPropagation(); chrome.tabs.update(t.id, { pinned: !t.pinned }); };
    const close = document.createElement("button");
    close.textContent = "×";
    close.title = "Close tab";
    close.onclick = (e) => { e.stopPropagation(); chrome.tabs.remove(t.id); };
    li.onclick = () => chrome.tabs.update(t.id, { active: true });
    li.addEventListener("dragstart", (e) => { dragId = t.id; e.dataTransfer?.setData("text/plain", String(t.id)); });
    li.addEventListener("dragend", () => { dragId = null; });
    li.addEventListener("dragover", (e) => { if (dragId != null) e.preventDefault(); });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragId == null) return;
      const r = li.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const id = dragId;
      dragId = null;
      performDrop(id, t.id, after).catch((err) => console.warn("drop failed", err));
    });
    li.append(title, pin, close);
    return li;
  }

  const events = ["onCreated", "onRemoved", "onUpdated", "onActivated", "onMoved", "onAttached", "onDetached"];
  for (const ev of events) chrome.tabs[ev].addListener(render);
  for (const ev of ["onCreated", "onUpdated", "onRemoved"]) chrome.tabGroups[ev].addListener(render);
  filterInput?.addEventListener("input", render);
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === "shell/spaces/changed") render(); });
  render();
  return { render };
}

const CSS = { grey: "#9aa0a6", blue: "#4285f4", red: "#ea4335", yellow: "#fbbc04", green: "#34a853", pink: "#ff63b8", purple: "#a142f4", cyan: "#24c1e0", orange: "#fa903e" };
function groupCss(c) { return CSS[c] || CSS.grey; }
