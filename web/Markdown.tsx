import { Marked } from "marked";
import { useEffect, useMemo, useRef } from "react";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const markdownWithoutRawHtml = new Marked({ gfm: true }).use({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    code({ text, lang }) {
      if (lang === "mermaid") return mermaidPlaceholder(text);
      if (lang === "diff") return coloredDiffBlock(text);
      return `<pre class="vis-code"><code>${escapeHtml(text)}</code></pre>`;
    },
  },
});

function mermaidPlaceholder(source: string): string {
  const shownUntilRendered = `<pre class="vis-code">${escapeHtml(source)}</pre>`;
  return `<div class="mermaid-block" data-src="${encodeURIComponent(source)}">${shownUntilRendered}</div>`;
}

function coloredDiffBlock(text: string): string {
  const lines = text.split("\n").map((line) => {
    const lineClass = line.startsWith("+") ? "dl-add" : line.startsWith("-") ? "dl-del" : "";
    return `<span class="dl ${lineClass}">${escapeHtml(line) || " "}</span>`;
  });
  return `<pre class="vis-code vis-diff">${lines.join("")}</pre>`;
}

type Mermaid = typeof import("mermaid").default;

async function loadMermaidOnlyWhenNeeded(): Promise<Mermaid> {
  const { default: m } = await import("mermaid");
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  m.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "neutral",
    fontFamily: "Geist, sans-serif",
    fontSize: 13,
    sequence: { mirrorActors: false, useMaxWidth: true },
    flowchart: { useMaxWidth: true },
  });
  return m;
}

let mermaidLoading: Promise<Mermaid> | null = null;
let diagramCount = 0;

async function renderMermaidDiagrams(root: HTMLElement) {
  const blocks = [...root.querySelectorAll<HTMLElement>(".mermaid-block:not([data-rendered])")];
  if (!blocks.length) return;
  mermaidLoading ??= loadMermaidOnlyWhenNeeded();
  const mermaid = await mermaidLoading;
  for (const block of blocks) {
    const id = `mmd-${++diagramCount}`;
    block.dataset.rendered = "true";
    try {
      const { svg } = await mermaid.render(id, decodeURIComponent(block.dataset.src ?? ""));
      block.innerHTML = svg;
    } catch {
      removeMermaidErrorNode(id);
      block.classList.add("mermaid-error");
    }
  }
}

function removeMermaidErrorNode(diagramId: string) {
  document.getElementById(`d${diagramId}`)?.remove();
}

/** Markdown with `diff` blocks colored and `mermaid` blocks drawn. Raw HTML shows as text. */
export function Markdown(props: { source: string; className?: string }) {
  const html = useMemo(() => markdownWithoutRawHtml.parse(props.source, { async: false }), [props.source]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) renderMermaidDiagrams(ref.current);
  }, [html]);

  return <div className={`md ${props.className ?? ""}`} ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
