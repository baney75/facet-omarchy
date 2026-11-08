// Article extraction, sanitising and Markdown conversion. Classic script.
(() => {
  const FP = globalThis.__facetPage;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "NAV", "ASIDE", "FORM", "BUTTON", "IFRAME", "SVG", "FOOTER", "INPUT", "SELECT", "TEXTAREA", "TEMPLATE", "DIALOG", "OBJECT", "EMBED", "AUDIO", "VIDEO", "CANVAS"]);
  const KEEP = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "EM", "STRONG", "B", "I", "A", "IMG", "FIGURE", "FIGCAPTION", "BR", "HR", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "SUP", "SUB"]);
  const JUNK = /(^|[\s_-])(share|social|newsletter|subscribe|related|promo|advert|ad-|ads|sponsor|comment|breadcrumb|sidebar|toolbar|popup|modal|cookie|recommend|outbrain|taboola)([\s_-]|$)/i;

  const textOf = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  function linkDensity(el) {
    const total = textOf(el).length || 1;
    let l = 0;
    el.querySelectorAll("a").forEach((a) => { l += textOf(a).length; });
    return l / total;
  }
  function hidden(el) {
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
    try { const cs = getComputedStyle(el); return cs.display === "none" || cs.visibility === "hidden"; } catch (_) { return false; }
  }
  const junky = (el) => JUNK.test((el.className && el.className.baseVal === undefined ? el.className : "") + " " + (el.id || ""));

  function findRoot(doc) {
    const scores = new Map();
    const add = (el, s) => scores.set(el, (scores.get(el) || 0) + s);
    for (const p of doc.querySelectorAll("p")) {
      const t = textOf(p);
      if (t.length < 25) continue;
      if (p.closest("nav,aside,footer,form,header[role=banner]")) continue;
      let bad = false;
      for (let a = p.parentElement; a && a !== doc.body; a = a.parentElement) if (junky(a)) { bad = true; break; }
      if (bad) continue;
      const s = 1 + (t.match(/[,，]/g) || []).length + Math.min(t.length / 100, 3);
      const par = p.parentElement;
      if (!par) continue;
      add(par, s);
      if (par.parentElement) add(par.parentElement, s / 2);
    }
    let best = null, bs = 0;
    for (const [el, s] of scores) {
      let v = s * (1 - Math.min(linkDensity(el), 0.9));
      if (el.tagName === "ARTICLE" || el.getAttribute("role") === "main") v *= 1.3;
      if (v > bs) { bs = v; best = el; }
    }
    // If the best is a tiny child of an <article>, use the article.
    const art = best && best.closest("article");
    if (art && textOf(art).length < textOf(best).length * 2.2) best = art;
    return best || doc.querySelector("article,main,[role=main]") || doc.body;
  }

  function absUrl(u) {
    try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch (_) { return null; }
  }

  // Build a sanitised copy in a detached element using only whitelisted tags and attributes.
  function sanitize(src, out, depth = 0) {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) { out.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (SKIP_TAGS.has(tag) || tag === "svg") continue;
      if (hidden(n) || junky(n)) continue;
      if (tag === "PICTURE") { const img = n.querySelector("img"); if (img) sanitize({ childNodes: [img] }, out, depth + 1); continue; }
      if (!KEEP.has(tag)) { sanitize(n, out, depth + 1); continue; }
      if (tag === "IMG") {
        const s = absUrl(n.currentSrc || n.getAttribute("src") || n.getAttribute("data-src") || "");
        if (!s) continue;
        const im = document.createElement("img");
        im.setAttribute("src", s);
        im.setAttribute("alt", n.getAttribute("alt") || "");
        out.appendChild(im);
        continue;
      }
      if (tag === "BR" || tag === "HR") { out.appendChild(document.createElement(tag)); continue; }
      const c = document.createElement(tag);
      if (tag === "A") {
        const h = absUrl(n.getAttribute("href") || "");
        if (!h) { sanitize(n, out, depth + 1); continue; }
        c.setAttribute("href", FP.settings.cleanLinks ? FP.cleanUrl(h) : h);
      }
      sanitize(n, c, depth + 1);
      if (!c.textContent.trim() && !c.querySelector("img")) continue;
      out.appendChild(c);
    }
  }

  const meta = (sel) => { const e = document.querySelector(sel); return e ? (e.getAttribute("content") || e.textContent || "").trim() : ""; };

  FP.extractArticle = () => {
    const root = findRoot(document);
    const body = document.createElement("div");
    sanitize(root, body);
    // Wrap stray text/inline runs so every block is a block.
    let title = meta('meta[property="og:title"]') || (document.querySelector("h1") ? textOf(document.querySelector("h1")) : "") || document.title;
    const h1 = body.querySelector("h1");
    if (h1 && textOf(h1) === title) h1.remove();
    const byline = meta('meta[name="author"]') || meta('[rel="author"]') || meta(".byline,[itemprop=author]");
    const site = meta('meta[property="og:site_name"]') || location.hostname;
    return { title, byline, site, body, url: FP.cleanUrl(location.href) };
  };

  // ---- Markdown -----------------------------------------------------------
  const esc = (s) => s.replace(/([\\`*_\[\]])/g, "\\$1");
  function inline(n) {
    let s = "";
    for (const c of n.childNodes) s += md(c, { list: 0 });
    return s;
  }
  function md(n, ctx) {
    if (n.nodeType === 3) return esc(n.nodeValue.replace(/\s+/g, " "));
    if (n.nodeType !== 1) return "";
    const tag = n.tagName;
    switch (tag) {
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
        return "\n\n" + "#".repeat(+tag[1]) + " " + inline(n).trim() + "\n\n";
      case "P": return "\n\n" + inline(n).trim() + "\n\n";
      case "BR": return "  \n";
      case "HR": return "\n\n---\n\n";
      case "STRONG": case "B": { const t = inline(n).trim(); return t ? "**" + t + "**" : ""; }
      case "EM": case "I": { const t = inline(n).trim(); return t ? "*" + t + "*" : ""; }
      case "CODE": return n.parentElement && n.parentElement.tagName === "PRE" ? n.textContent : "`" + n.textContent + "`";
      case "PRE": return "\n\n```\n" + n.textContent.replace(/\n$/, "") + "\n```\n\n";
      case "A": { const t = inline(n).trim(); const h = n.getAttribute("href"); return t && h ? "[" + t + "](" + h.replace(/\)/g, "%29") + ")" : t; }
      case "IMG": return "![" + esc(n.getAttribute("alt") || "") + "](" + n.getAttribute("src") + ")";
      case "SUP": return "^" + inline(n) ;
      case "BLOCKQUOTE": {
        const t = children(n).trim();
        return "\n\n" + t.split("\n").map((l) => "> " + l).join("\n") + "\n\n";
      }
      case "UL": case "OL": {
        let i = 0, out = "\n";
        for (const li of n.children) {
          if (li.tagName !== "LI") continue;
          i++;
          const bullet = tag === "OL" ? i + ". " : "- ";
          const body = children(li).trim().split("\n");
          out += "\n" + bullet + body[0] + body.slice(1).map((l) => "\n" + " ".repeat(bullet.length) + l).join("");
        }
        return out + "\n\n";
      }
      case "TABLE": {
        const rows = [...n.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => inline(c).trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
        if (!rows.length) return "";
        const w = Math.max(...rows.map((r) => r.length));
        const line = (r) => "| " + Array.from({ length: w }, (_, i) => r[i] || "").join(" | ") + " |";
        return "\n\n" + [line(rows[0]), "|" + " --- |".repeat(w), ...rows.slice(1).map(line)].join("\n") + "\n\n";
      }
      case "FIGURE": case "FIGCAPTION": case "LI": case "TBODY": case "THEAD": case "TR": case "TH": case "TD": default:
        return children(n, ctx);
    }
  }
  function children(n, ctx) {
    let s = "";
    for (const c of n.childNodes) s += md(c, ctx || {});
    return s;
  }
  FP.toMarkdown = (node) => children(node).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  FP.pageMarkdown = () => {
    const a = FP.extractArticle();
    const head = "# " + esc(a.title) + "\n\n" + (a.byline ? "By " + esc(a.byline) + "\n\n" : "") + "Source: <" + a.url + ">\n\n";
    return head + FP.toMarkdown(a.body) + "\n";
  };
  FP.articleText = () => {
    const a = FP.extractArticle();
    return a.title + ".\n\n" + (a.body.innerText || a.body.textContent).replace(/\n{3,}/g, "\n\n").trim();
  };
  FP.mdLink = (text, url) => "[" + text.replace(/([\[\]\\])/g, "\\$1") + "](" + url.replace(/\)/g, "%29").replace(/\s/g, "%20") + ")";

  FP.handlers.copyPageMarkdown = async () => {
    const text = FP.pageMarkdown();
    const ok = await FP.copy(text);
    return { ok, text };
  };
  FP.handlers.getText = () => ({ ok: true, text: FP.articleText() });
})();
