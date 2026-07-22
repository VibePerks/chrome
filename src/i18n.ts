// i18n.ts holds the extension popup's UI copy in every supported language and the
// small helpers that pick which one to show. The rendered ad line itself is already
// localised server-side (served in the publisher's account language), so this only
// covers the popup chrome (the extension's own UI text).
//
// Language resolution has two tiers:
//   1. Source of truth: the publisher's account language (`lang`) returned by the
//      backend token-verify call. Once known it is persisted and always wins.
//   2. Initial guess: before we have connected/verified, fall back to the browser's
//      language (its Accept-Language preference). Spanish -> "es"; everything else
//      falls back to English.

// Lang is the set of languages the popup UI is translated into. Keep in lockstep
// with the backend's SUPPORTED_LANGS (currently en/es).
export type Lang = "en" | "es"

export const DEFAULT_LANG: Lang = "en"

// MessageKey enumerates every translatable string in the popup UI.
export type MessageKey =
  | "settingsTitle"
  | "sitesTitleEnable"
  | "sitesTitleSettings"
  | "sitesIntro"
  | "aiSites"
  | "enableAll"
  | "reloadHint"
  | "pauseLabel"
  | "goBack"
  | "logout"
  | "signUp"
  | "connectHint"
  | "earning"
  | "paused"
  | "cappedLabel"
  | "cappedHint"
  | "available"
  | "goToDashboard"
  | "privacyHint"
  | "connectionEnded"
  | "connectOnSite"
  | "disconnected"

type Catalog = Record<MessageKey, string>

const EN: Catalog = {
  settingsTitle: "Manage sites",
  sitesTitleEnable: "Enable Sites",
  sitesTitleSettings: "Settings",
  sitesIntro: "Pick which AI sites show a sponsor line while a response is generating.",
  aiSites: "AI sites",
  enableAll: "Enable all",
  reloadHint: "After enabling a site, reload that site's tab.",
  pauseLabel: "Pause (stop showing sponsor lines)",
  goBack: "Go back",
  logout: "Log out",
  signUp: "Sign Up To Start",
  connectHint: "then click on Connect extension",
  earning: "Earning while you wait",
  paused: "Paused",
  cappedLabel: "Hourly limit reached",
  cappedHint: "More ads unlock when the timer runs out.",
  available: "Available",
  goToDashboard: "Go to Dashboard",
  privacyHint: "100% private, prompts never get sent.",
  connectionEnded: "Your connection ended - reconnect to keep earning",
  connectOnSite: "Click Connect extension on the site - this popup updates automatically.",
  disconnected: "Disconnected - reconnect from the site to earn again",
}

const ES: Catalog = {
  settingsTitle: "Administrar sitios",
  sitesTitleEnable: "Activar sitios",
  sitesTitleSettings: "Ajustes",
  sitesIntro:
    "Elige en qué sitios de IA se muestra una línea de patrocinio mientras se genera una respuesta.",
  aiSites: "Sitios de IA",
  enableAll: "Activar todos",
  reloadHint: "Después de activar un sitio, recarga la pestaña de ese sitio.",
  pauseLabel: "Pausar (dejar de mostrar líneas de patrocinio)",
  goBack: "Volver",
  logout: "Cerrar sesión",
  signUp: "Regístrate para empezar",
  connectHint: "luego haz clic en Conectar extensión",
  earning: "Ganando mientras esperas",
  paused: "En pausa",
  cappedLabel: "Límite por hora alcanzado",
  cappedHint: "Se desbloquean más anuncios cuando termina el temporizador.",
  available: "Disponible",
  goToDashboard: "Ir al panel",
  privacyHint: "100% privado, tus mensajes nunca se envían.",
  connectionEnded: "Tu conexión terminó - reconéctate para seguir ganando",
  connectOnSite:
    "Haz clic en Conectar extensión en el sitio - esta ventana se actualiza automáticamente.",
  disconnected: "Desconectado - reconéctate desde el sitio para volver a ganar",
}

const CATALOGS: Record<Lang, Catalog> = { en: EN, es: ES }

// normalizeLang clamps an arbitrary value to a supported Lang. Only Spanish maps to
// "es"; anything unknown or unsupported falls back to English.
export function normalizeLang(value: unknown): Lang {
  return value === "es" ? "es" : DEFAULT_LANG
}

// resolveInitialLang guesses the UI language from the browser's language preference
// (its Accept-Language), used before the account language is known. A Spanish
// browser gets Spanish; every other language falls back to English.
export function resolveInitialLang(navigatorLanguage: string | null | undefined): Lang {
  return typeof navigatorLanguage === "string" && navigatorLanguage.toLowerCase().startsWith("es")
    ? "es"
    : DEFAULT_LANG
}

// t returns the translated string for a key in the given language, falling back to
// English for any key missing from a non-default catalog.
export function t(lang: Lang, key: MessageKey): string {
  return CATALOGS[lang][key] ?? EN[key]
}
