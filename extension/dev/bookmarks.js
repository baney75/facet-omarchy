// Import a Netscape-format bookmarks HTML file. No DOMParser in workers, so tokenize by hand.
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

// Returns a tree: [{ title, children } | { title, url }]
export function parseBookmarksHtml(html) {
  const root = { children: [] };
  const stack = [root];
  let pendingFolder = null;
  const re = /<(\/?)(DL|H3|A)\b([^>]*)>([^<]*)/gi;
  let m;
  while ((m = re.exec(html))) {
    const close = m[1] === "/";
    const tag = m[2].toUpperCase();
    const attrs = m[3];
    const text = decode(m[4]).trim();
    if (tag === "H3" && !close) {
      pendingFolder = { title: text || "Folder", children: [] };
      stack.at(-1).children.push(pendingFolder);
    } else if (tag === "DL") {
      if (!close) { if (pendingFolder) { stack.push(pendingFolder); pendingFolder = null; } else if (stack.length === 1 && !root.opened) { root.opened = true; stack.push(root); } else stack.push({ children: stack.at(-1).children }); }
      else if (stack.length > 1) stack.pop();
    } else if (tag === "A" && !close) {
      const href = /\bHREF\s*=\s*"([^"]*)"/i.exec(attrs) || /\bHREF\s*=\s*'([^']*)'/i.exec(attrs);
      if (!href) continue;
      let title = text;
      const url = decode(href[1]);
      // Title text ends at the next tag, so a nested tag in the title is cut; accept that.
      stack.at(-1).children.push({ title: title || url, url });
    }
  }
  return root.children;
}

function count(nodes) {
  let n = 0;
  for (const x of nodes) n += x.url ? 1 : count(x.children);
  return n;
}

async function createNodes(parentId, nodes, stats) {
  for (const n of nodes) {
    if (n.url) {
      if (!/^(https?|ftp|file|chrome):/i.test(n.url)) { stats.skipped++; continue; }
      await chrome.bookmarks.create({ parentId, title: n.title, url: n.url });
      stats.bookmarks++;
    } else {
      const folder = await chrome.bookmarks.create({ parentId, title: n.title });
      stats.folders++;
      await createNodes(folder.id, n.children, stats);
    }
  }
}

// Puts everything under a new folder in Other bookmarks so an import is easy to undo.
export async function importBookmarksHtml(html, folderName = "Imported bookmarks") {
  const tree = parseBookmarksHtml(html);
  if (!count(tree)) throw new Error("No bookmarks found in that file");
  const [top] = await chrome.bookmarks.getTree();
  const parent = top.children.find((c) => c.folderType === "other") || top.children.at(-1);
  const folder = await chrome.bookmarks.create({ parentId: parent.id, title: folderName });
  const stats = { bookmarks: 0, folders: 1, skipped: 0, folderId: folder.id };
  await createNodes(folder.id, tree, stats);
  return stats;
}
