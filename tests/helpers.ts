import type { AsyncStorageArea } from "../src/config"

// fakeArea is an in-memory AsyncStorageArea for tests, mirroring the subset of
// chrome.storage.local the extension uses.
export function fakeArea(initial: Record<string, unknown> = {}): AsyncStorageArea & {
  data: Record<string, unknown>
} {
  const data: Record<string, unknown> = { ...initial }
  return {
    data,
    async get(keys: string[] | string): Promise<Record<string, unknown>> {
      const list = Array.isArray(keys) ? keys : [keys]
      const out: Record<string, unknown> = {}
      for (const k of list) if (k in data) out[k] = data[k]
      return out
    },
    async set(items: Record<string, unknown>): Promise<void> {
      Object.assign(data, items)
    },
    async remove(keys: string[] | string): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys]
      for (const k of list) delete data[k]
    },
  }
}

// jsonResponse builds a minimal fetch Response stand-in.
export function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body
    },
  } as unknown as Response
}
