// router.ts decides which popup view to show from stored state. It is kept pure and
// dependency-free (no chrome / DOM) so the first-run state machine is unit-testable
// without the extension host.

export type PopupView = "sites" | "connect" | "dashboard"

export interface PopupState {
  // anySiteEnabled: at least one supported AI-site host permission is granted.
  anySiteEnabled: boolean
  // connected: a device token is stored (handed over by the website connect flow
  // or pasted via the advanced fallback).
  connected: boolean
}

// chooseView implements the staged flow: no sites -> enable-sites view; sites but
// not connected -> connect view; connected -> the mini dashboard.
export function chooseView(state: PopupState): PopupView {
  if (!state.anySiteEnabled) return "sites"
  if (!state.connected) return "connect"
  return "dashboard"
}
