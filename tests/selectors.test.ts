import { describe, expect, it, vi } from "vitest"
import { DEFAULT_SITE_BASE } from "../src/config"
import { BUNDLED_SELECTORS, hostIdFor, loadSelectors } from "../src/selectors"
import { fakeArea, jsonResponse } from "./helpers"

const remote = {
  chatgpt: { thinkingSelectors: ["button.remote-stop"], composerSelectors: ["#composer"] },
}

describe("hostIdFor", () => {
  it("maps supported hostnames (incl. subdomains) to their host id", () => {
    expect(hostIdFor("chatgpt.com")).toBe("chatgpt")
    expect(hostIdFor("claude.ai")).toBe("claude")
    expect(hostIdFor("www.perplexity.ai")).toBe("perplexity")
    expect(hostIdFor("gemini.google.com")).toBe("gemini")
    expect(hostIdFor("chat.deepseek.com")).toBe("deepseek")
    expect(hostIdFor("bolt.new")).toBe("bolt")
    expect(hostIdFor("v0.app")).toBe("v0")
  })

  it("returns null for an unsupported host", () => {
    expect(hostIdFor("example.com")).toBeNull()
  })
})

describe("loadSelectors", () => {
  it("fetches, validates and caches the remote document", async () => {
    const area = fakeArea()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, remote))
    const cfg = await loadSelectors(area, fetchImpl as unknown as typeof fetch, 1000)
    expect(cfg.chatgpt.thinkingSelectors).toEqual(["button.remote-stop"])
    expect(Object.keys(area.data).some((key) => key.startsWith("vibeperks:selectors:"))).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      DEFAULT_SITE_BASE + "/extension/selectors.json",
      expect.any(Object),
    )
  })

  it("serves a fresh cache without re-fetching", async () => {
    const area = fakeArea({
      ["vibeperks:selectors:" + DEFAULT_SITE_BASE]: { fetchedAt: 1000, config: remote },
    })
    const fetchImpl = vi.fn()
    const cfg = await loadSelectors(area, fetchImpl as unknown as typeof fetch, 1500)
    expect(cfg.chatgpt.composerSelectors).toEqual(["#composer"])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("falls back to bundled selectors when the fetch fails", async () => {
    const area = fakeArea()
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"))
    const cfg = await loadSelectors(area, fetchImpl as unknown as typeof fetch, 1000)
    expect(cfg).toEqual(BUNDLED_SELECTORS)
  })

  it("falls back to bundled selectors on a malformed body", async () => {
    const area = fakeArea()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { chatgpt: { nope: true } }))
    const cfg = await loadSelectors(area, fetchImpl as unknown as typeof fetch, 1000)
    expect(cfg).toEqual(BUNDLED_SELECTORS)
  })
})
