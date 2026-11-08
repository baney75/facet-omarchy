// Per-site dark mode via an inverted-filter stylesheet. Runs at document_start.
(() => {
  const FP = globalThis.__facetPage;
  const ID = "facet-page-dark";
  const CSS = `
html{filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}
img,picture,video,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}`;
  const host = () => location.hostname;
  function apply() {
    const on = !!FP.settings.darkSites[host()];
    let el = document.getElementById(ID);
    if (on && !el) {
      el = document.createElement("style");
      el.id = ID;
      el.textContent = CSS;
      (document.head || document.documentElement).appendChild(el);
    } else if (!on && el) el.remove();
  }
  FP.dark = { apply };
  FP.ready.then(apply);
  FP.onSettings(apply);
  FP.handlers.toggleDark = async () => {
    const sites = { ...FP.settings.darkSites };
    if (sites[host()]) delete sites[host()]; else sites[host()] = true;
    await FP.save({ darkSites: sites });
    apply();
    return { ok: true, dark: !!sites[host()] };
  };
})();
