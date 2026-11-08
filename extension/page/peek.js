// Hover link peek: small preview card for a hovered link. Classic script.
(() => {
  const FP = globalThis.__facetPage;
  let timer = null, card = null, anchor = null, seq = 0;

  function hide() {
    clearTimeout(timer); seq++; anchor = null;
    if (card) { card.remove(); card = null; }
  }
  function show(a, info) {
    if (card) card.remove();
    card = document.createElement("div");
    card.id = "facet-page-peek";
    card.style.cssText = "all:initial;position:fixed;z-index:2147483645;pointer-events:none;";
    const r = card.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = ".c{width:320px;background:#1e1e20;color:#eee;border-radius:10px;box-shadow:0 6px 24px #0008;overflow:hidden;font:13px/1.4 system-ui,sans-serif}img{display:block;width:100%;max-height:150px;object-fit:cover}.b{padding:10px 12px}.t{font-weight:600;margin-bottom:4px}.d{opacity:.8;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.u{opacity:.5;margin-top:6px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}";
    const c = document.createElement("div"); c.className = "c";
    if (info.image) { const im = document.createElement("img"); im.referrerPolicy = "no-referrer"; im.src = info.image; c.appendChild(im); }
    const b = document.createElement("div"); b.className = "b";
    const mk = (cls, t) => { const d = document.createElement("div"); d.className = cls; d.textContent = t; b.appendChild(d); };
    mk("t", info.title || info.url);
    if (info.description) mk("d", info.description);
    mk("u", info.url);
    c.appendChild(b);
    r.append(st, c);
    const rect = a.getBoundingClientRect();
    card.style.left = Math.min(Math.max(8, rect.left), innerWidth - 336) + "px";
    const below = rect.bottom + 8;
    card.style.top = (below + 220 > innerHeight ? Math.max(8, rect.top - 228) : below) + "px";
    document.documentElement.appendChild(card);
  }

  addEventListener("mouseover", (e) => {
    const mode = FP.settings.peek;
    if (mode === "off") return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a === anchor) return;
    hide();
    if (mode === "shift" && !e.shiftKey) return;
    let url;
    try { url = new URL(a.href); } catch (_) { return; }
    if (!/^https?:$/.test(url.protocol) || (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search)) return;
    anchor = a;
    const mine = seq;
    timer = setTimeout(async () => {
      try {
        const info = await chrome.runtime.sendMessage({ type: "facet:peek", url: FP.cleanUrl(a.href) });
        if (mine === seq && info && info.ok) show(a, info);
      } catch (_) {}
    }, 600);
  }, true);
  addEventListener("mouseout", (e) => { if (anchor && (!e.relatedTarget || !anchor.contains(e.relatedTarget))) hide(); }, true);
  addEventListener("scroll", hide, true);
  addEventListener("keydown", hide, true);
})();
