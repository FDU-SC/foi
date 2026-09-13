import type { MigrationConfig } from "drizzle-orm/migrator";

export const platformMigrationConfig = {
  migrationsFolder: "drizzle",
  migrationsTable: "__drizzle_migrations",
} as const satisfies MigrationConfig;

export const deploymentMigrationConfig = {
  migrationsFolder: "drizzle.local",
  migrationsTable: "__drizzle_local_migrations",
} as const satisfies MigrationConfig;
