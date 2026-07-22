// stealth.ts is the stealth/health monitor. If the host page appears to be actively
// stripping the widget (our mounted host node is removed shortly after we mount it,
// which a site's own MutationObserver defense would do), the extension progressively
// backs off rather than fighting the page: normal -> reduced -> dormant for the rest
// of the session. This is pure, deterministic logic so it is unit-testable; the
// content script feeds it strip events and reads the mode.

export type StealthMode = "normal" | "reduced" | "dormant"

// Escalation thresholds (number of observed strips).
const REDUCED_AFTER = 1
const DORMANT_AFTER = 3

export class StealthMonitor {
  private strips = 0
  private mode: StealthMode = "normal"

  // recordStrip notes that the widget was removed by something other than us and
  // returns the (possibly escalated) mode.
  recordStrip(): StealthMode {
    this.strips += 1
    if (this.strips >= DORMANT_AFTER) this.mode = "dormant"
    else if (this.strips >= REDUCED_AFTER) this.mode = "reduced"
    return this.mode
  }

  currentMode(): StealthMode {
    return this.mode
  }

  // shouldShow is false once dormant: the extension stops mounting for the session.
  shouldShow(): boolean {
    return this.mode !== "dormant"
  }

  // isReduced signals the content script to use the less conspicuous behavior
  // (mount less often; see the content script's cooldown).
  isReduced(): boolean {
    return this.mode === "reduced"
  }
}
