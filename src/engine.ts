import { VibePerksClient } from "./client"
import type { PluginConfig } from "./config"
import { RejectedError } from "./errors"
import {
  type AdState,
  type Kv,
  EMPTY_STATE,
  clearState,
  enqueue,
  loadQueue,
  loadState,
  saveQueue,
  saveState,
} from "./store"
import type { Impression, ServeResult } from "./types"
import { isEarningCapped } from "./types"

// Meta is the per-session adapter metadata attached to every impression.
export interface Meta {
  cli: string
  cliVersion: string
  pluginVersion: string
  sessionId: string
}

const FLUSH_RETRY_DELAY_MS = 200

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// recordCurrent enqueues an impression for the currently displayed ad exactly once.
// It is a no-op when there is no ad or it was already recorded. UNLIKE the desktop
// adapters, this extension shows and records an ad on EVERY prompt/thinking cycle
// regardless of how long the generation lasted - there is no client-side minimum
// dwell gate here; the real measured displayed_ms is sent so the server applies its
// own crediting rules. The house ad (no impression token) is display-only and never
// reported. All times are epoch-ms integers.
async function recordCurrent(kv: Kv, s: AdState, meta: Meta, now: number): Promise<AdState> {
  if (!s.ad || !s.ad.impression_token || s.recorded) return s
  const displayedMs = Math.max(0, now - s.servedAt)
  const imp: Impression = {
    impression_token: s.ad.impression_token,
    displayed_ms: displayedMs,
    session_id: meta.sessionId || undefined,
    session_duration_ms: displayedMs || undefined,
    plugin_version: meta.pluginVersion || undefined,
    cli: meta.cli || undefined,
    cli_version: meta.cliVersion || undefined,
  }
  await enqueue(kv, imp)
  return { ...s, recorded: true }
}

// postWithRetry attempts a single impression post with at most one bounded retry,
// and only for transient failures. Permanent outcomes (success, RejectedError,
// UnauthorizedError) return/throw immediately without retrying.
async function postWithRetry(client: VibePerksClient, imp: Impression): Promise<void> {
  try {
    await client.postImpression(imp)
  } catch (e) {
    if (e instanceof RejectedError) throw e
    if (e instanceof Error && e.name === "UnauthorizedError") throw e
    await delay(FLUSH_RETRY_DELAY_MS)
    await client.postImpression(imp)
  }
}

// flush posts every buffered impression. Delivered and permanently rejected
// impressions are dropped; transient failures are kept for the next flush. The
// first transient error (if any) propagates after the buffer is rewritten so the
// boundary can log it.
export async function flush(kv: Kv, client: VibePerksClient): Promise<void> {
  const queue = await loadQueue(kv)
  if (queue.length === 0) return
  const remaining: Impression[] = []
  let firstErr: unknown = null
  for (const imp of queue) {
    try {
      await postWithRetry(client, imp)
    } catch (e) {
      if (e instanceof RejectedError) continue
      remaining.push(imp)
      if (firstErr === null) firstErr = e
    }
  }
  await saveQueue(kv, remaining)
  if (firstErr) throw firstErr
}

// serveNext is the thinking-start worker: it serves a FRESH ad for this cycle,
// caches it with servedAt=now, flushes any buffered impressions, and returns the
// AdState so the content script renders the widget from it. Opt-out clears the
// cached ad, does no network I/O, and returns the empty state. A rejected device
// token is terminal for the session: the cached ad is cleared and needsLogin is set
// so the popup shows a reconnect notice.
export async function serveNext(
  kv: Kv,
  client: VibePerksClient,
  cfg: PluginConfig,
  now: number,
): Promise<AdState> {
  if (cfg.optOut) {
    await clearState(kv)
    return { ...EMPTY_STATE }
  }
  let result: ServeResult
  try {
    result = await client.serve()
  } catch (e) {
    if (e instanceof Error && e.name === "UnauthorizedError") {
      const reason = (e as { reason?: string }).reason ?? ""
      const needsLogin: AdState = {
        ad: null,
        servedAt: 0,
        recorded: false,
        needsLogin: true,
        needsLoginReason: reason,
      }
      await saveState(kv, needsLogin)
      await flush(kv, client)
      return needsLogin
    }
    // Surface the serve error (the background boundary swallows it); leave state.
    await flush(kv, client)
    throw e
  }
  if (isEarningCapped(result)) {
    // Publisher hit their hourly/daily earning cap: no ad, and the backend told us
    // when to try again. Cache the reset time so the background worker stops calling
    // serve until then and the popup can show a countdown.
    const capped: AdState = { ...EMPTY_STATE, tryAgainAt: result.try_again_at }
    await saveState(kv, capped)
    await flush(kv, client)
    return capped
  }
  const next: AdState = result ? { ad: result, servedAt: now, recorded: false } : { ...EMPTY_STATE }
  await saveState(kv, next)
  await flush(kv, client)
  return next
}

// recordAndFlush is the thinking-end worker: it records the current ad's impression
// (once, no dwell gate) and flushes the buffer. Opt-out is a no-op.
export async function recordAndFlush(
  kv: Kv,
  client: VibePerksClient,
  cfg: PluginConfig,
  meta: Meta,
  now: number,
): Promise<void> {
  if (cfg.optOut) return
  let s = await loadState(kv)
  s = await recordCurrent(kv, s, meta, now)
  await saveState(kv, s)
  await flush(kv, client)
}
