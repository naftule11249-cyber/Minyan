/* The "now" window: a minyan is marked עכשיו for nowMinutes (20) after it starts, then dimmed; the lobby screen hides it. Clock frozen on Sunday 25 Oct 2026. */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  async function at(h, m, hash) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York', serviceWorkers: 'block' });
    const fixed = Date.UTC(2026, 9, 25, h + 4, m); // EDT = UTC-4
    await ctx.addInitScript(({ fixed }) => { const real = Date.now; const start = real(); Date.now = () => fixed + (real() - start); }, { fixed });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', x => { if (x.type() === 'error') errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + (hash || ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    const txt = async sel => (await page.locator(sel).allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    const r = { now: await txt('.tile.now'), next: await txt('.tile.next'), past: await page.locator('.tile.past').count(), pastVisible: await page.locator('.tile.past:visible').count(), nowVisible: await page.locator('.tile.now:visible').count() };
    await ctx.close(); return r;
  }
  let r = await at(9, 25);
  ok('9:25: the 9:15 minyan is "now"', r.now.length === 1 && /9:15/.test(r.now[0]) && /ברך משה/.test(r.now[0]), true);
  ok('9:25: next is 9:30', r.next.length === 1 && /9:30/.test(r.next[0]), true);
  ok('9:25: six earlier minyanim are past', r.past, 6);
  r = await at(9, 36);
  ok('9:36: only the 9:30 minyan is "now" (the 9:15 one left the 20-minute window)', r.now.length === 1 && /9:30/.test(r.now[0]), true);
  ok('9:36: the 9:15 minyan joined the past', r.past, 7);
  r = await at(9, 25, '#display');
  ok('lobby screen 9:25: past tiles hidden, "now" tile shown', [r.pastVisible, r.nowVisible], [0, 1]);
  r = await at(12, 25);
  ok('12:25: last shacharis (chatzos-30 = 12:10) is "now"', r.now.length === 1 && /12:10/.test(r.now[0]), true);
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('nowwindow: all good');
})();
