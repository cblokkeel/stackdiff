import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill, SKILL_DIR } from "../src/skill";

const fakeHome = (...agentHomes: string[]) => {
  const home = mkdtempSync(join(tmpdir(), "stackdiff-skill-"));
  for (const dir of agentHomes) mkdirSync(join(home, dir));
  return home;
};

describe("installSkill", () => {
  test("ships a SKILL.md in the repo", () => {
    expect(existsSync(join(SKILL_DIR, "SKILL.md"))).toBe(true);
  });

  test("links the skill only into agent homes that exist", () => {
    const home = fakeHome(".claude");
    const results = installSkill(home);
    expect(results).toEqual([{ path: join(home, ".claude/skills/stackdiff"), status: "linked" }]);
    expect(readlinkSync(results[0]!.path)).toBe(SKILL_DIR);
    expect(existsSync(join(home, ".agents"))).toBe(false);
  });

  test("replaces an old copy, and leaves a correct link alone", () => {
    const home = fakeHome(".claude", ".agents");
    mkdirSync(join(home, ".agents/skills/stackdiff"), { recursive: true });
    writeFileSync(join(home, ".agents/skills/stackdiff/SKILL.md"), "old");
    expect(installSkill(home).map((r) => r.status)).toEqual(["linked", "replaced"]);
    expect(installSkill(home).map((r) => r.status)).toEqual(["already linked", "already linked"]);
    expect(readlinkSync(join(home, ".agents/skills/stackdiff"))).toBe(SKILL_DIR);
  });

  test("fails when no agent home exists", () => {
    expect(() => installSkill(fakeHome())).toThrow("No agent home found");
  });
});
