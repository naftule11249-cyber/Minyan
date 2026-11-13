/* The "now" window: a שחרית minyan is marked עכשיו from its start until its הודו (ten minutes on), then it is past; מנחה and מעריב five minutes. Clock frozen on Sunday 25 Oct 2026. */
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
    page.on('pageerror', e => errors.push(e.message)); page.on('console', x => { if (x.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|ERR_CONNECTION/.test(x.text())) errors.push(x.text()); });
    await page.goto('http://localhost:8790/index.html' + (hash || ''), { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    const fb = page.locator('.foldbtn'); if (await fb.count()) { await fb.first().click(); await page.waitForTimeout(200); } /* unfold the past minyanim to count them */
    const txt = async sel => (await page.locator(sel).allTextContents()).map(s => s.replace(/\s+/g, ' ').trim());
    const r = { now: await txt('.tile.now'), next: await txt('.tile.next'), past: await page.locator('.tile.past').count(), pastVisible: await page.locator('.tile.past:visible').count(), nowVisible: await page.locator('.tile.now:visible').count() };
    await ctx.close(); return r;
  }
  let r = await at(9, 22);
  ok('9:22: the 9:15 minyan is "now" (its הודו is 9:25)', r.now.length === 1 && /9:15/.test(r.now[0]) && /ברך משה/.test(r.now[0]), true);
  ok('9:22: next is 9:30', r.next.length === 1 && /9:30/.test(r.next[0]), true);
  ok('9:22: six earlier minyanim are past', r.past, 6);
  r = await at(9, 26);
  ok('9:26: past its הודו the 9:15 minyan is no longer "now"', [r.now.length, r.past], [0, 7]);
  r = await at(9, 36);
  ok('9:36: only the 9:30 minyan is "now" (its הודו is 9:40)', r.now.length === 1 && /9:30/.test(r.now[0]), true);
  ok('9:36: the 9:15 minyan joined the past', r.past, 7);
  r = await at(9, 22, '#display');
  ok('hallway screen 9:22: the ones that went stay in view, light, and the one davening now is marked', [r.pastVisible > 0, r.nowVisible], [true, 1]);
  r = await at(12, 15);
  ok('12:15: last shacharis (chatzos-30 = 12:10) is "now" until its הודו', r.now.length === 1 && /12:10/.test(r.now[0]), true);
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('nowwindow: all good');
})();
