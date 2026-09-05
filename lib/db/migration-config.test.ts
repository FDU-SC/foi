import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { MigrationMeta } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import {
  deploymentMigrationConfig,
  platformMigrationConfig,
} from "./migration-config";

interface JournalRow {
  hash: string;
  created_at: number;
}

interface Transaction {
  execute(query: SQL): Promise<void>;
}

const migration = (
  sql: string,
  folderMillis: number,
  hash: string,
): MigrationMeta => ({
  sql: [sql],
  folderMillis,
  hash,
  bps: true,
});

function migrationTable(query: string): string {
  const match = query.match(/"drizzle"\."([^"]+)"/);
  if (!match) throw new Error(`迁移 SQL 没有指向 drizzle journal: ${query}`);
  return match[1]!;
}

function recordingSession(dialect: PgDialect) {
  const journals = new Map<string, JournalRow[]>();
  const statements: string[] = [];

  const execute = async (query: SQL) => {
    const rendered = dialect.sqlToQuery(query);
    const insert = /^insert into /i.test(rendered.sql);

    if (insert) {
      const rows = journals.get(migrationTable(rendered.sql)) ?? [];
      rows.push({
        hash: String(rendered.params[0]),
        created_at: Number(rendered.params[1]),
      });
      journals.set(migrationTable(rendered.sql), rows);
      return;
    }

    statements.push(rendered.sql);
  };

  const session = {
    execute: async (_query: SQL) => {},
    all: async (query: SQL) => {
      const rows = journals.get(migrationTable(dialect.sqlToQuery(query).sql)) ?? [];
      return [...rows].sort((a, b) => b.created_at - a.created_at).slice(0, 1);
    },
    transaction: async (run: (tx: Transaction) => Promise<void>) => {
      await run({ execute });
    },
  };

  return { journals, session, statements };
}

describe("数据库迁移 journal", () => {
  it("上游水位线较新时仍执行旧的部署迁移，重启后不重放", async () => {
    const dialect = new PgDialect();
    const { journals, session, statements } = recordingSession(dialect);
    const upstreamMillis = 1_787_887_519_492;
    const deploymentMillis = upstreamMillis - 1;

    await dialect.migrate(
      [migration("select 'platform migration'", upstreamMillis, "platform")],
      session as never,
      platformMigrationConfig,
    );
    await dialect.migrate(
      [migration("select 'deployment migration'", deploymentMillis, "deployment")],
      session as never,
      deploymentMigrationConfig,
    );
    await dialect.migrate(
      [migration("select 'deployment migration'", deploymentMillis, "deployment")],
      session as never,
      deploymentMigrationConfig,
    );

    expect(statements).toEqual([
      "select 'platform migration'",
      "select 'deployment migration'",
    ]);
    expect([...journals.keys()].sort()).toEqual([
      "__drizzle_local_migrations",
      "__drizzle_migrations",
    ]);
  });
});
