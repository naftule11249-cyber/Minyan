/* More of the hallway screen's settings: listing the next few and the last few by number, the back end's "On the screen now" box,
   marking the next minyan only shortly before it starts, what the countdown runs to, and how long a page stays when a frame turns
   pages. The schedule is the check's own. Wed 18 Nov 2026, New York:
     שחרית 7:45 לב אהרן · 8:00 דברי יואל · 8:02 ברך משה · 8:30 שלמה יודא · 9:00 דברי יואל · 9:30 ברך משה · 10:00 לב אהרן   (הודו ten minutes after each)
     מנחה 1:30 ברך משה · 2:00 דברי יואל        מעריב 6:00 ברך משה */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8790/';
const at = (h, m, s) => Date.UTC(2026, 10, 18, h + 5, m, s || 0);
const SHACHARIS = '07:45 לב אהרן\n08:00 דברי יואל\n08:02 ברך משה\n08:30 שלמה יודא\n09:00 דברי יואל\n09:30 ברך משה\n10:00 לב אהרן';
(async () => {
  const browser = await chromium.launch(); const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function context(when, more, viewport, locale) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1920, height: 1080 }, locale: locale || 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed: when });
    await ctx.route('**/config.json*', async route => {
      const res = await route.fetch(); const c = JSON.parse(await res.text());
      c.schedules.weekday.shacharis = SHACHARIS; c.schedules.weekday.mincha = '13:30 ברך משה\n14:00 דברי יואל'; c.schedules.weekday.maariv = '18:00 ברך משה';
      c.rolls = []; c.overrides = []; c.notices = []; c.banner = { text: '', from: '', until: '' }; c.nextTemplate = ''; c.bigTime = 'start'; c.nowMinutes = 20;
      ['nextPanel', 'nextHold', 'nextMark', 'pageSeconds', 'countTo', 'wallWindow'].forEach(k => delete c[k]);
      Object.assign(c, typeof more === 'function' ? more(c) : more || {});
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c) });
    });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource|favicon/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  }
  const screen = async page => { await page.goto(BASE + 'index.html?view=display&full=1', { waitUntil: 'networkidle' }); await page.locator('.aclock svg').waitFor({ timeout: 15000 }); await page.waitForTimeout(500); };
  const lists = page => page.evaluate(() => { const out = {}; document.querySelectorAll('.wall section.tefilla:not(.zcard)').forEach(card => { let name = card.querySelector('h3').textContent.replace(/[●○ ]+$/, '');
    const subs = card.querySelectorAll('.sub'); if (!subs.length) out[name] = Array.from(card.querySelectorAll('.tile .time')).map(t => t.textContent);
    else { let cur = null; Array.from(card.children).forEach(ch => { if (ch.classList.contains('sub')) { cur = ch.textContent; out[cur] = []; } else if (cur && ch.classList.contains('grid')) out[cur] = out[cur].concat(Array.from(ch.querySelectorAll('.tile .time')).map(t => t.textContent)); }); } }); return out; });
  const panel = page => page.evaluate(() => { const p = document.querySelector('.wall > .wcol > section.next'); return p ? { head: p.querySelector('h2').textContent, room: (p.querySelector('.rm') || {}).textContent, time: (p.querySelector('.time') || {}).textContent, count: (p.querySelector('.count') || {}).textContent || null } : null; });
  const fits = page => page.evaluate(() => Array.from(document.querySelectorAll('main.wall > .wcol')).every(c => c.scrollHeight - c.clientHeight <= 1) && document.documentElement.scrollHeight <= window.innerHeight);
  let ctx, page;

  /* ---- the next few and the last few, by number ---- */
  ({ ctx, page } = await context(at(8, 5)));
  await screen(page);
  ok('left as it is, the screen lists the whole day', await lists(page), { 'מניני שחרית': ['7:45', '8:00', '8:02', '8:30', '9:00', '9:30', '10:00'], 'מנחה': ['1:30', '2:00'], 'מעריב': ['6:00'] });
  await ctx.close();
  ({ ctx, page } = await context(at(8, 5), { wallWindow: { mode: 'count', next: 2, recent: 1, neverEmpty: true } }));
  await screen(page);
  ok('told "the next 2 and the last 1", at 8:05 each tefilla shows just those: the one that started last and the two to come', [await lists(page), await fits(page)], [{ 'מניני שחרית': ['8:02', '8:30', '9:00'], 'מנחה': ['1:30', '2:00'], 'מעריב': ['6:00'] }, true]);
  ok('the next one is marked and the started one keeps its "now" look', [await page.locator('.wall .tile.next .time').textContent(), await page.locator('.wall .tile.prev .time').textContent()], ['8:30', '8:02']);
  await ctx.close();
  ({ ctx, page } = await context(at(8, 5), { wallWindow: { mode: 'count', next: 3, recent: 0, neverEmpty: true } }));
  await screen(page);
  ok('with none of the started ones kept, only what is still to come', (await lists(page))['מניני שחרית'], ['8:30', '9:00', '9:30']);
  await ctx.close();
  ({ ctx, page } = await context(at(10, 5), { wallWindow: { mode: 'count', next: 2, recent: 1, neverEmpty: true } }));
  await screen(page);
  ok('when a tefilla has none left to come, "never leave the screen empty" keeps its last one up', (await lists(page))['מניני שחרית'], ['10:00']);
  await ctx.close();
  ({ ctx, page } = await context(at(10, 5), { wallWindow: { mode: 'count', next: 2, recent: 1, neverEmpty: false } }));
  await screen(page);
  ok('and without it that tefilla\'s frame goes, the rest of the day taking the screen', [Object.keys(await lists(page)).some(k => /שחרית/.test(k)), Object.keys(await lists(page)).length >= 2, await fits(page)], [false, true, true]);
  await ctx.close();

  /* ---- marking the next minyan only shortly before it starts ---- */
  ({ ctx, page } = await context(at(8, 5), { nextMark: 15 }));
  await screen(page);
  ok('told to mark the next minyan from 15 minutes before, at 8:05 the 8:30 is not marked yet: it looks like any minyan still to come', [await page.locator('.wall .tile.next').count(), await page.locator('.wall .tile.next-quiet .time').textContent(),
    await page.evaluate(() => { const q = document.querySelector('.wall .tile.next-quiet'), plain = Array.from(document.querySelectorAll('.wall .tile')).filter(t => t.className.trim() === 'tile')[0]; return getComputedStyle(q).backgroundImage === getComputedStyle(plain).backgroundImage && getComputedStyle(q, '::after').content === 'none'; })], [0, '8:30', true]);
  ok('the panel still names it and counts down to it', [(await panel(page)).room, (await panel(page)).time, /^00:2[45]:\d\d$/.test((await panel(page)).count)], ['שלמה יודא', '8:30', true]);
  await ctx.close();
  ({ ctx, page } = await context(at(8, 14, 57), { nextMark: 15 }));
  await screen(page);
  ok('seconds before the fifteen minutes it is still unmarked', await page.locator('.wall .tile.next').count(), 0);
  await page.waitForTimeout(5000);
  ok('and from fifteen minutes before, it turns green with הבא by itself', [await page.locator('.wall .tile.next .time').textContent(), await page.locator('.wall .tile.next-quiet').count()], ['8:30', 0]);
  await ctx.close();

  /* ---- what the countdown runs to ---- */
  ({ ctx, page } = await context(at(7, 47)));
  await screen(page);
  let pn = await panel(page);
  ok('left as it is, at 7:47 the panel is on the 8:00 and counts down to its start', [pn.room, pn.time, /^00:12:\d\d$/.test(pn.count)], ['דברי יואל', '8:00', true]);
  await ctx.close();
  ({ ctx, page } = await context(at(7, 47), { countTo: 'milestone' }));
  await screen(page);
  pn = await panel(page);
  ok('run to הודו, the panel stays on the 7:45 until its הודו at 7:55 and counts down to that', [pn.head, pn.room, pn.time, /^00:07:\d\d$/.test(pn.count)], ['מנין הבא', 'לב אהרן', '7:45', true]);
  ok('while the tiles already mark the 8:00 as the next', await page.locator('.wall .tile.next .time').textContent(), '8:00');
  await ctx.close();
  ({ ctx, page } = await context(at(7, 54, 57), { countTo: 'milestone' }));
  await screen(page); await page.waitForTimeout(5000);
  pn = await panel(page);
  ok('at its הודו the panel moves on to the 8:00, counting to that one\'s הודו', [pn.room, pn.time, /^00:14:\d\d$/.test(pn.count)], ['דברי יואל', '8:00', true]);
  await ctx.close();
  ({ ctx, page } = await context(at(13, 0), { countTo: 'milestone' }));
  await screen(page);
  pn = await panel(page);
  ok('a tefilla with no second time is counted to its start as ever', [pn.room, pn.time, /^00:29:\d\d$/.test(pn.count)], ['ברך משה', '1:30', true]);
  await ctx.close();
  ({ ctx, page } = await context(at(7, 47), { bigTime: 'milestone', countTo: 'start' }));
  await screen(page);
  pn = await panel(page);
  ok('with הודו as the large time and the countdown run to the start, the panel is on the next to start, its הודו large, counting to the start', [pn.room, pn.time, /^00:12:\d\d$/.test(pn.count)], ['דברי יואל', '8:10', true]);
  await ctx.close();
  ({ ctx, page } = await context(at(7, 57), { countTo: 'milestone', nextHold: 5 }));
  await screen(page);
  pn = await panel(page);
  ok('"stay on a minyan" counts from where the countdown ended: at 7:57 the panel is still on the 7:45, headed עכשיו', [pn.head, pn.room, pn.count], ['עכשיו', 'לב אהרן', null]);
  await ctx.close();

  /* ---- a frame with more than fits turns its pages, and how long each stays ---- */
  const crowd = c => { const rooms = ['ברך משה', 'דברי יואל', 'לב אהרן', 'שלמה יודא', 'היכל אדל']; let lines = []; for (let i = 0; i < 110; i++) { const m = 6 * 60 + i * 2; lines.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + ' ' + rooms[i % 5]); } c.schedules.weekday.shacharis = lines.join('\n'); return {}; };
  const top = page => page.evaluate(() => { const g = Array.from(document.querySelectorAll('.wall .grid')).sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; return Math.round(g.scrollTop); });
  ({ ctx, page } = await context(at(5, 0), c => Object.assign(crowd(c), { pageSeconds: 3 })));
  await screen(page);
  ok('a morning of 110 minyanim does not fit even at the smallest size, so its frame turns pages; nothing is cut off', [await page.locator('.wall .pg').count() >= 1, await fits(page), await top(page)], [true, true, 0]);
  await page.waitForTimeout(4600);
  ok('told 3 seconds a page, it has turned within five', (await top(page)) > 0, true);
  await ctx.close();
  ({ ctx, page } = await context(at(5, 0), c => Object.assign(crowd(c), { pageSeconds: 20 })));
  await screen(page); await page.waitForTimeout(9500);
  ok('told 20 seconds, it is still on its first page after ten', await top(page), 0);
  await ctx.close();
  ({ ctx, page } = await context(at(5, 0), c => crowd(c)));
  await screen(page); await page.waitForTimeout(4600);
  ok('left as it is (8 seconds), it has not turned after five', await top(page), 0);
  await page.waitForTimeout(5000);
  ok('and has after ten', (await top(page)) > 0, true);
  await ctx.close();

  /* ---- settings saved before these existed are not "changed" by the page learning about them ---- */
  ({ ctx, page } = await context(at(8, 5), { wallWindow: { mode: 'window', before: 180, after: 20, neverEmpty: true } }, { width: 1280, height: 950 }, 'en-US'));
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-screen'); await page.waitForTimeout(300);
  await page.click('.abar .btn.primary'); await page.waitForTimeout(900);
  ok('a Save with nothing touched, on settings from before today\'s additions, leaves nothing waiting to be published', [await page.locator('.pubbar').isVisible(), /Nothing new to publish|Saved/.test(await page.locator('#toast').textContent().catch(() => 'Saved'))], [false, true]);
  await ctx.close();

  /* ---- the back end: the settings, and "On the screen now" ---- */
  ({ ctx, page } = await context(at(8, 5), null, { width: 1280, height: 950 }, 'en-US'));
  await page.goto(BASE + 'admin.html', { waitUntil: 'networkidle' });
  await page.fill('#pin-input', '1234'); await page.press('#pin-input', 'Enter'); await page.waitForSelector('#tab-screen'); await page.click('#tab-screen'); await page.waitForTimeout(250);
  const box = () => page.evaluate(() => ({ rows: Array.from(document.querySelectorAll('#w-onscreen .os-row')).map(r => [r.querySelector('.os-name').textContent, Array.from(r.querySelectorAll('.os-chip')).map(c => c.querySelector('b').textContent + (c.classList.contains('next') ? '*' : c.classList.contains('gone') ? '-' : '')), (r.querySelector('.os-hid') || {}).textContent || '']),
    foot: document.querySelector('#w-onscreen .os-foot').textContent, time: document.querySelector('#w-onscreen .os-time').textContent }));
  let bx = await box();
  ok('"On the screen now" tells what the screen lists at this minute, tefilla by tefilla: the whole day, the started ones pale, the next one green', [bx.time, bx.rows, bx.foot],
    ['8:05 AM', [['שחרית', ['7:45-', '8:00-', '8:02-', '8:30*', '9:00', '9:30', '10:00'], ''], ['מנחה', ['1:30', '2:00'], ''], ['מעריב', ['6:00'], '']], '10 minyanim on the screen, none left out. The green one is the next; the pale ones have started.']);
  ok('the page opens with the settings as they are: whole day, the next minyan always marked, 8 seconds a page, the countdown as it is', [await page.inputValue('#w-mode'), await page.isChecked('#w-mark-on'), await page.locator('#w-mark').isVisible(), await page.inputValue('#w-page'), await page.inputValue('#w-countto'), await page.locator('#w-next').isVisible()], ['day', false, false, '8', '', false]);
  await page.selectOption('#w-mode', 'count'); await page.waitForTimeout(100);
  ok('choosing "by number" shows its two boxes and the box follows at once, before anything is saved', [await page.inputValue('#w-next'), await page.inputValue('#w-recent'), await page.locator('#w-before').isVisible(), (await box()).rows[0], /Unsaved/.test(await page.locator('.abar .status').textContent())],
    ['6', '2', false, ['שחרית', ['8:00-', '8:02-', '8:30*', '9:00', '9:30', '10:00'], '1 not shown'], true]);
  await page.fill('#w-next', '2'); await page.fill('#w-recent', '1'); await page.waitForTimeout(100);
  bx = await box();
  ok('changing the numbers changes the box as they are typed', [bx.rows, bx.foot], [[['שחרית', ['8:02-', '8:30*', '9:00'], '4 not shown'], ['מנחה', ['1:30', '2:00'], ''], ['מעריב', ['6:00'], '']], '6 minyanim on the screen, 4 left out for now. The green one is the next; the pale ones have started.']);
  await page.check('#w-mark-on'); await page.fill('#w-mark', '10'); await page.fill('#w-page', '5'); await page.selectOption('#w-countto', 'milestone');
  await page.click('.abar .btn.primary'); await page.waitForTimeout(900);
  const tv = await ctx.newPage(); await tv.setViewportSize({ width: 1920, height: 1080 }); await screen(tv);
  ok('saved, the screen itself lists exactly what the box said', (await lists(tv))['מניני שחרית'], ['8:02', '8:30', '9:00']);
  ok('and the other three settings have reached it: the next not marked yet (25 minutes off), and the panel on the 8:00, whose הודו at 8:10 the countdown runs to', [await tv.locator('.wall .tile.next').count(), await tv.locator('.wall .tile.next-quiet .time').textContent(), (await panel(tv)).room, /^00:04:\d\d$/.test((await panel(tv)).count)], [0, '8:30', 'דברי יואל', true]);
  await page.bringToFront(); await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('#tab-screen'); await page.click('#tab-screen'); await page.waitForTimeout(250);
  ok('opened again, the back end shows what was saved', [await page.inputValue('#w-mode'), await page.inputValue('#w-next'), await page.inputValue('#w-recent'), await page.isChecked('#w-mark-on'), await page.inputValue('#w-mark'), await page.inputValue('#w-page'), await page.inputValue('#w-countto'), /Unsaved/.test(await page.locator('.abar .status').textContent())],
    ['count', '2', '1', true, '10', '5', 'milestone', false]);
  await page.fill('#w-page', '999'); await page.fill('#w-mark', '0'); await page.fill('#w-next', '-4'); await page.fill('#w-recent', '500');
  await page.click('.abar .btn.primary'); await page.waitForTimeout(900);
  ok('numbers out of range are brought back into it instead of breaking the screen: 999 seconds a page is 60, no minutes is the usual 15, minus four to come is 1, five hundred started is 20', await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('minyan-config')); return [c.pageSeconds, c.nextMark, c.wallWindow.next, c.wallWindow.recent]; }), [60, 15, 1, 20]);
  await page.click('#tab-screen'); await page.fill('#w-page', ''); await page.fill('#w-next', ''); await page.click('.abar .btn.primary'); await page.waitForTimeout(900);
  ok('a box left empty takes its usual number', await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('minyan-config')); return [c.pageSeconds, c.wallWindow.next]; }), [8, 6]);
  await screen(tv);
  ok('and the screen still draws and fits', [await tv.locator('.wall .tile').count() > 0, await fits(tv)], [true, true]);
  await page.bringToFront(); await page.click('#tab-screen'); await page.uncheck('#w-mark-on'); await page.selectOption('#w-mode', 'day'); await page.waitForTimeout(100);
  ok('switching the marking off puts its minutes away, and "the whole day" its boxes', [await page.locator('#w-mark').isVisible(), await page.locator('#w-next').isVisible(), await page.locator('#w-keep').isVisible()], [false, false, false]);
  /* on a phone */
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  ok('on a phone the box and the new settings fit: nothing off the side', await page.evaluate(() => { const b = document.getElementById('w-onscreen').getBoundingClientRect(); return [document.documentElement.scrollWidth <= window.innerWidth, b.left >= 0 && b.right <= window.innerWidth, Array.from(document.querySelectorAll('#w-onscreen .os-chip')).every(c => c.getBoundingClientRect().right <= window.innerWidth)]; }), [true, true, true]);
  await ctx.close();

  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'all ok');
  process.exit(fails || errors.length ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
