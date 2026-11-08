// Shared helpers. No chrome.* calls at import time.
const TWO_LEVEL = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "co.in", "com.cn", "co.za"]);

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

// Registrable-ish domain: example.com for www.example.com, example.co.uk for a.b.example.co.uk.
export function domainOf(url) {
  const host = hostOf(url);
  if (!host) return "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host === "localhost") return host;
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join(".");
  return TWO_LEVEL.has(last2) ? parts.slice(-3).join(".") : last2;
}

export const GROUP_COLORS = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"];

export function colorFor(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

export function isHttpUrl(s) {
  return /^https?:\/\//i.test(s);
}

export function looksLikeUrl(s) {
  const t = s.trim();
  if (/\s/.test(t)) return false;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t) || /^localhost(:\d+)?(\/.*)?$/.test(t);
}

export function normalizeUrl(s) {
  const t = s.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
}
