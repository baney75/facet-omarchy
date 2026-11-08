// Command registry shared by the palette (titles) and the service worker (run).
import * as spaces from "./spaces.js";
import * as tabs from "./tabs.js";
import { domainOf } from "./util.js";

const open = (url) => async (ctx) => chrome.tabs.create({ windowId: ctx.windowId, url });

export const COMMANDS = [
  { id: "tab.new", title: "New Tab", run: (c) => chrome.tabs.create({ windowId: c.windowId }) },
  { id: "tab.close", title: "Close Tab", run: async (c) => chrome.tabs.remove((await tabs.activeTab(c.windowId)).id) },
  { id: "tab.duplicate", title: "Duplicate Tab", run: async (c) => chrome.tabs.duplicate((await tabs.activeTab(c.windowId)).id) },
  { id: "tab.pin", title: "Pin or Unpin Tab", run: async (c) => tabs.togglePin((await tabs.activeTab(c.windowId)).id) },
  {
    id: "tab.mute", title: "Mute or Unmute Tab",
    run: async (c) => { const t = await tabs.activeTab(c.windowId); return chrome.tabs.update(t.id, { muted: !t.mutedInfo?.muted }); },
  },
  { id: "tab.closeOthers", title: "Close Other Tabs", run: async (c) => tabs.closeOthers((await tabs.activeTab(c.windowId)).id) },
  { id: "tab.reopen", title: "Reopen Closed Tab", run: () => chrome.sessions.restore() },
  { id: "tabs.tidy", title: "Tidy Tabs by Domain", run: (c) => tabs.tidyByDomain(c.windowId) },
  { id: "tabs.ungroup", title: "Ungroup All Tabs", run: (c) => tabs.ungroupAll(c.windowId) },
  {
    id: "group.new", title: "New Group from Tab",
    run: async (c) => { const t = await tabs.activeTab(c.windowId); return tabs.groupTabs([t.id], { title: domainOf(t.url) || "Group" }); },
  },
  { id: "space.new", title: "New Space", run: (c, a) => spaces.createSpace(c.windowId, a?.name) },
  { id: "space.next", title: "Next Space", run: (c) => spaces.cycleSpace(c.windowId, 1) },
  { id: "space.prev", title: "Previous Space", run: (c) => spaces.cycleSpace(c.windowId, -1) },
  {
    id: "space.rename", title: "Rename Space",
    run: async (c, a) => { const { activeId } = await spaces.listSpaces(c.windowId); return spaces.renameSpace(activeId, a?.name); },
  },
  {
    id: "space.delete", title: "Delete Space",
    run: async (c) => { const { activeId } = await spaces.listSpaces(c.windowId); return spaces.deleteSpace(c.windowId, activeId); },
  },
  { id: "page.history", title: "Show All History", run: open("chrome://history") },
  { id: "page.bookmarks", title: "Open Bookmarks Manager", run: open("chrome://bookmarks") },
  { id: "page.downloads", title: "Show Downloads", run: open("chrome://downloads") },
  { id: "page.extensions", title: "Open Extensions", run: open("chrome://extensions") },
];

export async function runCommand(id, ctx, args) {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) throw new Error(`Unknown command ${id}`);
  return (await cmd.run(ctx, args)) ?? { ok: true };
}

// Commands whose title depends on the query text: "new space Work", "rename space Home".
export function dynamicCommands(query) {
  const out = [];
  let m = /^new space\s+(.+)$/i.exec(query);
  if (m) out.push({ id: "space.new", title: `New Space "${m[1].trim()}"`, args: { name: m[1].trim() } });
  m = /^rename space\s+(.+)$/i.exec(query);
  if (m) out.push({ id: "space.rename", title: `Rename Space to "${m[1].trim()}"`, args: { name: m[1].trim() } });
  return out;
}
