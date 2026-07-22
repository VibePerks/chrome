import type { Ad } from "./types"

// Server ad copy is untrusted at the render boundary: every C0 control byte (incl.
// ESC, tab, newline) and DEL is stripped so it can never emit escape sequences or
// inject markup when rendered into the widget.
const CONTROL = /[\u0000-\u001f\u007f]/g

// sanitize strips control bytes and trims whitespace from untrusted server copy
// before it is ever cached or rendered.
export function sanitize(s: string): string {
  return s.replace(CONTROL, "").trim()
}

// renderLine formats an ad as a single plain-text line. The advertiser domain leads
// the line, followed by the sentence ("<domain> - <sentence>"); when the sentence
// already contains the domain it is rendered as-is.
export function renderLine(ad: Ad): string {
  const sentence = sanitize(ad.sentence)
  const domain = sanitize(ad.domain)
  if (domain && !sentence.includes(domain)) {
    return `${domain} - ${sentence}`.trim()
  }
  return sentence
}

// adUrl builds a safe external URL for an ad's domain. A bare domain gets an https
// scheme; an explicit scheme is only honored when it is http(s), so a malformed or
// non-web value (e.g. a `file:`/`javascript:` scheme) can never be opened. Returns
// null when unsafe.
export function adUrl(domain: string): string | null {
  const d = sanitize(domain)
  if (!d) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(d)
  if (scheme && scheme[1].toLowerCase() !== "http" && scheme[1].toLowerCase() !== "https") {
    return null
  }
  const candidate = scheme ? d : `https://${d}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  return url.toString()
}

// clickUrl resolves the click target for an ad: the advertiser's full destination
// URL (path + query such as UTM tags preserved) when it is a safe http(s) link, else
// the bare domain promoted to https. Returns null when neither is a safe http(s)
// target. The visible line always shows only the domain, never this URL.
export function clickUrl(ad: Ad): string | null {
  return adUrl(ad.website_url ?? "") ?? adUrl(ad.domain)
}

// iconUrl returns the advertiser's brand-icon URL only when it is a safe https URL,
// so a malformed or non-https value from the server can never be loaded. Returns
// null otherwise, in which case the widget shows its generic glyph.
export function iconUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).protocol === "https:" ? url : null
  } catch {
    return null
  }
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

// hexColor returns the colour when it is a valid "#rrggbb" string, else null. The
// strict hex check keeps untrusted server colours from injecting anything into the
// widget's inline style strings. Used to validate the positional identity colours
// (identity_colors[0] = background, identity_colors[1] = accent).
export function hexColor(c: string | undefined): string | null {
  return typeof c === "string" && HEX_COLOR.test(c) ? c : null
}
