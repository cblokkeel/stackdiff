import type { ChatCode, Side } from "../src/types";

/** Ask the chat about these lines: the sidebar opens on Chat with them attached. */
export const ASK_IN_CHAT_EVENT = "stackdiff:ask-in-chat";

export interface AskInChat {
  code: ChatCode;
  body: string;
}

export function askInChat(detail: AskInChat) {
  dispatchEvent(new CustomEvent(ASK_IN_CHAT_EVENT, { detail }));
}

/** Lines to scroll to and mark, waiting here until the file that holds them has rendered. */
let pendingFocus: ChatCode | null = null;
export const FOCUS_LINES_EVENT = "stackdiff:focus-lines";

export function focusLines(code: ChatCode) {
  pendingFocus = code;
  dispatchEvent(new CustomEvent(FOCUS_LINES_EVENT));
}

export function takePendingFocus(file: string): ChatCode | null {
  if (pendingFocus?.file !== file) return null;
  const code = pendingFocus;
  pendingFocus = null;
  return code;
}

/** The lines of a unified patch on one side, with their +/-/space prefix, like the server's snippets. */
export function snippetFromPatch(patch: string, side: Side, start: number, end: number): string {
  const out: string[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      [oldNo, newNo, inHunk] = [Number(header[1]), Number(header[2]), true];
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    const kind = line[0];
    if (kind !== " " && kind !== "+" && kind !== "-") continue;
    const no = side === "additions" ? (kind === "-" ? null : newNo) : kind === "+" ? null : oldNo;
    if (no !== null && no >= start && no <= end) out.push(line);
    if (kind !== "+") oldNo++;
    if (kind !== "-") newNo++;
  }
  return out.join("\n");
}
