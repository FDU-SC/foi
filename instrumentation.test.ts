import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const mocks = vi.hoisted(() => ({
  assertBootConfiguration: vi.fn(),
  existsSync: vi.fn(),
  info: vi.fn(),
  migrate: vi.fn(),
  startReaping: vi.fn(),
}));

const db = {};

vi.mock("@/lib/boot/checks", () => ({
  assertBootConfiguration: mocks.assertBootConfiguration,
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: mocks.existsSync,
}));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: mocks.migrate,
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/log", () => ({ log: { info: mocks.info } }));
vi.mock("@/lib/runner/reaper", () => ({
  startReaping: mocks.startReaping,
}));

describe("instrumentation 运行时隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    globalThis.__foiReaper = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.__foiReaper = undefined;
  });

  it("Node.js imports 保持在显式运行时分支内", () => {
    const source = readFileSync(
      new URL("./instrumentation.ts", import.meta.url),
      "utf8",
    );
    const file = ts.createSourceFile(
      "instrumentation.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const declaration = file.statements
      .filter(ts.isFunctionDeclaration)
      .find((statement) => statement.name?.text === "register");

    expect(declaration?.body?.statements).toHaveLength(1);
    const runtimeBranch = declaration?.body?.statements[0];
    expect(runtimeBranch && ts.isIfStatement(runtimeBranch)).toBe(true);
    if (!runtimeBranch || !ts.isIfStatement(runtimeBranch)) return;

    expect(runtimeBranch.expression.getText(file)).toBe(
      'process.env.NEXT_RUNTIME === "nodejs"',
    );
    expect(ts.isBlock(runtimeBranch.thenStatement)).toBe(true);
    expect(runtimeBranch.elseStatement).toBeUndefined();
  });

  it("Edge 运行时不执行任何 Node.js 启动逻辑", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(mocks.assertBootConfiguration).not.toHaveBeenCalled();
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.startReaping).not.toHaveBeenCalled();
  });

  it("Node.js 运行时完成检查、迁移并替换 reaper", async () => {
    const stopPrevious = vi.fn();
    const stopCurrent = vi.fn();
    globalThis.__foiReaper = stopPrevious;
    mocks.startReaping.mockReturnValue(stopCurrent);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("FOI_AUTO_MIGRATE", undefined);

    await register();

    expect(mocks.assertBootConfiguration).toHaveBeenCalledOnce();
    expect(mocks.migrate).toHaveBeenNthCalledWith(1, db, {
      migrationsFolder: "drizzle",
    });
    expect(mocks.migrate).toHaveBeenNthCalledWith(2, db, {
      migrationsFolder: "drizzle.local",
    });
    expect(mocks.info).toHaveBeenCalledWith("数据库迁移已应用");
    expect(stopPrevious).toHaveBeenCalledOnce();
    expect(mocks.startReaping).toHaveBeenCalledWith(15_000);
    expect(globalThis.__foiReaper).toBe(stopCurrent);
  });
});
