// Page-side helper: talk to the service worker module.
export async function call(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res) throw new Error("No response from shell");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
