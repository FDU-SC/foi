import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCRIPTS = ["db-reset.cjs", "demo-seed.cjs"] as const;

function run(script: (typeof SCRIPTS)[number], foiEnv?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "postgres://foi:unused@127.0.0.1:1/foi",
    FOI_ALLOW_DESTRUCTIVE: "yes-drop-everything",
    FOI_DEMO_PASSWORD: "public-demo-password",
  };

  if (foiEnv === undefined) delete env.FOI_ENV;
  else env.FOI_ENV = foiEnv;

  return spawnSync(process.execPath, [join(ROOT, "scripts", script)], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
}

describe.each(SCRIPTS)("%s 的环境守卫", (script) => {
  it.each([undefined, "prod", "production"])(
    "FOI_ENV=%s 时在连接数据库前拒绝执行",
    (foiEnv) => {
      const result = run(script, foiEnv);
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).toBe(1);
      expect(output).toContain("FOI_ENV 必须显式设为 dev");
      expect(output).not.toContain("ECONNREFUSED");
    },
  );

  it("FOI_ENV=dev 时允许进入数据库连接阶段", () => {
    const result = run(script, "dev");
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).not.toContain("FOI_ENV 必须显式设为 dev");
    expect(output).toContain("ECONNREFUSED");
  });
});
