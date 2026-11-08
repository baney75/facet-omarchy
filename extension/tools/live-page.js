import { answer, weatherFor } from "./answer.js";
import { findDevServers } from "./devservers.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const LEAGUES = {
  "football/nfl": "NFL", "basketball/nba": "NBA", "baseball/mlb": "MLB", "hockey/nhl": "NHL",
  "basketball/mens-college-basketball": "NCAA men's basketball", "football/college-football": "College football",
  "soccer/eng.1": "Premier League", "soccer/usa.1": "MLS",
};

export async function loadScores(league, fetchFn = fetch) {
  const res = await fetchFn(`https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard`);
  if (!res.ok) throw new Error(`espn ${res.status}`);
  const j = await res.json();
  return (j.events || []).map((e) => {
    const comp = e.competitions?.[0];
    const teams = (comp?.competitors || []).map((c) => ({ name: c.team?.shortDisplayName || c.team?.displayName, score: c.score, home: c.homeAway === "home" }));
    return { id: e.id, name: e.shortName || e.name, status: e.status?.type?.shortDetail || "", teams };
  });
}

function renderScores(games) {
  $("scores").innerHTML = games.length ? games.map((g) => `<div class="row"><span>${g.teams.map((t) => `${esc(t.name)} <b>${esc(t.score)}</b>`).join(" , ")}</span><small>${esc(g.status)}</small></div>`).join("") : "<small>No games.</small>";
}

async function refreshScores() {
  try { renderScores(await loadScores($("league").value)); } catch (e) { $("scores").textContent = String(e.message); }
}

async function showWeather(city) {
  if (!city) return;
  try {
    const w = await weatherFor(city);
    $("weather").innerHTML = w ? `<div class="big">${Math.round(w.temp)}°${w.unit} ${esc(w.text)}</div><small>${esc(w.place)}, feels ${Math.round(w.feels)}°, wind ${Math.round(w.wind)}</small>${w.days.map((d) => `<div class="row"><span>${esc(d.date)} ${esc(d.text)}</span><span>${Math.round(d.hi)} / ${Math.round(d.lo)}</span></div>`).join("")}` : "City not found.";
  } catch (e) { $("weather").textContent = String(e.message); }
}

$("q").addEventListener("keydown", async (ev) => {
  if (ev.key !== "Enter") return;
  try {
    const r = await answer($("q").value);
    $("answer").innerHTML = r ? `<div class="big">${esc(r.value)}</div><small>${esc(r.title)}</small>${(r.links || []).map((l) => `<div><a target="_blank" href="${esc(l.url)}">${esc(l.carrier)}</a></div>`).join("")}` : "<small>No instant answer.</small>";
  } catch (e) { $("answer").textContent = String(e.message); }
});
$("city").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { chrome.storage?.local.set({ "tools/city": $("city").value }); showWeather($("city").value); } });
$("scan").addEventListener("click", async () => {
  $("servers").textContent = "Scanning";
  const found = await findDevServers();
  $("servers").innerHTML = found.length ? found.map((s) => `<div class="row"><a target="_blank" href="${esc(s.url)}">:${s.port}</a><small>${esc(s.title)}</small></div>`).join("") : "<small>None found.</small>";
});
$("league").innerHTML = Object.entries(LEAGUES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
$("league").addEventListener("change", refreshScores);

(async () => {
  const saved = (await chrome.storage?.local.get("tools/city").catch(() => ({})))?.["tools/city"];
  if (saved) { $("city").value = saved; showWeather(saved); }
  refreshScores();
  setInterval(refreshScores, 60000);
})();
