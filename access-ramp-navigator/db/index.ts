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
