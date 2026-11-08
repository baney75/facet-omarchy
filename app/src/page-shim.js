// Gives the shared page scripts the small part of the extension API they use. Runs in Facet's isolated world.
(() => {
  if (globalThis.chrome && globalThis.chrome.__facet) return;
  const call = async (message) => JSON.parse(await webkit.messageHandlers.facet.postMessage(JSON.stringify(message)));
  const ignored = { addListener() {} };
  globalThis.chrome = {
    __facet: true,
    storage: {
      local: { get: (keys) => call({ op: "get", keys }), set: (items) => call({ op: "set", items }) },
      onChanged: ignored,
    },
    runtime: {
      onMessage: ignored,
      async sendMessage(message) {
        if (message.type === "facet:peek") return call({ op: "peek", url: String(message.url || "") });
        if (message.type !== "facet:sponsor") return { ok: false };
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message.videoID));
        const prefix = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 4);
        const categories = encodeURIComponent(JSON.stringify(message.categories));
        const response = await fetch(`https://sponsor.ajay.app/api/skipSegments/${prefix}?categories=${categories}`, { credentials: "omit" });
        if (!response.ok) return { ok: true, segments: [] };
        const mine = (await response.json()).find((video) => video.videoID === message.videoID);
        return { ok: true, segments: mine ? mine.segments : [] };
      },
    },
  };
})();
