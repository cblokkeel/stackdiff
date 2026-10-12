import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORED_IMAGE, Store } from "../src/store";
import type { Plan } from "../src/types";

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "stackdiff-shots-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return { dir, store: new Store(dir) };
};

const planWith = (...paths: string[]): Plan => ({
  chunks: [{ title: "UI", hunks: [], screenshots: paths.map((path) => ({ path, caption: path })) }],
});

test("checkScreenshots names missing files and files that are not images", () => {
  const { dir, store } = repo();
  writeFileSync(join(dir, "notes.txt"), "hi");
  expect(store.checkScreenshots(planWith("gone.png", "notes.txt"), dir)).toEqual([
    'Chunk 1 ("UI"): screenshot "gone.png" not found.',
    'Chunk 1 ("UI"): screenshot "notes.txt" is not a .png, .jpg, .jpeg, .gif, .webp file.',
  ]);
});

test("storeScreenshots copies each image by content and drops copies no plan uses", () => {
  const { dir, store } = repo();
  writeFileSync(join(dir, "before.png"), "before");
  writeFileSync(join(dir, "after.PNG"), "after");

  const first = planWith("before.png", "after.PNG");
  expect(store.checkScreenshots(first, dir)).toEqual([]);
  store.storeScreenshots(first, dir);
  const names = first.chunks[0]!.screenshots!.map((s) => s.path);
  expect(names.every((n) => STORED_IMAGE.test(n))).toBe(true);
  expect(names[1]).toEndWith(".png");
  expect(first.chunks[0]!.screenshots![0]!.caption).toBe("before.png");

  const second = planWith("after.PNG");
  store.storeScreenshots(second, dir);
  expect(readdirSync(store.path("images"))).toEqual([names[1]!]);
  expect(existsSync(store.path(`images/${names[0]}`))).toBe(false);
});
