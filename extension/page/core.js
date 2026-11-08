// Shared namespace for the page content scripts. Classic script, no imports.
(() => {
  if (globalThis.__facetPage) return;
  const FP = (globalThis.__facetPage = { handlers: {}, lastTarget: null, lastPoint: null });

  const DEFAULTS = {
    cleanLinks: true,
    peek: "shift", // "shift" = hold Shift while hovering, "always", "off"
    darkSites: {},
    calmSites: {},
    calmAll: false,
    sponsorBlock: true,
    sponsorCategories: ["sponsor", "selfpromo", "interaction"],
    highlightColor: "#ffe066",
    readerTheme: "light",
    readerSize: 19,
    readerFont: "serif",
    speedByHost: {},
  };
  FP.settings = { ...DEFAULTS };
  const KEY = "facetPageSettings";
  const listeners = [];
  FP.onSettings = (fn) => listeners.push(fn);
  FP.ready = chrome.storage.local.get(KEY).then((r) => {
    FP.settings = { ...DEFAULTS, ...(r[KEY] || {}) };
  }).catch(() => {});
  FP.save = async (patch) => {
    FP.settings = { ...FP.settings, ...patch };
    await chrome.storage.local.set({ [KEY]: FP.settings });
  };
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch[KEY]) return;
    FP.settings = { ...DEFAULTS, ...(ch[KEY].newValue || {}) };
    listeners.forEach((fn) => { try { fn(FP.settings); } catch (_) {} });
  });

  const TRACK = /^(utm_.*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|hsa_.*|igshid|igsh|yclid|twclid|ttclid|li_fat_id|ref_src|ref_url|spm|vero_id|oly_anon_id|oly_enc_id|mkt_tok|_ga|_gl|s_cid|cmpid|ocid|trk|trkcampaign|__s|rb_clickid|wickedid|_openstat|piwik_.*|pk_.*|mtm_.*)$/i;
  const SI_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/i;
  FP.cleanUrl = (raw, base) => {
    let u;
    try { u = new URL(raw, base || location.href); } catch (_) { return raw; }
    if (!/^https?:$/.test(u.protocol)) return raw;
    // Unwrap common redirect wrappers.
    for (let i = 0; i < 3; i++) {
      const h = u.hostname.replace(/^www\./, "");
      let inner = null;
      if (/^google\.[a-z.]+$/.test(h) && u.pathname === "/url") inner = u.searchParams.get("q") || u.searchParams.get("url");
      else if (h === "facebook.com" && u.pathname === "/l.php") inner = u.searchParams.get("u");
      else if (h === "l.facebook.com" || h === "lm.facebook.com") inner = u.searchParams.get("u");
      if (!inner) break;
      try { u = new URL(inner); } catch (_) { break; }
    }
    const drop = [];
    for (const k of u.searchParams.keys()) {
      if (TRACK.test(k) || (k === "si" && SI_HOSTS.test(u.hostname))) drop.push(k);
    }
    drop.forEach((k) => u.searchParams.delete(k));
    return u.toString();
  };

  FP.toast = (msg) => {
    try {
      let host = document.getElementById("facet-page-toast");
      if (!host) {
        host = document.createElement("div");
        host.id = "facet-page-toast";
        host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;";
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = '<style>div{font:13px system-ui,sans-serif;background:#222;color:#fff;padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px #0006;max-width:320px}</style><div></div>';
        (document.body || document.documentElement).appendChild(host);
      }
      const box = host.shadowRoot.querySelector("div");
      box.textContent = msg;
      host.style.display = "";
      clearTimeout(FP._toastT);
      FP._toastT = setTimeout(() => { host.style.display = "none"; }, 2200);
    } catch (_) {}
  };

  FP.copy = async (text) => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {}
    if (!ok) {
      const sel = getSelection();
      const saved = sel ? Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i)) : [];
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove();
      if (sel && saved.length) { sel.removeAllRanges(); saved.forEach((r) => sel.addRange(r)); } // keep the user's selection
    }
    FP.toast(ok ? "Copied" : "Copy failed");
    return ok;
  };

  addEventListener("contextmenu", (e) => {
    FP.lastTarget = e.target;
    FP.lastPoint = { x: e.clientX, y: e.clientY };
  }, true);

  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (!m || m.type !== "facet:page:action") return;
    const h = FP.handlers[m.action];
    if (!h) return; // another frame or script may answer
    Promise.resolve()
      .then(() => FP.ready)
      .then(() => h(m))
      .then((r) => send(r === undefined ? { ok: true } : r), (e) => send({ ok: false, error: String(e && e.message || e) }));
    return true;
  });
})();
