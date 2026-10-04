# NOGRAM

Personal userscript that makes Instagram on the web usable without Reels: hides the Reels button, redirects `/reels/`, lets single reels from DMs play but blocks moving to the next one, locks up/down scrolling while a full-screen video is on screen, and adds an entry countdown, an on-screen timer and a per-sitting time limit. Runs on iPhone Safari via the **Userscripts** app (quoid), and on desktop (Arc/Chrome) via Violentmonkey.

The original requirements are in `instagram-no-reels-brief.md`. User-facing docs are in `README.md`.

## Files

- `instagram-no-reels.user.js`: the whole product. One file, one IIFE, with a `CONFIG` block at the top.
- `instagram-no-reels.meta.js`: header only, generated. The phone's `@updateURL` points here. Never hand-edit it.
- `scripts/release.mjs`, `scripts/check.mjs`, `scripts/lib.mjs`: release and check tooling (Node built-ins only).
- `test/run.mjs` + `test/mock-instagram.html`: Playwright tests against a fake Instagram SPA served on localhost.

## Commands

- `npm run check`: syntax check, `.meta.js` matches the header, and no network APIs or external URLs in the script body.
- `npm test`: browser suite (WebKit, plus installed Chrome for the synthetic-touch lock tests). Needs `npm install` once.
- `npm run release -- "summary"`: bumps the patch `@version`, regenerates `.meta.js`, prepends to `CHANGELOG.md`, commits everything, and pushes to `main`. The first line of the message is the changelog entry; extra lines go only into the commit body. Use extra lines for the `Co-Authored-By` trailer, e.g. `npm run release -- $'summary\n\nCo-Authored-By: ...'`.

Every change that should reach the phone **must** go through `npm run release`, because Userscripts only updates when `@version` increases. Docs-only changes can be committed directly, without a version bump.

## Rules for changing the script

- Every fragile value (selectors, path regexes, timings, thresholds) lives in `CONFIG`. Keep it that way, so most Instagram breakages are a one-line fix.
- Match on `href`, `aria-label` and semantic elements (`article`, `video`). Never use Instagram's obfuscated class names.
- No network requests, external libraries or analytics. `check.mjs` enforces this.
- Storage: `sessionStorage` holds the allowed reel ID; `localStorage` key `nogram.time` holds the time-limit state. Nothing else.
- Keep code commented and auditable; the user reads every line.
- The script must work in both injection contexts. In the page context, wrapping `history.pushState` works. In the isolated content-script context (possible under Userscripts `@inject-into auto`), it doesn't, and the DOM observer plus the 250 ms poll catch navigation instead. The tests run both.
- At `document-start`, `document.documentElement` can be null. Guard every access to it.
- Add or adjust tests in `test/run.mjs` for behaviour changes, and run `npm test` before releasing.

## Out of scope (from the brief)

Never log in to Instagram, automate it, or touch credentials. The user does all logged-in testing. No native app, proxy or PWA wrapper.

## Public repo: no personal data

The repo is public (github.com/conradwells8-byte/nogram) so the phone can fetch raw files without auth. Keep personal data out:
- Commits use the GitHub noreply email.
- No real email addresses, local paths or names beyond the GitHub handle.
- No LICENSE file with a real name.
- Scan staged files before pushing anything new.

## Phone and update facts

- Raw URLs: `https://raw.githubusercontent.com/conradwells8-byte/nogram/main/instagram-no-reels.{user,meta}.js`. GitHub's raw cache can lag up to about 5 minutes.
- The user restricted Userscripts' site access to instagram.com, so the popup's update check may not reach GitHub. The dependable update path is to reopen the raw `.user.js` link, choose "Allow for One Day", and install over the top.
- To verify the installed version: Files app → On My iPhone → Userscripts → preview the NOGRAM file and check `@version`.
- Safari extensions don't run in Home Screen web apps. Use a Home Screen icon with "Open as Web App" turned off, or a Shortcuts "Open URL" icon.
- Arc (desktop) works with Violentmonkey. Arc Search on iPhone can't run extensions.

## Known assumptions (not verified against real Instagram)

- Mobile web's Explore button is the way into Search, so `/explore/` redirects to `/explore/search/`.
- Reels opened from DMs may play as a pop-up without changing the URL. The video lock is designed to cover this from what's on screen: a `<video>` at least 75% of the viewport height that isn't inside an `<article>`.
- The desktop Instagram layout hasn't been tuned. If something misbehaves there, consider detecting desktop and handling it separately.
- WebKit doesn't allow `new Touch()`/`new TouchEvent()`. The gesture cancel sent to Instagram therefore relies on `pointercancel`; `touchcancel` is a best-effort extra.

Open question for the user: the "Time's up" lockout currently lasts `NEW_SITTING_AFTER_AWAY_MIN` (5 minutes). They may want it longer.
