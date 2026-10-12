# stackdiff

Review big agent changes locally, as a stack of small chunks. The agent splits
its diff into ordered chunks, you step through them in the browser, and your
comments go back to the agent. Nothing leaves your machine and git stays
untouched. Works with any agent that can run shell commands.

See [SPEC.md](SPEC.md) for the design.

## Install

```sh
cd stackdiff
bun install
bun run build
bun link                  # puts `stackdiff` on your PATH
stackdiff install-skill   # links skills/stackdiff into ~/.claude/skills and ~/.agents/skills
```

The skill is a symlink to this repo, so edits to `skills/stackdiff/SKILL.md`
reach your agents at once. Run `install-skill` again if you move the repo.

## Use it

Tell your agent, in any harness:

> Use the stackdiff skill so I can review your work.

The agent then runs `stackdiff hunks`, writes a plan, runs `stackdiff plan`,
`stackdiff open` (your browser opens) and `stackdiff wait`.

In the browser:

- The page opens on the **Overview**: how the agent thought about the change
  and how it works, with diagrams. Reopen it from the sidebar or with `o`.
- `j` / `k` to move between chunks, `s` to send a chunk's messages, `a` to approve it, `]` for the sidebar, `u` to undo, `?` for all shortcuts.
- Hover a line and click **+** to start a thread. Drag on the **+** to pick a range.
- A thread is a comment that asks for a change. Reply to any thread, even
  resolved ones; your reply reopens it when you send it.
- To ask about the lines instead, click **Ask in chat** in the comment box:
  the chat opens with the code attached, and your text comes along.
- **Send N messages** (`s`) in the chunk footer sends that chunk's unsent
  messages and moves on. The chunk stays open until you **Approve** it (`a`).
- Sends and deletes wait 5 seconds behind an **Undo** toast (`u`).
- **Submit review** sends every unsent message, from every chunk, and lists
  them by chunk first. Approving there with chunks left needs a deliberate
  click on **Approve with N chunks left**.
- Once every chunk is approved, **Approve & finish** tells the agent to stop.
- The **sidebar** on the right (dock icon at the top right, or `]`) has two tabs.
  Drag its left edge to resize it; double-click the edge to reset.
  **Threads** (`t`) lists every thread; click one to jump to it.
  **Chat** (`c`) talks to the agent: "move chunk 4
  first", "merge 2 and 3", "why this approach?". It goes to the agent at once,
  with the chunk you have open. Click the code in a message to jump to it. A
  message sent while the agent is still on an earlier one shows **Queued**, and
  you can **Cancel** it until the agent picks it up. A
  badge on the dock icon counts replies you have not read.
- `Esc` leaves a text box (what you typed stays), closes a dialog, or closes the sidebar.
- The page reloads by itself when the agent changes code or the plan. If the
  agent changes a chunk you approved, the approval clears and the chunk shows
  **Changed**. A chunk the agent changes after you approved it or sent comments
  on it shows against the code you last reviewed, not the base, so you read
  only what changed since. `f` switches back to the base.

## Commands

| Command | What it does |
| --- | --- |
| `stackdiff open [--base ref]` | Start the UI for this repo, print its URL |
| `stackdiff hunks [--json]` | List hunks and their ids |
| `stackdiff plan <file\|-> [--overview md]` | Check and save the chunk plan and overview |
| `stackdiff wait [--timeout s]` | Block until you submit a review, print it |
| `stackdiff reply <id...> -m msg` | Answer a comment thread, keep it open |
| `stackdiff resolve <id...> [-m msg]` | Close a comment thread |
| `stackdiff chat -m msg` | Answer the user in the chat panel |
| `stackdiff status` / `stop` | Status, stop server |
| `stackdiff install-skill` | Link the agent skill into `~/.claude` and `~/.agents` |

State lives in `.git/stackdiff/` of each worktree.

## Code map

`src/` runs in Bun (CLI and server). `web/` is the React UI.

| File | What it does |
| --- | --- |
| `src/cli.ts` | The `stackdiff` command: one function per subcommand |
| `src/daemon.ts` | Start, find, replace and stop the background server |
| `src/server.ts` | HTTP routes for the UI; thin handlers over `review.ts` |
| `src/review.ts` | **All comment-thread and review rules**, shared by server, CLI and UI |
| `src/plan.ts` | Check a plan; turn diff + plan into the chunks the UI shows |
| `src/git.ts` | Run git, parse the unified diff into files and hunks |
| `src/store.ts` | The state dir in `.git/stackdiff/`: read/write JSON, build the view |
| `src/format.ts` | Text the agent reads: reviews, hunks, status |
| `src/types.ts` | Types shared by server and UI |
| `src/skill.ts` | `install-skill`: link `skills/stackdiff` into agent homes |
| `skills/stackdiff/SKILL.md` | The skill that tells agents how to use stackdiff |
| `web/reviewState.ts` | Server state + optimistic updates + polling |
| `web/actions.ts` | Every reviewer action: update the screen, then send the request |
| `web/App.tsx` | Page layout, navigation, shortcuts, panels |
| `web/ChunkView.tsx`, `FileBlock.tsx`, `Thread.tsx` | A chunk, a file's diff, a comment thread |
| `web/OverviewView.tsx`, `Markdown.tsx` | The overview page; markdown with diff and mermaid blocks |
| `web/Sidebar.tsx`, `Topbar.tsx`, `CommentsPanel.tsx`, `ChatPanel.tsx`, `SubmitDialog.tsx` | The other parts of the page |

To change how threads or reviews behave, change `src/review.ts` and its
tests; the server, CLI and UI all follow.

## Develop

```sh
bun test
bun run typecheck
bun src/cli.ts serve --port 4299 & bun run dev:web   # UI with hot reload (proxies /api to :4299)
```
