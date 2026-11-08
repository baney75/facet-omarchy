// Site permissions viewer: read each permission's state as the page itself sees it.
const NAMES = ["geolocation", "notifications", "camera", "microphone", "clipboard-read", "clipboard-write", "midi", "persistent-storage", "background-sync", "screen-wake-lock", "idle-detection", "storage-access"];

export async function sitePermissions(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [NAMES],
    func: async (names) => {
      const out = { origin: location.origin, permissions: {} };
      for (const name of names) {
        try { out.permissions[name] = (await navigator.permissions.query({ name })).state; }
        catch { out.permissions[name] = "unsupported"; }
      }
      return out;
    },
  });
  return result;
}
