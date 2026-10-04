# Brief: Instagram No-Reels Userscript

## What I want
A personal userscript that makes Instagram on the web (iPhone Safari) behave normally, except that **Reels can't be browsed**. It's just for me. No accounts, no servers, no data leaving my phone.

Instagram will change its markup over time, so this needs a simple update loop: **edit in VS Code → push to GitHub → phone picks up the new version.**

Before writing any code, read this brief, give me a short plan and any questions, and **wait for my confirmation**.

## How it will run
- iPhone Safari, using the free open-source **Userscripts** app (by quoid) as the Safari extension
- Target: `https://www.instagram.com/*` (mobile web layout)
- Desktop testing: Chrome or Safari with Tampermonkey / Violentmonkey (or Userscripts for Mac), using responsive/device mode set to an iPhone viewport

## Behaviour

**Must block**
1. **Reels nav button.** Hide it completely.
2. **Reels feed** (`/reels/` and anything under it). If I land there by any route, redirect immediately to `/` using `location.replace` so Back doesn't return me to it.
3. **Swiping between reels.** I can open a single reel sent in DMs, but moving on to a different reel must not work.

**Must allow**
- Feed, stories, profiles, posts, DMs, search, notifications: all completely normal
- Opening a single reel from a DM (`/reel/<id>/`) and watching it, then going back to DMs and opening another one

**Optional (config flag at top of script, default ON)**
- `BLOCK_EXPLORE`: also hide and redirect `/explore/`, since it's mostly Reels

## Logic for single reels (the tricky part)
- Instagram is a single-page app, so URL changes don't reload the page. Detect navigation by wrapping `history.pushState` / `history.replaceState`, listening for `popstate`, and adding a light polling fallback (~250ms) on `location.pathname`.
- Track the previous route. A transition into `/reel/<id>/` is allowed **only if the previous route was not a reel** (i.e. I came from DMs or elsewhere).
- A transition from `/reel/A/` directly to `/reel/B/` counts as a swipe. Send me back to the allowed reel, or back out of the viewer, whichever proves more reliable. Explain the choice.
- Also lock scrolling/swiping on reel pages where possible (CSS `overscroll-behavior` / `overflow`, and blocking `touchmove`/`wheel` on the reel viewer) as a second layer. The URL guard is the primary defence.

## Technical constraints
- **Single script file**: `instagram-no-reels.user.js` with a proper userscript header (`@name`, `@namespace`, `@match`, `@run-at document-start`, `@version`, `@description`, `@updateURL`, `@downloadURL`)
- **No network requests, no external libraries, no analytics.** `sessionStorage` is fine for tracking the allowed reel ID, but nothing else is stored.
- **Selectors must be resilient.** Match on `href` (`a[href="/reels/"]`, `a[href^="/reels"]`, `a[href^="/explore"]`) and `aria-label`, never on Instagram's obfuscated class names. Use a `MutationObserver` to keep the nav button hidden as the DOM re-renders.
- **Fragile values live in one place.** Put every selector, path pattern and timing value in a clearly labelled `CONFIG` block at the top of the script, so most future fixes are a one-line edit.
- Inject the hiding CSS at `document-start` so the button never flashes on screen
- Keep the code commented and readable. I want to be able to audit every line.
- Include a `DEBUG` flag that logs route decisions to the console

## Update pipeline: VS Code → GitHub → iPhone

### Repo setup
- Initialise a git repo in this folder and create a GitHub repo for it. Use the `gh` CLI if it's installed and authenticated; otherwise give me the exact steps.
- Add a sensible `.gitignore` (e.g. `.DS_Store`, `node_modules`).
- **Ask me: public or private repo?** Explain the trade-off:
  - **Public** is simplest. The phone can fetch updates straight from the raw GitHub URL via `@updateURL` / `@downloadURL`. The script contains nothing personal, so this is low-risk.
  - **Private** means raw URLs need auth, so the phone needs a git client instead. The likely option is **Working Copy** on iOS, cloning the repo into a folder that the Userscripts app points at, and pulling to update (pulling is free in Working Copy).

### Versioning and release
- Every change must bump `@version` in the header. The Userscripts app compares versions to decide whether there's an update.
- Add a one-command release script (`npm run release` or a small shell script, your call). It should:
  - bump the patch version in the userscript header
  - commit with a message I pass in (e.g. `npm run release -- "fix nav selector"`)
  - push to `main`
- Keep a short `CHANGELOG.md` that the release script appends to automatically

### Phone side
- **Check the Userscripts app's own documentation** for how it currently handles `@updateURL` / `@downloadURL` and update checks (automatic vs a manual "check for updates" button), and set the header up to match. Don't assume.
- Document the exact steps on the phone to pull a new version after I push

## Deliverables
1. `instagram-no-reels.user.js`
2. Release script, plus `package.json` if you go the npm route
3. `CHANGELOG.md`
4. `README.md` containing:
   - **iPhone install**: install Userscripts from the App Store, enable it in Settings > Apps > Safari > Extensions, allow it on instagram.com, and install the script. Cover the public route (install from raw URL) or the private route (Working Copy + folder), whichever we chose.
   - **Updating**:
     1. Edit in VS Code
     2. Test on desktop
     3. Run `release`
     4. Update on the phone (exact steps)
   - **Desktop test setup** steps
   - **Manual test checklist**, covering:
     - Reels nav button is gone
     - `/reels/` redirects home
     - A DM'd reel plays
     - A swipe to the next reel is blocked
     - Back to DMs, then opening a second reel, works
     - Explore is blocked (if the flag is on)
     - Feed, stories and DMs are unaffected
   - **When Instagram breaks it**: how to spot what changed (turn on `DEBUG`, inspect the nav in desktop dev tools at iPhone size) and which `CONFIG` values to update
   - **Home-screen note**: Safari extensions may not run when instagram.com is saved to the home screen as a standalone web app. Test this; if it fails, use it as a Safari tab or Safari profile instead.

## Out of scope
- Do not log in to Instagram, automate it, or touch my credentials. I'll do all logged-in testing myself.
- No native app, no proxy, no PWA wrapper (Instagram blocks iframing, so it won't work anyway).
