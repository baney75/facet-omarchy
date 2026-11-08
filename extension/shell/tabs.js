// Pinned tabs, tab groups, tidier, reorder. Background-safe helpers.
import { domainOf, colorFor } from "./util.js";

export async function togglePin(tabId) {
  const t = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { pinned: !t.pinned });
  return { tabId, pinned: !t.pinned };
}

export async function activeTab(windowId) {
  const [t] = await chrome.tabs.query({ windowId, active: true });
  return t;
}

export async function groupTabs(tabIds, { title, color } = {}) {
  const first = await chrome.tabs.get(tabIds[0]);
  const gid = await chrome.tabs.group({ tabIds, createProperties: { windowId: first.windowId } });
  const t = title ?? domainOf(first.url) ?? "";
  await chrome.tabGroups.update(gid, { title: t, color: color || colorFor(t || String(gid)) });
  return { groupId: gid };
}

export async function ungroupTabs(tabIds) {
  await chrome.tabs.ungroup(tabIds);
  return { ungrouped: tabIds.length };
}

export async function ungroupAll(windowId) {
  const tabs = (await chrome.tabs.query({ windowId })).filter((t) => t.groupId > -1);
  if (tabs.length) await chrome.tabs.ungroup(tabs.map((t) => t.id));
  return { ungrouped: tabs.length };
}

// Group unpinned, ungrouped tabs by domain. Domains with fewer than minTabs tabs are left alone
// unless a group titled with that domain already exists. A tab already in a group is treated as
// arranged by hand and skipped.
export async function tidyByDomain(windowId, { minTabs = 2 } = {}) {
  const tabs = (await chrome.tabs.query({ windowId })).filter((t) => !t.pinned);
  const existing = await chrome.tabGroups.query({ windowId });
  const byDomain = new Map();
  for (const t of tabs) {
    if (t.groupId > -1) continue;
    const d = domainOf(t.url || t.pendingUrl || "");
    if (!d) continue;
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d).push(t.id);
  }
  let groups = 0, moved = 0;
  for (const [domain, ids] of byDomain) {
    const prior = existing.find((g) => g.title === domain);
    if (!prior && ids.length < minTabs) continue;
    if (prior) await chrome.tabs.group({ tabIds: ids, groupId: prior.id });
    else {
      const gid = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
      await chrome.tabGroups.update(gid, { title: domain, color: colorFor(domain) });
      groups++;
    }
    moved += ids.length;
  }
  return { groups, tabs: moved };
}

export async function moveTab(tabId, index) {
  const t = await chrome.tabs.move(tabId, { index });
  return { tabId, index: Array.isArray(t) ? t[0].index : t.index };
}

export async function closeOthers(tabId) {
  const t = await chrome.tabs.get(tabId);
  const ids = (await chrome.tabs.query({ windowId: t.windowId })).filter((x) => !x.pinned && x.id !== tabId).map((x) => x.id);
  if (ids.length) await chrome.tabs.remove(ids);
  return { closed: ids.length };
}
