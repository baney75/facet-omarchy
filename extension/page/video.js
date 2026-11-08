// Video speed and picture in picture, with a hover control strip. Classic script.
(() => {
  const FP = globalThis.__facetPage;
  const host = () => location.hostname;
  const clamp = (v) => Math.min(4, Math.max(0.25, Math.round(v * 100) / 100));

  function videos() { return [...document.querySelectorAll("video")].filter((v) => v.readyState > 0 || v.currentSrc || v.src); }
  function pick() {
    const t = FP.lastTarget;
    if (t && t.tagName === "VIDEO") return t;
    if (FP.lastPoint) {
      for (const el of document.elementsFromPoint(FP.lastPoint.x, FP.lastPoint.y)) if (el.tagName === "VIDEO") return el;
    }
    const vs = videos();
    return vs.find((v) => !v.paused) || vs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  }
  function setSpeed(v, rate) {
    v.playbackRate = clamp(rate);
    FP.save({ speedByHost: { ...FP.settings.speedByHost, [host()]: v.playbackRate } });
    return v.playbackRate;
  }
  async function pip(v) {
    if (document.pictureInPictureElement === v) { await document.exitPictureInPicture(); return false; }
    await v.requestPictureInPicture();
    return true;
  }

  // Apply saved speed to videos that start playing on this host.
  addEventListener("loadedmetadata", (e) => {
    const r = FP.settings.speedByHost[host()];
    if (e.target && e.target.tagName === "VIDEO" && r && r !== 1) e.target.playbackRate = r;
  }, true);

  FP.handlers.videoSpeed = (m) => {
    const v = pick();
    if (!v) { FP.toast("No video found"); return { ok: false, error: "no video" }; }
    const rate = m.reset ? setSpeed(v, 1) : setSpeed(v, m.value || v.playbackRate + (m.delta || 0));
    FP.toast("Speed " + rate + "x");
    return { ok: true, rate };
  };
  FP.handlers.videoPip = async () => {
    const v = pick();
    if (!v) { FP.toast("No video found"); return { ok: false, error: "no video" }; }
    try { return { ok: true, pip: await pip(v) }; }
    catch (e) { FP.toast("Picture in picture needs a click on the video controls"); return { ok: false, error: String(e.message || e) }; }
  };

  // Hover strip. A real click on it gives the user activation PiP requires.
  let strip = null, label = null, curr = null, hideT = null, lastMove = 0;
  function ensure() {
    if (strip) return;
    strip = document.createElement("div");
    strip.style.cssText = "all:initial;position:fixed;z-index:2147483645;display:none;";
    const r = strip.attachShadow({ mode: "open" });
    r.innerHTML = '<style>div{display:flex;gap:2px;align-items:center;background:#000b;color:#fff;border-radius:8px;padding:2px;font:12px system-ui,sans-serif}button{all:unset;cursor:pointer;padding:3px 8px;border-radius:6px}button:hover{background:#fff3}span{min-width:3.2em;text-align:center}</style><div><button data-a="-">-</button><span></span><button data-a="+">+</button><button data-a="pip">PiP</button></div>';
    label = r.querySelector("span");
    r.addEventListener("click", async (e) => {
      const a = e.target.dataset && e.target.dataset.a;
      if (!a || !curr) return;
      e.stopPropagation();
      if (a === "pip") { try { await pip(curr); } catch (_) {} }
      else { setSpeed(curr, curr.playbackRate + (a === "+" ? 0.25 : -0.25)); label.textContent = curr.playbackRate + "x"; }
    });
    strip.addEventListener("mouseenter", () => clearTimeout(hideT));
    (document.body || document.documentElement).appendChild(strip);
  }
  addEventListener("mousemove", (e) => {
    const now = Date.now();
    if (now - lastMove < 120) return;
    lastMove = now;
    const v = [...document.querySelectorAll("video")].find((x) => {
      const r = x.getBoundingClientRect();
      return r.width > 200 && r.height > 120 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (!v) return;
    ensure();
    curr = v;
    const r = v.getBoundingClientRect();
    strip.style.left = Math.max(4, r.right - 150) + "px";
    strip.style.top = Math.max(4, r.top + 8) + "px";
    strip.style.display = "";
    label.textContent = v.playbackRate + "x";
    clearTimeout(hideT);
    hideT = setTimeout(() => { strip.style.display = "none"; }, 2500);
  }, true);
})();
