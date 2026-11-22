/* Changes by text, end to end in the Worker bundle: a fake KV, a fake GitHub holding the settings file, texts signed as Twilio signs them.
   Clock: Sunday 22 Nov 2026, 10:00 in New York. Nothing here touches the real settings. */
const crypto = require('crypto');
global.Cal = require('../src/cal.js');
const Engine = require('../src/engine.js');
const base = JSON.parse(JSON.stringify(require('../config.default.json'))); base.overrides = [];
const PIN = process.env.MINYAN_PIN || '1234';
(async () => {
  const worker = (await import('../sms/dist/worker.js')).default;
  let fails = 0;
  const same = (g, w) => w instanceof RegExp ? w.test(String(g)) : Array.isArray(w) ? Array.isArray(g) && g.length === w.length && w.every((x, i) => same(g[i], x)) : JSON.stringify(g === undefined ? null : g) === JSON.stringify(w === undefined ? null : w);
  const ok = (name, got, want) => { const pass = same(got, want); if (!pass) fails++; console.log((pass ? 'ok   ' : 'FAIL ') + name + (pass ? '' : ' -> ' + JSON.stringify(got) + ' want ' + (Array.isArray(want) ? want.map(String).join(' , ') : want))); };
  const store = new Map();
  const SUBS = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); }, list: async () => ({ keys: [...store.keys()].map(name => ({ name })), list_complete: true }) };
  const env = { SUBS, CONFIG_URL: 'https://minyan.cascadeshul.org/config.json', ALLOWED_ORIGIN: 'https://minyan.cascadeshul.org', TWILIO_AUTH_TOKEN: 'twilio-test-token', GITHUB_TOKEN: 'gh-test-token' };
  /* the fake GitHub: one file, with a sha that changes at every write */
  const gh = { cfg: JSON.parse(JSON.stringify(base)), sha: 'sha1', puts: [], gets: 0, failNext: 0, down: false };
  const FILE = 'https://api.github.com/repos/naftule11249-cyber/Minyan/contents/docs/config.json';
  global.fetch = async (url, init) => {
    url = String(url);
    if (url.split('?')[0] === env.CONFIG_URL) return new Response(JSON.stringify(base), { headers: { 'content-type': 'application/json' } }); /* the site's copy: a little behind GitHub */
    if (url.split('?')[0] === FILE) {
      if ((init.headers.Authorization || '') !== 'Bearer gh-test-token') return new Response('{}', { status: 401 });
      if (gh.down) return new Response('{}', { status: 503 });
      if (!init.method || init.method === 'GET') { gh.gets++; return new Response(JSON.stringify({ sha: gh.sha, content: Buffer.from(JSON.stringify(gh.cfg, null, 1)).toString('base64').replace(/(.{60})/g, '$1\n') })); }
      const body = JSON.parse(init.body);
      if (gh.failNext) { gh.failNext--; gh.sha = 'moved' + gh.gets; return new Response('{}', { status: 409 }); }
      if (body.sha !== gh.sha) return new Response('{}', { status: 409 });
      gh.cfg = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); gh.sha = 'sha' + (gh.puts.length + 2); gh.puts.push(body);
      return new Response('{}', { status: 200 });
    }
    throw new Error('unexpected fetch ' + url);
  };
  const realNow = Date.now; let now = Cal.epochFromWall(Cal.rdFromGreg(2026, 11, 22), 10 * 60, 'America/New_York'); Date.now = () => now;
  const HOOK = 'https://w.example/';
  const sign = params => crypto.createHmac('sha1', env.TWILIO_AUTH_TOKEN).update(HOOK + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');
  const sms = async (from, text, opts) => { const params = { From: from, Body: text, To: '+19298287677' }; const r = await worker.fetch(new Request(HOOK, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': opts && opts.badSig ? 'nope' : sign(params) }, body: new URLSearchParams(params) }), opts && opts.env || env); const x = await r.text(); return { status: r.status, text: (/<Message>([\s\S]*)<\/Message>/.exec(x) || [, ''])[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&gt;/g, '>') }; };
  const editors = body => worker.fetch(new Request('https://w.example/editors', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify(body) }), env);
  const mincha = () => { const e = Engine(gh.cfg); return e.scheduleFor(Cal.rdFromGreg(2026, 11, 22)).byTefilla.mincha.map(x => e.fmtTime(x.start) + ' ' + x.room); };
  const GABBAI = '+17185550101', OTHER = '+17185550999';

  /* the list of numbers: by the admin PIN only, kept in the service, never in the settings file */
  let r = await editors({ pin: '0000', editors: [{ number: OTHER, name: 'x' }] });
  ok('the list cannot be read or changed with a wrong PIN', [r.status, store.has('editors')], [403, false]);
  r = await editors({ pin: PIN, editors: [{ number: '(718) 555-0101', name: 'גבאי א' }, { number: '+1 718 555 0102', name: 'גבאי ב' }, { number: '718-555-0101', name: 'twice' }, { number: '12', name: 'not a number' }] });
  let j = await r.json();
  ok('saved with the PIN: numbers tidied, a repeat and a non-number left out', [r.status, j.editors, j.ready], [200, [{ number: '+17185550101', name: 'גבאי א' }, { number: '+17185550102', name: 'גבאי ב' }], { github: true, twilio: true }]);
  ok('reading it back without sending a list leaves it as it is', (await (await editors({ pin: PIN })).json()).editors.length, 2);

  /* who may */
  r = await sms(OTHER, 'cancel mincha 2:00');
  ok('a number that is not on the list gets the ordinary answer, and nothing changes', [/Mincha|מנחה/.test(r.text), gh.puts.length, gh.gets], [true, 0, 0]);
  r = await sms(GABBAI, 'cancel mincha 2:00', { badSig: true });
  ok('a text Twilio did not sign is refused', [r.status, gh.puts.length], [403, 0]);
  const viaGet = await (await worker.fetch(new Request(HOOK + '?q=' + encodeURIComponent('cancel mincha 2:00') + '&from=' + encodeURIComponent(GABBAI)), env)).text();
  ok('the test address cannot change anything, whatever number it claims', [/Cancelled/.test(viaGet), gh.puts.length], [false, 0]);
  r = await sms(GABBAI, 'מנחה');
  ok('a gabbai\'s ordinary text is answered as always', [/מנחה/.test(r.text), gh.puts.length], [true, 0]);

  /* a change */
  r = await sms(GABBAI, 'לייג צו מנחה 2:15 לב אהרן');
  ok('add: answered, and written to the settings file as the back end\'s Publish writes it', [r.text.split('\n')[0], gh.puts.length, gh.puts[0].message, gh.puts[0].branch, mincha().includes('2:15 לב אהרן'), gh.cfg.overrides[0].date], ['צוגעלייגט: מנחה 2:15 לב אהרן, היינט (זונטאג).', 1, 'Update minyan schedule (by text)', 'main', true, '2026-11-22']);
  ok('the rest of the settings went back as they were', [JSON.stringify(Object.assign({}, gh.cfg, { overrides: [], savedAt: 0 })) === JSON.stringify(Object.assign({}, base, { overrides: [], savedAt: 0 })), gh.cfg.savedAt > (base.savedAt || 0)], [true, true]);
  r = await sms('whatsapp:+17185550102', 'cancel mincha 2:00');
  ok('the second gabbai, by WhatsApp: the change builds on the first one, from GitHub\'s copy, not the site\'s older one', [r.text.split('\n')[0], mincha().includes('2:15 לב אהרן'), mincha().includes('2:00 ברך משה')], ['Cancelled: Mincha 2:00 ברך משה, today (Sunday).', true, false]);
  r = await sms(GABBAI, 'cancel mincha 2:00');
  ok('what is no longer there is not found, and nothing is written', [/^No Mincha at 2:00 today/.test(r.text), gh.puts.length], [true, 2]);

  /* undo: each sender their own last change */
  r = await sms(GABBAI, 'צוריק');
  ok('undo takes back the sender\'s own change and leaves the other gabbai\'s', [r.text.split('\n')[0], mincha().includes('2:15 לב אהרן'), mincha().includes('2:00 ברך משה')], ['צוריקגעצויגן: צוגעלייגט: מנחה 2:15 לב אהרן, היינט (זונטאג).', false, false]);
  r = await sms(GABBAI, 'undo');
  ok('a second undo has nothing to take back', [r.text, gh.puts.length], [/^Nothing to undo/, 3]);
  r = await sms('+17185550102', 'undo');
  ok('the other gabbai\'s undo: the day is back on the regular schedule', [/^Undone: Cancelled: Mincha 2:00/.test(r.text), gh.cfg.overrides.length, mincha().includes('2:00 ברך משה')], [true, 0, true]);

  /* things going wrong */
  gh.failNext = 1; r = await sms(GABBAI, 'add maariv 9:15 ברך משה');
  ok('someone published at the same moment: read again and written once', [r.text.split('\n')[0], gh.cfg.overrides[0].lines.maariv.includes('21:15 ברך משה')], ['Added: Maariv 9:15 ברך משה, today (Sunday).', true]);
  gh.down = true; const putsBefore = gh.puts.length; r = await sms(GABBAI, 'add maariv 9:25');
  ok('GitHub not answering: said so plainly, nothing changed, no undo left behind for it', [r.text, gh.puts.length - putsBefore, JSON.parse(store.get('undo:17185550101')).summary], ['It could not be saved. Nothing changed; try again in a minute.', 0, 'Added: Maariv 9:15 ברך משה, today (Sunday)']);
  gh.down = false;
  const noKey = Object.assign({}, env); delete noKey.GITHUB_TOKEN;
  r = await sms(GABBAI, 'add maariv 9:25', { env: noKey });
  ok('the service without its GitHub key: says it is not set up', [r.text, gh.puts.length - putsBefore], ['Changes by text are not set up yet. Nothing changed.', 0]);
  r = await sms(GABBAI, 'גבאי');
  ok('examples for a gabbai', r.text, /^טוישן א מנין דורך טעקסט/);
  r = await sms(OTHER, 'גבאי');
  ok('but not for anyone else', /טוישן א מנין/.test(r.text), false);

  /* Shabbos */
  now = Cal.epochFromWall(Cal.rdFromGreg(2026, 11, 28), 10 * 60, 'America/New_York');
  r = await sms(GABBAI, 'add mincha 2:15');
  ok('on Shabbos nothing is changed and nothing is answered', [r.text, gh.puts.length - putsBefore], ['', 0]);

  /* the log the admin page shows */
  j = await (await editors({ pin: PIN })).json();
  ok('the last changes, newest first, by name', [j.log.length >= 8, j.log[0].who, j.log[0].ok, j.log.filter(x => x.ok).length, j.log.some(x => /9\.9\.9|gh-test|twilio-test/.test(JSON.stringify(x)))], [true, 'גבאי א', false, 5, false]);
  ok('the numbers are nowhere in the settings file', /5550101|5550102/.test(JSON.stringify(gh.cfg)), false);
  Date.now = realNow;
  console.log(fails ? fails + ' FAILURES' : 'textedit: all good');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
