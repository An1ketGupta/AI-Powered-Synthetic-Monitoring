import type { Monitor } from "../types";

const CACHE_KEY = "active_monitors";
const CACHE_TTL_SECONDS = 120;

/**
 * The cron sweep runs every minute and needs the full active-monitor list
 * on every tick. Caching it in KV avoids a D1 round trip per tick; any
 * write to /api/monitors invalidates it immediately so changes take effect
 * on the next tick rather than waiting out the TTL.
 */
export async function getActiveMonitors(env: Env): Promise<Monitor[]> {
  const cached = await env.CONFIG_CACHE.get<Monitor[]>(CACHE_KEY, "json");
  if (cached) return cached;

  const { results } = await env.DB.prepare(
    "SELECT * FROM monitors WHERE is_active = 1 ORDER BY created_at ASC"
  ).all<Monitor>();

  await env.CONFIG_CACHE.put(CACHE_KEY, JSON.stringify(results), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  return results;
}

export async function invalidateActiveMonitorsCache(env: Env): Promise<void> {
  await env.CONFIG_CACHE.delete(CACHE_KEY);
}
