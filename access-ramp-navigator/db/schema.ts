import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  /** What the person typed. Only a shortened form is ever shown publicly. */
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
]);

export const sessions = sqliteTable("sessions", {
  /** Opaque random token, also the cookie value. */
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("session_user_idx").on(table.userId),
]);

export const accessibilityContributions = sqliteTable("accessibility_contributions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  buildingId: text("building_id").notNull(),
  /** Denormalised so a person's own contribution list is readable without OSM. */
  buildingName: text("building_name"),
  category: text("category").notNull(),
  location: text("location").notNull(),
  details: text("details").notNull(),
  /** Null for reports made before accounts existed, or while signed out. */
  userId: integer("user_id").references(() => users.id),
  /** The author asked not to be credited publicly. */
  anonymous: integer("anonymous", { mode: "boolean" }).notNull().default(false),
  /** Legacy display name for rows with no account behind them. */
  contributor: text("contributor").notNull().default("Community member"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  status: text("status").notNull().default("pending_review"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("contribution_building_idx").on(table.buildingId, table.createdAt),
  index("contribution_user_idx").on(table.userId, table.createdAt),
]);
