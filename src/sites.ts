// Supported AI-chat sites and their permission origins. These origins are declared
// as `optional_host_permissions` in the manifest and requested at runtime from the
// popup (a user gesture), so the extension installs with a clean, minimal permission
// prompt and the user opts in per site (or all at once). The background dynamically
// registers the content script for whichever origins are granted.

export interface Site {
  id: string
  label: string
  origins: string[]
}

export const SUPPORTED_SITES: Site[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    origins: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  },
  { id: "claude", label: "Claude", origins: ["https://claude.ai/*"] },
  { id: "perplexity", label: "Perplexity", origins: ["https://*.perplexity.ai/*"] },
  { id: "gemini", label: "Gemini", origins: ["https://gemini.google.com/*"] },
  { id: "mistral", label: "Mistral", origins: ["https://chat.mistral.ai/*"] },
  { id: "copilot", label: "Copilot", origins: ["https://copilot.microsoft.com/*"] },
  { id: "deepseek", label: "DeepSeek", origins: ["https://chat.deepseek.com/*"] },
  { id: "grok", label: "Grok", origins: ["https://grok.com/*"] },
  { id: "lovable", label: "Lovable", origins: ["https://lovable.dev/*"] },
  { id: "v0", label: "v0 (Vercel)", origins: ["https://v0.dev/*", "https://v0.app/*"] },
  { id: "bolt", label: "Bolt", origins: ["https://bolt.new/*"] },
]

// ALL_ORIGINS is the flat list of every supported origin - what the "Enable on all
// AI sites" button requests. Must stay a subset of the manifest's
// optional_host_permissions.
export const ALL_ORIGINS: string[] = SUPPORTED_SITES.flatMap((s) => s.origins)

// knownGrantedOrigins returns the subset of `granted` the extension recognizes as a
// supported AI-site origin, so an unrelated granted origin can never become a
// content-script match pattern.
export function knownGrantedOrigins(granted: string[]): string[] {
  const known = new Set(ALL_ORIGINS)
  return granted.filter((o) => known.has(o))
}
