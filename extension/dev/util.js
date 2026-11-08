// Shared helpers for the dev module.
export async function activeTab(windowId) {
  const query = windowId ? { active: true, windowId } : { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(query);
  if (!tab) throw new Error("No active tab");
  return tab;
}

// Copy text through the page (offscreen documents are reserved for recording and captions).
export async function copyToTab(tabId, text) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [text],
    func: async (value) => {
      try { await navigator.clipboard.writeText(value); return true; } catch { /* fall through */ }
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.documentElement.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    },
  });
  return Boolean(result);
}

export function safeName(s) {
  return (s || "tab").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "tab";
}
