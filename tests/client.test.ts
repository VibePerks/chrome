import { describe, expect, it, vi } from "vitest"
import { VibePerksClient } from "../src/client"
import { RejectedError, UnauthorizedError } from "../src/errors"
import type { Ad, Impression } from "../src/types"
import { isEarningCapped } from "../src/types"
import { jsonResponse } from "./helpers"

const imp: Impression = { impression_token: "t", displayed_ms: 100 }

describe("VibePerksClient.serve", () => {
  it("returns null on 204", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(204, null))
    const c = new VibePerksClient("https://api.example/", "tok", fetchImpl)
    expect(await c.serve()).toBeNull()
  })

  it("returns a sanitized ad on 200 with the device token header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ad_id: "a",
        sentence: " Ship\u0000 faster ",
        domain: " example.com ",
        website_url: "https://example.com/x",
        impression_token: "it",
        rotate_seconds: 30,
      }),
    )
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    const result = await c.serve()
    expect(isEarningCapped(result)).toBe(false)
    const ad = result as Ad
    expect(ad.sentence).toBe("Ship faster")
    expect(ad.domain).toBe("example.com")
    const [, opts] = fetchImpl.mock.calls[0]
    expect(opts.headers["X-Device-Token"]).toBe("tok")
  })

  it("returns an earning-capped signal on 200 with status earning_capped", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: "earning_capped",
        ad_id: null,
        sentence: "",
        try_again_at: "2026-07-21T15:00:00+00:00",
        message: "You've reached your earning limit for now.",
        rotate_seconds: 30,
      }),
    )
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    const result = await c.serve()
    expect(isEarningCapped(result)).toBe(true)
    if (isEarningCapped(result)) {
      expect(result.try_again_at).toBe("2026-07-21T15:00:00+00:00")
    }
  })

  it("throws UnauthorizedError on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, null))
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    await expect(c.serve()).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

describe("VibePerksClient.postImpression", () => {
  it("resolves on 201", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, null))
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    await expect(c.postImpression(imp)).resolves.toBeUndefined()
  })

  it("throws RejectedError on a non-auth 4xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, null))
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    await expect(c.postImpression(imp)).rejects.toBeInstanceOf(RejectedError)
  })

  it("propagates a 5xx as a plain error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, null))
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    await expect(c.postImpression(imp)).rejects.toThrow(/unexpected status 500/)
  })
})

describe("VibePerksClient.postClick", () => {
  it("posts the impression token to /v1/clicks and resolves on 201", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { status: "ok" }))
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    await expect(c.postClick("it")).resolves.toBeUndefined()
    const [url, opts] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://api.example/v1/clicks")
    expect(opts.headers["X-Device-Token"]).toBe("tok")
    expect(JSON.parse(opts.body)).toEqual({ impression_token: "it" })
  })

  it("throws RejectedError on a non-auth 4xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, null))
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    await expect(c.postClick("it")).rejects.toBeInstanceOf(RejectedError)
  })
})

describe("VibePerksClient.verify", () => {
  const m = { cli: "chrome-extension", cliVersion: "", pluginVersion: "1", os: "windows" }

  it("returns the earnings snapshot on 200 and sends the token + query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status: "ok",
        lang: "es",
        earnings: { balance_available_cents: 500, balance_pending_cents: 20, currency: "MXN" },
      }),
    )
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    const res = await c.verify(m)
    expect(res.earnings?.balance_available_cents).toBe(500)
    expect(res.lang).toBe("es")
    const [url, opts] = fetchImpl.mock.calls[0]
    expect(url).toContain("/v1/token/verify?")
    expect(url).toContain("cli=chrome-extension")
    expect(url).toContain("os=windows")
    expect(opts.headers["X-Device-Token"]).toBe("tok")
  })

  it("returns null earnings and null lang when the backend omits them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok" }))
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    const res = await c.verify(m)
    expect(res.earnings).toBeNull()
    expect(res.lang).toBeNull()
  })

  it("throws UnauthorizedError on 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, null))
    const c = new VibePerksClient("https://api.example", "tok", fetchImpl)
    await expect(c.verify(m)).rejects.toBeInstanceOf(UnauthorizedError)
  })
})
