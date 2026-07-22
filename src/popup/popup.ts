import {
  type AsyncStorageArea,
  DEFAULT_SITE_BASE,
  DEVICE_TOKEN_KEY,
  type PluginConfig,
  clearDeviceToken,
  loadConfig,
  loadLang,
  saveLang,
  setOptOut,
} from "../config"
import {
  DEFAULT_LANG,
  type Lang,
  type MessageKey,
  normalizeLang,
  resolveInitialLang,
  t,
} from "../i18n"
import { ALL_ORIGINS, SUPPORTED_SITES, knownGrantedOrigins } from "../sites"
import { type PopupView, chooseView } from "./router"

// popup.ts is the extension's action popup. It runs a small staged flow:
//   1. Enable-sites (first run, until at least one AI site is enabled)
//   2. Token / verify (paste the device token from the dashboard, verify it)
//   3. Mini dashboard (earnings + Go to Dashboard + pause control)
// The settings gear reopens site management and account logout. It talks only to
// chrome.storage.local (shared with the background worker); no network here.
//
// The UI language matches the publisher's account language: the verified account
// `lang` is the source of truth (persisted once known); before that we guess from
// the browser's language (its Accept-Language), Spanish -> es, everything else -> en.

const area = chrome.storage.local as unknown as AsyncStorageArea
// The active popup UI language. Starts at the default, resolved during init().
let lang: Lang = DEFAULT_LANG

interface EarningsView {
  balance_available_cents: number
  balance_pending_cents: number
  currency: string
}

interface VerifyResult {
  verified: boolean
  reason?: string
  earnings?: EarningsView | null
  lang?: string | null
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error("missing element " + id)
  return el
}

// applyStaticI18n localizes every element tagged with a data-i18n* attribute in the
// current language and reflects it on the document element's lang attribute. Called
// on load and again whenever the account language becomes known.
function applyStaticI18n(): void {
  document.documentElement.lang = lang
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]"))) {
    el.textContent = t(lang, el.getAttribute("data-i18n") as MessageKey)
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n-title]"))) {
    el.setAttribute("title", t(lang, el.getAttribute("data-i18n-title") as MessageKey))
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n-aria]"))) {
    el.setAttribute("aria-label", t(lang, el.getAttribute("data-i18n-aria") as MessageKey))
  }
}

// adoptLang switches the popup to the publisher's account language (the source of
// truth) and persists it so later opens start in the right language. Re-localizes
// the static UI only when the language actually changes.
async function adoptLang(value: string): Promise<void> {
  const next = normalizeLang(value)
  await saveLang(area, next)
  if (next === lang) return
  lang = next
  applyStaticI18n()
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100)
  } catch {
    return (cents / 100).toFixed(2) + " " + currency
  }
}

// StatusResult mirrors the background GET_STATUS reply the popup needs: the
// earning-cap reset time (present only while capped) drives the countdown.
interface StatusResult {
  connected: boolean
  optOut: boolean
  needsLogin: boolean
  tryAgainAt?: string
}

// sendStatus reads the background worker's current status (including any active
// earning-cap reset time). Resolves to a benign default rather than rejecting.
function sendStatus(): Promise<StatusResult> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, (resp: StatusResult | undefined) => {
        void chrome.runtime.lastError
        resolve({
          connected: resp?.connected === true,
          optOut: resp?.optOut === true,
          needsLogin: resp?.needsLogin === true,
          tryAgainAt: resp?.tryAgainAt,
        })
      })
    } catch {
      resolve({ connected: false, optOut: false, needsLogin: false })
    }
  })
}

// The live countdown interval for the earning-cap banner, or undefined when idle.
let cappedTimer: number | undefined

function stopCountdown(): void {
  if (cappedTimer !== undefined) {
    clearInterval(cappedTimer)
    cappedTimer = undefined
  }
}

// formatHms renders a millisecond duration as HH:MM:SS (zero-padded).
function formatHms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// showCapped renders the earning-cap banner with a live HH:MM:SS countdown to the
// server-provided try_again_at. The countdown uses the client clock for the visual
// only; the server UTC reset time is authoritative. When it elapses the banner hides
// and the status flips back to "earning" (the background worker resumes serving).
function showCapped(tryAgainAt: string | undefined): void {
  const panel = $("capped")
  const timer = $("capped-timer")
  const status = $("dash-status")
  stopCountdown()
  const resetAt = tryAgainAt ? Date.parse(tryAgainAt) : Number.NaN
  if (!tryAgainAt || Number.isNaN(resetAt) || resetAt <= Date.now()) {
    panel.setAttribute("hidden", "")
    return
  }
  const tick = (): void => {
    const remaining = resetAt - Date.now()
    if (remaining <= 0) {
      stopCountdown()
      panel.setAttribute("hidden", "")
      status.textContent = t(lang, "earning")
      status.className = "ok"
      return
    }
    timer.textContent = formatHms(remaining)
  }
  tick()
  panel.removeAttribute("hidden")
  status.textContent = t(lang, "cappedLabel")
  status.className = "muted"
  cappedTimer = setInterval(tick, 1000) as unknown as number
}

// sendVerify asks the background worker to confirm the saved token with the backend
// (which also registers this browser as a device and returns the earnings
// snapshot). Resolves to a benign "unreachable" result rather than rejecting.
function sendVerify(): Promise<VerifyResult> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "VERIFY" }, (resp: VerifyResult | undefined) => {
        void chrome.runtime.lastError
        resolve({
          verified: resp?.verified === true,
          reason: resp?.reason,
          earnings: resp?.earnings ?? null,
          lang: resp?.lang ?? null,
        })
      })
    } catch {
      resolve({ verified: false, reason: "unreachable" })
    }
  })
}

// showEarnings renders the available balance when we have data, otherwise hides it.
function showEarnings(earnings: EarningsView | null | undefined): void {
  const panel = $("earnings")
  if (earnings) {
    ;($("available") as HTMLElement).textContent = formatMoney(
      earnings.balance_available_cents,
      earnings.currency,
    )
    panel.removeAttribute("hidden")
  } else {
    panel.setAttribute("hidden", "")
  }
}

// showView reveals exactly one view section and hides the rest. The settings gear is
// visible on every view except the enable-sites view itself.
function showView(view: PopupView): void {
  if (view !== "dashboard") stopCountdown()
  for (const v of ["sites", "connect", "dashboard"] as PopupView[]) {
    $("view-" + v).toggleAttribute("hidden", v !== view)
  }
  $("settings").toggleAttribute("hidden", view === "sites")
}

// anySiteEnabled reports whether at least one supported AI-site host permission is
// currently granted, driving the first-run routing decision.
async function anySiteEnabled(): Promise<boolean> {
  try {
    const all = await chrome.permissions.getAll()
    return knownGrantedOrigins(all.origins ?? []).length > 0
  } catch {
    return false
  }
}

// buildSitesUI renders one checkbox per supported AI site, reflecting whether its
// optional host permission is currently granted. Toggling requests/removes that
// site's origins (a user gesture, required by chrome.permissions.request). The
// background worker registers/unregisters the content script in response.
async function buildSitesUI(): Promise<void> {
  const container = $("sites")
  container.textContent = ""
  for (const site of SUPPORTED_SITES) {
    const row = document.createElement("label")
    row.className = "site-row"
    const cb = document.createElement("input")
    cb.type = "checkbox"
    const span = document.createElement("span")
    span.textContent = site.label
    row.append(cb, span)
    container.appendChild(row)
    cb.checked = await chrome.permissions.contains({ origins: site.origins })
    cb.addEventListener("change", async () => {
      if (cb.checked) {
        cb.checked = await chrome.permissions.request({ origins: site.origins })
      } else {
        await chrome.permissions.remove({ origins: site.origins })
        cb.checked = false
      }
    })
  }
}

function renderSettings(cfg: PluginConfig): void {
  $("logout").toggleAttribute("hidden", cfg.deviceToken === "")
}

// renderConnect prepares the connect view from stored state: it fills the advanced
// token field and clears any prior status message.
function renderConnect(_cfg: PluginConfig): void {
  const status = $("connect-status")
  status.textContent = t(lang, "connectHint")
  status.className = "muted"
}

// renderDashboard shows earnings + preferences, verifying the token to refresh the
// balances. If the token is no longer valid it drops back to the token view. The
// verify also returns the publisher's account language, which becomes the source of
// truth for the UI language.
async function renderDashboard(cfg: PluginConfig): Promise<void> {
  const status = $("dash-status")
  showEarnings(null)
  showCapped(undefined)
  const res = await sendVerify()
  if (res.lang) await adoptLang(res.lang)
  if (!res.verified && res.reason !== "unreachable") {
    await goToConnect(t(lang, "connectionEnded"))
    return
  }
  if (cfg.optOut) {
    status.textContent = t(lang, "paused")
    status.className = "muted"
  } else {
    status.textContent = t(lang, "earning")
    status.className = "ok"
  }
  showEarnings(res.earnings)
  // Surface an active earning cap (the hourly/daily limit was hit): show a live
  // countdown until ads resume. Paused users are not earning anyway, so skip it.
  if (!cfg.optOut) {
    const st = await sendStatus()
    showCapped(st.tryAgainAt)
  }
}

async function goToDashboard(): Promise<void> {
  const cfg = await loadConfig(area)
  showView("dashboard")
  await renderDashboard(cfg)
}

async function goToConnect(message?: string): Promise<void> {
  const cfg = await loadConfig(area)
  renderConnect(cfg)
  if (message) {
    const status = $("connect-status")
    status.textContent = message
    status.className = "muted"
  }
  showView("connect")
}

async function init(): Promise<void> {
  $("connect").addEventListener("click", () => {
    window.open(DEFAULT_SITE_BASE + "/signup", "_blank", "noopener")
    const status = $("connect-status")
    status.textContent = t(lang, "connectOnSite")
    status.className = "muted"
  })

  $("dashboard").addEventListener("click", () => {
    window.open(DEFAULT_SITE_BASE + "/app", "_blank", "noopener")
  })

  // Settings gear: reopen site management from any later view.
  $("settings").addEventListener("click", async () => {
    const cfg = await loadConfig(area)
    await buildSitesUI()
    renderSettings(cfg)
    ;($("optOut") as HTMLInputElement).checked = cfg.optOut
    $("sites-title").textContent = t(lang, "sitesTitleSettings")
    showView("sites")
  })

  $("enableAll").addEventListener("click", async () => {
    const granted = await chrome.permissions.request({ origins: ALL_ORIGINS })
    if (granted) await buildSitesUI()
  })

  // Go back from the sites/settings view to the connect or dashboard view as
  // appropriate for the current state.
  $("sitesContinue").addEventListener("click", async () => {
    const cfg = await loadConfig(area)
    if (cfg.deviceToken) await goToDashboard()
    else await goToConnect()
  })

  $("optOut").addEventListener("change", async (e) => {
    await setOptOut(area, (e.target as HTMLInputElement).checked)
  })

  $("logout").addEventListener("click", async () => {
    await clearDeviceToken(area)
    showEarnings(null)
    await goToConnect(t(lang, "disconnected"))
  })

  // When the website connect flow stores the token in another tab while this popup
  // is open, advance to the dashboard automatically.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return
    const change = changes[DEVICE_TOKEN_KEY]
    if (change && typeof change.newValue === "string" && change.newValue !== "") {
      void goToDashboard()
    }
  })

  await buildSitesUI()
  const currentCfg = await loadConfig(area)
  // Resolve the UI language: a previously verified account language wins (source of
  // truth); otherwise guess from the browser's language (its Accept-Language).
  const storedLang = await loadLang(area)
  lang = storedLang ? normalizeLang(storedLang) : resolveInitialLang(navigator.language)
  applyStaticI18n()
  renderSettings(currentCfg)
  ;($("optOut") as HTMLInputElement).checked = currentCfg.optOut
  const view = chooseView({
    anySiteEnabled: await anySiteEnabled(),
    connected: currentCfg.deviceToken !== "",
  })
  if (view === "sites") $("sites-title").textContent = t(lang, "sitesTitleEnable")
  showView(view)
  if (view === "connect") renderConnect(currentCfg)
  else if (view === "dashboard") await renderDashboard(currentCfg)
}

void init()
