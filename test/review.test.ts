import { describe, expect, test } from "bun:test";
import { formatReviews } from "../src/format";
import * as review from "../src/review";
import type { ReviewState } from "../src/types";

const AT = "2026-01-01T00:00:00.000Z";
const anchor = { file: "a.ts", side: "additions" as const, startLine: 9, endLine: 3, chunkTitle: "A", snippet: "" };
const emptyState = (): ReviewState => ({ comments: [], reviews: [], reviewed: {}, nextComment: 1, chat: [], nextChat: 1 });

describe("threads", () => {
  test("a new thread is a draft with sorted lines and the next id", () => {
    const s = emptyState();
    const t = review.addThread(s, anchor, "  why?  ", AT);
    expect(t).toMatchObject({ id: "c1", startLine: 3, endLine: 9, status: "open" });
    expect(t.messages).toEqual([{ id: "c1.1", author: "user", body: "why?", at: AT, sent: false }]);
    expect(review.threadState(t)).toBe("draft");
    expect(review.addThread(s, anchor, "x", AT).id).toBe("c2");
  });

  test("state follows the conversation", () => {
    const s = emptyState();
    const t = review.addThread(s, anchor, "why?", AT);
    review.submitReview(s, "changes", "", AT);
    expect(review.threadState(t)).toBe("waiting");
    review.addAgentMessage(t, "because", AT);
    expect(review.threadState(t)).toBe("answered");
    review.setStatus(t, "resolved");
    expect(review.threadState(t)).toBe("resolved");
    review.addUserMessage(t, review.nextMessageId(t), "but also", AT);
    expect(review.threadState(t)).toBe("pending");
    const replyToResolvedThread = review.submitReview(s, "changes", "", AT);
    expect(replyToResolvedThread.threadIds).toEqual(["c1"]);
    expect(t.status).toBe("open");
  });

  test("rules", () => {
    const s = emptyState();
    const t = review.addThread(s, anchor, "why?", AT);
    expect(() => review.addAgentMessage(t, "hi", AT)).toThrow("never sent");
    expect(() => review.addUserMessage(t, "c1.2", "again", AT)).toThrow("unsent reply");
    expect(() => review.addThread(s, anchor, "   ", AT)).toThrow("empty");
    review.submitReview(s, "changes", "", AT);
    expect(() => review.editMessage(t, "c1.1", "changed")).toThrow("Only unsent");
    expect(() => review.findThread(s.comments, "c9")).toThrow("Unknown comment id");
  });

  test("deleting the last message removes the thread", () => {
    const s = emptyState();
    review.addThread(s, anchor, "oops", AT);
    review.deleteMessage(s.comments, "c1", "c1.1");
    expect(s.comments).toEqual([]);
  });

  test("a sent thread can be deleted whole", () => {
    const s = emptyState();
    const t = review.addThread(s, anchor, "why?", AT);
    review.submitReview(s, "changes", "", AT);
    review.addAgentMessage(t, "because", AT);
    review.deleteThread(s.comments, "c1");
    expect(s.comments).toEqual([]);
    expect(() => review.deleteThread(s.comments, "c1")).toThrow("Unknown comment id");
  });
});

describe("reviews", () => {
  test("submitting sends every unsent message and records them", () => {
    const s = emptyState();
    review.addThread(s, anchor, "one", AT);
    review.addThread(s, anchor, "two", AT);
    const r = review.submitReview(s, "changes", " note ", AT);
    expect(r).toMatchObject({ id: 1, body: "note", threadIds: ["c1", "c2"], messageIds: ["c1.1", "c2.1"] });
    expect(review.unsentCount(s.comments)).toBe(0);
  });

  test("a review can send just some threads; the rest stay drafts", () => {
    const s = emptyState();
    review.addThread(s, anchor, "one", AT);
    const two = review.addThread(s, anchor, "two", AT);
    const r = review.submitReview(s, "changes", "", AT, ["c1"]);
    expect(r).toMatchObject({ threadIds: ["c1"], messageIds: ["c1.1"] });
    expect(review.threadState(two)).toBe("draft");
    expect(() => review.submitReview(s, "changes", "", AT, ["c1"])).toThrow("Nothing to send");
  });

  test("changes need a comment or a note; approve doesn't", () => {
    const s = emptyState();
    expect(() => review.submitReview(s, "changes", "", AT)).toThrow("Nothing to send");
    expect(review.submitReview(s, "approve", "", AT).verdict).toBe("approve");
  });

  test("undelivered reviews are taken once", () => {
    const s = emptyState();
    review.submitReview(s, "approve", "", AT);
    expect(review.takeUndelivered(s)).toHaveLength(1);
    expect(review.takeUndelivered(s)).toHaveLength(0);
  });
});

describe("questions", () => {
  test("a question goes to the agent at once, without the drafts", () => {
    const s = emptyState();
    review.addThread(s, anchor, "fix this", AT);
    const q = review.addThread(s, anchor, "why a map?", AT, "question");
    expect(q.id).toBe("q2");
    expect(review.threadState(q)).toBe("waiting");
    expect(review.unsentCount(s.comments)).toBe(1);
    expect(s.reviews).toMatchObject([{ verdict: "question", threadIds: ["q2"], messageIds: ["q2.1"] }]);
  });

  test("a follow-up in a question thread is sent too; in a change thread it waits", () => {
    const s = emptyState();
    const q = review.addThread(s, anchor, "why?", AT, "question");
    review.addAgentMessage(q, "because", AT);
    review.addReply(s, q, "and then?", AT);
    expect(review.threadState(q)).toBe("waiting");
    expect(s.reviews.at(-1)).toMatchObject({ verdict: "question", messageIds: ["q1.3"] });

    const c = review.addThread(s, anchor, "fix", AT);
    review.submitReview(s, "changes", "", AT);
    review.addReply(s, c, "also this", AT);
    expect(review.threadState(c)).toBe("pending");
  });

  test("the agent is told to answer, not change code", () => {
    const s = emptyState();
    review.addThread(s, anchor, "why a map?", AT, "question");
    const out = formatReviews(review.takeUndelivered(s), s.comments);
    expect(out).toContain("# Questions (1)");
    expect(out).toContain("## q1");
    expect(out).not.toContain("# Review:");
    expect(out).toContain("stackdiff wait");
  });

  test("questions that arrive with a review are listed apart", () => {
    const s = emptyState();
    review.addThread(s, anchor, "why?", AT, "question");
    review.addThread(s, anchor, "fix", AT);
    review.submitReview(s, "approve", "", AT);
    const out = formatReviews(review.takeUndelivered(s), s.comments);
    expect(out).toContain("# Review: APPROVED (1 thread with notes)");
    expect(out).toContain("# Questions (1)");
    expect(out).toContain("Do not run `stackdiff wait` again");
  });
});

describe("chat", () => {
  test("a chat message goes to the agent at once, with the chunk it was written on", () => {
    const s = emptyState();
    const m = review.addChatMessage(s, " move chunk 3 up ", AT, "Token types");
    expect(m).toEqual({ id: "chat.1", author: "user", body: "move chunk 3 up", at: AT, sent: true, chunkTitle: "Token types" });
    expect(s.reviews).toMatchObject([{ verdict: "chat", threadIds: [], messageIds: ["chat.1"] }]);
    expect(review.addAgentChatMessage(s, "done", AT).id).toBe("chat.2");
    expect(s.reviews).toHaveLength(1);
    expect(() => review.addChatMessage(s, "  ", AT)).toThrow("empty");
  });

  test("the agent reads new messages with recent ones for context, and how to answer", () => {
    const s = emptyState();
    review.addChatMessage(s, "why a map?", AT);
    review.takeUndelivered(s);
    review.addAgentChatMessage(s, "lookups", AT);
    review.addChatMessage(s, "merge chunks 2 and 3", AT, "Store");
    const out = formatReviews(review.takeUndelivered(s), s.comments, s.chat);
    expect(out).toContain("# Chat");
    expect(out).toContain("**Reviewer:**\nwhy a map?");
    expect(out).toContain('**Reviewer (new) (viewing chunk "Store"):**\nmerge chunks 2 and 3');
    expect(out).toContain("stackdiff chat -m");
    expect(out).toContain("stackdiff plan");
    expect(out).not.toContain("# Review:");
    expect(out).toContain("Then run `stackdiff wait` again.");
  });

  test("a message the agent has not received can be taken back; one it has, cannot", () => {
    const s = emptyState();
    review.addChatMessage(s, "first", AT);
    review.takeUndelivered(s);
    review.addChatMessage(s, "second", AT);
    expect(() => review.cancelChatMessage(s, "chat.1")).toThrow("already has");
    review.cancelChatMessage(s, "chat.2");
    expect(s.chat.map((m) => m.body)).toEqual(["first"]);
    expect(review.takeUndelivered(s)).toEqual([]);
    expect(review.addChatMessage(s, "third", AT).id).toBe("chat.3");
    expect(s.reviews.at(-1)!.id).toBe(3);
  });

  test("a message about some lines carries them, sorted, and the agent sees the code", () => {
    const s = emptyState();
    const code = { file: "pay.ts", side: "additions" as const, startLine: 18, endLine: 12, snippet: "+const net = gross;" };
    const m = review.addChatMessage(s, "why net?", AT, "Salary", code);
    expect(m.code).toMatchObject({ startLine: 12, endLine: 18 });
    const out = formatReviews(review.takeUndelivered(s), s.comments, s.chat);
    expect(out).toContain("About pay.ts lines 12-18 (new code):");
    expect(out).toContain("```diff\n+const net = gross;\n```");
    expect(out.indexOf("```diff")).toBeLessThan(out.indexOf("why net?"));
  });
});
