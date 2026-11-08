const SIMPLE = [
  [/^(open a )?new tab$/, "new-tab"],
  [/^close (this |the )?tab$/, "close-tab"],
  [/^(reload|refresh)( this| the)?( page| tab)?$/, "reload"],
  [/^go back$|^back$/, "back"],
  [/^go forward$|^forward$/, "forward"],
];

export function parseCommand(spoken) {
  const text = spoken.trim().replace(/[.?!,]+$/, "");
  const lower = text.toLowerCase();
  for (const [pattern, kind] of SIMPLE) if (pattern.test(lower)) return { kind };
  const open = lower.match(/^(?:open|go to) ([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/);
  if (open) return { kind: "open", url: `https://${open[1]}` };
  const search = text.match(/^(?:search(?: for)?|look up) (.+)$/i);
  return { kind: "search", text: search ? search[1] : text };
}
