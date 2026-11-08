// Entry point. background.js: import { register } from "./tools/index.js"; register();
import { answer } from "./answer.js";
import * as rewind from "./rewind.js";
import * as dl from "./downloads.js";
import * as img from "./images.js";
import * as pdf from "./pdf.js";
import { findDevServers } from "./devservers.js";

export { answer };
let registered = false;

const ROUTES = {
  "tools/answer": (m) => answer(m.query, { units: m.units }),
  "tools/rewind/search": (m) => rewind.rewindSearch(m.query || "", { limit: m.limit }),
  "tools/rewind/index": (m) => rewind.indexPage(m.page),
  "tools/rewind/capture": (m) => rewind.capture(m.tabId),
  "tools/rewind/forget": (m) => rewind.forget(m.url),
  "tools/rewind/count": () => rewind.count(),
  "tools/downloads/list": (m) => dl.listDownloads(m.limit),
  "tools/downloads/tidy": () => dl.tidyPreview(),
  "tools/downloads/rename": async (m) => {
    const r = await dl.renameDownload(m.id, m.name);
    if (m.removeOld) await dl.removeOld(m.id);
    return r;
  },
  "tools/downloads/move": async (m) => {
    const r = await dl.relocate(m.id, m.path);
    if (m.removeOld) await dl.removeOld(m.id);
    return r;
  },
  "tools/downloads/autotidy": (m) => dl.setAutoTidy(m.on),
  "tools/devservers": (m) => findDevServers(m),
  "tools/pdf/open": (m) => pdf.openPdf(m.url),
  "tools/open": (m) => chrome.tabs.create({ url: chrome.runtime.getURL(`tools/${m.page || "live"}.html`) }),
};

export function register() {
  if (registered) return;
  registered = true;

  rewind.startCapture();
  dl.startDownloads();

  chrome.runtime.onInstalled.addListener(() => {
    img.registerImageMenus();
    pdf.registerPdfMenus();
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    const id = String(info.menuItemId);
    if (id.startsWith("tools-img-")) img.onImageMenu(info, tab).catch(console.error);
    else if (id.startsWith("tools-pdf-")) pdf.onPdfMenu(info).catch(console.error);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    const route = msg && typeof msg.type === "string" ? ROUTES[msg.type] : null;
    if (!route) return false;
    Promise.resolve()
      .then(() => route(msg))
      .then((data) => send({ ok: true, data }), (e) => send({ ok: false, error: String(e?.message || e) }));
    return true;
  });
}
