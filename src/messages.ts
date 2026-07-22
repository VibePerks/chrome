import type { Ad, EarningsSummary } from "./types"
import type { HostSelectors } from "./selectors"

// Messages exchanged between the content script and the background service worker.
// The content script owns the page DOM signal (thinking start/end) and rendering;
// the background worker owns ALL network + auth + storage. This split keeps every
// API request in the background worker, where host_permissions make it
// CORS-exempt, and keeps the device token out of the page context.

export type RequestMessage =
  | { type: "SERVE" }
  | { type: "RECORD" }
  | { type: "CLICK"; token: string }
  | { type: "VERIFY" }
  | { type: "GET_SELECTORS"; host: string }
  | { type: "GET_STATUS" }

export interface ServeResponse {
  // The ad to render, or null when there is no eligible inventory / opted out /
  // needs reconnect. The house ad (impression_token === "") is display-only.
  ad: Ad | null
}

// VerifyResponse is the result of registering/checking the device token with the
// backend from the popup's connect action. `verified` is true only when the backend
// accepted the token (200). `reason` distinguishes an invalid token from a transient
// network failure so the popup can message the user accurately. `lang` is the
// publisher's account language (the source of truth for the popup UI language), or
// null when the backend omitted it.
export interface VerifyResponse {
  verified: boolean
  reason?: string
  earnings?: EarningsSummary | null
  lang?: string | null
}

export interface SelectorsResponse {
  // Selectors for the requested host, or null when the host is unsupported.
  selectors: HostSelectors | null
}

export interface StatusResponse {
  connected: boolean
  optOut: boolean
  needsLogin: boolean
  // ISO-8601 UTC time an active earning-cap resets, present only while capped, so
  // the popup can show a countdown until ads resume.
  tryAgainAt?: string
}

// ExternalRequest is the contract for messages the VibePerks website sends to the
// extension over the externally_connectable channel (chrome.runtime.onMessageExternal).
// PING lets the site detect the extension + whether it is already connected; CONNECT
// hands over the user's device token after they sign in on the site, so they never
// paste it by hand.
export type ExternalRequest = { type: "PING" } | { type: "CONNECT"; token: string }

// ExternalResponse is the reply to an ExternalRequest. `ok` is true when the
// message was accepted; `connected` reflects whether a device token is now stored;
// `reason` explains a rejection (untrusted origin / bad request).
export interface ExternalResponse {
  ok: boolean
  connected?: boolean
  reason?: string
}

export type ResponseMessage =
  ServeResponse | SelectorsResponse | StatusResponse | VerifyResponse | { ok: true }
