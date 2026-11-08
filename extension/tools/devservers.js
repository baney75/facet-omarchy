// Local dev server finder: probes localhost ports and reads each page title when it can.
export const COMMON_PORTS = [3000, 3001, 3333, 4000, 4200, 4321, 5000, 5173, 5174, 6006, 8000, 8080, 8081, 8787, 8888, 9000, 9229, 1313, 3030, 4567];

async function probe(port, timeoutMs, host) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const url = `http://${host}:${port}/`;
  try {
    let title = "";
    let status = 0;
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      status = res.status;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("html")) title = ((await res.text()).match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || "";
    } catch (e) {
      if (ctl.signal.aborted) return null;
      // CORS-blocked still means something answered; no-cors tells the two cases apart.
      await fetch(url, { mode: "no-cors", signal: ctl.signal, cache: "no-store" });
    }
    return { port, url, status, title };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function findDevServers({ ports = COMMON_PORTS, timeoutMs = 800, host = "localhost" } = {}) {
  const found = await Promise.all(ports.map((p) => probe(p, timeoutMs, host)));
  return found.filter(Boolean).sort((a, b) => a.port - b.port);
}
