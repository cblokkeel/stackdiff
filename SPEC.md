# stackdiff — spec

Local review UI for large agent changes. The agent splits its diff into small,
ordered chunks. You review them one by one in the browser and send comments
back to the agent.

## Rules

- Everything stays local. The server listens on `127.0.0.1` only.
- The split is a view. No commits, no branches, git stays untouched.
- Works with any agent that can run a shell command. No harness hooks.

## What it shows

All work on the branch: `git diff <merge-base of HEAD and base>` (committed,
staged and unstaged) plus untracked files. Base defaults to `main`, then
`master`; override with `--base`.

## Agent flow

1. `stackdiff hunks` — list every hunk with an id (`path#n`).
2. `stackdiff plan plan.json --overview overview.md` (or `-` for stdin) — save
   the split. Fails if a hunk is missing, unknown, or in two chunks.
3. `stackdiff open` — start the server (once per worktree) and print the URL.
4. `stackdiff wait` — block until the user submits a review, print it, exit.
   Exits after 9 minutes with "nothing yet, run again" so harness timeouts
   don't kill it.
5. Fix, then `stackdiff resolve <id> -m "what changed"` for each comment.
   Chat messages: act on them (re-run `stackdiff plan` to reorder chunks), then
   `stackdiff chat -m "answer"`.
6. Re-run `stackdiff plan` if the hunks changed, then `stackdiff wait` again.
7. Stop when `wait` prints `APPROVED`.

The stackdiff skill teaches the agent these steps.

## Plan format

```json
{
  "title": "Add magic link login",
  "summary": "optional",
  "overview": "optional markdown walkthrough (or pass --overview <file>)",
  "chunks": [
    { "title": "Token types", "description": "why and what to check",
      "visual": "optional markdown sketch",
      "hunks": ["src/auth/types.ts", "src/auth/token.ts#2"] }
  ]
}
```

A bare path takes every hunk in that file.

## UI

- Sidebar: chunks in order, +/- counts, comment count, approved checkbox,
  progress.
- Main: chunk title and description, then each file's hunks for that chunk
  (rendered with `@pierre/diffs`).
- Click "+" on a line (or drag a range) to start a thread. Unsent messages
  save on the server.
- "Send N messages" in the chunk footer (`s`) sends that chunk's unsent messages as
  "Request changes" and opens the next chunk, so the agent can start on fixes
  while you keep reviewing. It does not approve the chunk.
- "Approve chunk" (`a`) marks a chunk done. With open threads it reads
  "Approve anyway (N open)". When every chunk is approved, "Approve & finish"
  sends the final approval.
- "Submit review" sends all unsent messages as one batch, with an optional
  overall note, as "Request changes" or "Approve". With chunks not approved,
  Approve reads "Approve with N chunks left" and is never the default.
- Sends and deletes wait 5 seconds behind an Undo toast (`u`); leaving the page
  sends at once.
- Live reload: the page refreshes when the diff, plan or comments change.
- Hunks not in the plan (new edits after the plan) show in a last chunk called
  "Not in plan", so nothing hides.
- Approved checkboxes clear when the chunk's content changes; the chunk then
  shows "Changed" and a toast names it.
- Approving a chunk, or sending comments on it, keeps a copy of its code. When
  the chunk changes after that, it shows against the copy instead of the base:
  red is what you last reviewed, green is what's there now, only the hunks
  inside the chunk, with context you can expand. A bar above the diff says
  "Changed since you approved" or "Changed since you sent comments" and which
  view is on; its button ("Show whole chunk" / "Show only changes", `f`)
  switches. In the changes view you can comment on the new side only.
- Chunk visual: optional `visual` markdown per chunk (call/file trees as
  `diff` blocks, pseudocode, `mermaid` diagrams), shown above the code in a
  collapsible panel. Open/closed is remembered for all chunks.
- Overview: optional `overview` markdown, shown as its own page before chunk
  1: how the change was thought and how it works, with the same sketches as
  chunk visuals. The page opens on it the first time; it stays at the top of
  the sidebar and `o` goes back to it.
- Right sidebar: a dock icon at the top right (`]`) shows or hides it. Two tabs:
  Threads (`t`), every thread by chunk, and Chat (`c`). `t`/`c` open the sidebar
  on that tab, or close it if that tab is already shown. Drag its left edge to
  resize it (300-720px, the diff keeps 480px; ←/→ on the focused edge, Shift
  for bigger steps), double-click to reset to 380px. The width is remembered. Opening by click fades
  and slides it in; by key it shows at once.
- Chat: talk to the agent about anything: reorder,
  split or merge chunks, or ask about the change. Each message goes to the agent
  at once, through `stackdiff wait`, with the chunk on screen; the agent answers
  with `stackdiff chat`. A badge on the dock icon counts unread replies (kept
  across reloads); a dot on the Chat tab marks them too.
- Ask in chat: the new-comment box has an "Ask in chat" button. It moves the
  selected lines and the typed text to the chat box; the lines show above it
  until sent or removed. The message shows the code (click to jump to the
  lines), and the agent gets the file, lines and snippet with it.
- Each chat message shows its own state: "Sending" while the agent listens,
  "Queued" while it is away from `stackdiff wait`. A queued message has a
  Cancel link (5s Undo); the server refuses once the agent has it. "Thinking" sits under the last message
  the agent has received and not answered yet.
- Line questions as threads are gone from the UI; old question threads still
  show and work.
- Keys: `o` overview, `]` sidebar, `t` threads, `c` chat, `j`/`k` next/prev chunk, `s` send chunk, `a` toggle approved,
  `v` toggle "How it fits", `f` compare to your approval or the base, `u` undo.

## State

Stored in `$(git rev-parse --absolute-git-dir)/stackdiff/`, so it never shows
up in the working tree and each worktree gets its own:

- `plan.json`, `review.json` (comments, reviews, approval marks),
  `server.json` (port, pid).
- `reviewed.json` (per chunk you approved or commented on: how, its hash, each
  file's copy and line ranges) and
  `snapshots/` (the copies, named by content hash; unused ones get deleted).

## Not in v1

Versions/history, comment threads, expanding context beyond the hunk,
pushing to GitHub/Graphite.
