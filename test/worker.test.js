/* The Cloudflare Worker bundle end to end with a fake KV and a fake push service: self-made VAPID keys, subscribe with a pick, a reminder going out. */
const { subtle } = require('crypto').webcrypto;
const cfg = require('../config.default.json');
global.Cal = require('../src/cal.js');
(async () => {
  const worker = (await import('../sms/dist/worker.js')).default;
  let fails = 0;
  const ok = (name, got, want) => { const pass = JSON.stringify(got) === JSON.stringify(want); if (!pass) fails++; console.log((pass ? 'ok   ' : 'FAIL ') + name + (pass ? '' : ' -> ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))); };
  const store = new Map();
  const SUBS = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async k => { store.delete(k); },
    list: async () => ({ keys: [...store.keys()].map(name => ({ name })), list_complete: true }) };
  const env = { SUBS, CONFIG_URL: 'https://minyan.cascadeshul.org/config.json', ALLOWED_ORIGIN: 'https://minyan.cascadeshul.org', VAPID_SUBJECT: 'https://minyan.cascadeshul.org' };
  const pushed = [];
  global.fetch = async (url, init) => {
    if (url === env.CONFIG_URL) return new Response(JSON.stringify(cfg), { headers: { 'content-type': 'application/json' } });
    if (/^https:\/\/push\.example\//.test(url)) { pushed.push({ url, headers: init.headers, bytes: init.body.byteLength || init.body.length }); return new Response('', { status: 201 }); }
    throw new Error('unexpected fetch ' + url);
  };
  // 1. the public key is made on first use and then stays the same
  const k1 = await (await worker.fetch(new Request('https://w.example/push/key'), env)).text();
  const k2 = await (await worker.fetch(new Request('https://w.example/push/key'), env)).text();
  ok('vapid public key made by the worker (65-byte point, base64url)', [k1.length, /^[A-Za-z0-9_-]+$/.test(k1), k1 === k2, !!store.get('vapid')], [87, true, true, true]);
  // 2. a phone subscribes: last Shacharis before chatzos, 10 minutes before, plus a today-only Mincha
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const subscription = { endpoint: 'https://push.example/abc', keys: { p256dh: b64u(await subtle.exportKey('raw', ua.publicKey)), auth: b64u(require('crypto').randomBytes(16)) } };
  const rd = Cal.rdFromGreg(2026, 10, 26), iso = '2026-10-26'; // Monday
  const r = await worker.fetch(new Request('https://w.example/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription, reminders: [{ tefilla: 'shacharis', pick: 'before:chatzos', lead: 10 }, { tefilla: 'mincha', time: 840, lead: 5, once: iso }, { tefilla: 'maariv', pick: 'nonsense', lead: 3 }, { zman: 'sunset', lead: 20 }, { zman: 'bogus', tefilla: 'mincha', lead: 4 }], lang: 'he' }) }), env);
  const { id } = await r.json();
  const saved = JSON.parse(store.get('push:' + id));
  ok('subscription stored with pick and once (bad pick dropped)', saved.reminders, [{ tefilla: 'shacharis', time: null, lead: 10, pick: 'before:chatzos' }, { tefilla: 'mincha', time: 840, lead: 5, once: iso }, { tefilla: 'maariv', time: null, lead: 3 }, { zman: 'sunset', lead: 20 }, { tefilla: 'mincha', time: null, lead: 4 }]);
  ok('cors header for the site', r.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
  // 3. the cron run 10 minutes before the last Shacharis (chatzos-30) sends one encrypted push with a VAPID header
  const engine = require('../src/engine.js')(cfg), sched = engine.scheduleFor(rd), last = sched.byTefilla.shacharis.slice(-1)[0];
  const realNow = Date.now; Date.now = () => last.ms - 10 * 60000;
  await worker.scheduled({}, env);
  ok('one push sent', pushed.length, 1);
  ok('to the phone, encrypted, signed', [pushed[0].url, pushed[0].headers['Content-Encoding'] || pushed[0].headers['content-encoding'], /^vapid t=.+, k=/.test(pushed[0].headers.Authorization || pushed[0].headers.authorization), pushed[0].bytes > 100], ['https://push.example/abc', 'aes128gcm', true, true]);
  await worker.scheduled({}, env);
  ok('not sent twice', pushed.length, 1);
  // 4. the next day the today-only reminder is pruned
  Date.now = () => Cal.epochFromWall(rd + 1, 9 * 60, 'America/New_York');
  await worker.scheduled({}, env);
  ok('today-only reminder pruned the next day', JSON.parse(store.get('push:' + id)).reminders.length, 4);
  Date.now = realNow;
  console.log(fails ? fails + ' FAILURES' : 'ALL PASS');
  if (fails) process.exit(1);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
