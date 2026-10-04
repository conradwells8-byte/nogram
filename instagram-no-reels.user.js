// ==UserScript==
// @name         NOGRAM: Instagram without Reels
// @namespace    https://github.com/conradwells8-byte/nogram
// @version      1.0.1
// @description  Instagram on the web, minus Reels browsing, plus a timer, an entry countdown and a time limit. Single reels sent in DMs still open; swiping to the next one doesn't.
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
 * Stored on this device only:
 *   - sessionStorage: the ID of the one reel you're currently allowed to watch
 *   - localStorage:   time spent (this sitting, today) for the timer and limits
 *
 * How it works, in layers:
 *   1. CSS injected at document-start hides the Reels nav button before it can paint.
 *   2. A MutationObserver re-hides it whenever Instagram re-renders the DOM.
 *   3. A route guard watches every URL change and redirects away from blocked routes.
 *   4. A capture-phase click guard stops taps on blocked links before Instagram sees them.
 *   5. A video lock: while a reel (or any full-screen video) is on screen, up/down
 *      scrolling and swiping are blocked from the first pixel.
 *   6. Time limits: an entry countdown, an on-screen timer and a "Time's up" screen.
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
      // (/reels/audio/... is an audio page full of reels, not a reel id.)
      REELS_FEED_WITH_ID: /^\/reels\/(?!audio\/)([A-Za-z0-9_-]+)\/?$/,
      // Single reel: /reel/<id>/ (and sub-pages like /reel/<id>/comments/). Group 1 = id.
      SINGLE_REEL: /^\/reel\/([A-Za-z0-9_-]+)/,
      // Explore and everything under it...
      EXPLORE: /^\/explore(\/|$)/,
      // ...except these, which are search and its results.
      EXPLORE_ALLOWED: /^\/explore\/(search|tags|locations)(\/|$)/,
      // Where the video lock never applies (stories have their own swipe-down-to-close).
      NO_VIDEO_LOCK: /^\/stories\//,
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

    // --- Video lock ---------------------------------------------------------
    // While a reel or any other full-screen video is on screen, up/down
    // scrolling and swiping are blocked. Taps, sideways swipes and Safari's
    // swipe-back still work. A <video> at least this tall (fraction of the
    // screen height) counts as full-screen...
    VIEWER_VIDEO_MIN_HEIGHT: 0.75,
    // ...unless it's inside one of these (a normal feed post).
    FEED_POST_SELECTOR: 'article',
    // Touches that start inside these are never locked. Scrolling panels that
    // don't contain the video (like the comments sheet) are also left alone.
    VIDEO_LOCK_EXEMPT: 'textarea, input, [contenteditable="true"]',

    // --- Time limits ----------------------------------------------------------
    // A "sitting" starts when you open Instagram and ends once it has been off
    // screen for NEW_SITTING_AFTER_AWAY_MIN minutes. Only on-screen time counts.
    TIME: {
      ENABLED: true,
      GATE_SECONDS: 10, // countdown before Instagram appears, at the start of each sitting (0 = off)
      SESSION_LIMIT_MIN: 30, // "Time's up" screen after this long in one sitting (0 = off)
      NEW_SITTING_AFTER_AWAY_MIN: 5, // away this long = new sitting; also how long "Time's up" lasts
      SHOW_TIMER: true, // small timer at the top: "this sitting · today"
      WARN_LAST_MIN: 5, // timer turns amber this close to the limit
      // Where the timer sits. Plain CSS; it never blocks taps.
      TIMER_CSS: 'top: calc(env(safe-area-inset-top, 0px) + 4px); left: 50%; transform: translateX(-50%);',
    },

    // --- Timings ------------------------------------------------------------
    POLL_MS: 250, // fallback check of location.pathname

    // --- Internals ----------------------------------------------------------
    STORAGE_KEY: 'nogram.allowedReelId', // sessionStorage: the reel you may watch
    TIME_STORAGE_KEY: 'nogram.time', // localStorage: time spent (see TIME)
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
    if (CONFIG.TIME.ENABLED) render(timeState, Date.now()); // re-attach if a re-render removed it
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
  // Video lock: no up/down while a reel or other full-screen video is on screen.
  // This works from what's on screen, not the URL, so it also covers a reel that
  // opens as a pop-up over DMs without changing the address. Taps, sideways
  // swipes and Safari's swipe-back gesture still work.
  // ===========================================================================
  function onReelPage() {
    return singleReelId(location.pathname) !== null;
  }

  /** A visible video big enough to be a full-screen viewer (not a feed post), or null. */
  function viewerVideo() {
    const minHeight = window.innerHeight * CONFIG.VIEWER_VIDEO_MIN_HEIGHT;
    const videos = document.querySelectorAll('video');
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      if (video.closest(CONFIG.FEED_POST_SELECTOR)) continue;
      const r = video.getBoundingClientRect();
      if (r.height >= minHeight && r.bottom > 0 && r.top < window.innerHeight) return video;
    }
    return null;
  }

  /** Nearest scrollable element at or above `el`, not counting the page itself. */
  function scrollableAncestor(el) {
    for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
    }
    return null;
  }

  /** Should up/down input that starts on `target` be blocked right now? */
  function lockApplies(target) {
    if (!target || !target.closest) return false;
    if (CONFIG.PATHS.NO_VIDEO_LOCK.test(location.pathname)) return false;
    if (target.closest(CONFIG.VIDEO_LOCK_EXEMPT)) return false;
    const video = viewerVideo();
    if (!video && !onReelPage()) return false; // not watching anything
    // A scrolling panel that doesn't hold the video (e.g. comments) stays scrollable.
    const scroller = scrollableAncestor(target);
    if (scroller && !(video && scroller.contains(video))) return false;
    return true;
  }

  // One finger gesture at a time. The direction is decided on the very first
  // movement, before Safari or Instagram can commit to a scroll or a swipe.
  const gesture = { locked: false, axis: null, x: 0, y: 0, target: null, touch: null, pointerId: 1, cancelled: false };

  function startGesture(target, x, y) {
    gesture.locked = lockApplies(target);
    gesture.axis = null;
    gesture.x = x;
    gesture.y = y;
    gesture.target = target;
    gesture.cancelled = false;
  }

  function isVertical(x, y) {
    if (gesture.axis === null) {
      const dx = Math.abs(x - gesture.x);
      const dy = Math.abs(y - gesture.y);
      if (dx === 0 && dy === 0) return false;
      gesture.axis = dy >= dx ? 'y' : 'x';
    }
    return gesture.axis === 'y';
  }

  // Instagram saw the finger go down but never saw it move. Tell it the gesture
  // was cancelled so it resets (e.g. doesn't stay paused from hold-to-pause).
  function cancelForInstagram() {
    if (gesture.cancelled || !gesture.target) return;
    gesture.cancelled = true;
    const target = gesture.target;
    try {
      target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: gesture.pointerId, pointerType: 'touch', isPrimary: true }));
    } catch (e) {
      /* PointerEvent constructor unavailable */
    }
    try {
      const touches = gesture.touch ? [gesture.touch] : [];
      target.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true, changedTouches: touches }));
    } catch (e) {
      /* TouchEvent constructor unavailable (desktop) */
    }
  }

  const active = { capture: true, passive: false };

  window.addEventListener(
    'pointerdown',
    function (e) {
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      gesture.pointerId = e.pointerId;
      startGesture(e.target, e.clientX, e.clientY);
    },
    active
  );
  window.addEventListener(
    'touchstart',
    function (e) {
      if (e.touches.length !== 1) {
        gesture.locked = false; // pinch-zoom etc. is never blocked
        return;
      }
      gesture.touch = e.touches[0];
      startGesture(e.target, e.touches[0].clientX, e.touches[0].clientY);
    },
    active
  );
  window.addEventListener(
    'touchmove',
    function (e) {
      if (!gesture.locked) return;
      // No native scrolling at all while locked, from the first pixel.
      if (e.cancelable) e.preventDefault();
      // And Instagram's own swipe code never hears about up/down movement.
      const t = e.touches[0];
      if (t && isVertical(t.clientX, t.clientY)) e.stopImmediatePropagation();
    },
    active
  );
  window.addEventListener(
    'pointermove',
    function (e) {
      if (!gesture.locked || e.pointerType !== 'touch') return;
      if (isVertical(e.clientX, e.clientY)) e.stopImmediatePropagation();
    },
    active
  );
  // At the end of an up/down gesture, swallow the release (its position would
  // read as a swipe) and send Instagram a cancel instead.
  ['touchend', 'pointerup'].forEach(function (type) {
    window.addEventListener(
      type,
      function (e) {
        if (type === 'pointerup' && e.pointerType !== 'touch') return;
        if (!gesture.locked || gesture.axis !== 'y') return;
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
        cancelForInstagram();
      },
      active
    );
  });
  // Mouse wheel / trackpad (desktop).
  window.addEventListener(
    'wheel',
    function (e) {
      if (!lockApplies(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    active
  );
  // Arrow keys / Page Up / Page Down (desktop).
  window.addEventListener(
    'keydown',
    function (e) {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].indexOf(e.key) === -1) return;
      if (!lockApplies(e.target === document.body ? document.documentElement : e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );

  // ===========================================================================
  // Time limits: entry countdown, on-screen timer, "Time's up" screen.
  // ===========================================================================
  const TIME = CONFIG.TIME;
  const MINUTE = 60 * 1000;
  const AWAY_MS = TIME.NEW_SITTING_AFTER_AWAY_MIN * MINUTE;
  const LIMIT_MS = TIME.SESSION_LIMIT_MIN * MINUTE;

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // The saved state. Kept in memory too, in case localStorage is unavailable.
  //   day / dayMs   : today's date and on-screen time today
  //   sittingMs     : on-screen time this sitting
  //   lastActive    : when Instagram was last on screen (or when you were kicked)
  //   gateDone      : countdown finished for this sitting
  //   kicked        : "Time's up" for this sitting
  let timeState = { day: todayKey(), dayMs: 0, sittingMs: 0, lastActive: 0, gateDone: false, kicked: false };

  function loadTime() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.TIME_STORAGE_KEY));
      if (saved && typeof saved === 'object') timeState = saved; // picks up other tabs too
    } catch (e) {
      /* unavailable or corrupt: keep the in-memory copy */
    }
    return timeState;
  }
  function saveTime(state) {
    timeState = state;
    try {
      localStorage.setItem(CONFIG.TIME_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* unavailable: in-memory only */
    }
  }

  let gateLeftMs = TIME.GATE_SECONDS * 1000; // countdown runs in memory: a reload restarts it
  let lastTick = Date.now();
  let blocking = false; // countdown or "Time's up" screen showing

  function tick() {
    const now = Date.now();
    const dt = Math.min(now - lastTick, 2000); // ignore gaps (sleep, background throttling)
    lastTick = now;
    const s = loadTime();

    if (s.day !== todayKey()) {
      s.day = todayKey();
      s.dayMs = 0;
    }
    if (now - s.lastActive > AWAY_MS) {
      // Away long enough: a new sitting. Timer resets, countdown again, any kick is over.
      if (s.lastActive) log('new sitting');
      s.sittingMs = 0;
      s.kicked = false;
      s.gateDone = TIME.GATE_SECONDS <= 0;
      gateLeftMs = TIME.GATE_SECONDS * 1000;
    }

    if (document.visibilityState === 'visible' && !s.kicked) {
      if (!s.gateDone) {
        gateLeftMs -= dt;
        if (gateLeftMs <= 0) {
          s.gateDone = true;
          log('countdown finished');
        }
      } else {
        s.sittingMs += dt;
        s.dayMs += dt;
        if (LIMIT_MS > 0 && s.sittingMs >= LIMIT_MS) {
          s.kicked = true;
          log('time limit reached');
        }
      }
      s.lastActive = now; // while kicked this stops, so the lockout counts down
    }

    saveTime(s);
    render(s, now);
  }

  // --- On-screen elements ----------------------------------------------------
  // Styled from script (not the <style> tag) so a Content Security Policy can't
  // block them. Attached to <html>, outside Instagram's own render tree.
  let curtain = null; // full-screen cover: countdown / "Time's up"
  let curtainBig = null;
  let curtainSmall = null;
  let timer = null;

  function makeEl(css, parent) {
    const el = document.createElement('div');
    el.style.cssText = css;
    if (parent) parent.appendChild(el);
    return el;
  }

  function ensureTimeUi() {
    const root = document.documentElement;
    if (!root) return false;
    if (!curtain) {
      curtain = makeEl(
        'position: fixed; inset: 0; z-index: 2147483647; display: none; flex-direction: column;' +
          'align-items: center; justify-content: center; gap: 12px; background: #000; color: #fff;' +
          'font: 500 17px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: center;' +
          'padding: 24px; touch-action: none; user-select: none; -webkit-user-select: none;'
      );
      curtainBig = makeEl('font-size: 72px; font-weight: 200; font-variant-numeric: tabular-nums;', curtain);
      curtainSmall = makeEl('opacity: 0.7; max-width: 22em;', curtain);
      timer = makeEl(
        'position: fixed; z-index: 2147483646; display: none; pointer-events: none;' +
          'padding: 2px 9px; border-radius: 999px; background: rgba(0,0,0,0.6); color: #fff;' +
          'font: 600 11px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;' +
          'font-variant-numeric: tabular-nums; letter-spacing: 0.02em;' +
          TIME.TIMER_CSS
      );
    }
    if (!curtain.isConnected) root.appendChild(curtain);
    if (!timer.isConnected) root.appendChild(timer);
    return true;
  }

  function clock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function hoursMinutes(ms) {
    const m = Math.floor(ms / MINUTE);
    return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function render(s, now) {
    if (!ensureTimeUi()) return;
    blocking = !s.gateDone || s.kicked;

    if (s.kicked) {
      curtainBig.textContent = "Time's up";
      curtainBig.style.fontSize = '40px';
      curtainSmall.textContent =
        "That's " + TIME.SESSION_LIMIT_MIN + ' minutes. Instagram is back in ' + clock(s.lastActive + AWAY_MS - now) + '.';
    } else if (!s.gateDone) {
      curtainBig.textContent = String(Math.max(1, Math.ceil(gateLeftMs / 1000)));
      curtainBig.style.fontSize = '72px';
      curtainSmall.textContent = 'Still want to open Instagram?';
    }
    curtain.style.display = blocking ? 'flex' : 'none';
    if (blocking) pauseAllVideos();

    timer.style.display = TIME.SHOW_TIMER && !blocking ? 'block' : 'none';
    timer.textContent = clock(s.sittingMs) + ' · ' + hoursMinutes(s.dayMs) + ' today';
    const warn = LIMIT_MS > 0 && LIMIT_MS - s.sittingMs <= TIME.WARN_LAST_MIN * MINUTE;
    timer.style.background = warn ? 'rgba(214,120,0,0.9)' : 'rgba(0,0,0,0.6)';
  }

  function pauseAllVideos() {
    document.querySelectorAll('video').forEach(function (v) {
      v.pause();
    });
  }

  if (TIME.ENABLED) {
    // Nothing plays behind the countdown / "Time's up" screen.
    window.addEventListener(
      'play',
      function (e) {
        if (blocking && e.target && e.target.pause) e.target.pause();
      },
      true
    );
    // Coming back to the tab: re-check straight away (it may be a new sitting).
    document.addEventListener('visibilitychange', tick);
    setInterval(tick, 1000);
  }

  // ===========================================================================
  // Start
  // ===========================================================================
  log('loaded at', location.pathname, 'referrer path:', prevPath);
  checkRoute('load');
  if (CONFIG.TIME.ENABLED) tick(); // show the countdown before Instagram can paint
  startObserver();
})();
