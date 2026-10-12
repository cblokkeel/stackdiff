import type { ChatCode, ChatMessage, Comment, CommentKind, CommentStatus, Message, Review, ReviewState, Side, Verdict } from "./types";

export class ReviewError extends Error {}

export type ThreadState = "draft" | "pending" | "waiting" | "answered" | "resolved";

export const STATE_LABEL: Record<ThreadState, string> = {
  draft: "Unsent",
  pending: "Unsent reply",
  waiting: "Waiting for agent",
  answered: "Agent replied",
  resolved: "Resolved",
};

export function threadState(thread: Comment): ThreadState {
  const unsent = thread.messages.filter((m) => !m.sent).length;
  if (unsent > 0 && unsent === thread.messages.length) return "draft";
  if (unsent > 0) return "pending";
  if (thread.status === "resolved") return "resolved";
  return thread.messages.at(-1)?.author === "agent" ? "answered" : "waiting";
}

export function isResolved(thread: Comment): boolean {
  return threadState(thread) === "resolved";
}

export function unsentCount(threads: Comment[]): number {
  return threads.reduce((n, t) => n + t.messages.filter((m) => !m.sent).length, 0);
}

export interface ThreadAnchor {
  file: string;
  side: Side;
  startLine: number;
  endLine: number;
  chunkTitle: string;
  snippet: string;
}

export function findThread<T extends Comment>(threads: T[], id: string): T {
  const thread = threads.find((t) => t.id === id);
  if (!thread) throw new ReviewError(`Unknown comment id: ${id}`);
  return thread;
}

export function newThread(
  id: string,
  messageId: string,
  anchor: ThreadAnchor,
  body: string,
  at: string,
  kind: CommentKind = "change",
): Comment {
  return {
    ...anchor,
    id,
    kind,
    startLine: Math.min(anchor.startLine, anchor.endLine),
    endLine: Math.max(anchor.startLine, anchor.endLine),
    status: "open",
    createdAt: at,
    messages: [{ id: messageId, author: "user", body: requireText(body), at, sent: false }],
  };
}

export function addThread(
  state: ReviewState,
  anchor: ThreadAnchor,
  body: string,
  at: string,
  kind: CommentKind = "change",
): Comment {
  if (kind !== "change" && kind !== "question") throw new ReviewError(`Bad kind: ${kind}`);
  const id = `${kind === "question" ? "q" : "c"}${state.nextComment++}`;
  const thread = newThread(id, `${id}.1`, anchor, body, at, kind);
  state.comments.push(thread);
  if (kind === "question") queueQuestion(state, thread, at);
  return thread;
}

export function nextMessageId(thread: Comment): string {
  const n = Math.max(0, ...thread.messages.map((m) => Number(m.id.split(".").pop()) || 0));
  return `${thread.id}.${n + 1}`;
}

export function addUserMessage(thread: Comment, id: string, body: string, at: string): Message {
  if (thread.messages.some((m) => !m.sent)) throw new ReviewError("This thread already has an unsent reply.");
  const message: Message = { id, author: "user", body: requireText(body), at, sent: false };
  thread.messages.push(message);
  return message;
}

/** A reply in a question thread goes to the agent at once, like a chat. */
export function addReply(state: ReviewState, thread: Comment, body: string, at: string): Message {
  const message = addUserMessage(thread, nextMessageId(thread), body, at);
  if (thread.kind === "question") queueQuestion(state, thread, at);
  return message;
}

function queueQuestion(state: ReviewState, thread: Comment, at: string) {
  state.reviews.push({
    id: state.reviews.length + 1,
    verdict: "question",
    body: "",
    ...sendUnsentMessages([thread], at),
    createdAt: at,
    delivered: false,
  });
}

export function addAgentMessage(thread: Comment, body: string, at: string): Message {
  if (threadState(thread) === "draft") throw new ReviewError(`${thread.id} was never sent to the agent.`);
  const message: Message = { id: nextMessageId(thread), author: "agent", body: requireText(body), at, sent: true };
  thread.messages.push(message);
  return message;
}

/** A chat message goes to the agent at once, like a question with no lines. */
export function addChatMessage(
  state: ReviewState,
  body: string,
  at: string,
  chunkTitle?: string,
  code?: ChatCode,
): ChatMessage {
  const message: ChatMessage = { id: nextChatId(state), author: "user", body: requireText(body), at, sent: true };
  if (chunkTitle) message.chunkTitle = chunkTitle;
  if (code) {
    message.code = { ...code, startLine: Math.min(code.startLine, code.endLine), endLine: Math.max(code.startLine, code.endLine) };
  }
  state.chat.push(message);
  state.reviews.push({
    id: state.reviews.length + 1,
    verdict: "chat",
    body: "",
    threadIds: [],
    messageIds: [message.id],
    createdAt: at,
    delivered: false,
  });
  return message;
}

/** Takes back a chat message the agent has not received yet. */
export function cancelChatMessage(state: ReviewState, id: string) {
  const message = state.chat.find((m) => m.id === id && m.author === "user");
  if (!message) throw new ReviewError(`Unknown chat message: ${id}`);
  const review = state.reviews.find((r) => r.messageIds.includes(id));
  if (!review || review.delivered) throw new ReviewError("The agent already has this message.");
  state.chat.splice(state.chat.indexOf(message), 1);
  review.messageIds = review.messageIds.filter((m) => m !== id);
  // Review ids count the list, so an emptied review stays, marked as handed over with nothing in it.
  if (review.messageIds.length === 0) review.delivered = true;
}

export function addAgentChatMessage(state: ReviewState, body: string, at: string): ChatMessage {
  const message: ChatMessage = { id: nextChatId(state), author: "agent", body: requireText(body), at, sent: true };
  state.chat.push(message);
  return message;
}

function nextChatId(state: ReviewState): string {
  return `chat.${state.nextChat++}`;
}

export function editMessage(thread: Comment, messageId: string, body: string) {
  unsentMessage(thread, messageId).body = requireText(body);
}

export function deleteMessage(threads: Comment[], threadId: string, messageId: string) {
  const thread = findThread(threads, threadId);
  const message = unsentMessage(thread, messageId);
  thread.messages.splice(thread.messages.indexOf(message), 1);
  if (thread.messages.length === 0) threads.splice(threads.indexOf(thread), 1);
}

export function deleteThread(threads: Comment[], threadId: string) {
  threads.splice(threads.indexOf(findThread(threads, threadId)), 1);
}

export function setStatus(thread: Comment, status: CommentStatus) {
  if (status !== "open" && status !== "resolved") throw new ReviewError(`Bad status: ${status}`);
  thread.status = status;
}

function unsentMessage(thread: Comment, messageId: string): Message {
  const message = thread.messages.find((m) => m.id === messageId);
  if (!message || message.sent) throw new ReviewError("Only unsent messages can change.");
  return message;
}

function requireText(body: string): string {
  const text = body?.trim();
  if (!text) throw new ReviewError("Message is empty.");
  return text;
}

export function sendUnsentMessages(threads: Comment[], at: string) {
  const threadIds: string[] = [];
  const messageIds: string[] = [];
  for (const thread of threads) {
    const unsent = thread.messages.filter((m) => !m.sent);
    if (unsent.length === 0) continue;
    for (const m of unsent) {
      m.sent = true;
      m.at = at;
      messageIds.push(m.id);
    }
    thread.status = "open";
    threadIds.push(thread.id);
  }
  return { threadIds, messageIds };
}

/** Sends the unsent messages in `threadIds`, or in every thread when it is left out. */
export function submitReview(
  state: ReviewState,
  verdict: Verdict,
  note: string,
  at: string,
  threadIds?: string[],
): Review {
  if (verdict !== "approve" && verdict !== "changes") throw new ReviewError(`Bad verdict: ${verdict}`);
  const body = note.trim();
  const threads = threadIds ? threadIds.map((id) => findThread(state.comments, id)) : state.comments;
  if (verdict === "changes" && unsentCount(threads) === 0 && !body) {
    throw new ReviewError("Nothing to send: add a comment or a note.");
  }
  const review: Review = {
    id: state.reviews.length + 1,
    verdict,
    body,
    ...sendUnsentMessages(threads, at),
    createdAt: at,
    delivered: false,
  };
  state.reviews.push(review);
  return review;
}

export function takeUndelivered(state: ReviewState): Review[] {
  const reviews = state.reviews.filter((r) => !r.delivered);
  for (const r of reviews) r.delivered = true;
  return reviews;
}

export function setReviewed(state: ReviewState, chunkKey: string, chunkHash: string, reviewed: boolean) {
  if (reviewed) state.reviewed[chunkKey] = chunkHash;
  else delete state.reviewed[chunkKey];
}
