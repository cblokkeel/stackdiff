import { type ThreadState, threadState } from "./review";
import { hunkLines } from "./git";
import type { ChatMessage, Comment, DiffFile, DiffHunk, Review, ViewState } from "./types";

function fence(snippet: string) {
  const ticks = snippet.includes("```") ? "````" : "```";
  return `${ticks}diff\n${snippet}\n${ticks}`;
}

function lines(c: Pick<Comment, "file" | "side" | "startLine" | "endLine">) {
  const range = c.startLine === c.endLine ? `line ${c.startLine}` : `lines ${c.startLine}-${c.endLine}`;
  const side = c.side === "additions" ? "new code" : "old/deleted code";
  return `${c.file} ${range} (${side})`;
}

const CHAT_HISTORY = 6;

export function formatReviews(reviews: Review[], comments: Comment[], chat: ChatMessage[] = []): string {
  const out: string[] = [];
  const byId = new Map(comments.map((c) => [c.id, c]));
  const verdicts = reviews.filter((r) => r.verdict !== "question" && r.verdict !== "chat");
  const onlyQuestions = verdicts.length === 0;
  const newChatIds = new Set(reviews.filter((r) => r.verdict === "chat").flatMap((r) => r.messageIds));
  const approved = verdicts.at(-1)?.verdict === "approve";
  const newIds = new Set(reviews.flatMap((r) => r.messageIds));
  const threads = [...new Set(reviews.flatMap((r) => r.threadIds))]
    .map((id) => byId.get(id))
    .filter((c): c is Comment => c !== undefined);
  const changes = threads.filter((c) => c.kind !== "question");
  const questions = threads.filter((c) => c.kind === "question");

  const pushThread = (c: Comment) => {
    const followUp = c.messages.some((m) => m.sent && !newIds.has(m.id));
    out.push("", `## ${c.id} · ${lines(c)}${followUp ? " · follow-up" : ""}`, `Chunk: ${c.chunkTitle}`);
    if (c.snippet) out.push("", fence(c.snippet));
    if (c.codeChanged) out.push("", "(The code at these lines has changed since; the snippet shows what the reviewer saw.)");
    for (const m of c.messages.filter((m) => m.sent)) {
      const who = m.author === "agent" ? "You (agent)" : "Reviewer";
      out.push("", `**${who}${newIds.has(m.id) ? " (new)" : ""}:**`, m.body);
    }
  };

  if (!onlyQuestions) {
    const n = changes.length;
    out.push(
      approved
        ? `# Review: APPROVED (${n} thread${n === 1 ? "" : "s"} with notes)`
        : `# Review: CHANGES REQUESTED (${n} thread${n === 1 ? "" : "s"})`,
    );
    for (const r of verdicts) {
      if (r.body) out.push("", "Overall note from the reviewer:", "", r.body.replace(/^/gm, "> "));
    }
    changes.forEach(pushThread);
  }
  if (questions.length) {
    if (out.length) out.push("");
    out.push(`# Questions (${questions.length})`, "", "The reviewer asked about the code. They want an answer, not a change.");
    questions.forEach(pushThread);
  }

  if (newChatIds.size) {
    if (out.length) out.push("");
    out.push("# Chat", "", "The reviewer wrote to you in the chat panel. Earlier messages are for context.");
    const firstNew = chat.findIndex((m) => newChatIds.has(m.id));
    for (const m of chat.slice(Math.max(0, firstNew - CHAT_HISTORY))) {
      const who = m.author === "agent" ? "You (agent)" : "Reviewer";
      const where = m.chunkTitle ? ` (viewing chunk "${m.chunkTitle}")` : "";
      out.push("", `**${who}${newChatIds.has(m.id) ? " (new)" : ""}${where}:**`);
      if (m.code) out.push(`About ${lines(m.code)}:`, "", fence(m.code.snippet), "");
      out.push(m.body);
    }
  }

  out.push("", "---");
  if (newChatIds.size) {
    out.push(
      'Answer the chat with `stackdiff chat -m "answer"`. If they ask you to reorder, split, merge or',
      "rename chunks, or to rewrite the overview, edit the plan and run `stackdiff plan <file>` first.",
      "Change code only when they ask for it.",
    );
  }
  if (questions.length) {
    out.push(
      'Answer each question with `stackdiff reply <id> -m "answer"`. Do not change code for a question',
      "unless the reviewer asks you to in it.",
    );
  }
  if (onlyQuestions) {
    out.push("Then run `stackdiff wait` again.");
  } else if (approved) {
    out.push(
      "The reviewer approved the work. Handle any notes above if they ask for something,",
      'run `stackdiff resolve <id> -m "..."` for each, then stop. Do not run `stackdiff wait` again.',
    );
  } else {
    out.push(
      "Next steps, for each comment thread above:",
      '- Change made: `stackdiff resolve <id> -m "what you changed"`.',
      '- Question, or you disagree / need a decision: `stackdiff reply <id> -m "..."`. This keeps the thread open for the reviewer.',
      "Then:",
      "1. If your changes added or moved hunks, update the plan and run `stackdiff plan <file>`.",
      "2. Run `stackdiff wait` for the next review.",
    );
  }
  return out.join("\n");
}

export function formatHunks(files: DiffFile[], baseLabel: string): string {
  const out: string[] = [];
  const hunkCount = files.reduce((n, f) => n + f.hunks.length, 0);
  const add = files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.added, 0), 0);
  const del = files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.removed, 0), 0);
  out.push(`Base: ${baseLabel} · ${files.length} files · ${hunkCount} hunks · +${add} -${del}`);
  for (const f of files) {
    const fa = f.hunks.reduce((m, h) => m + h.added, 0);
    const fd = f.hunks.reduce((m, h) => m + h.removed, 0);
    const from = f.oldPath ? ` (from ${f.oldPath})` : "";
    out.push("", `${f.path}${from}  ${f.status}  +${fa} -${fd}`);
    for (const h of f.hunks) {
      const lineCount = [...hunkLines(h)].length;
      const size = lineCount ? `  ${lineCount} lines` : "";
      out.push(`  ${h.id}  ${h.header || "(no text diff)"}  +${h.added} -${h.removed}${size}`);
      const changed = h.text
        .split("\n")
        .slice(1)
        .filter((l) => (l.startsWith("+") || l.startsWith("-")) && l.trim().length > 1)
        .slice(0, 2);
      for (const l of changed) out.push(`      ${l.length > 110 ? l.slice(0, 110) + "…" : l}`);
    }
  }
  return out.join("\n");
}

/** A hunk's body with the line numbers a `path#n:a-b` plan entry counts. */
export function formatHunkLines(hunk: DiffHunk): string {
  const lines = [...hunkLines(hunk)];
  if (!lines.length) return `${hunk.id}  (no text diff)`;
  const width = String(lines.length).length;
  const body = lines.map((l, i) => `${String(i + 1).padStart(width)}  ${l.line}`);
  return [`${hunk.id}  ${hunk.header}  +${hunk.added} -${hunk.removed}`, ...body].join("\n");
}

export function formatStatus(view: ViewState, url: string | null): string {
  const count = (state: ThreadState) => view.comments.filter((c) => threadState(c) === state).length;
  const plan = view.planError
    ? `invalid (${view.planError})`
    : view.hasPlan
      ? `${view.title || "(untitled)"}, ${view.chunks.length} chunks`
      : "none";
  return [
    `UI: ${url ?? "not running (stackdiff open)"}`,
    `Branch: ${view.branch} vs ${view.base}`,
    `Plan: ${plan}`,
    `Reviewed: ${view.chunks.filter((c) => c.reviewed).length}/${view.chunks.length} chunks`,
    `Threads: ${count("draft") + count("pending")} with drafts, ${count("waiting")} waiting for you (the agent), ` +
      `${count("answered")} answered, ${count("resolved")} resolved`,
    `Reviews waiting for the agent: ${view.waitingReviews}`,
  ].join("\n");
}
