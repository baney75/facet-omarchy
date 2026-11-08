// Link cleaning, Markdown link, quote link. Classic script.
(() => {
  const FP = globalThis.__facetPage;

  function anchorFor(m) {
    const t = FP.lastTarget;
    const a = t && t.closest ? t.closest("a[href]") : null;
    if (a && (!m.linkUrl || a.href === m.linkUrl || FP.cleanUrl(a.href) === FP.cleanUrl(m.linkUrl))) return a;
    return null;
  }

  // Rewrite tracking parameters in place just before a link is used.
  function cleanAnchor(e) {
    if (!FP.settings.cleanLinks) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    const c = FP.cleanUrl(a.href);
    if (c !== a.href) a.href = c;
  }
  for (const ev of ["pointerdown", "contextmenu", "auxclick", "keydown", "dragstart"]) addEventListener(ev, cleanAnchor, true);

  // Remove tracking parameters from the address of the page being viewed.
  function cleanLocation() {
    if (!FP.settings.cleanLinks || !/^https?:$/.test(location.protocol)) return;
    const c = FP.cleanUrl(location.href);
    if (c !== location.href) { try { history.replaceState(history.state, "", c); } catch (_) {} }
  }
  FP.ready.then(cleanLocation);

  FP.handlers.copyCleanLink = async (m) => {
    const url = FP.cleanUrl(m.linkUrl || location.href);
    const ok = await FP.copy(url);
    return { ok, text: url };
  };

  FP.handlers.copyMarkdownLink = async (m) => {
    let url, text;
    if (m.linkUrl) {
      const a = anchorFor(m);
      url = FP.cleanUrl(m.linkUrl);
      text = ((a && (a.textContent || a.getAttribute("aria-label"))) || "").replace(/\s+/g, " ").trim() || url;
    } else {
      url = FP.cleanUrl(location.href);
      text = document.title.trim() || url;
    }
    const out = FP.mdLink(text, url);
    const ok = await FP.copy(out);
    return { ok, text: out };
  };

  const enc = (s) => encodeURIComponent(s).replace(/-/g, "%2D");
  FP.quoteUrl = (selText) => {
    const t = selText.replace(/\s+/g, " ").trim();
    if (!t) return null;
    const w = t.split(" ");
    let frag;
    if (t.length <= 300 || w.length <= 8) frag = enc(t);
    else frag = enc(w.slice(0, 4).join(" ")) + "," + enc(w.slice(-4).join(" "));
    const u = new URL(FP.cleanUrl(location.href));
    u.hash = "";
    return u.toString() + "#:~:text=" + frag;
  };
  FP.handlers.copyQuoteLink = async (m) => {
    const sel = (getSelection() && getSelection().toString()) || m.selectionText || "";
    const url = FP.quoteUrl(sel);
    if (!url) { FP.toast("Select some text first"); return { ok: false, error: "no selection" }; }
    const ok = await FP.copy(url);
    return { ok, text: url };
  };
})();
