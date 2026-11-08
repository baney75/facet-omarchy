// Runs in Facet's isolated world. Collects translatable text nodes, then writes translations back into the same nodes.
(() => {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "SVG", "CANVAS", "INPUT", "SELECT"]);
  const LIMIT = 20000;
  globalThis.__facetTranslate = {
    nodes: [],
    collect() {
      const nodes = [], texts = [];
      let total = 0;
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || SKIP.has(parent.tagName.toUpperCase()) || parent.closest("[contenteditable]:not([contenteditable=false]),[translate=no]")) return NodeFilter.FILTER_REJECT;
          return /\p{L}/u.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      });
      while (total < LIMIT && walker.nextNode()) {
        const core = walker.currentNode.nodeValue.replace(/\s+/g, " ").trim();
        nodes.push(walker.currentNode);
        texts.push(core);
        total += core.length;
      }
      this.nodes = nodes;
      return JSON.stringify({ lang: document.documentElement.lang || "", texts, truncated: !!walker.nextNode() });
    },
    apply(translated) {
      let changed = 0;
      translated.forEach((text, i) => {
        const node = this.nodes[i];
        if (typeof text !== "string" || !node || !node.isConnected) return;
        const [, lead, , trail] = node.nodeValue.match(/^(\s*)([\s\S]*?)(\s*)$/);
        node.nodeValue = lead + text + trail;
        changed++;
      });
      return changed;
    },
  };
})();
