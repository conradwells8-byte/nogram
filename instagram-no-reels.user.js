// ==UserScript==
// @name         NOGRAM: Instagram without Reels
// @namespace    https://github.com/conradwells8-byte/nogram
// @version      1.0.0
// @description  Instagram on the web, minus Reels browsing. Single reels sent in DMs still open; swiping to the next one doesn't.
// @match        https://www.instagram.com/*
// @run-at       document-start
// @inject-into  auto
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/conradwells8-byte/nogram/main/instagram-no-reels.meta.js
// @downloadURL  https://raw.githubusercontent.com/conradwells8-byte/nogram/main/instagram-no-reels.user.js
// ==/UserScript==

/*
 * NOGRAM: personal userscript. No network requests, no libraries, no analytics.
 * The only thing stored is the ID of the one reel you're currently allowed to
 * watch, in sessionStorage (cleared when the tab closes).
 *
 * How it works, in layers:
 *   1. CSS injected at document-start hides the Reels nav button before it can paint.
 *   2. A MutationObserver re-hides it whenever Instagram re-renders the DOM.
 *   3. A route guard watches every URL change and redirects away from blocked routes.
 *   4. A capture-phase click guard stops taps on blocked links before Instagram sees them.
 *   5. On a reel page, scroll/swipe/wheel/arrow-key input is locked as a second line of defence.
 *
 * If Instagram changes its markup, almost every fix is a one-line edit in CONFIG below.
 */

(function () {
  'use strict';

  // ===========================================================================
  // CONFIG: everything fragile lives here.
  // ===========================================================================
  const CONFIG = {
    // Log every route decision to the console (prefix: [NOGRAM]).
    DEBUG: false,

    // Also block Explore. On mobile web the Explore button is also the way into
    // Search, so instead of hiding it we send /explore/ to the search page.
    BLOCK_EXPLORE: true,

    // What to do when a reel-to-reel swipe is detected:
    //   'exit'   = leave the reel viewer and go back to where you opened it from (default)
    //   'return' = reload the reel you were allowed to watch
    // See README "Why 'exit' is the default".
    SWIPE_ACTION: 'exit',

    // --- Paths (regexes tested against location.pathname) --------------------
    PATHS: {
      // Reels feed: /reels/ and anything under it.
      REELS_FEED: /^\/reels(\/|$)/,
      // The bare feed entry point the nav button links to: /reels or /reels/.
      REELS_FEED_ROOT: /^\/reels\/?$/,
      // Reels feed URL that names one reel: /reels/<id>/. Capture group 1 = id.
      REELS_FEED_WITH_ID: /^\/reels\/([A-Za-z0-9_-]+)/,
      // Single reel: /reel/<id>/ (and sub-pages like /reel/<id>/comments/). Group 1 = id.
      SINGLE_REEL: /^\/reel\/([A-Za-z0-9_-]+)/,
      // Explore and everything under it...
      EXPLORE: /^\/explore(\/|$)/,
      // ...except these, which are search and its results.
      EXPLORE_ALLOWED: /^\/explore\/(search|tags|locations)(\/|$)/,
    },

    // Where blocked routes send you.
    REDIRECT_HOME: '/',
    REDIRECT_EXPLORE: '/explore/search/',

    // When a /reels/<id>/ link is opened fresh (not by swiping), rewrite it to
    // the single-reel URL /reel/<id>/ instead of bouncing home. DMs sometimes
    // share reels in the /reels/<id>/ form.
    REELS_ID_TO_SINGLE_REEL: true,

    // --- Selectors (never Instagram's obfuscated class names) ----------------
    // Links to hide outright. Matched by href, so they survive restyling.
    // Deliberately only the bare feed link: reels shared in DMs can look like
    // /reels/<id>/, and those must stay tappable (they open as a single reel).
    HIDE_SELECTORS: [
      'a[href="/reels/"]',
      'a[href="/reels"]',
      'a[href^="/reels/?"]',
      'a[href^="/reels?"]',
      'a[href="https://www.instagram.com/reels/"]',
    ],
    // Extra links to hide when BLOCK_EXPLORE is on. Empty by default because the
    // Explore button doubles as Search on mobile web (it gets redirected instead).
    HIDE_SELECTORS_EXPLORE: [],
    // Fallback: elements labelled like this get their enclosing link/button hidden,
    // but only if it has no href or its href is the bare Reels feed. That keeps a
    // profile's own "Reels" tab (/<username>/reels/) visible.
    HIDE_ARIA_LABELS: ['Reels'],
    // Inside these, touch/wheel scrolling is left alone even on a reel page
    // (comment sheets, text inputs, menus).
    SCROLL_LOCK_EXEMPT: '[role="dialog"], textarea, input, [contenteditable="true"]',

    // --- Timings ------------------------------------------------------------
    POLL_MS: 250, // fallback check of location.pathname
    // Swipes shorter than this (px) are ignored so taps and small drags still work.
    SWIPE_MIN_PX: 10,

    // --- Internals ----------------------------------------------------------
    STORAGE_KEY: 'nogram.allowedReelId', // sessionStorage key (the only thing stored)
    HTML_CLASS_ON_REEL: 'nogram-on-reel', // added to <html> while on a single reel
    STYLE_ID: 'nogram-style',
    HIDDEN_ATTR: 'data-nogram-hidden',
  };

  // ===========================================================================
  // Logging
  // ===========================================================================
  function log(...args) {
    if (CONFIG.DEBUG) console.log('[NOGRAM]', ...args);
  }

  // ===========================================================================
  // Route classification
  // ===========================================================================

  /** Return the reel id if `path` is a single-reel page, else null. */
  function singleReelId(path) {
    const m = CONFIG.PATHS.SINGLE_REEL.exec(path || '');
    return m ? m[1] : null;
  }

  /** Return the reel id if `path` is /reels/<id>/, else null. */
  function feedReelId(path) {
    const m = CONFIG.PATHS.REELS_FEED_WITH_ID.exec(path || '');
    return m ? m[1] : null;
  }

  /** Any kind of reel page, single or feed. */
  function isAnyReel(path) {
    return singleReelId(path) !== null || CONFIG.PATHS.REELS_FEED.test(path || '');
  }

  function isBlockedExplore(path) {
    return (
      CONFIG.BLOCK_EXPLORE &&
      CONFIG.PATHS.EXPLORE.test(path) &&
      !CONFIG.PATHS.EXPLORE_ALLOWED.test(path)
    );
  }

  // ===========================================================================
  // Allowed-reel memory (sessionStorage, wrapped so a storage error never breaks the page)
  // ===========================================================================
  function getAllowedReel() {
    try {
      return sessionStorage.getItem(CONFIG.STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }
  function setAllowedReel(id) {
    try {
      if (id) sessionStorage.setItem(CONFIG.STORAGE_KEY, id);
      else sessionStorage.removeItem(CONFIG.STORAGE_KEY);
    } catch (e) {
      /* storage unavailable: fall back to in-memory route tracking only */
    }
  }

  // ===========================================================================
  // The decision: given where we were and where we are, what should happen?
  // Returns one of:
  //   { action: 'allow',    reason, allowReel?, clearReel? }
  //   { action: 'redirect', reason, to, swallowClick? }
  //   { action: 'swipe',    reason }   (reel -> different reel)
  // `prev` is null on a fresh page load. Pure function: no side effects.
  // ===========================================================================
  function decide(prev, cur, allowedId) {
    // 1. Explore (if enabled).
    if (isBlockedExplore(cur)) {
      return { action: 'redirect', to: CONFIG.REDIRECT_EXPLORE, reason: 'explore blocked' };
    }

    // 2. Reels feed: /reels/ or /reels/<id>/.
    if (CONFIG.PATHS.REELS_FEED.test(cur)) {
      const id = feedReelId(cur);
      // Came here from a reel page = a swipe in the feed-style viewer.
      if (id && prev !== null && isAnyReel(prev)) {
        return { action: 'swipe', reason: 'reel -> /reels/' + id };
      }
      // A single shared reel in feed form: open it as a single reel instead.
      if (id && CONFIG.REELS_ID_TO_SINGLE_REEL) {
        return { action: 'redirect', to: '/reel/' + id + '/', reason: 'feed reel -> single reel' };
      }
      return { action: 'redirect', to: CONFIG.REDIRECT_HOME, reason: 'reels feed blocked', swallowClick: true };
    }

    // 3. Single reel: /reel/<id>/.
    const id = singleReelId(cur);
    if (id) {
      if (id === allowedId) {
        return { action: 'allow', reason: 'same reel as allowed (' + id + ')' };
      }
      const prevId = singleReelId(prev);
      if (prevId === id) {
        return { action: 'allow', reason: 'same reel, sub-page (' + id + ')', allowReel: id };
      }
      if (prev !== null && (prevId !== null || CONFIG.PATHS.REELS_FEED.test(prev))) {
        return { action: 'swipe', reason: 'reel ' + (prevId || prev) + ' -> reel ' + id };
      }
      return { action: 'allow', reason: 'opened reel ' + id + ' from ' + (prev || 'fresh load'), allowReel: id };
    }

    // 4. Everything else is normal Instagram.
    return { action: 'allow', reason: 'normal route', clearReel: true };
  }

  // ===========================================================================
  // Route guard: applies decide() on every URL change.
  // ===========================================================================

  // Last route we accepted. On a fresh load we try the same-origin referrer, so a
  // hard reload caused by a swipe is still recognised. A /reels/ referrer is
  // ignored: we never let you stay on one, so arriving from one always means our
  // own redirect (e.g. /reels/<id>/ -> /reel/<id>/), not a swipe.
  let prevPath = null;
  // Last non-reel route, used to "exit" the reel viewer.
  let exitPath = null;
  // Set once we've called location.replace, so nothing else runs during unload.
  let leaving = false;
  // False until the first check, which must always run (even if the referrer
  // happens to equal the current path, e.g. after a reload).
  let started = false;

  (function seedFromReferrer() {
    try {
      if (!document.referrer) return;
      const ref = new URL(document.referrer);
      if (ref.origin !== location.origin) return;
      if (CONFIG.PATHS.REELS_FEED.test(ref.pathname)) return;
      prevPath = ref.pathname;
      if (!isAnyReel(ref.pathname)) exitPath = ref.pathname + ref.search;
    } catch (e) {
      /* malformed referrer: ignore */
    }
  })();

  function go(to, reason) {
    if (leaving) return;
    leaving = true;
    log('redirect ->', to, '(' + reason + ')');
    // replace(), not assign(): Back must not return to the blocked page.
    location.replace(to);
  }

  function handleSwipe(reason) {
    const allowed = getAllowedReel();
    if (CONFIG.SWIPE_ACTION === 'return' && allowed) {
      go('/reel/' + allowed + '/', 'swipe blocked, ' + reason + ', returning to allowed reel');
    } else {
      setAllowedReel(null);
      go(exitPath || CONFIG.REDIRECT_HOME, 'swipe blocked, ' + reason + ', exiting viewer');
    }
  }

  function checkRoute(source) {
    if (leaving) return;
    const cur = location.pathname;
    if (started && cur === prevPath) return; // nothing changed
    started = true;

    const verdict = decide(prevPath, cur, getAllowedReel());
    log(source + ':', prevPath, '->', cur, '=>', verdict.action, '(' + verdict.reason + ')');

    if (verdict.action === 'redirect') return go(verdict.to, verdict.reason);
    if (verdict.action === 'swipe') return handleSwipe(verdict.reason);

    // Allowed.
    if (verdict.allowReel) setAllowedReel(verdict.allowReel);
    if (verdict.clearReel) {
      setAllowedReel(null);
      exitPath = cur + location.search;
    }
    prevPath = cur;
    syncReelClass();
  }

  // Mark <html> while on a single reel so the scroll-lock CSS applies. At
  // document-start <html> may not exist yet; sweep() calls this again later.
  function syncReelClass() {
    const root = document.documentElement;
    if (root) root.classList.toggle(CONFIG.HTML_CLASS_ON_REEL, singleReelId(location.pathname) !== null);
  }

  // --- Navigation detection -------------------------------------------------
  // (a) Wrap pushState/replaceState. This only sees Instagram's own calls when the
  //     script runs in the page context; in the isolated content-script context
  //     (b)-(d) cover it.
  ['pushState', 'replaceState'].forEach(function (name) {
    const original = history[name];
    history[name] = function () {
      const result = original.apply(this, arguments);
      checkRoute(name);
      return result;
    };
  });
  // (b) Back/forward.
  window.addEventListener('popstate', function () {
    checkRoute('popstate');
  });
  // (c) Polling fallback.
  setInterval(function () {
    checkRoute('poll');
  }, CONFIG.POLL_MS);
  // (d) DOM changes (see the observer below) also trigger a cheap route check,
  //     which catches SPA navigations within one animation frame.

  // ===========================================================================
  // Click guard: stop taps on blocked links before Instagram's router sees them.
  // ===========================================================================
  window.addEventListener(
    'click',
    function (event) {
      if (leaving) return;
      const link = event.target && event.target.closest && event.target.closest('a[href]');
      if (!link || link.origin !== location.origin) return;
      const target = link.pathname;
      const verdict = decide(location.pathname, target, getAllowedReel());
      if (verdict.action === 'allow') return;

      event.preventDefault();
      event.stopImmediatePropagation();
      log('click blocked:', target, '=>', verdict.action, '(' + verdict.reason + ')');
      // Redirects like Explore -> Search are followed straight away (no flash of
      // the blocked page). A tap on a Reels-feed link or a "next reel" link just
      // does nothing.
      if (verdict.action === 'redirect' && !verdict.swallowClick) go(verdict.to, verdict.reason);
    },
    true // capture phase on window: runs before any of Instagram's handlers
  );

  // ===========================================================================
  // Hiding the Reels button
  // ===========================================================================
  function hideSelectors() {
    return CONFIG.HIDE_SELECTORS.concat(CONFIG.BLOCK_EXPLORE ? CONFIG.HIDE_SELECTORS_EXPLORE : []);
  }

  function buildCss() {
    const hide = hideSelectors().concat('[' + CONFIG.HIDDEN_ATTR + ']');
    const onReel = 'html.' + CONFIG.HTML_CLASS_ON_REEL;
    return [
      hide.join(',\n') + ' { display: none !important; }',
      // Second-layer scroll lock on single reel pages.
      onReel + ', ' + onReel + ' body { overscroll-behavior: none !important; overflow: hidden !important; }',
    ].join('\n');
  }

  // Inject the stylesheet as early as possible and re-attach it if Instagram's
  // render throws it away.
  let styleEl = null;
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = CONFIG.STYLE_ID;
      styleEl.textContent = buildCss();
    }
    parent.appendChild(styleEl);
  }

  // JS-side hiding: covers the aria-label fallback, and still works if a Content
  // Security Policy ever blocks the <style> element (inline style properties set
  // from script aren't affected by CSP).
  function hideElement(el) {
    if (el.hasAttribute(CONFIG.HIDDEN_ATTR)) return;
    el.setAttribute(CONFIG.HIDDEN_ATTR, '');
    el.style.setProperty('display', 'none', 'important');
  }

  function sweep() {
    ensureStyle();
    syncReelClass();
    document.querySelectorAll(hideSelectors().join(',')).forEach(hideElement);

    CONFIG.HIDE_ARIA_LABELS.forEach(function (label) {
      document.querySelectorAll('[aria-label="' + label + '"]').forEach(function (labelled) {
        const target = labelled.closest('a, [role="link"], button') || labelled;
        if (target.hasAttribute('href')) {
          // Resolve relative and absolute hrefs alike, then compare the path.
          let path = '';
          try {
            path = new URL(target.getAttribute('href'), location.href).pathname;
          } catch (e) {
            return;
          }
          // Some other link that happens to say "Reels", e.g. a profile's Reels tab.
          if (!CONFIG.PATHS.REELS_FEED_ROOT.test(path)) return;
        }
        hideElement(target);
      });
    });
  }

  // Batch DOM mutations into one sweep + route check per frame.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      sweep();
      checkRoute('dom');
    });
  }

  function startObserver() {
    const root = document.documentElement;
    if (!root) {
      // Extremely early: <html> doesn't exist yet. Try again shortly.
      return setTimeout(startObserver, 0);
    }
    ensureStyle();
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    schedule();
  }

  // ===========================================================================
  // Second layer: lock swipes/scrolling on single reel pages.
  // The URL guard above is the real defence; this just makes swiping feel dead.
  // ===========================================================================
  function onReelPage() {
    return singleReelId(location.pathname) !== null;
  }
  function exempt(target) {
    return target && target.closest && target.closest(CONFIG.SCROLL_LOCK_EXEMPT);
  }

  let touchStartY = 0;
  let touchStartX = 0;
  window.addEventListener(
    'touchstart',
    function (e) {
      if (e.touches.length !== 1) return;
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    'touchmove',
    function (e) {
      if (!onReelPage() || exempt(e.target) || e.touches.length !== 1) return;
      const dy = Math.abs(e.touches[0].clientY - touchStartY);
      const dx = Math.abs(e.touches[0].clientX - touchStartX);
      // Block mostly-vertical drags (how reels are swiped); leave horizontal ones alone.
      if (dy > CONFIG.SWIPE_MIN_PX && dy > dx) e.preventDefault();
    },
    { capture: true, passive: false }
  );
  window.addEventListener(
    'wheel',
    function (e) {
      if (onReelPage() && !exempt(e.target)) e.preventDefault();
    },
    { capture: true, passive: false }
  );
  window.addEventListener(
    'keydown',
    function (e) {
      if (!onReelPage() || exempt(e.target)) return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].indexOf(e.key) !== -1) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // ===========================================================================
  // Start
  // ===========================================================================
  log('loaded at', location.pathname, 'referrer path:', prevPath);
  checkRoute('load');
  startObserver();
})();
