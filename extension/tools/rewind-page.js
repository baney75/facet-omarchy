const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const call = (msg) => chrome.runtime.sendMessage(msg).then((r) => { if (!r?.ok) throw new Error(r?.error || "failed"); return r.data; });
let t;
async function run() {
  const hits = await call({ type: "tools/rewind/search", query: $("q").value });
  $("results").innerHTML = hits.map((h) => `<div class="row"><span><a target="_blank" href="${esc(h.url)}">${esc(h.title || h.url)}</a><small>${esc(h.snippet)}</small></span><small>${new Date(h.time).toLocaleDateString()}</small></div>`).join("") || "<small>No match.</small>";
}
$("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => run().catch((e) => { $("results").textContent = e.message; }), 150); });
call({ type: "tools/rewind/count" }).then((n) => { $("n").innerHTML = `<small>${n} pages indexed</small>`; });
run();
