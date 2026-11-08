// Action registry shared by the worker (run) and the developer palette (titles, availability).
import { githubActions, parseGithubUrl } from "./github.js";
import { externalAppLink, listExternalApps, openInApp } from "./applinks.js";
import { listShortcuts, resolveShortcut } from "./shortcuts.js";
import { sitePermissions } from "./permissions.js";
import { popOutTab, openSideBySide, openPopup } from "./windows.js";
import { toggleRecording, isRecording } from "./recorder.js";
import { activeTab, copyToTab } from "./util.js";

async function needGithub(tab) {
  const g = githubActions(tab.url);
  if (!g) throw new Error("Not a GitHub repo or PR page");
  return g;
}

export const ACTIONS = [
  {
    id: "github.clone", title: "GitHub: Copy git clone Command", when: (t) => Boolean(parseGithubUrl(t.url)),
    run: async (t) => { const g = await needGithub(t); return { copied: await copyToTab(t.id, g.clone), text: g.clone }; },
  },
  {
    id: "github.prCheckout", title: "GitHub: Copy gh pr checkout Command", when: (t) => Boolean(parseGithubUrl(t.url)?.pr),
    run: async (t) => {
      const g = await needGithub(t);
      if (!g.prCheckout) throw new Error("Not a pull request page");
      return { copied: await copyToTab(t.id, g.prCheckout), text: g.prCheckout };
    },
  },
  {
    id: "github.codespaces", title: "GitHub: Open in Codespaces", when: (t) => Boolean(parseGithubUrl(t.url)),
    run: async (t) => { const g = await needGithub(t); await chrome.tabs.create({ windowId: t.windowId, url: g.codespaces }); return { url: g.codespaces }; },
  },
  {
    id: "app.open", title: "Open in Desktop App", when: (t) => Boolean(externalAppLink(t.url)),
    run: async (t) => {
      const link = externalAppLink(t.url);
      if (!link) throw new Error(`No desktop app link for this page (${listExternalApps().join(", ")})`);
      await openInApp(t.id, link.url);
      return link;
    },
  },
  { id: "site.permissions", title: "Show Site Permissions", run: (t) => sitePermissions(t.id) },
  { id: "tab.popOut", title: "Pop Out Tab to Window", run: (t) => popOutTab(t.id) },
  {
    id: "split.link", title: "Open Link Side by Side", needsUrl: true,
    run: (t, a) => openSideBySide(t.windowId, a?.url || t.url),
  },
  { id: "popup.open", title: "Open Link in Popup Window", needsUrl: true, run: (t, a) => openPopup(a?.url || t.url) },
  {
    id: "tab.record", title: "Record Tab to WebM (toggle)", run: async (t) => toggleRecording(t.id),
    titleFor: (t) => (isRecording(t.id) ? "Stop Recording Tab" : "Record Tab to WebM"),
  },
  {
    id: "shortcut.list", title: "List Site Shortcuts", run: async () => ({ shortcuts: await listShortcuts() }),
  },
  { id: "shortcut.open", title: "Open Site Shortcut", needsQuery: true, run: async (t, a) => {
    const url = await resolveShortcut(a?.query);
    if (!url) throw new Error("No shortcut matches");
    await chrome.tabs.create({ windowId: t.windowId, url });
    return { url };
  } },
];

export async function runAction(id, tabOrNull, args) {
  const action = ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`Unknown dev action ${id}`);
  const tab = args?.tabId ? await chrome.tabs.get(args.tabId) : tabOrNull || (await activeTab());
  return (await action.run(tab, args)) ?? { ok: true };
}

export async function describeActions(tab) {
  return ACTIONS.map((a) => ({
    id: a.id, title: a.titleFor ? a.titleFor(tab) : a.title, available: a.when ? Boolean(tab && a.when(tab)) : true,
    needsUrl: Boolean(a.needsUrl), needsQuery: Boolean(a.needsQuery),
  }));
}
