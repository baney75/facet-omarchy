// Site shortcuts: a keyword plus a URL template containing %s, e.g. "gh" -> https://github.com/search?q=%s
const KEY = "dev:siteShortcuts";

export async function listShortcuts() {
  const { [KEY]: map } = await chrome.storage.local.get(KEY);
  return map || {};
}

function validKeyword(k) { return /^[\w.-]{1,20}$/.test(k || ""); }

export async function setShortcut(keyword, template) {
  keyword = (keyword || "").trim().toLowerCase();
  if (!validKeyword(keyword)) throw new Error("Keyword must be 1-20 letters, digits, dot, dash or underscore");
  let u;
  try { u = new URL(template.replace("%s", "x")); } catch { throw new Error("Template is not a URL"); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Template must be http or https");
  if (!template.includes("%s")) throw new Error("Template needs %s where the query goes");
  const map = await listShortcuts();
  map[keyword] = template;
  await chrome.storage.local.set({ [KEY]: map });
  return map;
}

export async function removeShortcut(keyword) {
  const map = await listShortcuts();
  delete map[(keyword || "").trim().toLowerCase()];
  await chrome.storage.local.set({ [KEY]: map });
  return map;
}

// "gh react hooks" -> template URL, or null when the first word is not a keyword.
export function resolveWith(map, input) {
  const text = (input || "").trim();
  const space = text.search(/\s/);
  const word = (space < 0 ? text : text.slice(0, space)).toLowerCase();
  const template = Object.prototype.hasOwnProperty.call(map, word) ? map[word] : null;
  if (!template) return null;
  const query = space < 0 ? "" : text.slice(space).trim();
  return template.replace("%s", encodeURIComponent(query));
}

export async function resolveShortcut(input) {
  return resolveWith(await listShortcuts(), input);
}
