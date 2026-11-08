// Spaces: named tab sets. Each window has one active Space; the other Spaces are
// stored as snapshots (url, title, group) in chrome.storage.local. Switching
// snapshots the live tabs, opens the target Space's tabs, then closes the old ones.
// Pinned tabs are global to the window and survive switches.
import { colorFor } from "./util.js";

const KEY = "shell.spaces.v1";
const ACTIVE_KEY = "shell.spaces.active"; // storage.session: { [windowId]: spaceId }
const SPACE_COLORS = ["blue", "green", "purple", "orange", "pink", "cyan", "red", "yellow"];

let chain = Promise.resolve();
const switching = new Set();
const closing = new Set();
const timers = new Map();

function serial(fn) {
  const run = chain.then(() => fn());
  chain = run.catch(() => {});
  return run;
}

async function load() {
  const got = await chrome.storage.local.get(KEY);
  return got[KEY] || { spaces: [] };
}
const save = (state) => chrome.storage.local.set({ [KEY]: state });

async function loadActive() {
  const got = await chrome.storage.session.get(ACTIVE_KEY);
  return got[ACTIVE_KEY] || {};
}
const saveActive = (map) => chrome.storage.session.set({ [ACTIVE_KEY]: map });

function newId() {
  return `sp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeSpace(state, name, snap) {
  const n = state.spaces.length;
  return {
    id: newId(),
    name: (name || "").trim() || `Space ${n + 1}`,
    color: SPACE_COLORS[n % SPACE_COLORS.length],
    created: Date.now(),
    updated: Date.now(),
    tabs: snap?.tabs || [],
    groups: snap?.groups || [],
    activeIndex: snap?.activeIndex || 0,
  };
}

export async function snapshotWindow(windowId) {
  const all = await chrome.tabs.query({ windowId });
  const tabs = all.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
  const gs = await chrome.tabGroups.query({ windowId });
  const gmap = new Map(gs.map((g) => [g.id, g]));
  const groupIdx = new Map();
  const groups = [];
  const out = tabs.map((t) => {
    let g = -1;
    if (t.groupId > -1 && gmap.has(t.groupId)) {
      if (!groupIdx.has(t.groupId)) {
        const grp = gmap.get(t.groupId);
        groupIdx.set(t.groupId, groups.length);
        groups.push({ title: grp.title || "", color: grp.color, collapsed: !!grp.collapsed });
      }
      g = groupIdx.get(t.groupId);
    }
    return { url: t.url || t.pendingUrl || "", title: t.title || "", g };
  });
  let activeIndex = tabs.findIndex((t) => t.active);
  if (activeIndex < 0) activeIndex = 0;
  return { tabs: out, groups, activeIndex };
}

async function writeSnapshot(windowId, spaceId) {
  const state = await load();
  const space = state.spaces.find((s) => s.id === spaceId);
  if (!space) return;
  Object.assign(space, await snapshotWindow(windowId), { updated: Date.now() });
  await save(state);
}

async function openSpaceTabs(windowId, space) {
  const ids = [];
  const entries = space.tabs;
  if (!entries.length) {
    const t = await chrome.tabs.create({ windowId, active: true });
    return [t.id];
  }
  const active = Math.min(space.activeIndex || 0, entries.length - 1);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const props = { windowId, active: i === active };
    if (e.url) props.url = e.url;
    try {
      ids.push((await chrome.tabs.create(props)).id);
    } catch {
      ids.push((await chrome.tabs.create({ windowId, active: i === active })).id);
    }
  }
  for (let gi = 0; gi < (space.groups || []).length; gi++) {
    const tabIds = entries.map((e, i) => (e.g === gi ? ids[i] : null)).filter((x) => x != null);
    if (!tabIds.length) continue;
    const gid = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    const g = space.groups[gi];
    await chrome.tabGroups.update(gid, { title: g.title, color: g.color, collapsed: g.collapsed });
  }
  return ids;
}

async function windowExists(id) {
  try { await chrome.windows.get(Number(id)); return true; } catch { return false; }
}

// Make sure the window has an active Space; adopt a matching saved one or create one.
async function ensureWindowLocked(windowId) {
  const state = await load();
  const active = await loadActive();
  for (const [wid, sid] of Object.entries(active)) {
    if (!(await windowExists(wid)) || !state.spaces.some((s) => s.id === sid)) delete active[wid];
  }
  const current = active[windowId];
  if (current && state.spaces.some((s) => s.id === current)) {
    await saveActive(active);
    return current;
  }
  const snap = await snapshotWindow(windowId);
  const used = new Set(Object.values(active));
  const urls = snap.tabs.map((t) => t.url).join("\n");
  const match = state.spaces.find((s) => !used.has(s.id) && s.tabs.length && s.tabs.map((t) => t.url).join("\n") === urls);
  let space = match;
  if (!space) {
    space = makeSpace(state, "", snap);
    state.spaces.push(space);
    await save(state);
  }
  active[windowId] = space.id;
  await saveActive(active);
  return space.id;
}

export const ensureWindow = (windowId) => serial(() => ensureWindowLocked(windowId));

function publicSpace(s, active) {
  return { id: s.id, name: s.name, color: s.color, tabCount: s.tabs.length, active: !!active, updated: s.updated };
}

export function listSpaces(windowId) {
  return serial(async () => {
    const activeId = await ensureWindowLocked(windowId);
    const state = await load();
    const map = await loadActive();
    const activeIn = new Map(Object.entries(map).map(([w, s]) => [s, Number(w)]));
    return {
      activeId,
      spaces: state.spaces.map((s) => ({
        ...publicSpace(s, s.id === activeId),
        tabCount: s.id === activeId ? undefined : s.tabs.length,
        windowId: activeIn.get(s.id) ?? null,
      })),
    };
  }).then(async (res) => {
    // Live count for the active Space.
    const n = (await chrome.tabs.query({ windowId })).filter((t) => !t.pinned).length;
    for (const s of res.spaces) if (s.id === res.activeId) s.tabCount = n;
    return res;
  });
}

export function createSpace(windowId, name, { switchTo = true } = {}) {
  return serial(async () => {
    await ensureWindowLocked(windowId);
    const state = await load();
    const space = makeSpace(state, name);
    state.spaces.push(space);
    await save(state);
    if (switchTo) await switchLocked(windowId, space.id);
    return { id: space.id, name: space.name };
  }).then((r) => { notify(); return r; });
}

async function switchLocked(windowId, spaceId) {
  const state = await load();
  const target = state.spaces.find((s) => s.id === spaceId);
  if (!target) throw new Error("No such Space");
  const active = await loadActive();
  const currentId = active[windowId];
  if (currentId === spaceId) return { switched: false, spaceId };
  // Already open in another window: focus it instead of duplicating its tabs.
  for (const [wid, sid] of Object.entries(active)) {
    if (sid === spaceId && Number(wid) !== windowId && (await windowExists(wid))) {
      await chrome.windows.update(Number(wid), { focused: true });
      return { switched: false, spaceId, focusedWindow: Number(wid) };
    }
  }
  switching.add(windowId);
  try {
    const oldTabs = (await chrome.tabs.query({ windowId })).filter((t) => !t.pinned).map((t) => t.id);
    if (currentId) {
      const cur = state.spaces.find((s) => s.id === currentId);
      if (cur) Object.assign(cur, await snapshotWindow(windowId), { updated: Date.now() });
    }
    await openSpaceTabs(windowId, target);
    if (oldTabs.length) await chrome.tabs.remove(oldTabs);
    target.updated = Date.now();
    await save(state);
    active[windowId] = spaceId;
    await saveActive(active);
  } finally {
    switching.delete(windowId);
  }
  return { switched: true, spaceId };
}

export function switchSpace(windowId, spaceId) {
  return serial(async () => {
    await ensureWindowLocked(windowId);
    return switchLocked(windowId, spaceId);
  }).then((r) => { notify(); return r; });
}

export async function cycleSpace(windowId, dir) {
  const { spaces, activeId } = await listSpaces(windowId);
  if (spaces.length < 2) return { switched: false };
  const i = spaces.findIndex((s) => s.id === activeId);
  const next = spaces[(i + dir + spaces.length) % spaces.length];
  return switchSpace(windowId, next.id);
}

export function renameSpace(spaceId, name) {
  return serial(async () => {
    const clean = (name || "").trim();
    if (!clean) throw new Error("Name is empty");
    const state = await load();
    const s = state.spaces.find((x) => x.id === spaceId);
    if (!s) throw new Error("No such Space");
    s.name = clean;
    await save(state);
    return { id: s.id, name: s.name };
  }).then((r) => { notify(); return r; });
}

export function deleteSpace(windowId, spaceId) {
  return serial(async () => {
    await ensureWindowLocked(windowId);
    const state = await load();
    if (state.spaces.length < 2) throw new Error("Cannot delete the only Space");
    const idx = state.spaces.findIndex((s) => s.id === spaceId);
    if (idx < 0) throw new Error("No such Space");
    const active = await loadActive();
    for (const [wid, sid] of Object.entries(active)) {
      if (sid !== spaceId) continue;
      const fallback = state.spaces.find((s) => s.id !== spaceId);
      if (Number(wid) === windowId) {
        await switchLocked(windowId, fallback.id);
      } else {
        delete active[wid];
        await saveActive(active);
      }
    }
    const fresh = await load();
    fresh.spaces = fresh.spaces.filter((s) => s.id !== spaceId);
    await save(fresh);
    return { deleted: spaceId };
  }).then((r) => { notify(); return r; });
}

function notify() {
  try { chrome.runtime.sendMessage({ type: "shell/spaces/changed" }).catch(() => {}); } catch {}
}

// Keep the active Space's snapshot current as tabs change.
function schedule(windowId) {
  if (windowId == null || switching.has(windowId) || closing.has(windowId)) return;
  clearTimeout(timers.get(windowId));
  timers.set(windowId, setTimeout(() => {
    timers.delete(windowId);
    serial(async () => {
      if (switching.has(windowId) || closing.has(windowId)) return;
      const sid = (await loadActive())[windowId];
      if (sid) await writeSnapshot(windowId, sid);
    }).catch(() => {});
  }, 400));
}

export function initSpaceTracking() {
  const t = chrome.tabs;
  t.onCreated.addListener((tab) => schedule(tab.windowId));
  t.onMoved.addListener((_id, i) => schedule(i.windowId));
  t.onAttached.addListener((_id, i) => schedule(i.newWindowId));
  t.onDetached.addListener((_id, i) => schedule(i.oldWindowId));
  t.onRemoved.addListener((_id, i) => {
    if (i.isWindowClosing) { closing.add(i.windowId); clearTimeout(timers.get(i.windowId)); return; }
    schedule(i.windowId);
  });
  t.onUpdated.addListener((_id, change, tab) => {
    if ("url" in change || "title" in change || "pinned" in change || "groupId" in change) schedule(tab.windowId);
  });
  t.onActivated.addListener((i) => schedule(i.windowId));
  chrome.tabGroups.onCreated.addListener((g) => schedule(g.windowId));
  chrome.tabGroups.onUpdated.addListener((g) => schedule(g.windowId));
  chrome.tabGroups.onRemoved.addListener((g) => schedule(g.windowId));
  chrome.windows.onRemoved.addListener((wid) => {
    serial(async () => {
      const a = await loadActive();
      delete a[wid];
      await saveActive(a);
      closing.delete(wid);
    }).catch(() => {});
  });
}

export { colorFor };
