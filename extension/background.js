import { register as registerDev } from "./dev/index.js";
import { register as registerShell } from "./shell/index.js";
import { register as registerPage } from "./page/index.js";
import { register as registerAi } from "./ai/index.js";
import { register as registerNative } from "./native/index.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-sidebar" && tab) await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Ollama rejects extension origins unless its service is reconfigured, so drop the header on local calls only.
chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1,
    action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
    condition: { urlFilter: "|http://127.0.0.1:11434/", initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest"] },
  }],
});

registerShell();
registerPage();
registerAi();
registerNative();
registerDev();
