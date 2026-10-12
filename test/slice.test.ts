import { expect, test } from "bun:test";
import { hunkLines, parseDiff, sliceHunk } from "../src/git";
import { buildChunks, checkPlan, locateComments, UNPLANNED_TITLE } from "../src/plan";
import type { Comment, DiffHunk, ReviewState } from "../src/types";

// a.txt#1 body lines:
// 1 " ten"  2 "-eleven"  3 "-twelve"  4 "+ELEVEN"  5 " thirteen"  6 "-fourteen"  7 " fifteen"
const DIFF = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -10,6 +10,4 @@ section
 ten
-eleven
-twelve
+ELEVEN
 thirteen
-fourteen
 fifteen
diff --git a/b.txt b/b.txt
index 3333333..4444444 100644
--- a/b.txt
+++ b/b.txt
@@ -1,2 +1,2 @@
 one
-two
\\ No newline at end of file
+TWO
\\ No newline at end of file
diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..5555555
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+export const a = 1;
+export const b = 2;
+export const c = 3;
diff --git a/logo.png b/logo.png
index 6666666..7777777 100644
Binary files a/logo.png and b/logo.png differ
`;

const empty: ReviewState = { comments: [], reviews: [], reviewed: {}, nextComment: 1, chat: [], nextChat: 1 };
const files = parseDiff(DIFF);
const hunk = (id: string) => files.flatMap((f) => f.hunks).find((h) => h.id === id)!;
const numbers = (h: DiffHunk) => [...hunkLines(h)].map((l) => [l.oldNo, l.newNo]);

test("slice headers: removed-only, added-only, mixed", () => {
  const a = hunk("a.txt#1");
  const cases: [DiffHunk, number, number, string][] = [
    [a, 2, 3, "@@ -11,2 +10,0 @@"],
    [a, 6, 6, "@@ -14,1 +12,0 @@"],
    [a, 4, 4, "@@ -12,0 +11,1 @@"],
    [a, 2, 5, "@@ -11,3 +11,2 @@"],
    [a, 1, 1, "@@ -10,1 +10,1 @@"],
    [hunk("new.ts#1"), 2, 3, "@@ -0,0 +2,2 @@"],
  ];
  for (const [h, from, to, header] of cases) {
    const slice = sliceHunk(h, from, to);
    expect(slice.header).toBe(header);
    expect(slice.id).toBe(`${h.id}:${from}-${to}`);
    expect(numbers(slice)).toEqual(numbers(h).slice(from - 1, to));
  }
  expect(sliceHunk(a, 2, 5)).toMatchObject({ added: 1, removed: 2, lines: [2, 5] });
});

test("a slice keeps the no-newline marker of its last line", () => {
  const b = hunk("b.txt#1");
  expect(sliceHunk(b, 2, 2).text).toBe("@@ -2,1 +1,0 @@\n-two\n\\ No newline at end of file");
  expect(sliceHunk(b, 3, 3).text).toBe("@@ -2,0 +2,1 @@\n+TWO\n\\ No newline at end of file");
});

test("checkPlan reports line gaps and overlaps", () => {
  const errors = checkPlan(
    {
      chunks: [
        { title: "A", hunks: ["a.txt#1:1-3", "b.txt", "new.ts", "logo.png"] },
        { title: "B", hunks: ["a.txt#1:3-5", "new.ts#1:3-3"] },
      ],
    },
    files,
  );
  expect(errors).toEqual([
    'a.txt#1 line 3 is in both "A" and "B".',
    "a.txt#1 lines 6-7 not in any chunk.",
    'new.ts#1 line 3 is in both "A" and "B".',
  ]);
});

test("checkPlan rejects ranges outside the hunk", () => {
  const errors = checkPlan(
    { chunks: [{ title: "A", hunks: ["a.txt#1:0-2", "a.txt#1:5-8", "a.txt#1:4-2", "a.txt#9:1-2", "logo.png#1:1-1"] }] },
    files,
  );
  expect(errors.slice(0, 5)).toEqual([
    'Chunk 1 ("A"): "a.txt#1:0-2" is not a valid range of a.txt#1 (lines 1-7).',
    'Chunk 1 ("A"): "a.txt#1:5-8" is not a valid range of a.txt#1 (lines 1-7).',
    'Chunk 1 ("A"): "a.txt#1:4-2" is not a valid range of a.txt#1 (lines 1-7).',
    'Chunk 1 ("A"): unknown hunk or file "a.txt#9:1-2".',
    'Chunk 1 ("A"): "logo.png#1:1-1": logo.png#1 has no text lines to split.',
  ]);
});

test("a plan can mix whole hunks and line ranges", () => {
  const plan = {
    chunks: [
      { title: "First", hunks: ["a.txt#1:1-4", "new.ts#1:1-1", "logo.png"] },
      { title: "Second", hunks: ["a.txt#1:5-7", "new.ts#1:2-3", "b.txt#1"] },
    ],
  };
  expect(checkPlan(plan, files)).toEqual([]);
  const chunks = buildChunks(plan, files, empty);
  expect(chunks.map((c) => [c.title, c.files.map((f) => f.hunkIds)])).toEqual([
    ["First", [["a.txt#1:1-4"], ["new.ts#1:1-1"], ["logo.png#1"]]],
    ["Second", [["a.txt#1:5-7"], ["new.ts#1:2-3"], ["b.txt#1"]]],
  ]);
  const [first, second] = chunks;
  expect(chunks.map((c) => c.files.map((f) => f.expandable))).toEqual([
    [false, false, false],
    [false, false, true],
  ]);
  expect(first!.files[0]!.patch).toContain("@@ -10,3 +10,2 @@\n ten\n-eleven\n-twelve\n+ELEVEN\n");
  expect(second!.files[0]!.patch).toContain("@@ -13,3 +12,2 @@\n thirteen\n-fourteen\n fifteen\n");
  expect(first!.files[0]!.ranges).toEqual({ additions: [[10, 11]], deletions: [[10, 12]] });

  const comment = (endLine: number): Comment => ({
    id: `c${endLine}`,
    kind: "change",
    file: "new.ts",
    side: "additions",
    startLine: endLine,
    endLine,
    snippet: "",
    chunkTitle: "",
    status: "open",
    messages: [],
    createdAt: "",
  });
  expect(locateComments([comment(1), comment(3)], chunks).map((c) => c.chunkKey)).toEqual(["First", "Second"]);
});

test("buildChunks joins neighbouring ranges and leaves the rest unplanned", () => {
  const chunks = buildChunks(
    {
      chunks: [
        { title: "Whole", hunks: ["new.ts#1:1-1", "new.ts#1:2-3"] },
        { title: "Part", hunks: ["a.txt#1:2-3", "a.txt#1:9-12", "gone.ts#1:1-2"] },
        { title: "Late", hunks: ["a.txt#1:3-4"] },
      ],
    },
    files,
    empty,
  );
  expect(chunks.map((c) => [c.title, c.files.map((f) => f.hunkIds)])).toEqual([
    ["Whole", [["new.ts#1"]]],
    ["Part", [["a.txt#1:2-3"]]],
    ["Late", [["a.txt#1:4-4"]]],
    [UNPLANNED_TITLE, [["a.txt#1:1-1", "a.txt#1:5-7"], ["b.txt#1"], ["logo.png#1"]]],
  ]);
});
