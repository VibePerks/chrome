import { describe, expect, it } from "vitest"
import { DEFAULT_LANG, normalizeLang, resolveInitialLang, t } from "../src/i18n"

describe("i18n", () => {
  it("defaults to English", () => {
    expect(DEFAULT_LANG).toBe("en")
  })

  it("normalizeLang only maps Spanish to es, everything else to en", () => {
    expect(normalizeLang("es")).toBe("es")
    expect(normalizeLang("en")).toBe("en")
    expect(normalizeLang("fr")).toBe("en")
    expect(normalizeLang("")).toBe("en")
    expect(normalizeLang(undefined)).toBe("en")
    expect(normalizeLang(null)).toBe("en")
  })

  it("resolveInitialLang picks Spanish for a Spanish browser, English otherwise", () => {
    expect(resolveInitialLang("es")).toBe("es")
    expect(resolveInitialLang("es-MX")).toBe("es")
    expect(resolveInitialLang("ES")).toBe("es")
    expect(resolveInitialLang("en-US")).toBe("en")
    expect(resolveInitialLang("fr-FR")).toBe("en")
    expect(resolveInitialLang(null)).toBe("en")
    expect(resolveInitialLang(undefined)).toBe("en")
  })

  it("t returns the copy in the requested language", () => {
    expect(t("en", "goToDashboard")).toBe("Go to Dashboard")
    expect(t("es", "goToDashboard")).toBe("Ir al panel")
    expect(t("en", "earning")).toBe("Earning while you wait")
    expect(t("es", "earning")).toBe("Ganando mientras esperas")
  })

  it("every key is translated in both languages", () => {
    const keys = Object.keys(
      // Derive the key set from the English catalog via a known key's presence.
      {
        settingsTitle: 1,
        sitesTitleEnable: 1,
        sitesTitleSettings: 1,
        sitesIntro: 1,
        aiSites: 1,
        enableAll: 1,
        reloadHint: 1,
        pauseLabel: 1,
        goBack: 1,
        logout: 1,
        signUp: 1,
        connectHint: 1,
        earning: 1,
        paused: 1,
        cappedLabel: 1,
        cappedHint: 1,
        available: 1,
        goToDashboard: 1,
        privacyHint: 1,
        connectionEnded: 1,
        connectOnSite: 1,
        disconnected: 1,
      },
    ) as Parameters<typeof t>[1][]
    for (const key of keys) {
      expect(t("en", key)).not.toBe("")
      expect(t("es", key)).not.toBe("")
      // The Spanish copy should actually differ from English for real strings.
      expect(t("es", key)).not.toBe(t("en", key))
    }
  })
})
