# NOGRAM

Instagram on the web (iPhone Safari), minus Reels browsing.

- The Reels button is gone, and `/reels/` sends you home.
- A reel someone sends you in DMs still opens and plays.
- Swiping on to the next reel doesn't work. You get sent back to where you opened it from.
- Explore is blocked too (optional, on by default). The Explore button takes you straight to Search instead.

Everything else (feed, stories, profiles, posts, DMs, search, notifications) is untouched. It's one userscript, [`instagram-no-reels.user.js`](instagram-no-reels.user.js), with no network requests, no libraries and no analytics. The only thing it stores is the ID of the reel you're currently watching, in `sessionStorage`, and that's gone when the tab closes.

**Install link (open this on the iPhone in Safari):**
https://raw.githubusercontent.com/conradwells8-byte/nogram/main/instagram-no-reels.user.js

---

## iPhone install (one-off)

1. **Install the app.** In the App Store, get [**Userscripts**](https://apps.apple.com/app/userscripts/id1463298887) (free, open source, by quoid). Open it once. Recent versions set up their scripts folder automatically, so there's nothing to configure.
2. **Turn on the Safari extension.** Go to **Settings → Apps → Safari → Extensions → Userscripts** and switch it on. (On older iOS it's **Settings → Safari → Extensions**.)
3. **Give it access to Instagram.** On the same screen, set **www.instagram.com** (or *All Websites*) to **Allow**. You can also do this later from Safari when it asks.
4. **Install the script.** In Safari, open the install link above. You'll see the raw script text. Tap the **extensions icon** in the address bar (the puzzle piece, or the **AA** menu on older iOS), then **Userscripts**. The popup shows an install prompt. Tap it and confirm **Install**.
5. **Use it.** Open https://www.instagram.com in Safari and log in as normal. The Reels button should be gone.

If the popup ever says the script isn't active on Instagram, open the Userscripts popup on an instagram.com page and check that **NOGRAM: Instagram without Reels** is toggled on.

### Home-screen note

Safari extensions may **not** run when instagram.com is saved to the Home Screen as a standalone web app. Test it once: add it to the Home Screen, open it and look for the Reels button. If the button is there, the script isn't running in that mode, so use Instagram in a normal Safari tab instead. (A dedicated Safari **Profile** with only Instagram in it works well and keeps it separate from your other browsing.)

---

## Updating

The loop is: **edit in VS Code → test on desktop → `npm run release` → update on the phone.**

### 1. Edit in VS Code

Nearly every fix is a one-line change in the `CONFIG` block at the top of [`instagram-no-reels.user.js`](instagram-no-reels.user.js). See [When Instagram breaks it](#when-instagram-breaks-it).

### 2. Test on desktop

Run the automated tests first. They check the script against a small fake Instagram page, never the real site:

```sh
npm install                      # once
npx playwright install webkit    # once
npm test
```

Then do a real check: see [Desktop test setup](#desktop-test-setup) and run through the [Manual test checklist](#manual-test-checklist).

### 3. Release

```sh
npm run release -- "fix nav selector"
```

This needs Node, but no `npm install`, because there are no dependencies. It:

1. checks the script parses,
2. bumps the patch version in the `@version` header line (e.g. `1.0.3` → `1.0.4`),
3. regenerates `instagram-no-reels.meta.js` (the small header-only file the phone checks for updates),
4. adds an entry to [`CHANGELOG.md`](CHANGELOG.md),
5. commits everything as `v1.0.4: fix nav selector` and pushes to `main`.

Every release must bump the version, because Userscripts only updates when the version number goes up. The release script handles that, so don't push script changes by hand.

`npm run check` runs the same checks without releasing: the script parses, `.meta.js` matches the header, and there are no network APIs or external URLs in the script body.

### 4. Update on the phone

Userscripts reads `@updateURL` (the `.meta.js` file) and compares its `@version` with the installed one. If the remote version is higher, it downloads the new script from `@downloadURL`. It checks periodically on its own, but you don't have to wait:

1. In Safari, open any page (instagram.com is fine).
2. Tap the **extensions icon** → **Userscripts**.
3. Tap the **refresh** button in the popup. An **Updates** section appears listing NOGRAM with the new version.
4. Tap **Update**, then reload instagram.com.

**If no update shows up**, either GitHub's raw file cache hasn't caught up yet (it can serve the old file for up to about 5 minutes after a push), or the app's update check is having a moment. Its README notes the update process isn't fully implemented ([issue #248](https://github.com/quoid/userscripts/issues/248)). The fallback always works: open the [install link](https://raw.githubusercontent.com/conradwells8-byte/nogram/main/instagram-no-reels.user.js) again in Safari and install it from the popup. The new copy replaces the old one because it has the same `@name`.

To check which version the phone has, open the Userscripts popup on instagram.com and look at the script entry, or turn on `DEBUG` (see below).

---

## Desktop test setup

You can test everything except the actual touch-swipe on a Mac.

**Chrome + Violentmonkey (recommended for development)**

1. Install the [Violentmonkey](https://violentmonkey.github.io/) extension in Chrome (Tampermonkey works too).
2. In `chrome://extensions` → Violentmonkey → **Details**, turn on **Allow access to file URLs**.
3. Drag `instagram-no-reels.user.js` from Finder into a Chrome window. On the install page, tick **Track external edits** and keep that tab open. Now every save in VS Code is picked up when you reload Instagram.
4. Open instagram.com, then DevTools (`⌥⌘I`) → **Toggle device toolbar** (`⇧⌘M`) → pick an iPhone (e.g. *iPhone 14 Pro*) → reload. You need the reload so Instagram serves its mobile layout.
5. Set `DEBUG: true` in `CONFIG` to see `[NOGRAM]` route decisions in the Console. Set it back to `false` before releasing.

Tampermonkey runs `@grant none` scripts in the page itself. Userscripts on iPhone may run it in an isolated "content script" context instead. The script is built to work in both (see [How it works](#how-it-works)).

**Debugging on the real iPhone**

On the iPhone, go to **Settings → Apps → Safari → Advanced** and turn on **Web Inspector**. Connect the phone to the Mac by cable, then in Mac Safari open **Develop → [your iPhone] → instagram.com**. You get the phone's console, including `[NOGRAM]` logs if `DEBUG` is on.

---

## Manual test checklist

Run through this after every change, on desktop (iPhone viewport) and then on the phone. Log in yourself; nothing here automates Instagram.

- [ ] **Reels nav button is gone** from the bottom bar, and it doesn't flash on screen while the page loads.
- [ ] **`/reels/` redirects home.** Type `instagram.com/reels/` in the address bar and you should land on the feed. Press Back: you should *not* return to `/reels/`.
- [ ] **A DM'd reel plays.** Open a DM thread with a reel in it, tap the reel, and it opens and plays.
- [ ] **A swipe to the next reel is blocked.** In that reel, try to swipe up or scroll to the next one. Either nothing moves, or you're sent straight back to the DM thread.
- [ ] **Back to DMs, then a second reel works.** From the DM thread, open a *different* reel. It opens and plays.
- [ ] **Explore is blocked** (if `BLOCK_EXPLORE` is on). Tapping the Explore/search button lands on the search page, not the Explore grid. Searching for an account still works.
- [ ] **Feed, stories and DMs are unaffected.** Scroll the feed, watch a few stories, send a message.
- [ ] **Profiles are unaffected**, including a profile's own Reels tab (single reels from there open like DM reels).

---

## When Instagram breaks it

Instagram changes its markup regularly. Symptoms and fixes:

| Symptom | Likely cause | What to change in `CONFIG` |
|---|---|---|
| Reels button is back | Its link or label changed | `HIDE_SELECTORS` / `HIDE_ARIA_LABELS` |
| `/reels/` no longer redirects, or redirects too much | Reels URLs changed | `PATHS.REELS_FEED`, `PATHS.REELS_FEED_ROOT`, `PATHS.REELS_FEED_WITH_ID` |
| DM reels won't open, or swipes aren't caught | Single-reel URL changed | `PATHS.SINGLE_REEL` |
| Search broken | Search moved | `REDIRECT_EXPLORE`, `PATHS.EXPLORE_ALLOWED` (or set `BLOCK_EXPLORE: false`) |
| Can't scroll comments on a reel | Comment sheet isn't a `role="dialog"` any more | `SCROLL_LOCK_EXEMPT` |
| A swipe flashes the next reel for too long | Detection is slow | Lower `POLL_MS` (e.g. `100`) |

**How to see what changed:**

1. Set `DEBUG: true` and open the Console (desktop, or the iPhone via Web Inspector as above). Every navigation logs a line like
   `[NOGRAM] pushState: /direct/t/123/ -> /reel/ABC/ => allow (opened reel ABC from /direct/t/123/)`.
   If tapping around produces no `[NOGRAM]` lines at all, the script isn't running. Check the extension is enabled and allowed on instagram.com.
2. Watch which URLs appear as you open a reel and swipe. If Instagram has started using a new pattern (say `/clips/<id>/`), update the regexes in `PATHS`.
3. For the nav button: at iPhone size in desktop DevTools, right-click the Reels button → **Inspect**. Look at the `<a>` element's `href` and at any `aria-label` on it or on its `<svg>`. Add the new value to `HIDE_SELECTORS` (by `href`) or `HIDE_ARIA_LABELS`. **Never use Instagram's class names** (`x1i10hfl` and so on); they change every deploy.
4. `npm run release -- "describe the fix"`, then update on the phone.

---

## How it works

Five layers, from fastest to most thorough:

1. **CSS at `document-start`** hides the bare Reels feed link (`a[href="/reels/"]` and variants) before the page can paint it.
2. **A `MutationObserver`** re-applies the hiding (and an `aria-label="Reels"` fallback) every time Instagram re-renders, batched to once per animation frame. The same pass also sets `display: none` inline via script, which works even if a Content Security Policy were ever to block the `<style>` tag.
3. **A route guard** runs on every URL change. It watches for changes four ways: wrapped `history.pushState` / `replaceState`, `popstate`, the DOM observer, and a 250 ms poll of `location.pathname`. A single-reel URL (`/reel/<id>/`) is allowed only if the previous route was *not* a reel. A reel-to-different-reel change counts as a swipe. Blocked routes use `location.replace`, so Back doesn't return to them.
4. **A click guard** (capture phase, on `window`) stops taps on blocked links before Instagram's router sees them. That means no flash of Explore, and a "next reel" link simply does nothing.
5. **A scroll lock** on single-reel pages: `overflow: hidden` and `overscroll-behavior: none`, plus blocking vertical `touchmove`, `wheel` and arrow / Page Up / Page Down keys. Dialogs (the comment sheet) and text inputs are exempt. This is a second layer; the route guard is the real defence.

**Why the header says `@inject-into auto` and `@grant none`:** the script needs no special APIs. With `auto`, Userscripts runs it in the page itself where it can, and falls back to an isolated content-script context if Instagram's Content Security Policy prevents that. In the isolated context, wrapping `history.pushState` can't see Instagram's own calls. The DOM observer and the poll catch those navigations instead, normally within a frame. `npm test` runs every scenario in both contexts.

**Why `exit` is the default swipe action (`SWIPE_ACTION`):** when a reel-to-reel swipe is detected, the script can either *exit* (`location.replace` back to the page you opened the reel from, such as the DM thread, or home if that's unknown) or *return* (reload the reel you were allowed to watch). Exit is the default because it behaves the same whichever way Instagram changes the URL. If Instagram used `pushState` for the swipe, *return* would leave a duplicate reel entry in your Back history. If it used `replaceState`, it would lose the original entry. Either way you'd stay stuck in the reel viewer, where the next swipe triggers another reload. *Exit* always lands somewhere sensible, gives a clear "no", and leaves you one tap away from opening another reel. Set `SWIPE_ACTION: 'return'` if you'd rather stay on the reel.

**Choices that go slightly beyond the brief:**

- **Only the bare `/reels/` link is hidden**, not every `a[href^="/reels"]`. Reels shared in DMs can use the `/reels/<id>/` form, and a prefix match would hide those too. Opened fresh, a `/reels/<id>/` link is rewritten to the single-reel URL `/reel/<id>/` rather than bounced home (`REELS_ID_TO_SINGLE_REEL`). Reached by swiping from another reel, it's blocked like any other swipe.
- **Explore isn't hidden, it's redirected to Search.** On mobile web the Explore button is also the only way into Search, so hiding it would break search. `/explore/` goes to `/explore/search/`, and `/explore/search/`, `/explore/tags/…` and `/explore/locations/…` stay allowed. To hide the button anyway, add `'a[href^="/explore"]'` to `HIDE_SELECTORS_EXPLORE`.
- **Hard reloads are covered.** On a full page load the script uses the same-origin `document.referrer` as the "previous route", so a reel-to-reel change that reloads the page is still caught.

---

## Files

| File | What |
|---|---|
| `instagram-no-reels.user.js` | The userscript (the only thing that runs) |
| `instagram-no-reels.meta.js` | Header only. The phone checks this for new versions. Generated by `npm run release`; don't edit. |
| `scripts/release.mjs` | `npm run release -- "message"` |
| `scripts/check.mjs` | `npm run check` |
| `test/` | `npm test`: WebKit tests against a fake Instagram page |
| `CHANGELOG.md` | Appended by the release script |
| `instagram-no-reels-brief.md` | The original brief |

## Privacy

This repo is public so the phone can fetch updates without logging in. It contains no personal data: no credentials, no account names, no cookies. Commits use GitHub's no-reply address. The script never makes a network request. Instagram login happens only in your own Safari.
