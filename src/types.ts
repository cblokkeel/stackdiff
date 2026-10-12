export type Side = "additions" | "deletions";

export type FileStatus = "added" | "deleted" | "modified" | "renamed" | "binary";

export interface DiffHunk {
  id: string;
  file: string;
  index: number;
  header: string;
  text: string;
  added: number;
  removed: number;
  oldStart: number;
  newStart: number;
  /** Set on a slice: the body lines (1-based, inclusive) of hunk `index` it holds. */
  lines?: [number, number];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  header: string;
  hunks: DiffHunk[];
}

/** A picture of the UI the chunk changes. `path` is the agent's file until `stackdiff plan` stores it, then the stored name. */
export interface Screenshot {
  path: string;
  caption?: string;
}

export interface PlanChunk {
  title: string;
  description?: string;
  visual?: string;
  screenshots?: Screenshot[];
  hunks: string[];
}

export interface Plan {
  title?: string;
  summary?: string;
  /** Markdown walkthrough of the whole change, shown before the first chunk. */
  overview?: string;
  chunks: PlanChunk[];
}

export interface LineRanges {
  additions: [number, number][];
  deletions: [number, number][];
}

export interface ViewScreenshot {
  url: string;
  caption: string;
}

export interface ViewFile {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  patch: string;
  hunkIds: string[];
  added: number;
  removed: number;
  ranges: LineRanges;
  note?: string;
  /** The chunk holds every change in the file, so the lines between its hunks are truly unchanged. */
  expandable: boolean;
}

export interface ViewChunk {
  key: string;
  title: string;
  description: string;
  visual: string;
  screenshots: ViewScreenshot[];
  files: ViewFile[];
  added: number;
  removed: number;
  hash: string;
  /** Approved by the user. Stored as "reviewed"; clears when the chunk's content changes. */
  reviewed: boolean;
  /** Approved once, then the content changed, so the approval no longer holds. */
  changedSinceApproval: boolean;
  /** Set when the chunk changed since the user last reviewed it: the chunk against the code they reviewed. */
  sinceReview?: { by: ReviewedBy; files: Record<string, SinceFile> };
  unplanned: boolean;
}

/** How the user last reviewed a chunk. */
export type ReviewedBy = "approving" | "commenting";

/** A chunk's file against the code the user last reviewed. */
export interface SinceFile {
  /** Only the hunks inside the chunk; empty when nothing changed there. */
  patch: string;
  /** Every change in the file is in `patch`, so the lines between hunks are truly unchanged. */
  expandable: boolean;
  /** The file was not in the chunk when reviewed, so `patch` is its diff against the base. */
  joined: boolean;
}

export type CommentStatus = "open" | "resolved";

/** "change" waits for the review submit; "question" goes to the agent at once and asks for an answer, not a fix. */
export type CommentKind = "change" | "question";

export interface Message {
  id: string;
  author: "user" | "agent";
  body: string;
  at: string;
  sent: boolean;
}

export interface Comment {
  id: string;
  kind: CommentKind;
  file: string;
  side: Side;
  startLine: number;
  endLine: number;
  snippet: string;
  chunkTitle: string;
  /** The code at these lines is no longer what `snippet` shows: the agent rewrote it. */
  codeChanged?: boolean;
  status: CommentStatus;
  messages: Message[];
  createdAt: string;
}

/** Lines of the diff a chat message is about. */
export interface ChatCode {
  file: string;
  side: Side;
  startLine: number;
  endLine: number;
  snippet: string;
}

/** A message in the chat with the agent. */
export interface ChatMessage extends Message {
  /** The chunk the user had open when they wrote it, so "this chunk" means something to the agent. */
  chunkTitle?: string;
  /** The lines the user asked about, when they started from the code. */
  code?: ChatCode;
}

export interface ViewChatMessage extends ChatMessage {
  /** The agent has received it. Always true for the agent's own messages. */
  seen: boolean;
}

export type Verdict = "changes" | "approve";

export interface Review {
  id: number;
  /** "question" is one question or follow-up, sent on its own without a verdict; "chat" is one chat message. */
  verdict: Verdict | "question" | "chat";
  body: string;
  threadIds: string[];
  messageIds: string[];
  createdAt: string;
  delivered: boolean;
}

export interface ReviewState {
  comments: Comment[];
  reviews: Review[];
  reviewed: Record<string, string>;
  nextComment: number;
  chat: ChatMessage[];
  /** Never reused, so a cancelled message's number never comes back. */
  nextChat: number;
}

export interface ViewComment extends Comment {
  chunkKey: string | null;
  /** The agent has received every message the user sent in this thread. */
  seen: boolean;
}

export interface ViewState {
  root: string;
  branch: string;
  base: string;
  title: string;
  summary: string;
  overview: string;
  hasPlan: boolean;
  planError: string | null;
  chunks: ViewChunk[];
  comments: ViewComment[];
  chat: ViewChatMessage[];
  waitingReviews: number;
  /** `stackdiff wait` is running right now, so a question reaches the agent at once. */
  agentListening: boolean;
}
