// VibePerks brand colors - Chrome extension copy.
// SOURCE OF TRUTH: website/src/config.js -> colors + applyBrandColors.
// Update config.js first, then copy the `colors` object here manually.
// Used by widget.ts for inline Shadow DOM styles and popup.ts for dynamic theming.

export const COLORS = {
  // Primitives
  jetBlack: "#0d0d0d",
  surface: "#161616",
  surfaceAlt: "#1f1f1f",
  deepSlate: "#2a2a2a",
  borderStrong: "#3a3a3a",
  amber: "#ffb800",
  darkGold: "#b8860b",
  textMuted: "#a0a0a0",
  white: "#ffffff",
  // Status
  success: "#22c55e",
  info: "#3b82f6",
  warning: "#facc15",
  error: "#ef4444",
  // Destructive
  danger: "#e5484d",
  dangerDark: "#c62828",
  // Auth / form errors
  authError: "#e5484d",
  // Composites (alpha blends)
  overlayLight: "rgba(26,24,38,0.18)",
  overlayMedium: "rgba(26,24,38,0.32)",
  overlayHeavy: "rgba(26,24,38,0.55)",
  highlight: "rgba(26,24,38,0.02)",
  accentGlow: "rgba(255,184,0,0.25)",
  accentGlowFaint: "rgba(255,184,0,0.06)",
  accentGlowSubtle: "rgba(255,184,0,0.15)",
  successPulse: "rgba(34,197,94,0.6)",
  authErrorBg: "rgba(229,72,77,0.08)",
  authErrorBorder: "rgba(229,72,77,0.28)",
  dangerBg: "rgba(198,40,40,0.08)",
} as const
