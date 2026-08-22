import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accessibilityContributions = sqliteTable("accessibility_contributions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  buildingId: text("building_id").notNull(),
  category: text("category").notNull(),
  location: text("location").notNull(),
  details: text("details").notNull(),
  contributor: text("contributor").notNull().default("Community member"),
  status: text("status").notNull().default("pending_review"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index("contribution_building_idx").on(table.buildingId, table.createdAt),
]);
