// SponsorBlock skipping on YouTube. Segments are fetched by the worker. Classic script.
(() => {
  const FP = globalThis.__facetPage;
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  let vid = null, segs = [], timer = null, lastSkip = 0;

  const currentId = () => {
    const u = new URL(location.href);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  };
  const video = () => document.querySelector("video.html5-main-video") || document.querySelector("video");

  async function load(id) {
    segs = [];
    if (!id || !FP.settings.sponsorBlock) return;
    try {
      const r = await chrome.runtime.sendMessage({ type: "facet:sponsor", videoID: id, categories: FP.settings.sponsorCategories });
      if (id === vid && r && Array.isArray(r.segments)) segs = r.segments;
    } catch (_) {}
  }
  function tick() {
    const v = video();
    if (!v || !segs.length || v.paused) return;
    const t = v.currentTime;
    for (const s of segs) {
      const [a, b] = s.segment;
      if (t >= a && t < b - 0.3 && Date.now() - lastSkip > 400) {
        lastSkip = Date.now();
        v.currentTime = b;
        FP.toast("Skipped " + s.category);
        break;
      }
    }
  }
  function check() {
    const id = currentId();
    if (id !== vid) { vid = id; load(id); }
  }
  FP.ready.then(() => {
    check();
    timer = setInterval(() => { check(); tick(); }, 250);
  });
  addEventListener("yt-navigate-finish", check);
  FP.sponsorState = () => ({ vid, segs });
})();
