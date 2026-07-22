import { VibePerksClient } from "./client"
import { isTrustedSiteOrigin, loadConfig, saveDeviceToken } from "./config"
import type { AsyncStorageArea } from "./config"
import { type Meta, recordAndFlush, serveNext } from "./engine"
import type { ExternalRequest, ExternalResponse, RequestMessage, ResponseMessage } from "./messages"
import { loadSelectors, BUNDLED_SELECTORS } from "./selectors"
import { knownGrantedOrigins } from "./sites"
import { chromeKv, loadState } from "./store"

// background.ts is the SINGLE network + auth + storage boundary and the only place
// that fails silently. The content script never sees the device token and never
// touches the network; it only asks this worker to SERVE / RECORD / GET_SELECTORS /
// GET_STATUS. Every API request runs here, where the extension's
// host_permissions make it exempt from page-origin CORS.

const CLI = "chrome-extension"

const area = chrome.storage.local as unknown as AsyncStorageArea

// A single session id for the life of the service worker instance.
const sessionId = cryptoRandomId()

function cryptoRandomId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return Math.random().toString(36).slice(2)
  }
}

function meta(): Meta {
  let pluginVersion = ""
  try {
    pluginVersion = chrome.runtime.getManifest().version ?? ""
  } catch {
    pluginVersion = ""
  }
  return { cli: CLI, cliVersion: "", pluginVersion, sessionId }
}

// osName derives a coarse OS label from the worker's user agent for device
// registration (the backend dedups the device notification by cli/os/hostname).
function osName(): string {
  try {
    const ua = navigator.userAgent
    if (/Windows/i.test(ua)) return "windows"
    if (/Mac OS X|Macintosh/i.test(ua)) return "macos"
    if (/CrOS/i.test(ua)) return "chromeos"
    if (/Linux|Android/i.test(ua)) return "linux"
  } catch {
    /* navigator may be unavailable */
  }
  return "browser"
}

async function handle(msg: RequestMessage): Promise<ResponseMessage> {
  const kv = chromeKv(area)
  const cfg = await loadConfig(area)

  switch (msg.type) {
    case "SERVE": {
      if (cfg.optOut || !cfg.deviceToken) return { ad: null }
      // Respect an active earning-cap backoff: while capped, do NOT call serve at
      // all (the backend would only return earning_capped again). Resume once the
      // cap's reset time has passed.
      const cached = await loadState(kv)
      if (cached.tryAgainAt && Date.now() < Date.parse(cached.tryAgainAt)) {
        return { ad: null }
      }
      const client = new VibePerksClient(cfg.apiBase, cfg.deviceToken)
      const state = await serveNext(kv, client, cfg, Date.now())
      return { ad: state.ad }
    }
    case "RECORD": {
      if (cfg.optOut || !cfg.deviceToken) return { ok: true }
      const client = new VibePerksClient(cfg.apiBase, cfg.deviceToken)
      await recordAndFlush(kv, client, cfg, meta(), Date.now())
      return { ok: true }
    }
    case "CLICK": {
      // Fire-and-forget click attribution. Never retried and never surfaced: the
      // viewer has already been sent to the advertiser URL by the widget, so a
      // failed report only costs one CTR data point.
      if (cfg.optOut || !cfg.deviceToken || !msg.token) return { ok: true }
      const client = new VibePerksClient(cfg.apiBase, cfg.deviceToken)
      try {
        await client.postClick(msg.token)
      } catch (e) {
        console.warn("[VibePerks] click report failed:", e)
      }
      return { ok: true }
    }
    case "VERIFY": {
      if (!cfg.deviceToken) return { verified: false, reason: "no token" }
      const client = new VibePerksClient(cfg.apiBase, cfg.deviceToken)
      const m = meta()
      try {
        const result = await client.verify({
          cli: m.cli,
          cliVersion: m.cliVersion,
          pluginVersion: m.pluginVersion,
          os: osName(),
        })
        return { verified: true, earnings: result.earnings, lang: result.lang }
      } catch (e) {
        if (e instanceof Error && e.name === "UnauthorizedError") {
          return { verified: false, reason: (e as { reason?: string }).reason ?? "unauthorized" }
        }
        // Transient/network failure: the token may be fine, we just could not reach
        // the server. Report it distinctly so the popup does not cry "invalid". Log
        // the underlying error so it is visible in the service worker console.
        console.warn("[VibePerks] verify failed:", e)
        return { verified: false, reason: "unreachable" }
      }
    }
    case "GET_SELECTORS": {
      // fetch must be bound to the global scope (see VibePerksClient): loadSelectors
      // calls it as a bare function, which would otherwise throw in the worker.
      const config = await loadSelectors(area, fetch.bind(globalThis))
      const selectors = config[msg.host] ?? BUNDLED_SELECTORS[msg.host] ?? null
      return { selectors }
    }
    case "GET_STATUS": {
      const state = await loadState(kv)
      const capped = state.tryAgainAt && Date.now() < Date.parse(state.tryAgainAt)
      return {
        connected: cfg.deviceToken !== "",
        optOut: cfg.optOut,
        needsLogin: state.needsLogin === true,
        tryAgainAt: capped ? state.tryAgainAt : undefined,
      }
    }
  }
}

chrome.runtime.onMessage.addListener(
  (msg: RequestMessage, _sender, sendResponse: (r: ResponseMessage) => void) => {
    handle(msg)
      .then(sendResponse)
      .catch(() => {
        // Fail silent: never surface an error into the page. Reply with a benign
        // shape so the content script's awaited call resolves.
        if (msg.type === "SERVE") sendResponse({ ad: null })
        else sendResponse({ ok: true })
      })
    // Return true to keep the message channel open for the async response.
    return true
  },
)

// --- Account connect handoff (externally_connectable) ---
// The VibePerks website hands the extension the user's device token after they
// sign in there, so no one pastes a token by hand. Only the site origin declared
// in externally_connectable can reach this, and we re-check the sender's origin
// here as defense in depth before trusting a token.
async function handleExternal(
  msg: ExternalRequest,
  sender: chrome.runtime.MessageSender,
): Promise<ExternalResponse> {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "")
  if (!isTrustedSiteOrigin(origin)) return { ok: false, reason: "untrusted-origin" }
  const cfg = await loadConfig(area)
  if (msg.type === "PING") return { ok: true, connected: cfg.deviceToken !== "" }
  if (msg.type === "CONNECT" && typeof msg.token === "string" && msg.token.trim() !== "") {
    await saveDeviceToken(area, msg.token)
    // Best-effort verify so the browser registers as a device (fires the backend's
    // one-time device-registered notification). A failure here never blocks the
    // connect: the token is already stored and serving will start.
    try {
      const client = new VibePerksClient(cfg.apiBase, msg.token.trim())
      const m = meta()
      await client.verify({
        cli: m.cli,
        cliVersion: m.cliVersion,
        pluginVersion: m.pluginVersion,
        os: osName(),
      })
    } catch (e) {
      console.warn("[VibePerks] connect verify failed:", e)
    }
    return { ok: true, connected: true }
  }
  return { ok: false, reason: "bad-request" }
}

chrome.runtime.onMessageExternal.addListener(
  (msg: ExternalRequest, sender, sendResponse: (r: ExternalResponse) => void) => {
    handleExternal(msg, sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, reason: "error" }))
    return true
  },
)

// --- Dynamic content-script registration (Option B: optional host permissions) ---
// The content script is NOT declared statically in the manifest. Instead we register
// it at runtime for exactly the AI-site origins the user has granted, and keep it in
// sync as permissions are added/removed. This keeps the install prompt minimal and
// lets the user opt in per site from the popup.

const CONTENT_SCRIPT_ID = "vibeperks-content"

async function syncContentScripts(): Promise<void> {
  try {
    const all = await chrome.permissions.getAll()
    const origins = knownGrantedOrigins(all.origins ?? [])
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [CONTENT_SCRIPT_ID],
    })
    if (origins.length === 0) {
      if (existing.length) {
        await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] })
      }
      return
    }
    const script: chrome.scripting.RegisteredContentScript = {
      id: CONTENT_SCRIPT_ID,
      js: ["content.js"],
      matches: origins,
      runAt: "document_idle",
      persistAcrossSessions: true,
    }
    if (existing.length) await chrome.scripting.updateContentScripts([script])
    else await chrome.scripting.registerContentScripts([script])
  } catch (e) {
    console.warn("[VibePerks] content-script sync failed:", e)
  }
}

chrome.runtime.onInstalled.addListener(() => void syncContentScripts())
chrome.runtime.onStartup.addListener(() => void syncContentScripts())
chrome.permissions.onAdded.addListener(() => void syncContentScripts())
chrome.permissions.onRemoved.addListener(() => void syncContentScripts())
