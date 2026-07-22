// Shared wire types for the VibePerks Chrome extension. These mirror the backend
// API contract exactly (GET /v1/ads/serve, POST /v1/impressions) so the extension
// stays a thin client over the same contract the other adapters use.

// Ad is the served creative returned by GET /v1/ads/serve.
export interface Ad {
  ad_id: string
  sentence: string
  domain: string
  // Full advertiser destination URL (path + query preserved, e.g. UTM tags). Used
  // as the click target while `domain` remains the visible text. Optional so an
  // older backend that omits it still deserializes (falls back to the domain).
  website_url?: string
  // Public brand-icon URL for the advertiser (favicon service). Rendered as the
  // widget's leading icon so the unit carries the advertiser's own identity.
  // Optional: an older backend that omits it falls back to the generic glyph.
  icon_url?: string
  // The two brand colours ("#rrggbb") inferred for the advertiser, ordered
  // [background, accent]. The widget uses the first as its background and the
  // second as its accent; absent/invalid entries fall back to the brand defaults.
  identity_colors?: string[]
  impression_token: string
  rotate_seconds: number
}

// EarningCapped is returned by GET /v1/ads/serve (200) when the publisher has hit
// their hourly/daily earning limit. No ad is served; `try_again_at` is the ISO-8601
// UTC time the cap resets, so the client stops calling serve until then and shows a
// countdown. Nothing is rendered, billed, or credited.
export interface EarningCapped {
  earning_capped: true
  try_again_at: string
}

// ServeResult is what the client's serve() resolves to: an ad to show, an
// earning-capped signal, or null (empty inventory / opted out).
export type ServeResult = Ad | EarningCapped | null

// isEarningCapped narrows a ServeResult to the earning-capped signal.
export function isEarningCapped(r: ServeResult): r is EarningCapped {
  return r !== null && (r as EarningCapped).earning_capped === true
}

// Impression is the payload posted to POST /v1/impressions. Money/credit is
// decided server-side; the client only reports display facts. Optional fields are
// omitted when empty so the backend treats them as absent.
export interface Impression {
  impression_token: string
  displayed_ms: number
  session_id?: string
  session_duration_ms?: number
  plugin_version?: string
  cli?: string
  cli_version?: string
}

// EarningsSummary is the publisher's balance snapshot returned by GET
// /v1/token/verify so the popup can show earnings for the connected device.
export interface EarningsSummary {
  balance_available_cents: number
  balance_pending_cents: number
  currency: string
  month_impressions?: number
  lifetime_impressions?: number
}
