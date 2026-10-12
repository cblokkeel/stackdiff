---
name: stackdiff
description: Hand a large change to the user for local review with stackdiff. Split the diff into small ordered chunks, open the review UI, wait for the user's comments, fix them, and loop until approved. Use when you finish a change over ~300 lines, when the user asks to review your work locally, or mentions stackdiff.
---

stackdiff shows your diff in the browser as a stack of small chunks. The user
reviews them one by one and their comments come back to you through
`stackdiff wait`. The split is only a view: never commit, branch or stage
anything for it.

If `stackdiff` is not found, tell the user to run `bun link` in the stackdiff
repo, then stop.

## 1. List the hunks

```sh
stackdiff hunks
```

Every changed hunk since the base branch (committed, staged, unstaged and
untracked), each with an id like `src/auth/token.ts#2`. If the base is not
`main`/`master`, pass `--base <ref>` to `stackdiff open` first.

To split a hunk, print it with numbered lines:

```sh
stackdiff hunks src/i18n/en.json#1
```

## 2. Plan the chunks

This is the part that matters. Treat the chunks like a stack of PRs: each
chunk must be mergeable on its own, on top of the chunks before it.

**The rule:** chunks 1..N applied together, with nothing from N+1 onward, must
build, pass type checks and tests, and not break anything that works today. A
chunk may use code from earlier chunks. It must never use code from a later
one.

How to get there:

- Start from the dependencies, not the file list. For each piece of the change,
  ask "what must exist before this compiles and works?" Those pieces go in
  earlier chunks.
- Put each hunk (or line range) in the same chunk as the first code that uses
  it. "The earliest chunk where everything it needs exists" is a floor, not a
  target.
- Never make a chunk that only holds exports, translation keys or config for
  later chunks. Split a shared hunk (i18n keys, an import block) by line range
  (`path#n:a-b`) so each part goes with its user.
- Tests go in the same chunk as the code they cover, not in a "tests" chunk at
  the end. A chunk with new behavior and no tests is not done.
- Changing a call site before the thing it calls exists breaks the build. A
  helper with no caller yet does not, but put it with its first caller.
- Changing a signature means updating every caller in the same chunk, or the
  build breaks.
- Dependency, config, schema and lockfile changes go in the first chunk that
  needs them. Never in a late "cleanup" chunk.
- A chunk that turns the feature on (route, flag, menu entry, wiring in main)
  comes last, so earlier chunks don't change what users see.
- Smallest chunks that still follow the rule. Aim for 50–300 changed lines.
  When the rule and the size clash, the rule wins: merge chunks.
- Split a file across chunks when its hunks belong to different steps, and a
  hunk by line range when its lines do.
- Each `description` says what the chunk does, why, what it builds on
  ("Uses the token store from chunk 3"), and what to check closely. Plain
  words, 1–3 sentences.

Before saving, check the plan: walk the chunks in order, and for each one
confirm every name it uses is defined in that chunk, an earlier chunk, or
code that already exists on the base branch. If you can, prove it: for a
risky chunk, apply only chunks 1..N in a scratch worktree and run the build
and tests. Never do this in the user's working tree.

A line-range split can leave chunks 1..N invalid for the file's format. JSON:
if chunk A ends a block with `},` and the next block comes in a later chunk,
chunks 1..A alone have a trailing comma. The review view does not care. When
you prove chunks in a scratch worktree or turn them into real PRs, fix such
edges (commas, braces) as you apply them.

### A visual for each chunk

Give every chunk a `visual`: a short markdown sketch shown above its code in a
collapsible "How it fits" panel. It answers "where does this sit and what
changes?" before the user reads lines. Pick the smallest view that makes the
point, usually one, at most two:

- **Shape change** (most chunks): a `diff` block over a call tree, component
  tree or file tree, so `+`/`-` show what this chunk adds to the existing shape.
  ````
  ```diff
   submitForm
     createSession
  +    expandSkillMention
       launchAgent
  ```
  ````
- **Logic**: pseudocode in a `text` block.
- **Runtime flow between parts**: a `mermaid` `sequenceDiagram` or
  `flowchart`, with 3–5 participants. The UI renders it.
- **New files or modules**: a shallow file tree with a `# role` comment per line.

Rules:
- One plain sentence first, then the sketch. Keep the whole visual under ~20
  lines.
- Use the real names from the code. Show only the calls, files and states this
  chunk touches, plus enough around them to place it.
- Mark what comes from earlier chunks or later ones ("# from chunk 3",
  "# wired in chunk 7"), so the stack order is visible.
- Skip the visual (leave it out) for chunks where it adds nothing, like a
  lockfile bump or a rename.
- No raw HTML; it is shown as text.

### Screenshots for UI chunks

When a chunk changes what users see (a new screen, a layout, a state like
empty or error), add `screenshots` so the user sees the result before reading
the code. They show as thumbnails under the description; a click opens one
full size.

```json
"screenshots": [
  { "path": "/tmp/stackdiff-shots/login-before.png", "caption": "Before: no magic-link option" },
  { "path": "/tmp/stackdiff-shots/login-after.png", "caption": "After: magic-link button under the form" }
]
```

- Take them with whatever browser tool you have (a Playwright MCP, the
  project's run skill, a headless browser). If you have none, or the app
  will not run, skip screenshots; never block the review on them.
- Only for chunks with a visible change. One to three per chunk: the main
  state, plus the edge states the chunk adds. A before/after pair helps when
  the chunk changes an existing screen.
- Show the state with chunks 1..N in place when you can. If the screen only
  works once a later chunk lands, say so in the caption ("full feature, after
  chunk 6").
- Crop to the part that changed, not the whole desktop.
- Save them outside the repo (`/tmp/stackdiff-shots/`). `stackdiff plan`
  copies them, so you can delete yours after. Formats: png, jpg, gif, webp.
- Captions are short and plain: what state, and what to look at.

### The overview

Before the chunks, write an overview: a markdown walkthrough shown as its own
page before chunk 1. The user reads it first, so they start the review with
context, and can reopen it any time from the top of the sidebar (or `o`).

Load the `show-me` skill and use it to pick the views. Its HTML-file option
does not apply here: the overview is markdown only (no raw HTML), with the
same block types as `visual` (`diff`, `text`, `mermaid`). Use `##` headings
for three parts:

1. **How it was thought**: the problem, the approach you picked, what you
   ruled out and why, and the trade-offs the user should agree with.
2. **How it works**: the runtime flow as a `mermaid` sequenceDiagram or
   flowchart, the call or component tree as a `diff` block over today's code,
   a file tree with a `# role` comment per file, pseudocode for tricky logic,
   and the shape of new data types. Pick what the change needs, not all of it.
3. **How to read the chunks**: the order and why, and which chunks need the
   most care.

Short prose next to each sketch, real names from the code, around 60–150
lines. Write it to a temp file (`/tmp/stackdiff-overview.md`) and pass it with
`--overview` when you save the plan.

### Write the plan

Write the plan to a temp file, outside the repo. `visual` is a JSON string, so
newlines are `\n` (writing the file from a small script is easiest):

```json
{
  "title": "Short name for the whole change",
  "summary": "What the change does and why, in a few lines.",
  "chunks": [
    {
      "title": "Add token types",
      "description": "New types for magic-link tokens. Check the expiry field.",
      "visual": "Tokens get a type and a hash helper; the store comes in chunk 3.\n\n```diff\n src/auth/\n+├── types.ts   # MagicToken\n └── token.ts\n+    hashToken()\n```",
      "hunks": ["src/auth/types.ts", "src/auth/token.ts#1"]
    },
    {
      "title": "Magic-link button on the login page",
      "description": "Adds the button and its loading state. Uses sendMagicLink from chunk 3.",
      "screenshots": [{ "path": "/tmp/stackdiff-shots/login.png", "caption": "Login with the new button" }],
      "hunks": ["src/pages/Login.tsx"]
    }
  ]
}
```

An entry in `hunks` is one of:

- `src/auth/token.ts`: every hunk in the file.
- `src/auth/token.ts#2`: hunk 2.
- `src/i18n/en.json#1:5-40`: lines 5 to 40 of hunk 1, as
  `stackdiff hunks <id>` numbers them.

Every line of every hunk must be in exactly one chunk.

```sh
stackdiff plan /tmp/stackdiff-plan.json --overview /tmp/stackdiff-overview.md
```

If it prints "Plan not saved", fix what it lists and run it again.

## 3. Open and wait

```sh
stackdiff open
stackdiff wait
```

`open` starts the local server and opens the browser. Tell the user in one
line that the review is ready and give the URL. `wait` blocks until the user
submits. If it prints "No review yet", run `stackdiff wait` again. Keep waiting
until a review arrives; do not end your turn.

## 4. Handle the review

`wait` prints each comment thread with an id (`c3`), the file, lines, code and
the whole conversation so far. Messages marked "(new)" are the ones to answer.
For each thread:

- You made the change: `stackdiff resolve c3 -m "what you changed"`.
- You have a question, disagree, or need a decision:
  `stackdiff reply c3 -m "..."`. The thread stays open for the user.

The user can reply to any thread, resolved ones too, so later reviews may bring
follow-ups ("· follow-up" in the heading). Read the history before answering.

The user can also ask a quick question on some lines without submitting a
review. `wait` prints it under `# Questions` with an id like `q4`. Answer with
`stackdiff reply q4 -m "..."`, change no code for it, then run `stackdiff wait`
again.

If your fixes added or moved hunks, run `stackdiff hunks`, update the plan file
and run `stackdiff plan` again. The UI reloads by itself.

Then run `stackdiff wait` again.

## 5. Stop

Stop when `wait` prints `APPROVED`. Handle any notes that came with the
approval, resolve them, and do not wait again.

## Other commands

- `stackdiff status`: URL, plan, comment counts.
