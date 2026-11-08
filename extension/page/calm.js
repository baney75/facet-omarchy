// Calm mode: hide newsletter popups and other fixed-position distractions. Classic script.
(() => {
  const FP = globalThis.__facetPage;
  const STYLE = "facet-page-calm-style";
  const WORDS = /newsletter|subscribe|sign up for|join (our|the) (mailing|email|list)|get (our|the) (free )?(updates|emails|newsletter)|no,? thanks|allow notifications|enable notifications|turn on notifications|exit intent/i;
  const CLASSY = /newsletter|subscribe|popup|pop-up|modal|overlay|lightbox|interstitial|exit-?intent|push-?prompt|signup|sign-up/i;
  const STATIC = '[class*="newsletter-popup" i],[id*="newsletter-popup" i],[class*="exit-intent" i],[id*="onesignal" i],[class*="onesignal" i],[class*="sumo" i][class*="popup" i]';
  let obs = null, active = false;

  const on = () => FP.settings.calmAll || !!FP.settings.calmSites[location.hostname];

  function suspect(el) {
    if (el.nodeType !== 1 || el.hasAttribute("data-facet-calm") || el.id === "facet-page-reader") return false;
    if (/^(HTML|BODY|HEAD|NAV|HEADER|VIDEO|MAIN|ARTICLE)$/.test(el.tagName)) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" || cs.display === "none") return false;
    const txt = (el.textContent || "").slice(0, 800);
    const email = !!el.querySelector('input[type="email"],input[name*="email" i]');
    const cls = (typeof el.className === "string" ? el.className : "") + " " + el.id;
    const area = (el.offsetWidth * el.offsetHeight) / Math.max(1, innerWidth * innerHeight);
    if (area < 0.02) return false;
    if (email || WORDS.test(txt)) return true;
    return CLASSY.test(cls) && area > 0.25 && txt.trim().length > 0;
  }

  function hide(el) {
    el.setAttribute("data-facet-calm", "1");
    el.style.setProperty("display", "none", "important");
    // Also drop a bare full-screen backdrop that sits next to the popup.
    for (const sib of el.parentElement ? el.parentElement.children : []) {
      if (sib === el || sib.hasAttribute("data-facet-calm")) continue;
      const cs = getComputedStyle(sib);
      if (cs.position === "fixed" && !(sib.textContent || "").trim() && sib.offsetWidth >= innerWidth * 0.9 && sib.offsetHeight >= innerHeight * 0.9 && CLASSY.test((sib.className || "") + sib.id + "backdrop")) {
        sib.setAttribute("data-facet-calm", "1");
        sib.style.setProperty("display", "none", "important");
      }
    }
    document.documentElement.classList.add("facet-calm-unlock");
  }

  function scan(root) {
    let n = 0;
    const list = [];
    if (root.nodeType === 1) list.push(root);
    root.querySelectorAll && list.push(...root.querySelectorAll("div,section,aside,dialog,form,iframe"));
    for (const el of list) {
      if (++n > 5000) break;
      try { if (suspect(el)) hide(el); } catch (_) {}
    }
  }

  function start() {
    if (active || !document.body) return;
    active = true;
    const st = document.createElement("style");
    st.id = STYLE;
    st.textContent = `${STATIC}{display:none!important}html.facet-calm-unlock,html.facet-calm-unlock body{overflow:auto!important}`;
    document.documentElement.appendChild(st);
    scan(document.body);
    let queued = new Set(), t = null;
    obs = new MutationObserver((recs) => {
      for (const r of recs) r.addedNodes.forEach((n) => n.nodeType === 1 && queued.add(n));
      if (r_attr(recs)) recs.forEach((r) => r.type === "attributes" && queued.add(r.target));
      clearTimeout(t);
      t = setTimeout(() => { const q = [...queued]; queued = new Set(); q.forEach((n) => document.contains(n) && scan(n)); }, 150);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  }
  const r_attr = (recs) => recs.length < 50;

  function stop() {
    if (!active) return;
    active = false;
    obs && obs.disconnect();
    document.getElementById(STYLE)?.remove();
    document.documentElement.classList.remove("facet-calm-unlock");
    document.querySelectorAll("[data-facet-calm]").forEach((e) => { e.style.removeProperty("display"); e.removeAttribute("data-facet-calm"); });
  }

  const sync = () => (on() ? start() : stop());
  FP.ready.then(() => { if (document.body) sync(); else addEventListener("DOMContentLoaded", sync, { once: true }); });
  FP.onSettings(sync);
  FP.calmScan = () => document.body && scan(document.body);

  FP.handlers.toggleCalm = async () => {
    const sites = { ...FP.settings.calmSites };
    if (sites[location.hostname]) delete sites[location.hostname]; else sites[location.hostname] = true;
    await FP.save({ calmSites: sites });
    sync();
    return { ok: true, calm: !!sites[location.hostname] };
  };
})();
