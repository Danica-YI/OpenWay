/**
 * Cloudflare bindings available to the worker.
 *
 * `@cloudflare/workers-types` ships an empty `Cloudflare.Env` for projects to
 * augment; TypeScript merges this declaration with it. Binding names must match
 * `.openai/hosting.json`, which vite.config.ts reads to build the local
 * Miniflare setup.
 */
declare namespace Cloudflare {
  interface Env {
    /** D1 database. Local dev uses a SQLite file under .wrangler/. */
    DB: D1Database;
    /** Static assets, served by the worker. */
    ASSETS: Fetcher;
  }
}
