const list = document.getElementById("tabs");
const filter = document.getElementById("filter");

async function render() {
  const needle = filter.value.toLowerCase();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  list.replaceChildren(...tabs
    .filter((t) => `${t.title} ${t.url}`.toLowerCase().includes(needle))
    .map((t) => {
      const row = document.createElement("li");
      row.className = t.active ? "active" : "";
      row.dataset.tabId = t.id;
      const title = document.createElement("span");
      title.textContent = t.title || t.url;
      const close = document.createElement("button");
      close.textContent = "×";
      close.title = "Close tab";
      close.onclick = (e) => { e.stopPropagation(); chrome.tabs.remove(t.id); };
      row.onclick = () => chrome.tabs.update(t.id, { active: true });
      row.append(title, close);
      return row;
    }));
}

for (const ev of ["onCreated", "onRemoved", "onUpdated", "onActivated", "onMoved"]) chrome.tabs[ev].addListener(render);
filter.oninput = render;
document.getElementById("new").onclick = () => chrome.tabs.create({});
render();
