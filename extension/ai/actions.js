// Page-aware actions. Each returns { messages, label } for the chat to stream.
import { getPage, activeTab, allReadableTabs, formatPage } from "./pagectx.js";
import { chatOnce } from "./ollama.js";

const SYS = "You are a concise assistant inside a browser side panel. Answer using the supplied page content when relevant.";

export async function askPage(question) {
  const t = await activeTab();
  if (!t) throw new Error("No readable active tab");
  const p = await getPage(t.id);
  return { label: `Ask about page: ${p.title}`, messages: [
    { role: "system", content: SYS },
    { role: "user", content: `${formatPage(p)}\n\nQuestion: ${question || "What is this page about?"}` },
  ] };
}

export async function askSelection(question, selectionOverride) {
  const t = await activeTab();
  let sel = selectionOverride || "", p = null;
  if (t) { p = await getPage(t.id); if (!sel) sel = p.selection; }
  if (!sel) throw new Error("No text selected");
  return { label: "Ask about selection", messages: [
    { role: "system", content: SYS },
    { role: "user", content: `Selected text:\n"""\n${sel}\n"""\n${p ? `From: ${p.title} (${p.url})\n` : ""}\nQuestion: ${question || "Explain this."}` },
  ] };
}

export async function summarizePage() {
  const t = await activeTab();
  if (!t) throw new Error("No readable active tab");
  const p = await getPage(t.id);
  return { label: `Summarize: ${p.title}`, messages: [
    { role: "system", content: SYS },
    { role: "user", content: `Summarize this page in a short paragraph followed by 3 to 6 bullet points.\n\n${formatPage(p)}` },
  ] };
}

async function multi() {
  const tabs = await allReadableTabs();
  if (!tabs.length) throw new Error("No readable tabs");
  const pages = [];
  for (const t of tabs.slice(0, 12)) pages.push(await getPage(t.id));
  // shrink per tab so the whole prompt stays bounded
  const per = Math.floor(24000 / pages.length);
  return pages.map((p) => ({ ...p, text: p.text.slice(0, per) }));
}

export async function askAllTabs(question) {
  const pages = await multi();
  return { label: `Ask all tabs (${pages.length})`, messages: [
    { role: "system", content: SYS },
    { role: "user", content: `${pages.map(formatPage).join("\n\n---\n\n")}\n\nQuestion about all of these tabs: ${question || "What are these tabs about?"}` },
  ] };
}

export async function compareTabs(tabIds) {
  let pages = await multi();
  if (tabIds && tabIds.length) pages = pages.filter((p) => tabIds.includes(p.tabId));
  if (pages.length < 2) throw new Error("Need at least two readable tabs to compare");
  return { label: `Compare tabs (${pages.length})`, messages: [
    { role: "system", content: SYS },
    { role: "user", content: `Compare these pages. Cover what they share, how they differ, and which suits what need.\n\n${pages.map(formatPage).join("\n\n---\n\n")}` },
  ] };
}

// AI tab naming: short label per tab, stored in chrome.storage.local.aiTabNames {tabId: name}.
export async function nameTabs({ model, tabIds, onName }) {
  let tabs = await allReadableTabs();
  if (tabIds) tabs = tabs.filter((t) => tabIds.includes(t.id));
  const names = {};
  for (const t of tabs) {
    const p = await getPage(t.id);
    const out = await chatOnce({ model, messages: [
      { role: "system", content: "Reply with only a tab label of 2 to 4 words. No quotes, no punctuation at the end." },
      { role: "user", content: `${p.title}\n${p.url}\n${p.text.slice(0, 1500)}` },
    ] });
    const name = out.replace(/["\n\r]+/g, " ").trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 40);
    if (!name) continue;
    names[t.id] = name;
    if (onName) onName(t, name);
  }
  const prev = (await chrome.storage.local.get("aiTabNames")).aiTabNames || {};
  await chrome.storage.local.set({ aiTabNames: { ...prev, ...names } });
  return names;
}
