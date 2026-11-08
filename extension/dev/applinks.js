// External app links: map a web URL to the desktop app scheme that can open it.
const RULES = [
  { app: "Zoom", test: /^https:\/\/([\w-]+\.)?zoom\.us\/j\/(\d+)(?:\?pwd=([\w.-]+))?/, to: (m) => `zoommtg://zoom.us/join?confno=${m[2]}${m[3] ? `&pwd=${m[3]}` : ""}` },
  { app: "Spotify", test: /^https:\/\/open\.spotify\.com\/(track|album|artist|playlist|episode|show)\/(\w+)/, to: (m) => `spotify:${m[1]}:${m[2]}` },
  { app: "Slack", test: /^https:\/\/app\.slack\.com\/client\/(\w+)(?:\/(\w+))?/, to: (m) => `slack://channel?team=${m[1]}${m[2] ? `&id=${m[2]}` : ""}` },
  { app: "Discord", test: /^https:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/([\w@]+(?:\/\d+)*)/, to: (m) => `discord://-/channels/${m[1]}` },
  { app: "Steam", test: /^https:\/\/store\.steampowered\.com\/app\/(\d+)/, to: (m) => `steam://store/${m[1]}` },
  { app: "Telegram", test: /^https:\/\/t\.me\/([\w]+)/, to: (m) => `tg://resolve?domain=${m[1]}` },
  { app: "VS Code", test: /^https:\/\/vscode\.dev\/github\/([\w.-]+\/[\w.-]+)/, to: (m) => `vscode://vscode.git/clone?url=${encodeURIComponent(`https://github.com/${m[1]}.git`)}` },
  { app: "Apple Music", test: /^https:\/\/music\.apple\.com\/(.+)/, to: (m) => `music://music.apple.com/${m[1]}` },
];

export function externalAppLink(url) {
  for (const rule of RULES) {
    const m = rule.test.exec(url || "");
    if (m) return { app: rule.app, url: rule.to(m) };
  }
  return null;
}

export function listExternalApps() {
  return RULES.map((r) => r.app);
}

// Launch the scheme from the page so Chromium shows its own "open app" prompt.
export async function openInApp(tabId, schemeUrl) {
  await chrome.scripting.executeScript({ target: { tabId }, args: [schemeUrl], func: (u) => { location.href = u; } });
}
