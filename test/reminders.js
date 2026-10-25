/* Reminders UI: the panel with reminder rows, and tapping a tile to set one. No reminder service behind it, so the "set" path must fail politely. */
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const orig = fs.readFileSync('docs/config.json', 'utf8'); const c = JSON.parse(orig);
  c.notifyUrl = 'http://localhost:8790/no-such-service'; c.savedAt = Date.now();
  fs.writeFileSync('docs/config.json', JSON.stringify(c));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const errors = []; let fails = 0;
  const ok = (name, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) console.log('ok   ' + name); else { fails++; console.log('FAIL ' + name + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'he', timezoneId: 'America/New_York' });
    await ctx.grantPermissions(['notifications'], { origin: 'http://localhost:8790' });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto('http://localhost:8790/index.html', { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
    ok('reminders panel shown', await page.locator('section.side h3:has-text("Reminders on your phone")').count(), 1);
    ok('tiles are tappable', (await page.locator('.tile.tap').count()) > 10, true);
    await page.click('button:has-text("+ Add reminder")');
    ok('a reminder row appears', await page.locator('.rem-row').count(), 1);
    const which = await page.locator('.rem-row select[aria-label="Which minyan"] option').allTextContents();
    ok('which-minyan choices for shacharis', which.slice(0, 5), ['First minyan of the day', 'Last minyan of the day', 'Last minyan before sof zman Shema', 'Last minyan before sof zman tefilla', 'Last minyan before chatzos']);
    ok('…then today\'s times', which.length > 5 && /ברך משה|דברי יואל|לב אהרן|שלמה יודא|היכל/.test(which[5]), true);
    await page.locator('.rem-row select[aria-label="Tefilla"]').selectOption('mincha');
    ok('mincha choices', (await page.locator('.rem-row select[aria-label="Which minyan"] option').allTextContents()).slice(0, 4), ['First minyan of the day', 'Last minyan of the day', 'Last minyan before sunset', 'Last minyan before zman Maariv (tzeis)']);
    await page.locator('.rem-row select[aria-label="Every day or today only"]').selectOption('today');
    await page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
    const first = page.locator('.tile.tap').first(); const tileText = (await first.textContent()).replace(/\s+/g, ' ').trim();
    await first.click();
    ok('remind-me box opens', await page.locator('#rem-overlay .panel.small').count(), 1);
    const what = await page.locator('#rem-overlay .rem-what').textContent();
    ok('box names the minyan', /שחרית/.test(what) && tileText.indexOf(what.split(' ').slice(-1)[0]) >= 0, true);
    await page.fill('#rem-lead', '15');
    await page.click('#rem-overlay button:has-text("Set reminder")');
    await page.waitForFunction(() => /Could not set the reminder/.test((document.querySelector('#rem-msg') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const m = await page.locator('#rem-msg').textContent();
    console.log('message without a service:', m);
    ok('without a service the box explains instead of crashing', /Could not set the reminder/.test(m), true);
    await page.screenshot({ path: 'test/shot-reminders.png' });
    ok('the reminder row draft survived', await page.locator('.rem-row').count(), 1);
    await ctx.close();
  } finally { fs.writeFileSync('docs/config.json', orig); await browser.close(); }
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (fails || errors.length) process.exit(1); else console.log('reminders: all good');
})();
