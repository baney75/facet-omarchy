// Pop out and split helpers, placed with plain window bounds (no display API needed).
export async function popOutTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const win = await chrome.windows.get(tab.windowId);
  const created = await chrome.windows.create({
    tabId,
    focused: true,
    type: "normal",
    left: win.left == null ? undefined : win.left + 40,
    top: win.top == null ? undefined : win.top + 40,
    width: win.width,
    height: win.height,
  });
  return { windowId: created.id, tabId };
}

// Open a url beside the current window: current window takes the left half, new one the right half.
export async function openSideBySide(sourceWindowId, url) {
  const src = await chrome.windows.get(sourceWindowId);
  const { left = 0, top = 0, width = 1200, height = 800 } = src;
  const half = Math.floor(width / 2);
  await chrome.windows.update(sourceWindowId, { state: "normal" });
  await chrome.windows.update(sourceWindowId, { left, top, width: half, height });
  const created = await chrome.windows.create({ url, type: "normal", left: left + half, top, width: width - half, height, focused: true });
  return { leftWindowId: sourceWindowId, rightWindowId: created.id };
}

// Small popup window for a link.
export async function openPopup(url, { width = 480, height = 640 } = {}) {
  const created = await chrome.windows.create({ url, type: "popup", width, height, focused: true });
  return { windowId: created.id };
}
