// Shared navigation between the tool pages, shown at the foot of each panel.
const LINKS = [
  ["Tabs", "shell/tabs.html"],
  ["AI", "ai/panel.html"],
  ["Live", "tools/live.html"],
  ["Rewind", "tools/rewind.html"],
  ["Files", "tools/downloads.html"],
  ["Voice", "native/voice.html"],
  ["Dev", "dev/palette.html"],
];

const nav = document.createElement("nav");
nav.className = "facet-rail";
nav.setAttribute("aria-label", "Facet tools");
for (const [label, path] of LINKS) {
  const link = document.createElement("a");
  link.textContent = label;
  link.href = chrome.runtime.getURL(path);
  if (location.pathname === `/${path}`) link.setAttribute("aria-current", "page");
  nav.append(link);
}
document.body.append(nav);
