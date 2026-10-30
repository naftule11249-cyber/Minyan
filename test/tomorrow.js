/* After today's minyanim of a tefilla are over, its section shows tomorrow's list (מחר). Clock frozen on Sunday 25 Oct 2026. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function at(h, m, hash) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = Date.UTC(2026, 9, 25, h + 4, m);
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + (hash || ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    const heads = await page.locator('section.tefilla h3').allTextContents();
    const firstSh = await page.locator('section.tefilla').first().locator('.tile').count();
    const firstTime = (await page.locator('section.tefilla').first().locator('.tile .time').first().textContent().catch(() => ''));
    const dayHeads = await page.locator('.day-head h2').allTextContents();
    await ctx.close(); return { heads, firstSh, firstTime, dayHeads };
  }
  let r = await at(9, 25);
  ok('morning: today\'s Shacharis (Sunday list: 19 minyanim, 6 past ones folded)', [/מחר/.test(r.heads[0]), r.firstSh], [false, 13]);
  r = await at(13, 0);
  ok('after chatzos: Shacharis section is tomorrow\'s, headed מחר', [/^מניני שחרית – מחר, יום שני$/.test(r.heads[0]), r.firstSh, r.firstTime], [true, 20, '6:20']);
  ok('mincha and maariv still today\'s', r.heads.slice(1).every(h => !/מחר/.test(h)), true);
  r = await at(23, 50);
  ok('late night: Shacharis and Mincha show tomorrow, Maariv (12:00, 12:15 AM still ahead) stays today, one day block', [/מחר/.test(r.heads[0]), /מחר/.test(r.heads[1]), /מחר/.test(r.heads[2]), r.dayHeads.length], [true, true, false, 1]);
  r = await at(13, 0, '#display');
  ok('lobby screen: tomorrow\'s Shacharis comes after today\'s sections (it is shown when there is room for it)', [/מחר/.test(r.heads[r.heads.length - 1]), r.heads.slice(0, -1).every(h => !/מחר/.test(h))], [true, true]);
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('tomorrow: all good');
})();
