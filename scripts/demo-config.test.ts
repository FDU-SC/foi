import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("demo 配置补丁", () => {
  it("移除按 uid 分配的用户组", () => {
    const root = mkdtempSync(join(tmpdir(), "foi-demo-config-"));

    try {
      mkdirSync(join(root, "scripts"), { recursive: true });
      mkdirSync(join(root, "content/enrollment"), { recursive: true });
      mkdirSync(join(root, "content/problems/leaky-bucket"), {
        recursive: true,
      });

      copyFileSync(
        join(process.cwd(), "scripts/demo-config.cjs"),
        join(root, "scripts/demo-config.cjs"),
      );
      writeFileSync(
        join(root, "content/site.ts"),
        `export const site = {
  name: "Sample",
  title: "Sample",
  description: "Sample",
  homeEntries: [
  ],
};
`,
      );
      writeFileSync(
        join(root, "content/enrollment/example.ts"),
        `export const rules = [
  {
    label: "first",
    uids: [1],
    groups: ["staff"],
  },
  {
    label: "second",
    uids: [2],
    groups: ["observer"],
  },
  {
    label: "public",
    email: /@example\\.test$/i,
    groups: ["participant"],
  },
];
`,
      );
      writeFileSync(
        join(root, "content/problems/leaky-bucket/problem.ts"),
        `export const problem = {
  maxScore: 100,
};
`,
      );

      execFileSync(process.execPath, ["scripts/demo-config.cjs"], {
        cwd: root,
        env: {
          ...process.env,
          FOI_DEMO_PASSWORD: "public-password",
          FOI_DEMO_ACCOUNT_COUNT: "5",
        },
      });

      const enrollment = readFileSync(
        join(root, "content/enrollment/example.ts"),
        "utf8",
      );
      expect(enrollment).not.toContain("uids:");
      expect(enrollment).not.toContain('label: "first"');
      expect(enrollment).not.toContain('label: "second"');
      expect(enrollment).toContain('groups: ["participant"]');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
