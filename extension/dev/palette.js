// Developer palette: lists dev actions for the tab behind this window and runs the chosen one.
const q = document.getElementById("q");
const list = document.getElementById("list");
const status = document.getElementById("status");
const send = (m) => chrome.runtime.sendMessage(m);
let targetTabId = null;
let actions = [];
let shown = [];
let sel = 0;

async function pickTarget() {
  const params = new URLSearchParams(location.search);
  if (params.get("tabId")) return Number(params.get("tabId"));
  const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0]?.id ?? null;
}

function render() {
  const text = q.value.trim().toLowerCase();
  shown = actions.filter((a) => !text || a.title.toLowerCase().includes(text));
  sel = Math.min(sel, Math.max(shown.length - 1, 0));
  list.replaceChildren(...shown.map((a, i) => {
    const li = document.createElement("li");
    li.textContent = a.title;
    li.dataset.id = a.id;
    li.className = (i === sel ? "sel " : "") + (a.available ? "" : "off");
    li.onclick = () => run(a);
    return li;
  }));
}

async function run(a) {
  let args = { tabId: targetTabId };
  if (a.needsQuery) args.query = q.value.trim();
  const res = await send({ facetDev: "run", id: a.id, args });
  status.textContent = res.ok ? JSON.stringify(res.result, null, 1) : `Error: ${res.error}`;
}

q.addEventListener("input", () => { sel = 0; render(); });
q.addEventListener("keydown", async (e) => {
  if (e.key === "ArrowDown") { sel = Math.min(sel + 1, shown.length - 1); render(); e.preventDefault(); }
  if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
  if (e.key === "Escape") window.close();
  if (e.key === "Enter") {
    const text = q.value.trim();
    const url = text && (await send({ facetDev: "resolveShortcut", input: text })).result;
    if (url) { await chrome.tabs.create({ url }); window.close(); }
    else if (shown[sel]) run(shown[sel]);
  }
});

targetTabId = await pickTarget();
actions = (await send({ facetDev: "list", tabId: targetTabId })).result || [];
render();
