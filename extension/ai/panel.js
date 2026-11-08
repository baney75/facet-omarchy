import { listModels, chatStream } from "./ollama.js";
import * as A from "./actions.js";

const $ = (id) => document.getElementById(id);
const log = $("log"), input = $("input"), modelSel = $("model"), statusEl = $("status");
let history = [];
let ctrl = null;

function add(cls, text) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

async function loadModels() {
  try {
    const names = await listModels();
    const saved = (await chrome.storage.local.get("aiModel")).aiModel;
    modelSel.replaceChildren(...names.map((n) => new Option(n, n)));
    if (saved && names.includes(saved)) modelSel.value = saved;
    statusEl.textContent = names.length ? `${names.length} models` : "no models installed";
  } catch (e) {
    modelSel.replaceChildren();
    statusEl.textContent = "Ollama unreachable";
    add("error", `Cannot reach Ollama at 127.0.0.1:11434: ${e.message}. If it is running, set OLLAMA_ORIGINS to allow chrome-extension://*.`);
  }
}

function setBusy(b) {
  $("send").hidden = b;
  $("stop").hidden = !b;
  document.querySelectorAll("#actions button").forEach((x) => (x.disabled = b));
}

// Send a turn. `context` (optional) are the page-aware messages for this turn only.
async function run(userText, label, preMessages) {
  const model = modelSel.value;
  if (!model) { add("error", "No model selected."); return; }
  await chrome.storage.local.set({ aiModel: model });
  const msgs = preMessages
    ? [...history, ...preMessages.filter((m) => m.role !== "system")]
    : [...history, { role: "user", content: userText }];
  if (preMessages && history.length === 0) msgs.unshift(preMessages.find((m) => m.role === "system"));
  add("user", label || userText);
  const out = add("assistant", "");
  ctrl = new AbortController();
  setBusy(true);
  try {
    const full = await chatStream({
      model, messages: msgs, signal: ctrl.signal,
      onToken: (_t, f) => { out.textContent = f; log.scrollTop = log.scrollHeight; },
    });
    history = [...msgs, { role: "assistant", content: full }];
  } catch (e) {
    if (e.name === "AbortError") out.textContent += "\n[stopped]";
    else { out.classList.add("error"); out.textContent += `\n${e.message}`; }
  } finally { ctrl = null; setBusy(false); }
}

async function doAction(act, extra) {
  const q = input.value.trim();
  try {
    if (act === "name") {
      const model = modelSel.value;
      if (!model) return add("error", "No model selected.");
      setBusy(true);
      add("note", "Naming tabs...");
      try {
        const names = await A.nameTabs({ model, onName: (t, n) => add("note", `${t.id}: ${n}`) });
        add("note", `Named ${Object.keys(names).length} tabs (stored as aiTabNames).`);
      } finally { setBusy(false); }
      return;
    }
    let r;
    if (act === "page") r = await A.askPage(q);
    else if (act === "selection") r = await A.askSelection(q, extra && extra.selection);
    else if (act === "summarize") r = await A.summarizePage();
    else if (act === "alltabs") r = await A.askAllTabs(q);
    else if (act === "compare") r = await A.compareTabs();
    else return;
    input.value = "";
    history = []; // page-aware actions start a fresh context
    await run(null, r.label, r.messages);
  } catch (e) { add("error", e.message); }
}

document.querySelectorAll("#actions button").forEach((b) => b.addEventListener("click", () => doAction(b.dataset.act)));
$("refresh").addEventListener("click", loadModels);
$("stop").addEventListener("click", () => ctrl && ctrl.abort());
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = input.value.trim();
  if (!t) return;
  input.value = "";
  run(t);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); }
});

// Requests queued by the background (context menus) while the panel was closed.
async function drainPending() {
  const { aiPending } = await chrome.storage.session.get("aiPending");
  if (!aiPending) return;
  await chrome.storage.session.remove("aiPending");
  await doAction(aiPending.act, aiPending);
}
chrome.storage.session.onChanged.addListener((c) => { if (c.aiPending && c.aiPending.newValue) drainPending(); });

await loadModels();
await drainPending();
