// Secrets are deliberately not declared in wrangler.toml (they're set via
// `wrangler secret put`), so `wrangler types` doesn't know about them.
// This augments the ambient, global `Env` interface generated into
// worker-configuration.d.ts.
interface Env {
  API_TOKEN: string;
}
