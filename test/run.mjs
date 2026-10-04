// Browser tests against a tiny fake Instagram (test/mock-instagram.html), in
// WebKit (Safari's engine) at iPhone size. Never touches the real Instagram.
//
//   npm install   (once, installs Playwright)
//   npx playwright install webkit   (once)
//   npm test
//
// Runs every scenario twice: with the script able to wrap history.pushState
// (page context, like Tampermonkey) and with the app bypassing the wrapper
// (like Userscripts' isolated content-script context), plus SWIPE_ACTION=return.

import { webkit, devices } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';

const SRC = fs.readFileSync(new URL('../instagram-no-reels.user.js', import.meta.url), 'utf8');
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
server.close();
console.log(`\n${pass} passed, ${failn} failed`);
process.exit(failn ? 1 : 0);
