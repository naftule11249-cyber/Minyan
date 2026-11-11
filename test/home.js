/* The back end's Home page: the hallway screen as it is now, and as it will be on any day. The picture is the screen itself in a frame; "Another
   day" opens it with its clock set to that day and time (?at=…), so the schedule, the zmanim and the donations shown are that day's. It shows what
   is saved on this device. Clock frozen Wed 18 Nov 2026, 9:10 AM New York = ח׳ כסלו תשפ״ז; one donation is on now and one only on 1 December. */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/', FIXED = Date.UTC(2026, 10, 18, 14, 10);
const NOTICES = [
  { title: 'פרנס חודש כסלו', name: 'מו״ה יעקב יואל פריעדמאן הי״ו', body: 'מחשובי מתפללי בית מדרשינו', size: 'big', from: '2026-11-11', to: '2026-12-10' },
  { title: 'פרנס היום', name: 'ר׳ שמואל ווייס', body: 'לרגל היארצייט', size: 'tiny', from: '2026-12-01', to: '2026-12-01' }];
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function context(viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: FIXED });
    await ctx.route('**/config.json*', async route => {
      const res = await route.fetch(); const c = JSON.parse(await res.text());
      c.notices = JSON.parse(JSON.stringify(NOTICES)); delete c.donationKinds; c.banner = { text: '', from: '', until: '' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  }
  async function admin(page) {
    await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#pin-input, #tab-home');
    if (await page.locator('#pin-input').count()) { await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); }
    await page.waitForSelector('#tab-home'); await page.waitForTimeout(300);
  }
  const tv = page => page.frameLocator('#home-tv');
  const shown = async page => { await page.waitForTimeout(400); await tv(page).locator('.aclock svg').waitFor({ timeout: 15000 }); await page.waitForTimeout(700);
    /* the screen has no line across the top: the day it shows is on the page itself (data-day), the time on the clock face */
    return { day: await tv(page).locator('#app').getAttribute('data-day'), clock: (await tv(page).locator('.aclock .dig').textContent()).trim().replace(/:\d\d$/, ''),
      sponsors: await tv(page).locator('.sponsor .t').allTextContents(), badge: await tv(page).locator('.preview-badge').count() }; };
  const facts = page => page.evaluate(() => { const o = {}; const dt = document.querySelectorAll('.home-facts dt'), dd = document.querySelectorAll('.home-facts dd'); dt.forEach((t, i) => { o[t.textContent] = dd[i].textContent; }); return o; });
  const status = page => page.locator('.abar .status').textContent();

  let { ctx, page } = await context(); await admin(page);
  ok('the back end opens on Home, with nothing marked as changed', [await page.locator('.ptitle h2').textContent(), await page.locator('#tab-home').getAttribute('aria-selected'), /Unsaved/.test(await status(page))], ['Home', 'true', false]);
  let s = await shown(page);
  ok('the picture is the hallway screen itself, live: today, this minute, with today\'s donation', [await page.locator('.home-cap').textContent(), await page.locator('#home-tv').getAttribute('data-url'), s.day, s.clock, s.sponsors, s.badge],
    ['The screen as it is right now.', 'index.html?view=display&full=1', '2026-11-18', '9:10', ['פרנס חודש כסלו'], 0]);
  ok('under it, what today holds in words', await facts(page), { 'Day': 'יום רביעי פרשת ויצא · ח׳ כסלו תשפ״ז', 'Schedule in use': 'Weekdays', 'Donations on the board': 'מו״ה יעקב יואל פריעדמאן הי״ו (פרנס חודש כסלו)' });
  ok('the frame is the TV\'s shape and fits the page', await page.evaluate(() => { const st = document.querySelector('.home-stage').getBoundingClientRect(), f = document.getElementById('home-tv'); const k = +(/scale\(([\d.]+)\)/.exec(f.style.transform) || [0, 0])[1];
    return [Math.abs(st.width / st.height - 16 / 9) < 0.06, st.right <= window.innerWidth, k > 0.3 && k < 0.6, document.documentElement.scrollWidth <= window.innerWidth]; }), [true, true, true, true]);

  /* the picture keeps to its frame whatever happens to the page around it */
  const framed = page => page.evaluate(() => { const st = document.querySelector('.home-stage'), f = document.getElementById('home-tv'), k = +(/scale\(([\d.]+)\)/.exec(f.style.transform) || [0, 0])[1], w = st.clientWidth;
    return [Math.abs(k - w / 1920) < 0.002, Math.abs(st.clientHeight - w * 9 / 16) <= 1.5, w > 200]; });
  await page.evaluate(() => { document.querySelector('.home-tv').style.width = '60%'; }); await page.waitForTimeout(350);
  ok('when the frame itself changes size (no window resize), the picture is fitted to it again', await framed(page), [true, true, true]);
  await page.evaluate(() => { document.querySelector('.home-tv').style.width = ''; }); await page.waitForTimeout(350);
  await page.click('#tab-general'); await page.evaluate(() => { const f = document.getElementById('home-tv'); f.style.transform = 'scale(1)'; }); /* as if it had been measured too early */
  await page.setViewportSize({ width: 1100, height: 900 }); await page.click('#tab-home'); await page.waitForTimeout(500);
  ok('coming back to Home after the window changed while it was out of sight, the whole screen is in the frame again', await framed(page), [true, true, true]);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(300);
  ok('the picture itself is a way to the large view, and so is the button', [await page.locator('#home-zoom').getAttribute('href'), await page.locator('#home-open').getAttribute('href'), await page.locator('#home-zoom').evaluate(e => { const r = e.getBoundingClientRect(), s = document.querySelector('.home-stage').getBoundingClientRect(); return r.width >= s.width - 20 && r.height >= s.height - 20; })],
    ['index.html?view=display&full=1', 'index.html?view=display&full=1', true]);
  ok('the picture carries no button of its own over the screen', await tv(page).locator('#fs-btn').count(), 0);

  /* another day */
  await page.click('#home-at'); s = await shown(page);
  ok('"Another day" starts at tomorrow morning: the screen\'s own clock is moved there', [await page.inputValue('#home-date'), await page.inputValue('#home-time'), await page.locator('#home-tv').getAttribute('data-url'), s.day, s.clock, await page.locator('.home-cap').textContent()],
    ['2026-11-19', '08:00', 'index.html?view=display&full=1&at=2026-11-19T08:00', '2026-11-19', '8:00', 'The screen as it will be on Thursday, Nov 19, 2026 at 8:00 AM.']);
  ok('the day is shown in Hebrew boxes and in the civil calendar, and "Tomorrow" is marked', [await page.evaluate(() => Array.from(document.querySelectorAll('.home-pick .hebpick select')).map(x => x.options[x.selectedIndex].text)), await page.locator('.home-pick .dn-civil').textContent(), await page.locator('.home-pick [data-day].on').textContent()], [['ט׳', 'כסלו', 'תשפ״ז'], 'Thursday, Nov 19, 2026', 'Tomorrow']);
  const t1 = await tv(page).locator('.aclock .dig').textContent(); await page.waitForTimeout(1300); const t2 = await tv(page).locator('.aclock .dig').textContent();
  ok('its clock runs on from that moment', [/^8:00:\d\d$/.test(t1), t1 !== t2], [true, true]);
  await page.locator('.home-pick [data-day]', { hasText: 'Shabbos' }).click(); s = await shown(page);
  ok('"Shabbos" shows this coming Shabbos, with Shabbos\'s own schedule', [await page.inputValue('#home-date'), s.day, (await facts(page))['Schedule in use'], (await facts(page))['Day']], ['2026-11-21', '2026-11-21', 'Shabbos', 'שבת קודש פרשת ויצא · י״א כסלו תשפ״ז']);
  await page.locator('.home-pick [data-day]', { hasText: 'Rosh Chodesh' }).click(); s = await shown(page);
  ok('"Rosh Chodesh" finds the next one and shows its schedule', [await page.inputValue('#home-date'), s.day, (await facts(page))['Schedule in use'], /ראש חודש/.test((await facts(page))['Day'])], ['2026-12-10', '2026-12-10', 'Rosh Chodesh', true]);
  await page.locator('.home-pick [data-time="18:00"]').click(); s = await shown(page);
  ok('"Evening" moves the time of day', [await page.inputValue('#home-time'), s.clock, await page.locator('#home-tv').getAttribute('data-url')], ['18:00', '6:00', 'index.html?view=display&full=1&at=2026-12-10T18:00']);

  /* a donation that is only on one day */
  await page.fill('#home-date', '2026-12-01'); await page.locator('#home-date').dispatchEvent('change');
  await page.locator('.home-pick [data-time="07:30"]').click(); s = await shown(page);
  ok('on the day a donation is for, the screen shows it and the words under it name it', [s.sponsors, (await facts(page))['Donations on the board'], await tv(page).locator('.sponsor.sp-xs .n').textContent()],
    [['פרנס חודש כסלו', 'פרנס היום'], 'מו״ה יעקב יואל פריעדמאן הי״ו (פרנס חודש כסלו)  ·  ר׳ שמואל ווייס (פרנס היום)', 'ר׳שמואל ווייס']);
  await page.evaluate(() => { const sel = document.querySelectorAll('.home-pick .hebpick select'); sel[0].value = '22'; sel[0].dispatchEvent(new Event('change', { bubbles: true })); });
  s = await shown(page);
  ok('choosing a Hebrew day moves the civil date and the picture with it; the next day that donation is gone', [await page.inputValue('#home-date'), s.sponsors], ['2026-12-02', ['פרנס חודש כסלו']]);
  await page.click('#home-now'); s = await shown(page);
  ok('"Now" goes back to the live screen', [await page.locator('#home-tv').getAttribute('data-url'), s.clock, await page.locator('.home-when').isVisible()], ['index.html?view=display&full=1', '9:10', false]);
  ok('looking around changed nothing: the settings are not marked as changed', /Unsaved/.test(await status(page)), false);

  /* the buttons beside the picture */
  await page.click('#home-at'); await shown(page);
  ok('"Open full size" leads to the same screen', await page.locator('#home-open').getAttribute('href'), 'index.html?view=display&full=1&at=2026-12-02T07:30');
  await page.click('#home-refresh'); await page.waitForTimeout(300);
  ok('"Refresh" loads the screen again', /at=2026-12-02T07:30&r=\d+$/.test(await page.locator('#home-tv').getAttribute('src')), true);
  await page.fill('#home-date', ''); await page.locator('#home-date').dispatchEvent('change'); await page.waitForTimeout(200);
  ok('with no day chosen it asks for one instead of breaking', await page.locator('.home-cap').textContent(), 'Choose a day and a time to see the screen then.');
  await page.locator('.home-pick [data-day]', { hasText: 'Tomorrow' }).click(); await shown(page);

  /* it shows what is saved: a change elsewhere is flagged until it is saved */
  await page.click('#tab-notices'); await page.fill('#banner-text', 'מעריב היום בשעה 6:00'); await page.click('#tab-home'); await page.waitForTimeout(300);
  ok('a change made on another page is flagged here until it is saved', [await page.locator('.home-note.warn').isVisible(), /Unsaved/.test(await status(page)), await tv(page).locator('.banner-inner').count()], [true, true, 0]);
  await page.click('.abar .btn.primary'); await page.waitForTimeout(900); await page.click('#home-now'); s = await shown(page);
  ok('after Save the picture carries it, and the flag is gone', [await tv(page).locator('.banner-inner').textContent(), await page.locator('.home-note.warn').isVisible(), (await facts(page))['Banner']], ['מעריב היום בשעה 6:00', false, 'מעריב היום בשעה 6:00']);
  ok('a Save keeps the gabbai on Home', await page.locator('#tab-home').getAttribute('aria-selected'), 'true');

  /* browsing the donations does not mark anything as changed either */
  await page.click('#tab-donations'); await page.click('[data-filter="soon"]'); await page.fill('#dn-search', 'ווייס'); await page.selectOption('#dn-sort', 'new');
  await page.click('#dn-add'); await page.waitForTimeout(200); await page.click('#dn-cancel'); await page.waitForTimeout(150);
  ok('searching, filtering and opening the donation form without saving leave the settings unchanged', /Unsaved/.test(await status(page)), false);
  await ctx.close();

  /* the board itself with ?at= */
  ({ ctx, page } = await context({ width: 1920, height: 1080 }));
  await page.goto(BASE + 'index.html?view=display&full=1&at=2026-12-01T07:30', { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
  ok('opened by itself, a dated screen says plainly that it is a preview, and of when', [await page.locator('.preview-badge').textContent(), (await page.locator('.aclock .dig').textContent()).trim().replace(/:\d\d$/, ''), await page.locator('.sponsor .t').allTextContents()], ['תצוגה מקדימה · כ״א כסלו תשפ״ז · 7:30', '7:30', ['פרנס חודש כסלו', 'פרנס היום']]);
  for (const [at, clock] of [['2027-03-20T08:00', '8:00'], ['2027-07-04T20:30', '8:30'], ['2026-11-19', '9:10']]) {
    await page.goto(BASE + 'index.html?view=display&full=1&at=' + at, { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
    ok('?at=' + at + ' lands on that day at that hour by the shul\'s clock, summer time or winter', [(await page.locator('.aclock .dig').textContent()).trim().replace(/:\d\d$/, ''), await page.locator('#app').getAttribute('data-day')], [clock, at.slice(0, 10)]);
  }
  for (const bad of ['2026-13-45T99:99', 'tomorrow', '2026-11-19T25:00']) {
    await page.goto(BASE + 'index.html?view=display&full=1&at=' + bad, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
    ok('?at=' + bad + ' is not a moment: the screen stays on today, with no preview mark', [(await page.locator('.aclock .dig').textContent()).trim().replace(/:\d\d$/, ''), await page.locator('#app').getAttribute('data-day'), await page.locator('.preview-badge').count()], ['9:10', '2026-11-18', 0]);
  }
  await page.goto(BASE + 'index.html?view=display&full=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
  ok('the screen without ?at= has no preview mark', await page.locator('.preview-badge').count(), 0);
  await ctx.close();
  ({ ctx, page } = await context({ width: 390, height: 780 }));
  await page.goto(BASE + 'index.html?at=2026-12-01T07:30', { waitUntil: 'networkidle' }); await page.waitForTimeout(700);
  ok('the phone board takes ?at= as well', [await page.locator('.preview-badge').count(), /כ״א כסלו/.test(await page.locator('.top').textContent())], [1, true]);
  /* Home on a phone */
  await admin(page); await page.waitForTimeout(600);
  ok('on a phone Home fits, the picture straight after the buttons', await page.evaluate(() => { const st = document.querySelector('.home-stage').getBoundingClientRect(), bar = document.querySelector('.home-bar').getBoundingClientRect(), cap = document.querySelector('.home-cap').getBoundingClientRect();
    return [document.documentElement.scrollWidth <= window.innerWidth, st.left >= 0 && st.right <= window.innerWidth, st.top >= bar.bottom - 1 && cap.top >= st.bottom - 1]; }), [true, true, true]);
  await page.click('#home-at'); await page.waitForTimeout(500);
  ok('and the day and time boxes come under it, their buttons big enough for a thumb', await page.evaluate(() => { const st = document.querySelector('.home-stage').getBoundingClientRect(), w = document.querySelector('.home-when').getBoundingClientRect(), b = Array.from(document.querySelectorAll('.home-when .dn-chip')).map(e => e.getBoundingClientRect());
    return [w.top >= st.bottom - 1, b.every(r => r.height >= 40 && r.right <= window.innerWidth + 1)]; }), [true, true]);
  await page.screenshot({ path: 'test/shot-home-phone.png' });
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILING' : 'home: all good');
  if (fails || errors.length) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
