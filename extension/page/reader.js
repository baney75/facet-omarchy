// Reader mode overlay. Classic script.
(() => {
  const FP = globalThis.__facetPage;
  const TAG = "facet-page-reader";
  const THEMES = {
    light: ["#fbfbfa", "#1d1d1b", "#0b57d0"],
    sepia: ["#f4ecd8", "#433422", "#7a4a12"],
    dark: ["#16181a", "#d8d8d4", "#8ab4f8"],
  };
  let prevOverflow = null;

  function close() {
    const h = document.getElementById(TAG);
    if (!h) return false;
    h.remove();
    document.documentElement.style.overflow = prevOverflow || "";
    removeEventListener("keydown", onKey, true);
    return true;
  }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }

  function open() {
    const art = FP.extractArticle();
    const host = document.createElement("div");
    host.id = TAG;
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;";
    const root = host.attachShadow({ mode: "open" });
    const css = document.createElement("style");
    root.appendChild(css);
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const bar = document.createElement("div");
    bar.className = "bar";
    const mk = (label, fn, title) => { const b = document.createElement("button"); b.textContent = label; b.title = title || label; b.addEventListener("click", fn); bar.appendChild(b); return b; };
    const article = document.createElement("article");
    const h = document.createElement("h1");
    h.textContent = art.title;
    const by = document.createElement("p");
    by.className = "by";
    by.textContent = [art.byline, art.site].filter(Boolean).join(" · ");
    article.append(h, by, art.body);
    wrap.append(bar, article);
    root.appendChild(wrap);

    const s = FP.settings;
    const state = { theme: s.readerTheme in THEMES ? s.readerTheme : "light", size: s.readerSize, font: s.readerFont };
    const paint = () => {
      const [bg, fg, ln] = THEMES[state.theme];
      css.textContent = `
:host{all:initial}
.wrap{position:absolute;inset:0;overflow:auto;background:${bg};color:${fg};font:${state.size}px/1.65 ${state.font === "serif" ? "Georgia,'Times New Roman',serif" : "system-ui,sans-serif"}}
.bar{position:sticky;top:0;display:flex;gap:6px;justify-content:flex-end;padding:8px 12px;background:${bg};border-bottom:1px solid ${fg}22;font:13px system-ui,sans-serif}
button{font:inherit;color:${fg};background:transparent;border:1px solid ${fg}44;border-radius:6px;padding:3px 9px;cursor:pointer}
button:hover{background:${fg}18}
article{max-width:42em;margin:0 auto;padding:2em 1.2em 6em}
h1{font-size:1.7em;line-height:1.2;margin:.4em 0 .2em}
.by{font:13px system-ui,sans-serif;opacity:.65;margin:0 0 1.6em}
a{color:${ln}} img{max-width:100%;height:auto} pre{overflow:auto;padding:.8em;background:${fg}12;border-radius:6px;font-size:.8em}
blockquote{margin:1em 0;padding-left:1em;border-left:3px solid ${fg}44;opacity:.9} table{border-collapse:collapse} td,th{border:1px solid ${fg}33;padding:4px 8px}`;
    };
    mk("A-", () => { state.size = Math.max(12, state.size - 1); paint(); FP.save({ readerSize: state.size }); }, "Smaller text");
    mk("A+", () => { state.size = Math.min(36, state.size + 1); paint(); FP.save({ readerSize: state.size }); }, "Larger text");
    mk("Font", () => { state.font = state.font === "serif" ? "sans" : "serif"; paint(); FP.save({ readerFont: state.font }); }, "Switch font");
    mk("Theme", () => { const k = Object.keys(THEMES); state.theme = k[(k.indexOf(state.theme) + 1) % k.length]; paint(); FP.save({ readerTheme: state.theme }); }, "Switch theme");
    mk("Copy Markdown", () => FP.copy("# " + art.title + "\n\nSource: <" + art.url + ">\n\n" + FP.toMarkdown(art.body) + "\n"));
    mk("Read aloud", () => chrome.runtime.sendMessage({ type: "facet:tts", text: art.title + ". " + (art.body.innerText || art.body.textContent) }));
    mk("Stop", () => chrome.runtime.sendMessage({ type: "facet:tts-stop" }));
    mk("Close", close);
    paint();

    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.appendChild(host);
    addEventListener("keydown", onKey, true);
    return art;
  }

  FP.handlers.reader = () => {
    if (close()) return { ok: true, open: false };
    const art = open();
    return { ok: true, open: true, title: art.title, chars: (art.body.textContent || "").length };
  };
})();
