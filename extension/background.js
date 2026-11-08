import { register as registerPage } from "./page/index.js";
import { register as registerAi } from "./ai/index.js";
import { register as registerNative } from "./native/index.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-sidebar" && tab) await chrome.sidePanel.open({ windowId: tab.windowId });
});

registerPage();
registerAi();
registerNative();
