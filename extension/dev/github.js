// GitHub page actions: derive clone / gh pr checkout / Codespaces from a repo or PR URL.
const RESERVED = new Set([
  "settings", "orgs", "organizations", "marketplace", "explore", "topics", "trending", "notifications", "login", "logout",
  "join", "pricing", "features", "sponsors", "about", "search", "pulls", "issues", "codespaces", "new", "apps", "enterprise",
  "collections", "events", "customer-stories", "readme", "security", "site", "users", "account", "dashboard", "gist",
]);

// Returns { owner, repo, pr } or null. pr is a number for /pull/N pages.
export function parseGithubUrl(input) {
  let u;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== "https:" || (u.hostname !== "github.com" && u.hostname !== "www.github.com")) return null;
  const [owner, repoRaw, kind, num] = u.pathname.split("/").filter(Boolean);
  if (!owner || !repoRaw || RESERVED.has(owner.toLowerCase())) return null;
  const repo = repoRaw.replace(/\.git$/, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  const pr = kind === "pull" && /^\d+$/.test(num || "") ? Number(num) : null;
  return { owner, repo, pr };
}

export function cloneCommand(info) {
  return `git clone https://github.com/${info.owner}/${info.repo}.git`;
}

export function prCheckoutCommand(info) {
  return info.pr ? `gh pr checkout ${info.pr} --repo ${info.owner}/${info.repo}` : null;
}

export function codespacesUrl(info) {
  const q = new URLSearchParams({ repo: `${info.owner}/${info.repo}` });
  return `https://github.com/codespaces/new?${q}`;
}

// Everything the page offers for a URL, as plain data.
export function githubActions(url) {
  const info = parseGithubUrl(url);
  if (!info) return null;
  return { info, clone: cloneCommand(info), prCheckout: prCheckoutCommand(info), codespaces: codespacesUrl(info) };
}
