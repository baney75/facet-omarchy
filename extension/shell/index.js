// Entry point. background.js: import { register } from "./shell/index.js"; register();
import * as spaces from "./spaces.js";
import * as tabs from "./tabs.js";
import { COMMANDS, runCommand } from "./commands.js";

let registered = false;

export async function openPalette() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
  const w = win?.id ?? "";
  const width = 680, height = 460;
  const left = win ? Math.round((win.left ?? 0) + ((win.width ?? 1280) - width) / 2) : undefined;
  const top = win ? Math.round((win.top ?? 0) + 80) : undefined;
  return chrome.windows.create({
    url: chrome.runtime.getURL(`shell/palette.html?w=${w}`),
    type: "popup", width, height, left, top, focused: true,
  });
}

async function currentWindowId() {
  const w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
  return w.id;
}

const ROUTES = {
  "shell/spaces/list": (m) => spaces.listSpaces(m.windowId),
  "shell/spaces/create": (m) => spaces.createSpace(m.windowId, m.name, { switchTo: m.switch !== false }),
  "shell/spaces/switch": (m) => spaces.switchSpace(m.windowId, m.spaceId),
  "shell/spaces/rename": (m) => spaces.renameSpace(m.spaceId, m.name),
  "shell/spaces/delete": (m) => spaces.deleteSpace(m.windowId, m.spaceId),
  "shell/tabs/pin": (m) => tabs.togglePin(m.tabId),
  "shell/tabs/group": (m) => tabs.groupTabs(m.tabIds, m),
  "shell/tabs/ungroup": (m) => tabs.ungroupTabs(m.tabIds),
  "shell/tabs/tidy": (m) => tabs.tidyByDomain(m.windowId, m),
  "shell/tabs/move": (m) => tabs.moveTab(m.tabId, m.index),
  "shell/command": (m) => runCommand(m.id, { windowId: m.windowId }, m.args),
  "shell/palette/open": () => openPalette().then(() => ({ ok: true })),
  "shell/commands/list": () => COMMANDS.map(({ id, title }) => ({ id, title })),
};

const COMMAND_HANDLERS = {
  "open-palette": () => openPalette(),
  "tidy-tabs": async () => tabs.tidyByDomain(await currentWindowId()),
  "new-space": async () => spaces.createSpace(await currentWindowId()),
  "next-space": async () => spaces.cycleSpace(await currentWindowId(), 1),
  "prev-space": async () => spaces.cycleSpace(await currentWindowId(), -1),
  "toggle-pin": async () => tabs.togglePin((await tabs.activeTab(await currentWindowId())).id),
};

export function register() {
  if (registered) return;
  registered = true;
  spaces.initSpaceTracking();

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    const route = msg && typeof msg.type === "string" ? ROUTES[msg.type] : null;
    if (!route) return false;
    Promise.resolve()
      .then(() => route(msg))
      .then((data) => send({ ok: true, data }), (e) => send({ ok: false, error: String(e?.message || e) }));
    return true;
  });

  chrome.commands.onCommand.addListener((command) => {
    const h = COMMAND_HANDLERS[command];
    if (h) h().catch((e) => console.warn("shell command failed", command, e));
  });

  chrome.runtime.onInstalled.addListener(async () => {
    try { await spaces.ensureWindow(await currentWindowId()); } catch {}
  });
  chrome.runtime.onStartup.addListener(async () => {
    try { await spaces.ensureWindow(await currentWindowId()); } catch {}
  });
  chrome.windows.onCreated.addListener((w) => {
    if (w.type === "normal") spaces.ensureWindow(w.id).catch(() => {});
  });
}
