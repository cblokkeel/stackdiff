import { useMemo } from "react";
import * as review from "../src/review";
import type { ChatCode, ChatMessage, Comment, CommentKind, Message, Side, Verdict, ViewChatMessage, ViewChunk, ViewComment } from "../src/types";
import { api } from "./api";
import { type Update, useOptimisticSave } from "./reviewState";
import { currentId, forgetTempId, rememberRealId, serverId, tempId } from "./tempIds";

export interface NewComment {
  file: string;
  side: Side;
  startLine: number;
  endLine: number;
  body: string;
  kind: CommentKind;
}

const now = () => new Date().toISOString();

function changeCopyOfThreads(change: (threads: ViewComment[]) => void): Update {
  return (state) => {
    const comments = structuredClone(state.comments);
    change(comments);
    return { ...state, comments };
  };
}

/** `id` as the shown state has it: a thread made a moment ago may still carry its temp id, or already its real one. */
function shownId(ids: string[], id: string): string {
  const real = currentId(id);
  return ids.includes(real) ? real : id;
}

function findThread(threads: ViewComment[], id: string): ViewComment {
  return review.findThread(threads, shownId(threads.map((t) => t.id), id));
}

function shownMessageId(thread: ViewComment, id: string): string {
  return shownId(thread.messages.map((m) => m.id), id);
}

export function useActions() {
  const optimisticSave = useOptimisticSave();

  return useMemo(() => {
    // Waits for the server's ids, so a thread can be acted on before its create has finished.
    const threadUrl = async (id: string) => `/api/comments/${encodeURIComponent(await serverId(id))}`;
    const messageUrl = async (threadId: string, messageId: string) =>
      `${await threadUrl(threadId)}/messages/${encodeURIComponent(await serverId(messageId))}`;

    return {
      addComment(comment: NewComment, chunk: ViewChunk) {
        const id = tempId();
        const messageId = tempId();
        const at = now();
        const anchor = { ...comment, chunkTitle: chunk.title, snippet: "" };
        return optimisticSave(
          changeCopyOfThreads((threads) => {
            const thread = review.newThread(id, messageId, anchor, comment.body, at, comment.kind);
            if (comment.kind === "question") review.sendUnsentMessages([thread], at);
            threads.push({ ...thread, chunkKey: chunk.key, seen: false });
          }),
          async () => {
            try {
              const created = await api<Comment>("/api/comments", { body: { ...comment, chunkTitle: chunk.title } });
              rememberRealId(created.id, id);
              rememberRealId(created.messages[0]!.id, messageId);
            } catch (e) {
              forgetTempId(id, e as Error);
              forgetTempId(messageId, e as Error);
              throw e;
            }
          },
          comment.kind === "question" ? "Question not sent." : "Comment not saved.",
        );
      },

      reply(threadId: string, body: string) {
        const messageId = tempId();
        const at = now();
        return optimisticSave(
          changeCopyOfThreads((threads) => {
            const thread = findThread(threads, threadId);
            review.addUserMessage(thread, messageId, body, at);
            if (thread.kind === "question") review.sendUnsentMessages([thread], at);
          }),
          async () => {
            try {
              const created = await api<Message>(`${await threadUrl(threadId)}/messages`, { body: { body } });
              rememberRealId(created.id, messageId);
            } catch (e) {
              forgetTempId(messageId, e as Error);
              throw e;
            }
          },
          "Reply not saved.",
        );
      },

      editMessage(threadId: string, messageId: string, body: string) {
        return optimisticSave(
          changeCopyOfThreads((threads) => {
            const thread = findThread(threads, threadId);
            review.editMessage(thread, shownMessageId(thread, messageId), body);
          }),
          async () => api(await messageUrl(threadId, messageId), { method: "PATCH", body: { body } }),
          "Edit not saved.",
        );
      },

      deleteMessage(threadId: string, messageId: string, wait?: Promise<void>) {
        return optimisticSave(
          changeCopyOfThreads((threads) => {
            const thread = findThread(threads, threadId);
            review.deleteMessage(threads, thread.id, shownMessageId(thread, messageId));
          }),
          async () => {
            await wait;
            await api(await messageUrl(threadId, messageId), { method: "DELETE" });
          },
          "Delete failed.",
        );
      },

      deleteThread(threadId: string, wait?: Promise<void>) {
        return optimisticSave(
          changeCopyOfThreads((threads) => review.deleteThread(threads, findThread(threads, threadId).id)),
          async () => {
            await wait;
            await api(await threadUrl(threadId), { method: "DELETE" });
          },
          "Delete failed.",
        );
      },

      resolve(threadId: string) {
        return optimisticSave(
          changeCopyOfThreads((threads) => review.setStatus(findThread(threads, threadId), "resolved")),
          async () => api(await threadUrl(threadId), { method: "PATCH", body: { status: "resolved" } }),
          "Not resolved.",
        );
      },

      reopen(threadId: string) {
        return optimisticSave(
          changeCopyOfThreads((threads) => review.setStatus(findThread(threads, threadId), "open")),
          async () => api(await threadUrl(threadId), { method: "PATCH", body: { status: "open" } }),
          "Not reopened.",
        );
      },

      sendChat(body: string, chunkTitle?: string, code?: ChatCode) {
        const id = tempId();
        const message: ViewChatMessage = { id, author: "user", body, at: now(), sent: true, chunkTitle, code, seen: false };
        return optimisticSave(
          (state) => ({ ...state, chat: [...state.chat, message] }),
          async () => {
            try {
              // The server cuts the snippet itself, from the diff as it is now.
              const lines = code && { file: code.file, side: code.side, startLine: code.startLine, endLine: code.endLine };
              const created = await api<ChatMessage>("/api/chat", { body: { body, chunkTitle, code: lines } });
              rememberRealId(created.id, id);
            } catch (e) {
              forgetTempId(id, e as Error);
              throw e;
            }
          },
          "Message not sent.",
        );
      },

      /** Takes back a chat message the agent has not received yet. */
      cancelChat(id: string, wait?: Promise<void>) {
        return optimisticSave(
          (state) => ({ ...state, chat: state.chat.filter((m) => m.id !== shownId(state.chat.map((c) => c.id), id)) }),
          async () => {
            await wait;
            await api(`/api/chat/${encodeURIComponent(await serverId(id))}`, { method: "DELETE" });
          },
          "Not cancelled.",
        );
      },

      setReviewed(chunk: ViewChunk, reviewed: boolean) {
        return optimisticSave(
          (state) => ({ ...state, chunks: state.chunks.map((c) => (c.key === chunk.key ? { ...c, reviewed } : c)) }),
          () => api("/api/reviewed", { body: { key: chunk.key, hash: chunk.hash, reviewed } }),
          "Not saved.",
        );
      },

      submitReview(verdict: Verdict, note: string) {
        const at = now();
        return optimisticSave(
          (state) => {
            const comments = structuredClone(state.comments);
            review.sendUnsentMessages(comments, at);
            return { ...state, comments, waitingReviews: state.waitingReviews + 1 };
          },
          () => api("/api/review", { body: { verdict, body: note } }),
          "Review not sent.",
        );
      },

      /** Sends only these threads' unsent messages: the ones no chunk shows any more. */
      sendThreads(threadIds: string[], wait?: Promise<void>) {
        const at = now();
        return optimisticSave(
          (state) => {
            const comments = structuredClone(state.comments);
            review.sendUnsentMessages(
              comments.filter((t) => threadIds.includes(t.id)),
              at,
            );
            return { ...state, comments, waitingReviews: state.waitingReviews + 1 };
          },
          async () => {
            await wait;
            const ids = await Promise.all(threadIds.map(serverId));
            await api("/api/review", { body: { verdict: "changes", body: "", threadIds: ids } });
          },
          "Comments not sent.",
        );
      },

      /** Sends only this chunk's unsent messages, so the agent can start on them while the review goes on. */
      sendChunk(chunk: ViewChunk, wait?: Promise<void>) {
        const at = now();
        return optimisticSave(
          (state) => {
            const comments = structuredClone(state.comments);
            review.sendUnsentMessages(
              comments.filter((t) => t.chunkKey === chunk.key),
              at,
            );
            return { ...state, comments, waitingReviews: state.waitingReviews + 1 };
          },
          async () => {
            await wait;
            await api("/api/review", { body: { verdict: "changes", body: "", chunkKey: chunk.key } });
          },
          "Comments not sent.",
        );
      },
    };
  }, [optimisticSave]);
}
