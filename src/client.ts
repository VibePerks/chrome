import { UnauthorizedError, RejectedError } from "./errors"
import { sanitize } from "./sanitize"
import type { Ad, EarningsSummary, Impression, ServeResult } from "./types"

// A hard per-request timeout so a slow or hung backend can never stall the
// extension's background worker.
const HTTP_TIMEOUT_MS = 5000

// authReason maps a rejection status to a short, user-facing reason. The backend
// returns 403 only for a suspended account and 401 for an invalid/revoked/unknown
// token, so the status alone is an accurate reason (no guessing).
function authReason(status: number): string {
  return status === 403 ? "account suspended" : "device token invalid or revoked"
}

// VerifyResult is what verify() returns on success: the publisher's current
// earnings snapshot (or null when the backend omitted it) and their account
// language (or null when the backend omitted it), used as the source of truth for
// the popup's UI language.
export interface VerifyResult {
  earnings: EarningsSummary | null
  lang: string | null
}

// FetchFn is the fetch contract; injected so tests run with no real network.
export type FetchFn = typeof fetch

// VibePerksClient talks to the backend with the device token attached to every
// request. It performs no retries itself - bounded retry lives in one place
// (the engine's flush) per the repo's no-retry-nest rule. Requests run from the
// extension background service worker, whose host_permissions make them exempt from
// page-origin CORS.
export class VibePerksClient {
  private readonly base: string
  private readonly token: string
  private readonly fetchImpl: FetchFn

  // The default fetch is bound to the global scope. Native fetch must be called
  // with the global (WorkerGlobalScope) as its receiver; invoking it as a method
  // (this.fetchImpl(...)) would detach it and throw "Illegal invocation" in the
  // service worker. Tests inject their own fetchImpl, unaffected by the bind.
  constructor(apiBase: string, token: string, fetchImpl: FetchFn = fetch.bind(globalThis)) {
    this.base = apiBase.replace(/\/+$/, "")
    this.token = token
    this.fetchImpl = fetchImpl
  }

  // serve fetches the next eligible ad. A 204 (empty inventory) returns null. A 200
  // with status "earning_capped" means the publisher hit their hourly/daily earning
  // limit: no ad is returned, only an EarningCapped signal carrying try_again_at so
  // the caller stops polling and shows a countdown.
  async serve(): Promise<ServeResult> {
    const res = await this.fetchImpl(this.base + "/v1/ads/serve", {
      method: "GET",
      headers: { "X-Device-Token": this.token },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (res.status === 204) return null
    if (res.status === 200) {
      const body = (await res.json()) as Record<string, unknown>
      if (body.status === "earning_capped") {
        return { earning_capped: true, try_again_at: String(body.try_again_at ?? "") }
      }
      const ad = body as unknown as Ad
      ad.sentence = sanitize(ad.sentence)
      ad.domain = sanitize(ad.domain)
      ad.website_url = sanitize(ad.website_url ?? "")
      return ad
    }
    if (res.status === 401 || res.status === 403)
      throw new UnauthorizedError(authReason(res.status))
    throw new Error(`serve: unexpected status ${res.status}`)
  }

  // postImpression reports one impression. 200/201 is success; 401/403 is
  // UnauthorizedError; any other 4xx is a permanent RejectedError; 5xx/transport
  // errors propagate so the caller can retry once.
  async postImpression(imp: Impression): Promise<void> {
    const res = await this.fetchImpl(this.base + "/v1/impressions", {
      method: "POST",
      headers: { "X-Device-Token": this.token, "Content-Type": "application/json" },
      body: JSON.stringify(imp),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (res.status === 200 || res.status === 201) return
    if (res.status === 401 || res.status === 403)
      throw new UnauthorizedError(authReason(res.status))
    if (res.status >= 400 && res.status < 500) throw new RejectedError()
    throw new Error(`impression: unexpected status ${res.status}`)
  }

  // postClick reports that the viewer clicked the served ad, so the backend can
  // increment the campaign's click count (click-through rate). The viewer is
  // already being sent straight to the advertiser URL by the widget; this call is
  // purely for measurement and carries only the impression token. Success/rejection
  // semantics mirror postImpression.
  async postClick(impressionToken: string): Promise<void> {
    const res = await this.fetchImpl(this.base + "/v1/clicks", {
      method: "POST",
      headers: { "X-Device-Token": this.token, "Content-Type": "application/json" },
      body: JSON.stringify({ impression_token: impressionToken }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (res.status === 200 || res.status === 201) return
    if (res.status === 401 || res.status === 403)
      throw new UnauthorizedError(authReason(res.status))
    if (res.status >= 400 && res.status < 500) throw new RejectedError()
    throw new Error(`click: unexpected status ${res.status}`)
  }

  // verify confirms the device token with the backend and registers this browser
  // as a device (which fires the backend's one-time device-registered
  // notification, deduped per cli/os/hostname). Returns true on 200; throws
  // UnauthorizedError on 401/403; other statuses/transport errors propagate.
  async verify(meta: {
    cli: string
    cliVersion: string
    pluginVersion: string
    os: string
  }): Promise<VerifyResult> {
    const q = new URLSearchParams({
      cli: meta.cli,
      cli_version: meta.cliVersion,
      plugin_version: meta.pluginVersion,
      os: meta.os,
      hostname: "",
    })
    const res = await this.fetchImpl(this.base + "/v1/token/verify?" + q.toString(), {
      method: "GET",
      headers: { "X-Device-Token": this.token },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (res.status === 200) {
      const body = (await res.json()) as { earnings?: EarningsSummary | null; lang?: string | null }
      return { earnings: body.earnings ?? null, lang: body.lang ?? null }
    }
    if (res.status === 401 || res.status === 403)
      throw new UnauthorizedError(authReason(res.status))
    throw new Error(`verify: unexpected status ${res.status}`)
  }
}
