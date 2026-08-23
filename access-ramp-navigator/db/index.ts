import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getD1() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

/**
 * Create the tables on first use.
 *
 * Local development starts from an empty D1 file and the migrations in
 * `drizzle/` are not applied automatically, so the app bootstraps its own
 * schema. Runs once per isolate.
 */
let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  schemaReady ??= bootstrap().catch((error) => {
    schemaReady = null; // let the next request retry rather than caching failure
    throw error;
  });
  return schemaReady;
}

async function bootstrap(): Promise<void> {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS session_user_idx ON sessions (user_id)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS accessibility_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building_id TEXT NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      details TEXT NOT NULL,
      contributor TEXT NOT NULL DEFAULT 'Community member',
      status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS contribution_building_idx ON accessibility_contributions (building_id, created_at)"),
  ]);

  // Columns added after the first release. SQLite has no ADD COLUMN IF NOT
  // EXISTS, so a duplicate-column error here just means we are already current.
  const additions = [
    "ALTER TABLE accessibility_contributions ADD COLUMN building_name TEXT",
    "ALTER TABLE accessibility_contributions ADD COLUMN user_id INTEGER",
    "ALTER TABLE accessibility_contributions ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0",
  ];
  for (const statement of additions) {
    try {
      await d1.prepare(statement).run();
    } catch {
      /* column already present */
    }
  }
  try {
    await d1.prepare("CREATE INDEX IF NOT EXISTS contribution_user_idx ON accessibility_contributions (user_id, created_at)").run();
  } catch {
    /* index needs the column, which the ALTER above provides on a fresh run */
  }
}
