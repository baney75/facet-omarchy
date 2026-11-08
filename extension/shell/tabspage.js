// Tabs and Spaces page. Doubles as the markup the sidebar can copy.
import { mountTabList } from "./tablist.js";
import { call } from "./api.js";

const nav = document.getElementById("spaces");
let windowId;

async function renderSpaces() {
  windowId ??= (await chrome.windows.getCurrent()).id;
  const { spaces } = await call("shell/spaces/list", { windowId });
  nav.replaceChildren(...spaces.map((s) => {
    const b = document.createElement("button");
    b.textContent = `${s.name} (${s.tabCount ?? 0})`;
    b.className = s.active ? "active" : "";
    b.dataset.spaceId = s.id;
    b.onclick = () => call("shell/spaces/switch", { windowId, spaceId: s.id });
    b.oncontextmenu = (e) => {
      e.preventDefault();
      const name = prompt("Rename Space, or leave empty to delete it", s.name);
      if (name === null) return;
      if (name.trim()) call("shell/spaces/rename", { spaceId: s.id, name });
      else if (confirm(`Delete Space "${s.name}"?`)) call("shell/spaces/delete", { windowId, spaceId: s.id });
    };
    return b;
  }));
}

document.getElementById("new-space").onclick = () => {
  const name = prompt("Space name");
  if (name !== null) call("shell/spaces/create", { windowId, name });
};
document.getElementById("tidy").onclick = () => call("shell/tabs/tidy", { windowId });
document.getElementById("new-tab").onclick = () => chrome.tabs.create({});
chrome.runtime.onMessage.addListener((m) => { if (m?.type === "shell/spaces/changed") renderSpaces(); });
chrome.tabs.onActivated.addListener(renderSpaces);
chrome.tabs.onCreated.addListener(renderSpaces);
chrome.tabs.onRemoved.addListener(renderSpaces);

chrome.windows.getCurrent().then((w) => {
  windowId = w.id;
  mountTabList(document.getElementById("tabs"), { filterInput: document.getElementById("filter"), windowId });
  renderSpaces();
});
