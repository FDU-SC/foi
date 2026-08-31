/**
 * No deployment-owned tables: kernel tests describe the platform's own schema.
 *
 * A fork declares its tables in `content.local/schema.ts` and keeps the
 * matching migrations in `drizzle.local/`.
 */

export {};
