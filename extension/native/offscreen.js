// Records tab audio in short self-contained clips so each one decodes alone.
const CLIP_MS = 5000;
const sessions = new Map();

function toBase64(buffer) {
  let binary = "";
  new Uint8Array(buffer).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function recordClip(tabId, session) {
  if (!sessions.has(tabId)) return;
  const recorder = new MediaRecorder(session.stream, { mimeType: "audio/webm" });
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    const audio = toBase64(await new Blob(chunks).arrayBuffer());
    chrome.runtime.sendMessage({ facetCaptionAudio: true, tabId, audio });
    recordClip(tabId, session);
  };
  recorder.start();
  session.timer = setTimeout(() => recorder.stop(), CLIP_MS);
}

async function start(tabId, streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  });
  // Capturing a tab mutes it unless the audio is routed back out.
  const context = new AudioContext();
  context.createMediaStreamSource(stream).connect(context.destination);
  const session = { stream, context };
  sessions.set(tabId, session);
  recordClip(tabId, session);
}

function stop(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  clearTimeout(session.timer);
  session.stream.getTracks().forEach((t) => t.stop());
  session.context.close();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.facetOffscreen === "start") start(msg.tabId, msg.streamId).catch(console.error);
  if (msg.facetOffscreen === "stop") stop(msg.tabId);
});
