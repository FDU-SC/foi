import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const stopReaping = vi.fn();

  return {
    assertBootConfiguration: vi.fn(),
    database: {},
    existsSync: vi.fn(),
    migrate: vi.fn(),
    startReaping: vi.fn(() => stopReaping),
  };
});

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: mocked.existsSync,
}));

vi.mock("@/lib/boot/checks", () => ({
  assertBootConfiguration: mocked.assertBootConfiguration,
}));

vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: mocked.migrate,
}));

vi.mock("@/lib/db", () => ({
  db: mocked.database,
}));

vi.mock("@/lib/runner/reaper", () => ({
  startReaping: mocked.startReaping,
}));

import { register } from "./instrumentation";

describe("instrumentation.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("FOI_AUTO_MIGRATE", "true");
    mocked.existsSync.mockReturnValue(false);
    globalThis.__foiReaper = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.__foiReaper = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("部署 journal 存在时先迁移平台，再迁移部署表", async () => {
    mocked.existsSync.mockReturnValue(true);

    await register();

    expect(mocked.migrate).toHaveBeenNthCalledWith(1, mocked.database, {
      migrationsFolder: "drizzle",
    });
    expect(mocked.migrate).toHaveBeenNthCalledWith(2, mocked.database, {
      migrationsFolder: "drizzle.local",
    });
  });

  it("部署 journal 不存在时只迁移平台表", async () => {
    await register();

    expect(mocked.existsSync).toHaveBeenCalledWith("drizzle.local/meta/_journal.json");
    expect(mocked.migrate).toHaveBeenCalledTimes(1);
    expect(mocked.migrate).toHaveBeenCalledWith(mocked.database, {
      migrationsFolder: "drizzle",
    });
  });
});
