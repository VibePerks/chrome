# VibePerks for ChatGPT (Chrome extension)

A Manifest V3 Chrome extension that shows one small, dismissible sponsor line while
a ChatGPT response is generating on `chatgpt.com`, so you earn VibePerks credit while
you wait. It is a thin client over the same backend contract every other VibePerks
adapter uses (`GET /v1/ads/serve` + `POST /v1/impressions`, authenticated with your
device token).

## How it works

- A content script on `chatgpt.com` watches the page for the "generating" signal
  (the stop-streaming button) via a `MutationObserver`.
- On each prompt/thinking cycle it asks the background worker to serve an ad and
  mounts a small widget above the composer.
- When the response finishes it records one impression and removes the widget.
- Impression model: **one ad + one impression per generation cycle, regardless of how
  long the generation lasts.** (Very short cycles are still recorded; the backend
  applies its own minimum-display crediting rule.)

All network calls run from the **background service worker**, whose `host_permissions`
make them exempt from page-origin CORS. The content script never touches the network
or your device token.

## Privacy

| Data | What the extension does |
| --- | --- |
| Your prompts | **Never read.** |
| The AI's responses | **Never read.** |
| Page content | Only checks whether a "generating" indicator is present (a boolean signal); no text is read or sent. |
| Sent to `api-dev.vibeperks.ai` or `api.vibeperks.ai` | Your device token (auth) + impression telemetry (impression token, display duration, session id, plugin version). |
| Sent anywhere else | Nothing. Selector config is fetched read-only from `dev.vibeperks.ai` or `vibeperks.ai` depending on the config. |
| Stored locally | Device token, opt-out flag, cached ad + impression queue (in `chrome.storage.local`). |

## Design notes (unobtrusive by construction)

- **Closed Shadow DOM** with a random per-session host id and no static/predictable
  classes or ids - nothing page-visible contains brand/ad tokens.
- **Text + inline SVG only** - no external image/font/stylesheet loads, so a strict
  page CSP cannot break the widget and there is nothing for the page to probe.
- **No `web_accessible_resources`** - the extension cannot be fingerprinted by a page
  fetching a known packaged file.
- **Never overlaps or modifies the ChatGPT UI**; the widget is small, sits in dead
  space above the composer, and is dismissible.
- **Stealth/health backoff**: if the widget is repeatedly stripped by the page, the
  extension progressively backs off (normal -> reduced -> dormant for the session)
  instead of fighting the page.
- **Remote-updatable selectors**: DOM hooks are loaded from
  `https://vibeperks.ai/extension/selectors.json` (with a bundled fallback) so a
  ChatGPT UI change can be fixed without a Web Store release.

## Develop

```sh
npm install
npm run typecheck
npm test
npm run build   # outputs a loadable unpacked extension into dist/
```

## Load unpacked (for testing)

1. `npm run build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** -> select the `dist/` folder.
4. Open `chatgpt.com`, click the VibePerks toolbar icon, and paste your device token
   (from the dashboard at `https://vibeperks.ai/install`).
5. Send a prompt: the sponsor line appears while the response generates and is removed
   when it finishes.

## License

PolyForm Shield 1.0.0 (see `LICENSE`).