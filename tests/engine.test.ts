import { describe, expect, it, vi } from "vitest"
import type { VibePerksClient } from "../src/client"
import type { PluginConfig } from "../src/config"
import { UnauthorizedError } from "../src/errors"
import { type Meta, recordAndFlush, serveNext } from "../src/engine"
import { chromeKv, loadQueue, loadState } from "../src/store"
import type { Ad } from "../src/types"
import { fakeArea } from "./helpers"

const cfg: PluginConfig = {
  apiBase: "https://api.example",
  deviceToken: "tok",
  optOut: false,
}
const meta: Meta = { cli: "chrome-extension", cliVersion: "", pluginVersion: "1", sessionId: "s" }

function ad(overrides: Partial<Ad> = {}): Ad {
  return {
    ad_id: "a1",
    sentence: "Ship faster",
    domain: "example.com",
    website_url: "",
    impression_token: "it",
    rotate_seconds: 20,
    ...overrides,
  }
}

function fakeClient(over: Partial<VibePerksClient> = {}): VibePerksClient {
  return {
    serve: vi.fn().mockResolvedValue(null),
    postImpression: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as VibePerksClient
}

describe("serveNext", () => {
  it("opt-out clears state and never serves", async () => {
    const kv = chromeKv(fakeArea())
    const client = fakeClient({ serve: vi.fn() })
    const s = await serveNext(kv, client, { ...cfg, optOut: true }, 1000)
    expect(s.ad).toBeNull()
    expect(client.serve).not.toHaveBeenCalled()
  })

  it("serves a fresh ad and stamps servedAt", async () => {
    const kv = chromeKv(fakeArea())
    const client = fakeClient({ serve: vi.fn().mockResolvedValue(ad()) })
    const s = await serveNext(kv, client, cfg, 5000)
    expect(s.ad?.ad_id).toBe("a1")
    expect(s.servedAt).toBe(5000)
    expect((await loadState(kv)).servedAt).toBe(5000)
  })

  it("sets needsLogin on a rejected token", async () => {
    const kv = chromeKv(fakeArea())
    const client = fakeClient({
      serve: vi.fn().mockRejectedValue(new UnauthorizedError("device token invalid or revoked")),
    })
    const s = await serveNext(kv, client, cfg, 1000)
    expect(s.needsLogin).toBe(true)
    expect(s.ad).toBeNull()
  })

  it("caches try_again_at and serves no ad when earning-capped", async () => {
    const kv = chromeKv(fakeArea())
    const client = fakeClient({
      serve: vi.fn().mockResolvedValue({
        earning_capped: true,
        try_again_at: "2026-07-21T15:00:00+00:00",
      }),
    })
    const s = await serveNext(kv, client, cfg, 1000)
    expect(s.ad).toBeNull()
    expect(s.tryAgainAt).toBe("2026-07-21T15:00:00+00:00")
    // Persisted so the background worker can back off and the popup can count down.
    expect((await loadState(kv)).tryAgainAt).toBe("2026-07-21T15:00:00+00:00")
  })
})

describe("recordAndFlush", () => {
  it("records an impression regardless of how short the display was", async () => {
    const kv = chromeKv(fakeArea())
    const post = vi.fn().mockResolvedValue(undefined)
    const client = fakeClient({ serve: vi.fn().mockResolvedValue(ad()), postImpression: post })
    // A 10ms generation cycle - far below any dwell threshold - must still record.
    await serveNext(kv, client, cfg, 1000)
    await recordAndFlush(kv, client, cfg, meta, 1010)
    expect(post).toHaveBeenCalledTimes(1)
    const sent = post.mock.calls[0][0]
    expect(sent.impression_token).toBe("it")
    expect(sent.displayed_ms).toBe(10)
    expect(sent.cli).toBe("chrome-extension")
    expect(await loadQueue(kv)).toHaveLength(0)
  })

  it("never records the house ad (no impression token)", async () => {
    const kv = chromeKv(fakeArea())
    const post = vi.fn().mockResolvedValue(undefined)
    const client = fakeClient({
      serve: vi.fn().mockResolvedValue(ad({ impression_token: "" })),
      postImpression: post,
    })
    await serveNext(kv, client, cfg, 1000)
    await recordAndFlush(kv, client, cfg, meta, 3000)
    expect(post).not.toHaveBeenCalled()
  })

  it("opt-out is a no-op", async () => {
    const kv = chromeKv(fakeArea())
    const post = vi.fn()
    const client = fakeClient({ postImpression: post })
    await recordAndFlush(kv, client, { ...cfg, optOut: true }, meta, 1000)
    expect(post).not.toHaveBeenCalled()
  })

  it("keeps a transient-failed impression buffered after one retry", async () => {
    const kv = chromeKv(fakeArea())
    const post = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
    const client = fakeClient({ serve: vi.fn().mockResolvedValue(ad()), postImpression: post })
    await serveNext(kv, client, cfg, 1000)
    await expect(recordAndFlush(kv, client, cfg, meta, 1200)).rejects.toThrow()
    expect(post).toHaveBeenCalledTimes(2) // one attempt + one retry
    expect(await loadQueue(kv)).toHaveLength(1)
  })
})
