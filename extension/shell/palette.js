import { searchAll, runResult } from "./search.js";

const params = new URLSearchParams(location.search);
const q = document.getElementById("q");
const list = document.getElementById("results");
let results = [];
let sel = 0;
let seq = 0;
let windowId = Number(params.get("w")) || undefined;

async function resolveWindow() {
  if (windowId) return;
  const w = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
  windowId = w?.id;
}

function paint() {
  list.replaceChildren(...results.map((r, i) => {
    const li = document.createElement("li");
    li.className = i === sel ? "sel" : "";
    li.setAttribute("role", "option");
    li.dataset.kind = r.kind;
    const k = Object.assign(document.createElement("span"), { className: "kind", textContent: r.kind });
    const t = Object.assign(document.createElement("span"), { className: "title", textContent: r.title });
    const s = Object.assign(document.createElement("span"), { className: "sub", textContent: r.subtitle || "" });
    li.append(k, t, s);
    li.onclick = () => choose(i);
    return li;
  }));
  list.children[sel]?.scrollIntoView({ block: "nearest" });
}

async function refresh() {
  const mine = ++seq;
  await resolveWindow();
  const found = await searchAll(q.value, { windowId });
  if (mine !== seq) return;
  results = found;
  sel = 0;
  paint();
}

async function choose(i) {
  const r = results[i];
  if (!r) return;
  await runResult(r, windowId);
  window.close();
}

q.addEventListener("input", refresh);
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) { sel = Math.min(sel + 1, results.length - 1); paint(); e.preventDefault(); }
  else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
  else if (e.key === "Enter") { choose(sel); e.preventDefault(); }
  else if (e.key === "Escape") window.close();
});
window.addEventListener("blur", () => { if (!params.has("keep")) setTimeout(() => window.close(), 150); });
refresh();
