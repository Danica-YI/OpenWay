// Deploys the production build to Cloudflare Workers.
//
// `npm run build` writes dist/server/wrangler.json with the placeholder D1 id
// and bucket name that local development uses. This swaps in the real
// resources named in deploy.json, then runs `wrangler deploy` on that file.
// Set "r2" to { "bucket_name": "..." } once R2 is enabled on the account;
// while it is null, photo uploads are unavailable and everything else works.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const generated = resolve(root, "dist/server/wrangler.json");
if (!existsSync(generated)) {
  console.error("dist/server/wrangler.json not found: run `npm run build` first.");
  process.exit(1);
}

const deploy = JSON.parse(readFileSync(resolve(root, "deploy.json"), "utf8"));
const bindings = JSON.parse(readFileSync(resolve(root, ".openai/hosting.json"), "utf8"));
const config = JSON.parse(readFileSync(generated, "utf8"));

config.name = deploy.worker;
config.topLevelName = deploy.worker;
config.d1_databases = bindings.d1 && deploy.d1 ? [{ binding: bindings.d1, ...deploy.d1 }] : [];
config.r2_buckets = bindings.r2 && deploy.r2 ? [{ binding: bindings.r2, ...deploy.r2 }] : [];
writeFileSync(generated, JSON.stringify(config, null, 2));

console.log(
  `Deploying ${deploy.worker}: D1 ${deploy.d1?.database_name ?? "none"}, ` +
    `R2 ${deploy.r2?.bucket_name ?? "none (photo uploads disabled)"}`,
);
const result = spawnSync("npx", ["wrangler", "deploy", "-c", generated, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
