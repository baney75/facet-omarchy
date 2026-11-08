// Persistent highlights, anchored by text with prefix/suffix context. Classic script.
(() => {
  const FP = globalThis.__facetPage;
  const CTX = 32;
  const key = () => "hl:" + FP.cleanUrl(location.href).split("#")[0];
  const BAD = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "TEMPLATE"]);

  function index() {
    const nodes = [];
    let text = "";
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !BAD.has(n.parentElement.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push({ n, start: text.length }); text += n.nodeValue; }
    return { nodes, text };
  }

  function wrap(idx, a, b, id, color) {
    const segs = idx.nodes.filter((x) => x.start < b && x.start + x.n.nodeValue.length > a);
    // Wrap last to first so earlier splits do not disturb later nodes.
    for (const x of segs.reverse()) {
      const s = Math.max(a - x.start, 0), e = Math.min(b - x.start, x.n.nodeValue.length);
      if (s >= e) continue;
      const r = document.createRange();
      r.setStart(x.n, s); r.setEnd(x.n, e);
      const m = document.createElement("mark");
      m.setAttribute("data-facet-hl", id);
      m.style.cssText = `background:${color};color:inherit;border-radius:2px;`;
      r.surroundContents(m);
    }
  }

  function place(h) {
    const idx = index();
    let at = idx.text.indexOf(h.prefix + h.text + h.suffix);
    let a;
    if (at >= 0) a = at + h.prefix.length;
    else { a = idx.text.indexOf(h.text); if (a < 0) return false; }
    wrap(idx, a, a + h.text.length, h.id, h.color);
    return true;
  }

  async function restore() {
    if (!document.body) return;
    const list = (await chrome.storage.local.get(key()))[key()] || [];
    const todo = list.filter((h) => !document.querySelector(`mark[data-facet-hl="${h.id}"]`));
    const missed = todo.filter((h) => !place(h));
    if (missed.length && !restore.retried) {
      restore.retried = true;
      setTimeout(restore, 2000); // late-rendering pages
    }
    return { restored: todo.length - missed.length, missed: missed.length };
  }
  FP.restoreHighlights = restore;
  FP.ready.then(restore);

  FP.handlers.highlight = async (m) => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return { ok: false, error: "no selection" };
    const r = sel.getRangeAt(0);
    const idx = index();
    let a = Infinity, b = -1;
    for (const x of idx.nodes) {
      if (!r.intersectsNode(x.n)) continue;
      const s = x.n === r.startContainer ? r.startOffset : 0;
      const e = x.n === r.endContainer ? r.endOffset : x.n.nodeValue.length;
      if (s >= e) continue;
      a = Math.min(a, x.start + s);
      b = Math.max(b, x.start + e);
    }
    if (b <= a) return { ok: false, error: "empty" };
    const h = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: idx.text.slice(a, b),
      prefix: idx.text.slice(Math.max(0, a - CTX), a),
      suffix: idx.text.slice(b, b + CTX),
      color: FP.settings.highlightColor,
      t: Date.now(),
    };
    wrap(idx, a, b, h.id, h.color);
    sel.removeAllRanges();
    const list = (await chrome.storage.local.get(key()))[key()] || [];
    list.push(h);
    await chrome.storage.local.set({ [key()]: list });
    return { ok: true, id: h.id, text: h.text };
  };

  FP.handlers.removeHighlight = async () => {
    const t = FP.lastTarget;
    const mark = t && t.closest ? t.closest("mark[data-facet-hl]") : null;
    if (!mark) { FP.toast("No highlight there"); return { ok: false, error: "no highlight under cursor" }; }
    const id = mark.getAttribute("data-facet-hl");
    document.querySelectorAll(`mark[data-facet-hl="${id}"]`).forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
    const list = ((await chrome.storage.local.get(key()))[key()] || []).filter((h) => h.id !== id);
    await chrome.storage.local.set({ [key()]: list });
    return { ok: true };
  };
})();
