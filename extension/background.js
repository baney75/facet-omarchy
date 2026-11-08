chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-sidebar" && tab) await chrome.sidePanel.open({ windowId: tab.windowId });
});
