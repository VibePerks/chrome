// Switch these two constants together to select the extension environment.
export const DEFAULT_API_BASE = "https://api.vibeperks.ai"
export const DEFAULT_SITE_BASE = "https://vibeperks.ai"

// Config keys as stored in chrome.storage.local. Named to mirror the shared
// ~/.vibeperks/config.json the desktop adapters use, so the mental model matches.
export const DEVICE_TOKEN_KEY = "device_token"
export const OPT_OUT_KEY = "opt_out"
// Persisted UI language for the popup. Populated from the publisher's account
// language once the token is verified (the source of truth); absent until then.
export const LANG_KEY = "lang"

// PluginConfig is the resolved configuration the extension runs on.
export interface PluginConfig {
  apiBase: string
  deviceToken: string
  optOut: boolean
}

// AsyncStorageArea is the minimal subset of chrome.storage.local we depend on. It
// is passed in explicitly so the config layer stays testable without the extension
// host (tests pass an in-memory fake). MV3 chrome.storage.local returns promises.
export interface AsyncStorageArea {
  get(keys: string[] | string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove?(keys: string[] | string): Promise<void>
}

// loadConfig resolves the effective config from chrome.storage.local, applying the
// built-in default base when unset.
export async function loadConfig(area: AsyncStorageArea): Promise<PluginConfig> {
  const raw = await area.get([DEVICE_TOKEN_KEY, OPT_OUT_KEY])
  const deviceToken =
    typeof raw[DEVICE_TOKEN_KEY] === "string" ? (raw[DEVICE_TOKEN_KEY] as string) : ""
  return {
    apiBase: DEFAULT_API_BASE,
    deviceToken,
    optOut: raw[OPT_OUT_KEY] === true,
  }
}

// saveDeviceToken records a device token (connect account).
export async function saveDeviceToken(area: AsyncStorageArea, token: string): Promise<void> {
  await area.set({ [DEVICE_TOKEN_KEY]: token.trim() })
}

// clearDeviceToken removes the device token (disconnect).
export async function clearDeviceToken(area: AsyncStorageArea): Promise<void> {
  await area.set({ [DEVICE_TOKEN_KEY]: "" })
}

// isTrustedSiteOrigin reports whether an external message sender's origin is the
// VibePerks website (the only page allowed to hand the extension a device token
// over the externally_connectable channel). Compared by exact origin, so a
// look-alike host or a different scheme is rejected.
export function isTrustedSiteOrigin(origin: string): boolean {
  try {
    return new URL(origin).origin === new URL(DEFAULT_SITE_BASE).origin
  } catch {
    return false
  }
}

// setOptOut toggles the opt_out flag (pause / resume).
export async function setOptOut(area: AsyncStorageArea, value: boolean): Promise<void> {
  await area.set({ [OPT_OUT_KEY]: value })
}

// loadLang returns the persisted popup UI language, or null when none has been
// stored yet (i.e. the account language is not yet known).
export async function loadLang(area: AsyncStorageArea): Promise<string | null> {
  const raw = await area.get([LANG_KEY])
  return typeof raw[LANG_KEY] === "string" ? (raw[LANG_KEY] as string) : null
}

// saveLang persists the popup UI language (the verified account language).
export async function saveLang(area: AsyncStorageArea, lang: string): Promise<void> {
  await area.set({ [LANG_KEY]: lang })
}
