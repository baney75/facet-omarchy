const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const call = (msg) => chrome.runtime.sendMessage(msg).then((r) => { if (!r?.ok) throw new Error(r?.error || "failed"); return r.data; });

async function render() {
  const [items, groups] = await Promise.all([call({ type: "tools/downloads/list", limit: 60 }), call({ type: "tools/downloads/tidy" })]);
  $("list").innerHTML = items.map((d) => `<div class="row"><span>${esc(d.name)}<small>${esc(d.folder)} , ${esc(d.state)}</small></span><button data-rename="${d.id}" data-name="${esc(d.name)}">Rename</button></div>`).join("") || "<small>Nothing yet.</small>";
  $("tidy").innerHTML = Object.entries(groups).map(([folder, s]) => `<div class="row"><span>${esc(folder)}<small>${s.length} files: ${esc(s.slice(0, 3).map((x) => x.name).join(", "))}</small></span><button data-move="${esc(folder)}">Move</button></div>`).join("") || "<small>Already tidy.</small>";
  $("tidy").onclick = async (ev) => {
    const folder = ev.target.dataset?.move;
    if (!folder) return;
    for (const s of groups[folder]) await call({ type: "tools/downloads/move", id: s.id, path: s.target, removeOld: true });
    render();
  };
  $("list").onclick = async (ev) => {
    const id = ev.target.dataset?.rename;
    if (!id) return;
    const name = prompt("New name", ev.target.dataset.name);
    if (name) { await call({ type: "tools/downloads/rename", id: Number(id), name, removeOld: true }); render(); }
  };
}
$("auto").onchange = () => call({ type: "tools/downloads/autotidy", on: $("auto").checked });
chrome.storage.local.get("tools/autoTidy").then((v) => { $("auto").checked = !!v["tools/autoTidy"]; });
render().catch((e) => { $("list").textContent = e.message; });
