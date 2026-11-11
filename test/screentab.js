/* The back end's Hallway screen page, and what it does to the screen itself. The background and the boxes are set a step darker or
   lighter at a time (a lit screen never looks the colour it was given, so they are tuned in front of the TV); the line across the top
   is a switch, off unless asked for. Each look's starting colours in the back end must be the ones the stylesheet gives the screen.
   Clock frozen Wed 18 Nov 2026, 9:10 AM New York. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/', FIXED = Date.UTC(2026, 10, 18, 14, 10);
const NOTICES = [{ title: 'פרנס חודש כסלו', name: 'מו״ה יעקב יואל פריעדמאן הי״ו', body: 'מחשובי מתפללי בית מדרשינו', size: 'big', from: '2026-11-11', to: '2026-12-10' }];
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
  await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: FIXED });
  await ctx.route('**/config.json*', async route => {
    const res = await route.fetch(); const c = JSON.parse(await res.text());
    c.notices = JSON.parse(JSON.stringify(NOTICES)); delete c.donationKinds; delete c.wallLook; delete c.wallTopBar; c.palette = 'hallway'; c.banner = { text: '', from: '', until: '' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
  });
  const watch = page => { page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); }); return page; };
  const page = watch(await ctx.newPage()), tv = watch(await ctx.newPage());
  async function admin() {
    await page.bringToFront();
    await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#pin-input, #tab-home');
    if (await page.locator('#pin-input').count()) { await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); }
    await page.waitForSelector('#tab-home'); await page.waitForTimeout(300);
    await page.click('#tab-screen'); await page.waitForTimeout(200);
  }
  const rows = () => page.locator('.shade').evaluateAll(rs => rs.map(r => [r.querySelector('.swname').textContent, r.querySelector('.shade-state').textContent, r.querySelector('input[type=color]').value, r.querySelector('input[type=checkbox]').checked]));
  const status = () => page.locator('.abar .status').textContent();
  const save = async () => { await page.click('.abar .btn.primary'); await page.waitForTimeout(900); };
  /* the screen itself, as a second tab of the same browser: what is saved here is what it shows */
  async function screen() {
    await tv.bringToFront(); await tv.setViewportSize({ width: 1920, height: 1080 });
    await tv.goto(BASE + 'index.html?view=display&full=1', { waitUntil: 'networkidle' }); await tv.locator('.aclock svg').waitFor({ timeout: 15000 }); await tv.waitForTimeout(500);
    return tv.evaluate(() => {
      const hex = c => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); return m ? '#' + [1, 2, 3].map(i => (+m[i] < 16 ? '0' : '') + (+m[i]).toString(16)).join('') : c; };
      const bg = e => hex(getComputedStyle(e).backgroundColor), q = s => document.querySelector(s);
      return { page: bg(document.body), frame: bg(q('.wall section.tefilla')), next: bg(q('.wall > .wcol > section.next')), sponsor: q('.wall .sponsor') ? getComputedStyle(q('.wall .sponsor')).backgroundImage === 'none' ? bg(q('.wall .sponsor')) : 'gradient' : null,
        line: hex(getComputedStyle(q('.wall section.tefilla')).borderTopColor), top: document.querySelectorAll('header.top').length, noTop: q('#app').classList.contains('no-top'),
        fits: Array.from(document.querySelectorAll('main.wall > .wcol')).every(c => c.scrollHeight - c.clientHeight <= 1) && document.documentElement.scrollHeight <= window.innerHeight };
    });
  }

  await admin();
  ok('the page opens with the look\'s own colours for the background, the boxes and their line', await rows(),
    [['The background', 'The look\'s own colour', '#baaf9b', false], ['The boxes', 'The look\'s own colour', '#ddd5c4', false], ['The line around the boxes', 'The look\'s own colour', '#a59880', false]]);
  let s = await screen();
  ok('those are the very colours the screen has: stone behind, a lighter stone for every box, no top line', [s.page, s.frame, s.next, s.sponsor, s.line, s.top, s.noTop, s.fits], ['#baaf9b', '#ddd5c4', '#ddd5c4', 'gradient', '#a59880', 0, true, true]);

  /* a step at a time */
  await page.bringToFront();
  await page.click('#w-pageBg-darker'); await page.click('#w-pageBg-darker'); await page.waitForTimeout(350); /* the sample fades to its new colour */
  ok('Darker, twice: the background is two steps deeper, it is marked as the gabbai\'s own, and the change is flagged', [(await rows())[0], /Unsaved/.test(await status()), await page.locator('.shade-chip').first().evaluate(e => getComputedStyle(e).backgroundColor)],
    [['The background', 'Your own colour', '#a49b89', true], true, 'rgb(164, 155, 137)']);
  await page.click('#w-pageBg-lighter'); await page.click('#w-pageBg-lighter');
  ok('Lighter, twice, comes back to exactly where it started', (await rows())[0][2], '#baaf9b');
  for (let i = 0; i < 5; i++) await page.click('#w-pageBg-lighter');
  for (let i = 0; i < 6; i++) await page.click('#w-pageBg-darker');
  ok('five lighter and six darker is one step darker, to the digit', (await rows())[0][2], '#afa592');
  await page.click('#w-frameBg-darker');
  await save();
  s = await screen();
  ok('after Save the screen wears them: the page a step darker, and the frames, the next-minyan panel and the sponsor panel all the one box colour', [s.page, s.frame, s.next, s.sponsor, s.fits], ['#afa592', '#d0c8b8', '#d0c8b8', '#d0c8b8', true]);
  await admin();
  ok('opened again, the back end shows what was saved, as the gabbai\'s own colours', [(await rows()).map(r => [r[1], r[2], r[3]]), /Unsaved/.test(await status())],
    [[['Your own colour', '#afa592', true], ['Your own colour', '#d0c8b8', true], ['The look\'s own colour', '#a59880', false]], false]);
  await page.fill('#w-frameLine', '#806040');
  ok('any colour at all can be chosen from the colour box, the line around the boxes included', [(await rows())[2], /Unsaved/.test(await status())], [['The line around the boxes', 'Your own colour', '#806040', true], true]);
  await save(); s = await screen();
  ok('the line colour reaches the screen too', s.line, '#806040');
  await admin();
  await page.click('#w-base-reset');
  ok('"Back to the look\'s own colours" clears the three', [(await rows()).map(r => [r[1], r[2], r[3]]), /Unsaved/.test(await status())],
    [[['The look\'s own colour', '#baaf9b', false], ['The look\'s own colour', '#ddd5c4', false], ['The look\'s own colour', '#a59880', false]], true]);
  await save(); s = await screen();
  ok('and after Save the screen is back in the look\'s own stone', [s.page, s.frame, s.next, s.sponsor, s.line], ['#baaf9b', '#ddd5c4', '#ddd5c4', 'gradient', '#a59880']);

  /* every look: the back end starts from the colours the stylesheet gives the screen */
  for (const look of ['shul', 'classic', 'contrast', 'hallway']) {
    await admin();
    await page.click('#tab-general'); await page.selectOption('#f-palette', look); await page.click('#tab-screen'); await page.waitForTimeout(150);
    const r = await rows();
    await save(); s = await screen();
    ok('the ' + look + ' look: the back end\'s starting colours are the ones the screen really has', [r[0][2], r[1][2], r[2][2], r.map(x => x[3])], [s.page, s.frame, s.line, [false, false, false]]);
  }

  /* the top line */
  await admin();
  ok('the top line is off unless asked for', [await page.isChecked('#w-topbar'), s.top, s.noTop], [false, 0, true]);
  await page.check('#w-topbar');
  ok('ticking it is a change to save', /Unsaved/.test(await status()), true);
  await save(); s = await screen();
  ok('with it on, the screen has the line again: the day, the date and the running time, and everything still fits', [s.top, s.noTop, s.fits, await tv.locator('.top .dayline').textContent(), /^9:1\d$/.test((await tv.locator('.top .clock .hm').textContent()).trim())], [1, false, true, 'יום רביעי פרשת ויצא', true]);
  await admin();
  ok('the back end remembers that it is on', await page.isChecked('#w-topbar'), true);
  await page.uncheck('#w-topbar'); await save(); s = await screen();
  ok('and off again takes it away; the time stays on the clock face', [s.top, s.noTop, /^9:1\d:\d\d$/.test(await tv.locator('.aclock .dig').textContent())], [0, true, true]);

  /* buttons that change something by themselves count as a change, and do it without an error */
  await admin();
  await page.locator('#w-next-template').scrollIntoViewIfNeeded();
  await page.locator('.chips-row .btn', { hasText: '{room}' }).click();
  ok('a button that writes into the page (a piece for the next-minyan panel) marks the page as changed', [/Unsaved/.test(await status()), /\{room\}/.test(await page.inputValue('#w-next-template'))], [true, true]);

  /* on a phone */
  await page.setViewportSize({ width: 390, height: 844 }); await admin();
  ok('on a phone the rows fit: no sideways scrolling, the buttons big enough for a thumb', await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.shade-acts .btn')).map(e => e.getBoundingClientRect());
    return [document.documentElement.scrollWidth <= window.innerWidth, b.length, b.every(r => r.height >= 40 && r.left >= 0 && r.right <= window.innerWidth)]; }), [true, 4, true]);

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
