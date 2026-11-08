import { parseCommand } from "./voice-commands.js";

const talk = document.getElementById("talk");
const result = document.getElementById("result");
let recorder = null;

function toBase64(buffer) {
  let binary = "";
  new Uint8Array(buffer).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

async function otherWindowTab() {
  const tabs = await chrome.tabs.query({ active: true });
  return tabs.find((t) => !t.url?.startsWith(chrome.runtime.getURL("")));
}

async function run(command) {
  const tab = await otherWindowTab();
  if (command.kind === "new-tab") return chrome.tabs.create({});
  if (command.kind === "close-tab" && tab) return chrome.tabs.remove(tab.id);
  if (command.kind === "reload" && tab) return chrome.tabs.reload(tab.id);
  if (command.kind === "back" && tab) return chrome.tabs.goBack(tab.id);
  if (command.kind === "forward" && tab) return chrome.tabs.goForward(tab.id);
  if (command.kind === "open") return chrome.tabs.create({ url: command.url });
  if (command.kind === "search") return chrome.search.query({ text: command.text, disposition: "NEW_TAB" });
}

async function start() {
  if (recorder) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    recorder = null;
    talk.classList.remove("on");
    result.textContent = "Listening done, transcribing";
    const audio = toBase64(await new Blob(chunks).arrayBuffer());
    const reply = await chrome.runtime.sendMessage({ facetNative: "transcribe", params: { audio } });
    if (!reply.ok) { result.textContent = reply.error; return; }
    const command = parseCommand(reply.result.text);
    result.textContent = `${reply.result.text} [${command.kind}]`;
    await run(command);
  };
  recorder.start();
  talk.classList.add("on");
}

function stop() {
  if (recorder?.state === "recording") recorder.stop();
}

talk.addEventListener("pointerdown", start);
addEventListener("pointerup", stop);
addEventListener("keydown", (e) => { if (e.code === "Space" && !e.repeat) { e.preventDefault(); start(); } });
addEventListener("keyup", (e) => { if (e.code === "Space") stop(); });
