import type { AsyncStorageArea } from "./config"
import type { Ad, Impression } from "./types"

// Kv is the minimal async key/value store the engine needs. chrome.storage.local is
// adapted onto it via chromeKv below; tests pass an in-memory fake. Values
// round-trip through the host's JSON-serializable storage.
export interface Kv {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

// chromeKv adapts a chrome.storage area (local) onto the async Kv contract the
// engine uses.
export function chromeKv(area: AsyncStorageArea): Kv {
  return {
    async get(key: string): Promise<unknown> {
      const raw = await area.get(key)
      return raw[key]
    },
    async set(key: string, value: unknown): Promise<void> {
      await area.set({ [key]: value })
    },
  }
}

// AdState is the cached current ad plus its display bookkeeping. `servedAt` is the
// epoch-ms the ad started showing; `recorded` prevents double-counting one ad.
// `needsLogin` is set when the device token was rejected (401/403) so the popup can
// show a reconnect notice instead of an ad. `tryAgainAt` is the ISO-8601 UTC time
// an active earning-cap resets: while it is in the future there is no ad, the
// background worker stops calling serve, and the popup shows a countdown.
export interface AdState {
  ad: Ad | null
  servedAt: number
  recorded: boolean
  needsLogin?: boolean
  needsLoginReason?: string
  tryAgainAt?: string
}

const STATE_KEY = "vibeperks:state"
const QUEUE_KEY = "vibeperks:queue"

export const EMPTY_STATE: AdState = { ad: null, servedAt: 0, recorded: false }

function isAdState(v: unknown): v is AdState {
  return typeof v === "object" && v !== null && "recorded" in v && "servedAt" in v
}

// loadState reads the cached state; anything missing or malformed yields the empty
// state (no ad).
export async function loadState(kv: Kv): Promise<AdState> {
  const v = await kv.get(STATE_KEY)
  return isAdState(v) ? v : { ...EMPTY_STATE }
}

export async function saveState(kv: Kv, s: AdState): Promise<void> {
  await kv.set(STATE_KEY, s)
}

export async function clearState(kv: Kv): Promise<void> {
  await kv.set(STATE_KEY, { ...EMPTY_STATE })
}

export async function loadQueue(kv: Kv): Promise<Impression[]> {
  const v = await kv.get(QUEUE_KEY)
  return Array.isArray(v) ? (v as Impression[]) : []
}

export async function saveQueue(kv: Kv, q: Impression[]): Promise<void> {
  await kv.set(QUEUE_KEY, q)
}

// enqueue appends an impression, deduped by impression token so a record repeated
// for the same ad is stored once.
export async function enqueue(kv: Kv, imp: Impression): Promise<void> {
  const q = await loadQueue(kv)
  if (q.some((e) => e.impression_token === imp.impression_token)) return
  await saveQueue(kv, [...q, imp])
}
