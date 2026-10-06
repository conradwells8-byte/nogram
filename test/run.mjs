// Browser tests against a tiny fake Instagram (test/mock-instagram.html), in
// WebKit (Safari's engine) at iPhone size. Never touches the real Instagram.
//
//   npm install   (once, installs Playwright)
//   npx playwright install webkit   (once)
//   npm test
//
// Runs every scenario twice: with the script able to wrap history.pushState
// (page context, like Tampermonkey) and with the app bypassing the wrapper
// (like Userscripts' isolated content-script context), plus SWIPE_ACTION=return,
// the video lock (synthetic touch/pointer/wheel input) and the time limits.

import { webkit, chromium, devices } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';

const FULL_SRC = fs.readFileSync(new URL('../instagram-no-reels.user.js', import.meta.url), 'utf8');
// Route/lock tests run without the time limits or feed cap (the countdown would
// cover the page; the cap would stop scrolling on the home feed).
const SRC = FULL_SRC.replaceAll('ENABLED: true', 'ENABLED: false');
const MOCK = fs.readFileSync(new URL('./mock-instagram.html', import.meta.url));
// Every path serves the same single-page app, like Instagram does.
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(MOCK);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const B = 'http://127.0.0.1:' + server.address().port;
let pass = 0, failn = 0;
const check = (name, cond, extra='') => { cond ? pass++ : failn++; console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  ' + extra)); };
const settle = (page) => page.waitForTimeout(500);

async function run(label, { bypass = false, src = SRC } = {}) {
  console.log('\n== ' + label);
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  await ctx.addInitScript(`sessionStorage.setItem('bypass', '${bypass ? 1 : 0}');`);
  await ctx.addInitScript(src);
  const page = await ctx.newPage();
  const path = () => new URL(page.url()).pathname;
  const disp = (sel) => page.$eval(sel, el => getComputedStyle(el).display).catch(() => 'missing');

  await page.goto(B + '/'); await settle(page);
  check('Reels nav hidden', await disp('#nav-reels') === 'none');
  check('Explore nav still visible (it is the search entry)', await disp('#nav-explore') !== 'none');
  check('profile Reels tab still visible', await disp('#profile-tab') !== 'none');
  check('href-less button labelled Reels hidden', await disp('#labelled-btn') === 'none');
  check('content link to /reels/ hidden', await disp('#content-reels') === 'none');

  await page.goto(B + '/reels/'); await settle(page);
  check('/reels/ -> /', path() === '/', path());
  await page.goto(B + '/reels/XYZ/'); await settle(page);
  check('fresh /reels/XYZ/ -> /reel/XYZ/', path() === '/reel/XYZ/', path());

  await page.goto(B + '/direct/t/1/'); await settle(page);
  await page.click('#dm-reel-a'); await settle(page);
  check('DM reel A opens', path() === '/reel/AAA/', path());
  check('scroll-lock class on <html>', await page.evaluate(() => document.documentElement.classList.contains('nogram-on-reel')));
  await page.click('#swipe'); await settle(page);
  check('swipe A->B blocked (exit to DM thread)', path() === '/direct/t/1/', path());
  check('allowed reel cleared', await page.evaluate(() => sessionStorage.getItem('nogram.allowedReelId')) === null);

  await page.click('#dm-reel-c'); await settle(page);
  check('second DM reel C opens', path() === '/reel/CCC/', path());
  await page.click('#swipe-replace'); await settle(page);
  check('replaceState swipe blocked', path() === '/direct/t/1/', path());

  await page.click('#dm-reel-a'); await settle(page);
  await page.click('#swipe-feed'); await settle(page);
  check('swipe to /reels/BBB/ blocked', path() === '/direct/t/1/', path());

  await page.click('#dm-reel-a'); await settle(page);
  await page.click('#next-link'); await settle(page);
  check('"next reel" link click does nothing', path() === '/reel/AAA/', path());
  await page.reload(); await settle(page);
  check('reload on allowed reel stays', path() === '/reel/AAA/', path());
  await page.click('#profile'); await settle(page);
  check('reel -> profile allowed', path() === '/someone/', path());

  await page.goto(B + '/direct/t/1/'); await settle(page);
  await page.click('#dm-feed-reel'); await settle(page);
  check('DM link in /reels/<id>/ form opens as single reel', path() === '/reel/FFF/', path());

  // hard navigation reel -> reel (full page load)
  await page.goto(B + '/direct/t/2/'); await settle(page);
  await page.click('#dm-reel-a'); await settle(page);
  await page.evaluate(() => location.assign('/reel/QQQ/')); await settle(page);
  check('hard-load swipe (referrer is a reel) blocked', path() !== '/reel/QQQ/', path());

  await page.goto(B + '/'); await settle(page);
  await page.click('#nav-explore'); await settle(page);
  check('Explore tap -> /explore/search/', path() === '/explore/search/', path());
  await page.goto(B + '/explore/'); await settle(page);
  check('/explore/ -> /explore/search/', path() === '/explore/search/', path());
  await page.goto(B + '/explore/tags/cats/'); await settle(page);
  check('/explore/tags/ allowed', path() === '/explore/tags/cats/', path());
  for (const p of ['/', '/direct/inbox/', '/stories/someone/123/', '/p/abc/', '/someone/']) {
    await page.goto(B + p); await settle(page);
    check('normal route untouched: ' + p, path() === p, path());
  }
  // Back must not return to a blocked page
  await page.goto(B + '/direct/t/9/'); await settle(page);
  await page.goto(B + '/reels/'); await settle(page);
  await page.goBack(); await settle(page);
  check('Back after /reels/ redirect does not land on /reels/', !path().startsWith('/reels'), path());
  await browser.close();
}

// Synthetic gestures. Returns false if the script cancelled (preventDefault) any move.
async function swipe(page, sel, dx, dy, kind = 'touch') {
  return page.evaluate(({ sel, dx, dy, kind }) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 300);
    let notCancelled = true;
    for (let i = 0; i <= 5; i++) {
      const cx = x + (dx * i) / 5, cy = y + (dy * i) / 5;
      const type = i === 0 ? 'start' : 'move';
      if (kind === 'touch') {
        const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
        const ev = new TouchEvent('touch' + type, { bubbles: true, cancelable: true, touches: [t], changedTouches: [t] });
        notCancelled = el.dispatchEvent(ev) && notCancelled;
      } else {
        const ev = new PointerEvent(type === 'start' ? 'pointerdown' : 'pointermove', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: cx, clientY: cy });
        el.dispatchEvent(ev);
      }
    }
    if (kind === 'touch') {
      const t = new Touch({ identifier: 1, target: el, clientX: x + dx, clientY: y + dy });
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [t] }));
    } else {
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: x + dx, clientY: y + dy }));
    }
    return notCancelled;
  }, { sel, dx, dy, kind });
}

async function lockTests() {
  // Chromium here: WebKit's desktop build can't construct Touch objects for
  // synthetic finger input. The script's logic is the same in both engines.
  console.log('\n== video lock (Chromium, synthetic touch/pointer/wheel)');
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch()); // installed Chrome, else Playwright's
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  await ctx.addInitScript(SRC);
  const page = await ctx.newPage();
  const ig = () => page.evaluate(() => window.ig);

  await page.goto(B + '/direct/t/1/'); await settle(page);
  await page.click('#open-viewer'); await settle(page);
  check('pop-up reel: URL unchanged (guard cannot see it)', new URL(page.url()).pathname === '/direct/t/1/');
  const nc = await swipe(page, '#viewer-video', 0, -300);
  check('pop-up reel: up-swipe scroll is cancelled', nc === false);
  check('pop-up reel: Instagram touch handler sees no swipe', (await ig()).touchSwipes === 0, JSON.stringify(await ig()));
  await swipe(page, '#viewer-video', 0, -300, 'pointer');
  check('pop-up reel: Instagram pointer handler sees no swipe', (await ig()).pointerSwipes === 0, JSON.stringify(await ig()));
  await page.evaluate(() => document.querySelector('#viewer-video').dispatchEvent(new WheelEvent('wheel', { deltaY: 300, bubbles: true, cancelable: true })));
  check('pop-up reel: wheel blocked', (await ig()).wheelSteps === 0);
  const ncComments = await swipe(page, '#comments', 0, -100);
  check('comments panel still scrolls', ncComments === true && (await ig()).commentMoves > 0, JSON.stringify(await ig()));
  await swipe(page, '#viewer-video', 200, 0);
  check('sideways swipe still closes the pop-up', (await ig()).closed === 1, JSON.stringify(await ig()));

  await page.goto(B + '/'); await settle(page);
  check('feed video (inside <article>) not locked', (await swipe(page, '#feed-video', 0, -200)) === true);
  await page.goto(B + '/stories/someone/1/'); await settle(page);
  check('story not locked', (await swipe(page, '#story-video', 0, 200)) === true);
  await page.goto(B + '/direct/t/1/'); await settle(page);
  await page.click('#dm-reel-a'); await settle(page);
  check('/reel/ page: vertical drag cancelled', (await swipe(page, '#page', 0, -200)) === false);
  await browser.close();
}

async function timeTests() {
  console.log('\n== time limits (sped up: 2s countdown, 3.6s limit, 3s away = new sitting)');
  const src = FULL_SRC.replace(/FEED_CAP: \{\n(\s*)ENABLED: true/, 'FEED_CAP: {\n$1ENABLED: false')
    .replace('GATE_SECONDS: 10', 'GATE_SECONDS: 2')
    .replace('SESSION_LIMIT_MIN: 30', 'SESSION_LIMIT_MIN: 0.06')
    .replace('NEW_SITTING_AFTER_AWAY_MIN: 5', 'NEW_SITTING_AFTER_AWAY_MIN: 0.05');
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  await ctx.addInitScript(src);
  const page = await ctx.newPage();
  const ui = () => page.evaluate(() => {
    const kids = [...document.documentElement.children];
    const cover = kids.find(e => e.style.zIndex === '2147483647');
    const timer = kids.find(e => e.style.zIndex === '2147483646');
    return { cover: cover && cover.style.display !== 'none' ? cover.textContent : null, timer: timer && timer.style.display !== 'none' ? timer.textContent : null };
  });

  // Poll until `pred(ui)` holds, up to `ms`. Returns the last ui state seen.
  const waitUi = async (pred, ms) => {
    const end = Date.now() + ms;
    let u = await ui();
    while (!pred(u) && Date.now() < end) { await page.waitForTimeout(100); u = await ui(); }
    return u;
  };
  const kicked = (u) => /^Time's up/.test(u.cover || '');
  const gate = (u) => /Still want/.test(u.cover || '');

  await page.goto(B + '/'); await page.waitForTimeout(200);
  let u = await ui();
  check('countdown covers Instagram on open', u.cover && /^[12]Still want/.test(u.cover), JSON.stringify(u));
  check('timer hidden during countdown', u.timer === null, JSON.stringify(u));
  const t0 = Date.now();
  u = await waitUi((u) => u.cover === null, 4000);
  check('countdown gone after ~2s', u.cover === null && Date.now() - t0 > 1000, JSON.stringify(u));
  check('timer shows "m:ss · Xm today"', /^0:0\d · 0m today$/.test(u.timer || ''), JSON.stringify(u));
  await page.reload(); await page.waitForTimeout(300);
  check('reload in the same sitting: no countdown', (await ui()).cover === null, JSON.stringify(await ui()));
  u = await waitUi(kicked, 8000);
  check("Time's up screen after the limit", kicked(u), JSON.stringify(u));
  await page.reload(); await page.waitForTimeout(300);
  check("reload doesn't escape Time's up", kicked(await ui()), JSON.stringify(await ui()));
  u = await waitUi(gate, 6000);
  check('after the away period: new sitting with a fresh countdown', gate(u), JSON.stringify(u));
  u = await waitUi((u) => u.cover === null, 4000);
  check('new sitting: timer restarted', u.cover === null && /^0:0\d/.test(u.timer || ''), JSON.stringify(u));
  await browser.close();
}

async function feedTests() {
  console.log('\n== feed cap (sped up: 5 posts, 3s cooldown)');
  const src = FULL_SRC.replace(/TIME: \{\n(\s*)ENABLED: true/, 'TIME: {\n$1ENABLED: false')
    .replace('POSTS: 20', 'POSTS: 5')
    .replace('COOLDOWN_MIN: 10', 'COOLDOWN_MIN: 0.05');
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  await ctx.addInitScript(src);
  const page = await ctx.newPage();
  const state = () => page.evaluate(() => {
    const posts = [...document.querySelectorAll('article')];
    const hidden = posts.filter((p) => getComputedStyle(p).visibility === 'hidden');
    const note = [...document.documentElement.children].find((e) => / posts\. More in /.test(e.textContent || '') && e.style.display !== 'none');
    const saved = JSON.parse(localStorage.getItem('nogram.feed') || '{"seen":[]}');
    return {
      count: saved.seen.length,
      hidden: hidden.length,
      note: note ? note.textContent : null,
      wallTop: hidden[0] ? Math.round(hidden[0].getBoundingClientRect().top) : null,
      vh: innerHeight,
      scrollY: Math.round(scrollY),
    };
  });
  const scrollLots = async (dy, times) => {
    for (let i = 0; i < times; i++) { await page.evaluate((dy) => window.scrollBy(0, dy), dy); await page.waitForTimeout(40); }
    await settle(page);
  };

  await page.goto(B + '/'); await settle(page);
  let st = await state();
  check('feed: posts already in view are counted', st.count >= 1 && st.count < 5, JSON.stringify(st));
  check('feed: nothing hidden before the cap', st.hidden === 0 && st.note === null, JSON.stringify(st));
  await scrollLots(400, 40);
  st = await state();
  check('feed: stops counting at the cap', st.count === 5, JSON.stringify(st));
  check('feed: posts past the cap are hidden', st.hidden > 0, JSON.stringify(st));
  check('feed: scroll held above the first hidden post', st.wallTop !== null && st.wallTop >= st.vh - 2, JSON.stringify(st));
  check('feed: note says "That\'s 5 posts. More in …"', /^That's 5 posts\. More in 0:0\d\.$/.test(st.note || ''), JSON.stringify(st));
  const before = st.scrollY;
  await scrollLots(-300, 3);
  check('feed: can still scroll back up', (await state()).scrollY < before);

  await page.reload(); await settle(page);
  await scrollLots(400, 40);
  st = await state();
  check('feed: reload keeps the cap (no recount)', st.count === 5 && st.hidden > 0 && st.wallTop >= st.vh - 2, JSON.stringify(st));

  await page.goto(B + '/direct/inbox/'); await settle(page);
  check('feed: no note away from the home feed', (await state()).note === null);

  await page.waitForTimeout(3200);
  await page.goto(B + '/'); await settle(page);
  st = await state();
  check('feed: allowance refills after the cooldown', st.hidden === 0 && st.note === null && st.count < 5, JSON.stringify(st));
  await scrollLots(400, 40);
  st = await state();
  check('feed: capped again after another 5', st.count === 5 && st.hidden > 0, JSON.stringify(st));
  await browser.close();
}

await run('page context (wrapped pushState)');
await run('isolated context (pushState bypass -> poll/DOM fallbacks)', { bypass: true });
{
  console.log('\n== SWIPE_ACTION=return');
  const browser = await webkit.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  await ctx.addInitScript(SRC.replace("SWIPE_ACTION: 'exit'", "SWIPE_ACTION: 'return'"));
  const page = await ctx.newPage();
  const path = () => new URL(page.url()).pathname;
  await page.goto(B + '/direct/t/1/'); await settle(page);
  await page.click('#dm-reel-a'); await settle(page);
  await page.click('#swipe'); await settle(page);
  check('swipe A->B returns to reel A', path() === '/reel/AAA/', path());
  await page.click('#swipe'); await settle(page);
  check('second swipe also returns to A (no loop / no escape)', path() === '/reel/AAA/', path());
  await browser.close();
}
await lockTests();
await timeTests();
await feedTests();
server.close();
console.log(`\n${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
