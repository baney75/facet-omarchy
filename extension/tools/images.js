// Image context menu: copy image, open image, Google Lens by URL.
export const lensUrl = (src) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(src)}`;

// Runs in the page. Copies as PNG so any pasted target accepts it.
async function copyInPage(src) {
  const blob = await (await fetch(src)).blob();
  let png = blob;
  if (blob.type !== "image/png") {
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    png = await c.convertToBlob({ type: "image/png" });
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  return true;
}

export async function copyImage(tabId, src) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: copyInPage, args: [src] });
  return !!r?.result;
}

export const openImage = (src) => chrome.tabs.create({ url: src });
export const lensSearch = (src) => chrome.tabs.create({ url: lensUrl(src) });

export function registerImageMenus() {
  chrome.contextMenus.create({ id: "tools-img-copy", title: "Copy image", contexts: ["image"] });
  chrome.contextMenus.create({ id: "tools-img-open", title: "Open image in new tab", contexts: ["image"] });
  chrome.contextMenus.create({ id: "tools-img-lens", title: "Search image with Google Lens", contexts: ["image"] });
}

export async function onImageMenu(info, tab) {
  const src = info.srcUrl;
  if (!src) return;
  if (info.menuItemId === "tools-img-copy" && tab?.id != null) await copyImage(tab.id, src);
  else if (info.menuItemId === "tools-img-open") await openImage(src);
  else if (info.menuItemId === "tools-img-lens") await lensSearch(src);
}
