import { DEFAULT_SITE_BASE, type AsyncStorageArea } from "./config"

// HostSelectors describes how to read a target site's DOM. Kept small and remote-
// updatable so a ChatGPT UI change can be fixed by editing a hosted JSON file, with
// no Chrome Web Store release. `thinkingSelectors` are matched against the whole
// document: while ANY of them matches an element, the AI is considered to be
// generating (e.g. the stop-streaming button is present). `composerSelectors` locate
// the prompt input area so the widget can be anchored near it.
export interface HostSelectors {
  thinkingSelectors: string[]
  composerSelectors: string[]
}

// SelectorConfig is the whole remote document: one entry per supported host id.
export type SelectorConfig = Record<string, HostSelectors>

// hostIdFor maps a page hostname to a supported host id, or null when the site is
// not one we inject on. Matches the exact host or any subdomain of it.
const HOST_MAP: [string, string][] = [
  ["chatgpt.com", "chatgpt"],
  ["chat.openai.com", "chatgpt"],
  ["claude.ai", "claude"],
  ["perplexity.ai", "perplexity"],
  ["gemini.google.com", "gemini"],
  ["chat.mistral.ai", "mistral"],
  ["copilot.microsoft.com", "copilot"],
  ["chat.deepseek.com", "deepseek"],
  ["grok.com", "grok"],
  ["lovable.dev", "lovable"],
  ["v0.dev", "v0"],
  ["v0.app", "v0"],
  ["bolt.new", "bolt"],
]

export function hostIdFor(hostname: string): string | null {
  const h = hostname.toLowerCase()
  for (const [suffix, id] of HOST_MAP) {
    if (h === suffix || h.endsWith("." + suffix)) return id
  }
  return null
}

// A cross-site heuristic for "the model is generating": while a stop/cancel control
// is present, a response is streaming. Case-insensitive attribute matches catch the
// many label variants ("Stop", "Stop generating", "Stop response", "Detener"). These
// are appended to every host so a site still works before we tune host-specific
// selectors, and remain remote-updatable.
const GENERIC_THINKING = [
  'button[data-testid="stop-button"]',
  'button[data-testid*="stop" i]',
  'button[aria-label*="stop" i]',
  'button[title*="stop" i]',
]

const GENERIC_COMPOSER = [
  'form div[contenteditable="true"]',
  'div[contenteditable="true"]',
  "form textarea",
  "main form",
  "textarea",
]

function host(thinking: string[], composer: string[] = []): HostSelectors {
  return {
    thinkingSelectors: [...thinking, ...GENERIC_THINKING],
    composerSelectors: [...composer, ...GENERIC_COMPOSER],
  }
}

// BUNDLED_SELECTORS is the fallback shipped inside the extension. It is used when
// the remote fetch fails or has never succeeded, so the widget always works offline
// and on day one. Host-specific hooks come first; the generic stop/composer
// heuristics are appended by host().
export const BUNDLED_SELECTORS: SelectorConfig = {
  chatgpt: host(
    ['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]'],
    ["#prompt-textarea"],
  ),
  claude: host(['button[aria-label="Stop response"]']),
  perplexity: host(['button[aria-label*="Stop" i]']),
  gemini: host(['button[aria-label*="Stop" i]', "button.stop"]),
  mistral: host(['button[aria-label*="Stop" i]']),
  copilot: host(['button[aria-label*="Stop" i]']),
  deepseek: host(['button[aria-label*="Stop" i]']),
  grok: host(['button[aria-label*="Stop" i]']),
  lovable: host(['button[aria-label*="Stop" i]']),
  v0: host(['button[aria-label*="Stop" i]']),
  bolt: host(['button[aria-label*="Stop" i]']),
}

const CACHE_KEY = "vibeperks:selectors:" + DEFAULT_SITE_BASE
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h

interface CacheEntry {
  fetchedAt: number
  config: SelectorConfig
}

function isHostSelectors(v: unknown): v is HostSelectors {
  if (typeof v !== "object" || v === null) return false
  const t = (v as { thinkingSelectors?: unknown }).thinkingSelectors
  const c = (v as { composerSelectors?: unknown }).composerSelectors
  return (
    Array.isArray(t) &&
    Array.isArray(c) &&
    t.every((x) => typeof x === "string") &&
    c.every((x) => typeof x === "string")
  )
}

function isSelectorConfig(v: unknown): v is SelectorConfig {
  if (typeof v !== "object" || v === null) return false
  const entries = Object.values(v as Record<string, unknown>)
  return entries.length > 0 && entries.every(isHostSelectors)
}

// loadSelectors returns the effective selector config for the current host. It
// serves a fresh cache when present, otherwise fetches the remote document (via the
// injected fetch), validates + caches it, and falls back to the bundled defaults on
// any error. It never throws.
export async function loadSelectors(
  area: AsyncStorageArea,
  fetchImpl: typeof fetch,
  now: number = Date.now(),
): Promise<SelectorConfig> {
  try {
    const cached = (await area.get(CACHE_KEY))[CACHE_KEY] as CacheEntry | undefined
    if (cached && isSelectorConfig(cached.config) && now - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.config
    }
    const res = await fetchImpl(DEFAULT_SITE_BASE + "/extension/selectors.json", {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok)
      return cached?.config && isSelectorConfig(cached.config) ? cached.config : BUNDLED_SELECTORS
    const body = (await res.json()) as unknown
    if (!isSelectorConfig(body)) return BUNDLED_SELECTORS
    const entry: CacheEntry = { fetchedAt: now, config: body }
    await area.set({ [CACHE_KEY]: entry })
    return body
  } catch {
    return BUNDLED_SELECTORS
  }
}
