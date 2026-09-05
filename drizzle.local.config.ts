import { defineConfig } from "drizzle-kit";
import { deploymentMigrationConfig } from "./lib/db/migration-config";

/**
 * Migrations for the tables a deployment adds for itself.
 *
 * Separate from `drizzle.config.ts` on purpose. Two folders means two journals,
 * so a fork's version numbers never collide with the upstream's and neither
 * side has to renumber after a merge. `instrumentation.ts` applies `drizzle/`
 * first and this one after, whenever it exists.
 *
 * Declare the tables in `content.local/schema.ts`; they reach the drizzle
 * instance through `lib/db/index.ts`. Importing an upstream table there to hang
 * a foreign key off is fine — `tablesFilter` is what keeps drizzle-kit from
 * trying to create it a second time, so every table declared here needs the
 * prefix below.
 *
 *   pnpm exec drizzle-kit generate --config drizzle.local.config.ts
 *
 * Unused upstream: there is no `content.local/` in this repository.
 */
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  schema: "./content.local/schema.ts",
  out: deploymentMigrationConfig.migrationsFolder,
  dialect: "postgresql",
  tablesFilter: ["x_*"],
  migrations: { table: deploymentMigrationConfig.migrationsTable },
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: "snake_case",
});
