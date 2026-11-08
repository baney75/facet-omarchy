// Recorder half of the shared offscreen document. Messages use the facetDevRec key only.
const sessions = new Map();

async function start(tabId, streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  });
  // Capturing mutes the tab unless its audio is routed back out.
  const context = new AudioContext();
  context.createMediaStreamSource(stream).connect(context.destination);
  const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    context.close();
    sessions.delete(tabId);
    const blob = new Blob(chunks, { type: "video/webm" });
    chrome.runtime.sendMessage({ facetDevRecDone: true, tabId, url: blob.size ? URL.createObjectURL(blob) : null, size: blob.size });
  };
  stream.getVideoTracks()[0]?.addEventListener("ended", () => stop(tabId));
  sessions.set(tabId, recorder);
  recorder.start(1000);
}

function stop(tabId) {
  const recorder = sessions.get(tabId);
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.facetDevRec === "start") {
    start(msg.tabId, msg.streamId).catch((e) => chrome.runtime.sendMessage({ facetDevRecDone: true, tabId: msg.tabId, error: String(e.message || e) }));
  }
  if (msg.facetDevRec === "stop") stop(msg.tabId);
  if (msg.facetDevRec === "release") URL.revokeObjectURL(msg.url);
});
