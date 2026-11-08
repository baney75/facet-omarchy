// Local Ollama client. Only talks to the loopback server; no keys, no other providers.
export const OLLAMA_URL = "http://127.0.0.1:11434";

export async function listModels(base = OLLAMA_URL) {
  const r = await fetch(`${base}/api/tags`);
  if (!r.ok) throw new Error(`Ollama /api/tags returned ${r.status}`);
  const j = await r.json();
  return (j.models || []).map((m) => m.name || m.model).filter(Boolean);
}

// Streams /api/chat (NDJSON). onToken(text) per chunk. Returns full text.
export async function chatStream({ model, messages, signal, onToken, base = OLLAMA_URL }) {
  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Ollama chat failed (${r.status}) ${t.slice(0, 200)}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "";
  const handle = (line) => {
    if (!line.trim()) return;
    const j = JSON.parse(line);
    if (j.error) throw new Error(j.error);
    const t = j.message && j.message.content;
    if (t) { full += t; if (onToken) onToken(t, full); }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  buf += dec.decode();
  handle(buf);
  return full;
}

// Non-streaming convenience built on the same endpoint.
export async function chatOnce(opts) {
  return chatStream({ ...opts, onToken: undefined });
}
