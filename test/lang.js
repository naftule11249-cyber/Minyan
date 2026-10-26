/* Yiddish labels (per phone, with the gabbai's default for the lobby screen) and the zmanim list rolling over to tomorrow. Clock frozen on Sunday 25 Oct 2026. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function open(width, h, m, path, lang) {
    const ctx = await browser.newContext({ viewport: { width: width, height: 860 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = Date.UTC(2026, 9, 25, h + 4, m);
    await ctx.addInitScript(({ fixed, lang }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); try { if (lang) localStorage.setItem('minyan-lang', lang); } catch (e) {} }, { fixed, lang });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + (path || ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    return { ctx, page };
  }
  let { ctx, page } = await open(400, 9, 22, '', 'yi');
  ok('yiddish: day line, today, next minyan', [await page.locator('.dayline').textContent(), await page.locator('.day-head h2').first().textContent(), await page.locator('section.next:not(.zman) h2').textContent()], ['זונטאג פרשת וירא', 'היינט', 'מנין הבא']);
  ok('yiddish: section title, fold button, now badge', [await page.locator('section.tefilla h3').first().textContent(), await page.locator('.foldbtn').textContent(), await page.locator('.row.now .badge').textContent()], ['שחרית מנינים', 'ווייז די פריערדיגע (6)', 'יעצט']);
  ok('yiddish: board type label and footer switch', [await page.locator('.day-head .sub').first().textContent(), await page.locator('#lang').inputValue()], ['לוח זונטאג', 'yi']);
  await ctx.close();
  ({ ctx, page } = await open(1280, 13, 0, '?view=display', 'yi'));
  ok('lobby screen keeps the gabbai\'s Hebrew default', [await page.locator('.day-head h2').first().textContent(), await page.locator('section.tefilla h3').first().textContent()], ['היום', 'מניני שחרית – מחר, יום שני']);
  await ctx.close();
  ({ ctx, page } = await open(1280, 13, 0, '', 'yi'));
  ok('yiddish tile badge via CSS variable', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--badge-now').trim()), '"יעצט"');
  ok('yiddish: tomorrow in the section title', await page.locator('section.tefilla h3').first().textContent(), 'שחרית מנינים – מארגן, מאנטאג');
  await ctx.close();
  ({ ctx, page } = await open(1280, 13, 0));
  const rows = await page.locator('.zlist li').evaluateAll(els => els.map(e => ({ name: e.querySelector('span').childNodes[0].textContent, tag: (e.querySelector('.tag') || {}).textContent || '', time: e.querySelector('.z').textContent, cls: e.className })));
  const shema = rows.find(r => r.name === 'סוף זמן ק״ש'), sunset = rows.find(r => r.name === 'שקיעה');
  ok('13:00: sof zman Shema has passed, keeps today\'s time, dimmed and untagged', [shema.tag, shema.cls.indexOf('past') >= 0, shema.cls.indexOf('tomorrow') >= 0, /^\d{1,2}:\d{2}$/.test(shema.time)], ['', true, false, true]);
  ok('13:00: shkia still today\'s, untagged', [sunset.tag, sunset.time], ['', '6:01']);
  await ctx.close(); await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('lang: all good');
})();
