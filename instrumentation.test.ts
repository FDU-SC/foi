import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const mocks = vi.hoisted(() => ({
  assertBootConfiguration: vi.fn(),
  existsSync: vi.fn(),
  info: vi.fn(),
  migrate: vi.fn(),
  prepareDeploymentMigrationJournal: vi.fn(),
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
vi.mock("@/lib/db/migration-journal", () => ({
  prepareDeploymentMigrationJournal: mocks.prepareDeploymentMigrationJournal,
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

  it("Edge 运行时不执行任何 Node.js 启动逻辑", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await register();

    expect(mocks.assertBootConfiguration).not.toHaveBeenCalled();
    expect(mocks.prepareDeploymentMigrationJournal).not.toHaveBeenCalled();
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.startReaping).not.toHaveBeenCalled();
  });

  it.each([undefined, "true"])("Node.js 完成检查、依次迁移平台和部署表并替换 reaper（FOI_AUTO_MIGRATE=%s）", async (autoMigrate) => {
    const stopPrevious = vi.fn();
    const stopCurrent = vi.fn();
    globalThis.__foiReaper = stopPrevious;
    mocks.startReaping.mockReturnValue(stopCurrent);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("FOI_AUTO_MIGRATE", autoMigrate);

    await register();

    expect(mocks.assertBootConfiguration).toHaveBeenCalledOnce();
    expect(mocks.prepareDeploymentMigrationJournal).toHaveBeenCalledWith(db);
    expect(mocks.prepareDeploymentMigrationJournal.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.migrate.mock.invocationCallOrder[0]!);
    expect(mocks.migrate).toHaveBeenNthCalledWith(1, db, {
      migrationsFolder: "drizzle",
      migrationsTable: "__drizzle_migrations",
    });
    expect(mocks.migrate).toHaveBeenNthCalledWith(2, db, {
      migrationsFolder: "drizzle.local",
      migrationsTable: "__drizzle_local_migrations",
    });
    expect(mocks.info).toHaveBeenCalledWith("数据库迁移已应用");
    expect(stopPrevious).toHaveBeenCalledOnce();
    expect(mocks.startReaping).toHaveBeenCalledWith(15_000);
    expect(globalThis.__foiReaper).toBe(stopCurrent);
  });

  it("部署 journal 不存在时只迁移平台表", async () => {
    mocks.existsSync.mockReturnValue(false);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("FOI_AUTO_MIGRATE", "true");

    await register();

    expect(mocks.existsSync).toHaveBeenCalledWith("drizzle.local/meta/_journal.json");
    expect(mocks.prepareDeploymentMigrationJournal).not.toHaveBeenCalled();
    expect(mocks.migrate).toHaveBeenCalledTimes(1);
    expect(mocks.migrate).toHaveBeenCalledWith(db, {
      migrationsFolder: "drizzle",
      migrationsTable: "__drizzle_migrations",
    });
  });
});
