import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getD1() {
  // Keep the workerd-only module out of the eager server-module graph. This
  // lets non-database pages render in Node (including the production HTML
  // smoke test) while database routes still resolve bindings inside workerd.
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return env.DB;
}

export async function getDb() {
  return drizzle(await getD1(), { schema });
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
  const d1 = await getD1();
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
      latitude REAL,
      longitude REAL,
      photo_key TEXT,
      photo_content_type TEXT,
      photo_latitude REAL,
      photo_longitude REAL,
      photo_accuracy REAL,
      photo_captured_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS contribution_building_idx ON accessibility_contributions (building_id, created_at)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS contribution_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contribution_id INTEGER NOT NULL,
      user_id INTEGER,
      reason TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS report_contribution_idx ON contribution_reports (contribution_id)"),
  ]);

  // Columns added after the first release. SQLite has no ADD COLUMN IF NOT
  // EXISTS, so a duplicate-column error here just means we are already current.
  const additions = [
    "ALTER TABLE accessibility_contributions ADD COLUMN building_name TEXT",
    "ALTER TABLE accessibility_contributions ADD COLUMN user_id INTEGER",
    "ALTER TABLE accessibility_contributions ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accessibility_contributions ADD COLUMN latitude REAL",
    "ALTER TABLE accessibility_contributions ADD COLUMN longitude REAL",
    "ALTER TABLE accessibility_contributions ADD COLUMN photo_key TEXT",
    "ALTER TABLE accessibility_contributions ADD COLUMN photo_content_type TEXT",
    "ALTER TABLE accessibility_contributions ADD COLUMN photo_latitude REAL",
    "ALTER TABLE accessibility_contributions ADD COLUMN photo_longitude REAL",
    "ALTER TABLE accessibility_contributions ADD COLUMN photo_accuracy REAL",
    "ALTER TABLE accessibility_contributions ADD COLUMN photo_captured_at TEXT",
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
