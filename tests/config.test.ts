import { describe, expect, it } from "vitest"
import {
  DEFAULT_API_BASE,
  DEFAULT_SITE_BASE,
  clearDeviceToken,
  isTrustedSiteOrigin,
  loadConfig,
  loadLang,
  saveDeviceToken,
  saveLang,
  setOptOut,
} from "../src/config"
import { fakeArea } from "./helpers"

describe("config", () => {
  it("defaults api base and empty token when unset", async () => {
    const cfg = await loadConfig(fakeArea())
    expect(cfg.apiBase).toBe(DEFAULT_API_BASE)
    expect(cfg.deviceToken).toBe("")
    expect(cfg.optOut).toBe(false)
  })

  it("uses the constants even when legacy api_base storage exists", async () => {
    const area = fakeArea({ api_base: "https://api.example/", device_token: "tok", opt_out: true })
    const cfg = await loadConfig(area)
    expect(cfg.apiBase).toBe(DEFAULT_API_BASE)
    expect(cfg.deviceToken).toBe("tok")
    expect(cfg.optOut).toBe(true)
  })

  it("saveDeviceToken trims and persists", async () => {
    const area = fakeArea()
    await saveDeviceToken(area, "  abc  ")
    expect((await loadConfig(area)).deviceToken).toBe("abc")
  })

  it("clearDeviceToken empties the token", async () => {
    const area = fakeArea({ device_token: "abc" })
    await clearDeviceToken(area)
    expect((await loadConfig(area)).deviceToken).toBe("")
  })

  it("setOptOut toggles the flag", async () => {
    const area = fakeArea()
    await setOptOut(area, true)
    expect((await loadConfig(area)).optOut).toBe(true)
  })

  it("loadLang returns null when no language is stored", async () => {
    expect(await loadLang(fakeArea())).toBeNull()
  })

  it("saveLang persists the language and loadLang reads it back", async () => {
    const area = fakeArea()
    await saveLang(area, "es")
    expect(await loadLang(area)).toBe("es")
  })

  it("exports the site base independently from the api base", () => {
    expect(DEFAULT_SITE_BASE).not.toBe("")
    expect(DEFAULT_API_BASE).not.toBe("")
  })

  it("isTrustedSiteOrigin only accepts the exact site origin", () => {
    const origin = new URL(DEFAULT_SITE_BASE).origin
    expect(isTrustedSiteOrigin(origin)).toBe(true)
    // A path on the same origin still resolves to the trusted origin.
    expect(isTrustedSiteOrigin(DEFAULT_SITE_BASE + "/app")).toBe(true)
    // Look-alike host, wrong scheme, and garbage are all rejected.
    expect(isTrustedSiteOrigin("https://evil.example")).toBe(false)
    expect(isTrustedSiteOrigin("http://" + new URL(DEFAULT_SITE_BASE).host)).toBe(false)
    expect(isTrustedSiteOrigin("not-a-url")).toBe(false)
    expect(isTrustedSiteOrigin("")).toBe(false)
  })
})
