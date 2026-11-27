
/* ---- Cloudflare Worker: text/WhatsApp responder, reminder texts, daily schedule texts and app notifications.
   Bindings: KV namespace SUBS. Variables: CONFIG_URL (required), ALLOWED_ORIGIN (the website address), VAPID_SUBJECT (mailto:…).
   Optional secret BROADCAST_KEY: a second way to authorise the admin page's "Send a notification", besides the admin PIN.
   Secrets (wrangler secret put): TWILIO_AUTH_TOKEN (also verifies Twilio's signature), TWILIO_ACCOUNT_SID, TWILIO_FROM (+1718…),
   WA_FROM (whatsapp:+1718…, optional), WA_CONTENT_SID (optional WhatsApp template), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
   Cron trigger every 5 minutes (wrangler.toml) sends what is due.
   Changes by text: the gabbaim named on the admin page change one day's minyanim by a text. The changes and the numbers are kept
   in KV (never in the public config); see "changes by text" below. No extra secret is needed. ---- */
async function sha256Hex(str) { var b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))), s = '', i; for (i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2); return s; }
function escapeXml(s) { return s.replace(/[<>&'"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]; }); }
/* Twilio signs the address exactly as it was typed into the number's settings: "https://x.workers.dev" and "https://x.workers.dev/" are
   the same place to us, so the signature is tried on both. */
async function twilioSignatureOk(request, params, token) {
  var sig = request.headers.get('X-Twilio-Signature') || '', tail = '', urls = [request.url], i;
  if (!sig) return false;
  var u = new URL(request.url); if (u.pathname === '/') urls.push(u.origin + u.search);
  Object.keys(params).sort().forEach(function (k) { tail += k + params[k]; });
  var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  for (i = 0; i < urls.length; i++) {
    var mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(urls[i] + tail)));
    if (btoa(String.fromCharCode.apply(null, mac)) === sig) return true;
  }
  return false;
}
/* the published schedule, fresh within a minute or two of a publish: the address changes by the minute, so the site's CDN copy is passed by */
async function loadSiteConfig(env) { return (await fetch(env.CONFIG_URL + (env.CONFIG_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 60000), { cf: { cacheTtl: 60, cacheEverything: true } })).json(); }
/* the settings as everyone sees them: with the texted one-day changes laid over */
async function loadConfig(env) { var c = await loadSiteConfig(env); return MinyanEngine.withDayLines(c, await textDays(env, c)); }
function twiml(text) { return new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + (text ? '<Message>' + escapeXml(text) + '</Message>' : '') + '</Response>', { headers: { 'content-type': 'text/xml; charset=utf-8' } }); }
function cors(env, extra) { return Object.assign({ 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }, extra || {}); }
function json(env, obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: cors(env, { 'content-type': 'application/json' }) }); }
async function sendTwilio(env, to, body) {
  var isWa = /^whatsapp:/.test(to), from = isWa ? env.WA_FROM : env.TWILIO_FROM;
  if (!from || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return false;
  var form = new URLSearchParams({ To: to, From: from });
  if (isWa && env.WA_CONTENT_SID) { form.set('ContentSid', env.WA_CONTENT_SID); form.set('ContentVariables', JSON.stringify({ 1: body })); } else form.set('Body', body);
  var r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_ACCOUNT_SID + '/Messages.json', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(env.TWILIO_ACCOUNT_SID + ':' + env.TWILIO_AUTH_TOKEN), 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  return r.ok;
}
/* VAPID keys for app notifications: from the secrets when set, otherwise made once on first use and kept in KV, so there is nothing to configure */
async function vapidKeys(env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { pub: env.VAPID_PUBLIC_KEY, priv: env.VAPID_PRIVATE_KEY };
  var saved = await env.SUBS.get('vapid', 'json');
  if (saved && saved.pub && saved.priv) return saved;
  var kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  var jwk = await crypto.subtle.exportKey('jwk', kp.privateKey), raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)), s = '', i;
  for (i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
  saved = { pub: btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), priv: jwk.d };
  await env.SUBS.put('vapid', JSON.stringify(saved));
  return saved;
}
async function pushEnv(env) { var k = await vapidKeys(env); return { VAPID_SUBJECT: env.VAPID_SUBJECT || 'https://minyan.cascadeshul.org', VAPID_PUBLIC_KEY: k.pub, VAPID_PRIVATE_KEY: k.priv }; }
async function allSubscriptions(env) {
  var out = [], cursor;
  do {
    var page = await env.SUBS.list({ cursor: cursor });
    for (var i = 0; i < page.keys.length; i++) if (/^(sub|push):/.test(page.keys[i].name)) out.push(page.keys[i].name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
/* Does Twilio itself have this message, as a text that came in from that sender to that number with these words? Used for texts the
   shul's relay passes on without Twilio's signature. A message ID is believed once only. */
async function twilioHasMessage(env, token, params) {
  var sid = (await env.SUBS.get('twacct')) || env.TWILIO_ACCOUNT_SID;
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid || '')) return false;
  var seenKey = 'msg:' + params.MessageSid;
  if (await env.SUBS.get(seenKey)) return false;
  try {
    var r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages/' + params.MessageSid + '.json', { headers: { Authorization: 'Basic ' + btoa(sid + ':' + token) } });
    if (!r.ok) return false;
    var m = await r.json();
    var same = String(m.direction || '') === 'inbound' && phoneDigits(m.from) === phoneDigits(params.From) && phoneDigits(m.to) === phoneDigits(params.To) && String(m.body || '').trim() === String(params.Body || '').trim();
    if (same) await env.SUBS.put(seenKey, '1', { expirationTtl: 7 * 86400 });
    return same;
  } catch (e) { return false; }
}

/* The admin PIN (the site's config carries its hash) or the BROADCAST_KEY secret; ten wrong tries lock that address out for an hour.
   Resolves to null when the caller is the gabbai, otherwise to the refusal to send back. */
async function adminRefusal(request, env, body, cfg) {
  var ip = request.headers.get('cf-connecting-ip') || 'unknown', failKey = 'bcfail:' + ip, fails = +(await env.SUBS.get(failKey)) || 0;
  if (fails >= 10) return json(env, { error: 'too many wrong tries; try again in an hour' }, 429);
  var hasPin = !!(cfg.pinHash || cfg.pin), okKey = !!env.BROADCAST_KEY && body.key === env.BROADCAST_KEY;
  var okPin = hasPin && typeof body.pin === 'string' && body.pin !== '' && (cfg.pinHash ? (await sha256Hex(body.pin)) === cfg.pinHash : body.pin === String(cfg.pin));
  if (okKey || okPin) return null;
  await env.SUBS.put(failKey, String(fails + 1), { expirationTtl: 3600 });
  return json(env, { error: hasPin ? 'wrong PIN' : 'set an admin PIN first' }, 403);
}

/* ---- changes by text: a gabbai's number texts "add mincha 2:15", and that day's schedule changes (src/edit.js).
   The service keeps these one-day changes itself, in KV ("textdays"), and gives them out at /changes; the board, the app and this
   service's own answers lay them over the published settings (MinyanEngine.withDayLines). Nothing is written to the website's
   files, so no GitHub key is needed, and a change is on the screen at the screen's next look, within a minute.
   textdays = { '2026-11-22': { mincha: { line, base, at } } }: see withDayLines for what line and base are. ---- */
function phoneDigits(n) { var d = String(n || '').replace(/\D/g, ''); return d.length === 10 ? '1' + d : d; } /* +1 718 555 1234 = whatsapp:+17185551234 = 7185551234 */
async function textDays(env, cfg) {
  var days = (await env.SUBS.get('textdays', 'json')) || {};
  if (!cfg) return days;
  var today = MinyanEngine.isoDate(Cal.nowInTz(Date.now(), MinyanEngine(cfg).loc().tz).rd), out = {};
  Object.keys(days).forEach(function (iso) { if (iso >= today) out[iso] = days[iso]; }); /* days gone by are dropped */
  return out;
}
function ownLine(cfg, iso, tef) { var o = (cfg.overrides || []).filter(function (x) { return x.date === iso; })[0]; return o && o.lines && Object.prototype.hasOwnProperty.call(o.lines, tef) ? o.lines[tef] : null; }
/* After a change (or its undo) was worked out on the settings-with-changes: note that tefilla's list for that day. When it is again
   what the published settings give by themselves, the note simply goes. */
async function keepDay(env, siteCfg, days, changed, iso, tef) {
  var line = ownLine(changed, iso, tef), base = ownLine(siteCfg, iso, tef);
  days[iso] = days[iso] || {};
  if (line === base) delete days[iso][tef]; else days[iso][tef] = { line: line, base: base, at: Date.now() };
  if (!Object.keys(days[iso]).length) delete days[iso];
  await env.SUBS.put('textdays', JSON.stringify(days));
}
async function editLog(env, entry) { var log = (await env.SUBS.get('editlog', 'json')) || []; log.unshift(entry); await env.SUBS.put('editlog', JSON.stringify(log.slice(0, 30))); }
/* ---- a text in the gabbai's own words: "מאך די מנחה פון 2 אין לב אהרן היינט", "pls cancel the late maariv tmrw" ----
   Workers AI (the AI binding in wrangler.toml; nothing to set up) reads the text and fills in a small form: what to do, to which
   tefilla, at what time, which room, which day. That form becomes one of the plain commands src/edit.js already knows, and
   everything after it is the same as for a text written the plain way: found or not found, done, said back in words, undo.
   So the AI never changes anything by itself and cannot invent a room or a tefilla; the worst it can do is pick the wrong minyan,
   and the answer says exactly what was changed. */
var AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
var AI_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function aiPrompt(cfg, nowMs) {
  var engine = MinyanEngine(cfg), now = Cal.nowInTz(nowMs, engine.loc().tz), sched = engine.scheduleFor(now.rd), tefs = engine.tefillos().filter(function (t) { return t.kind !== 'event'; });
  function t24(m) { m = Math.round(m) % 1440; return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
  var rooms = {}, nums = cfg.roomNumbers || {};
  String(cfg.rooms || '').split(',').forEach(function (r) { if (r.trim()) rooms[r.trim()] = 1; });
  tefs.forEach(function (t) { (sched.byTefilla[t.id] || []).forEach(function (e) { if (e.room) rooms[e.room] = 1; }); });
  var roomLines = Object.keys(rooms).map(function (r) { var n = Object.keys(nums).filter(function (k) { return nums[k] === r; })[0]; return '- ' + r + (n ? ' (room number ' + n + ')' : ''); }).join('\n');
  var lists = tefs.map(function (t) { return t.id + ' (' + t.name + '): ' + ((sched.byTefilla[t.id] || []).map(function (e) { return t24(e.start) + (e.room ? ' ' + e.room : ''); }).join(', ') || 'none'); }).join('\n');
  return 'You read text messages that a gabbai sends to change his shul\'s minyan schedule for ONE day, and fill in a form. The texts are in Yiddish, Hebrew or English, often mixed, short, with typos, or in Latin letters (e.g. "shachris", "mincha", "maariv", "morgen").\n\n' +
    'Now: ' + AI_DAYS[sched.info.dow] + ', ' + t24(now.min) + ' (24-hour clock).\n\n' +
    'Tefillos (use the id): ' + tefs.map(function (t) { return t.id + ' = ' + t.name; }).join(', ') + '.\n\n' +
    'Rooms (copy the name exactly as written here; a number alone can be a room number):\n' + roomLines + '\n\n' +
    'Today\'s minyanim, 24-hour clock:\n' + lists + '\n\n' +
    'Fill in:\n' +
    '- intent: "add" (a new minyan), "cancel" (a minyan is off / not taking place), "move" (an existing minyan gets another time and/or another room), "undo" (take back his last change), "help" (he asks how to do it), "none" (anything else: a question, asking for the times, a greeting, or a request this form cannot hold, like cancelling several minyanim at once).\n' +
    '- tefilla: the id, or null if he does not say and it cannot be told from the time.\n' +
    '- time: "HH:MM", 24-hour. For add: the new minyan\'s time. For cancel and move: the time the minyan has NOW. Mincha and maariv are in the afternoon and evening (2:00 is "14:00"; maariv at 12:00 is "00:00"), shacharis in the morning. "the first / last / late mincha" means that one in today\'s list.\n' +
    '- new_time: for move only, the new time if the time changes; otherwise null.\n' +
    '- room: for add, its room; for move, the room it moves TO; for cancel, a room only if he names one. Otherwise null.\n' +
    '- day: "today", "tomorrow", or a weekday name in English, lower case; null means today. היינט = today, מארגן / מחר = tomorrow, זונטאג = sunday, מאנטאג = monday, דינסטאג = tuesday, מיטוואך = wednesday, דאנערשטאג = thursday, פרייטאג / ערב שבת = friday, שבת = saturday.\n\n' +
    'Examples:\n' +
    '"מאך די מנחה פון 2 אין לב אהרן היינט" -> {"intent":"move","tefilla":"mincha","time":"14:00","new_time":null,"room":"לב אהרן","day":"today"}\n' +
    '"עס איז נישטא קיין מעריב 9:30 מארגן" -> {"intent":"cancel","tefilla":"maariv","time":"21:30","new_time":null,"room":null,"day":"tomorrow"}\n' +
    '"can u add a mincha at 215 in room 4" -> {"intent":"add","tefilla":"mincha","time":"14:15","new_time":null,"room":"<the room numbered 4>","day":null}\n' +
    '"די 8:00 שחרית וועט זיין 8:10 דינסטאג" -> {"intent":"move","tefilla":"shacharis","time":"08:00","new_time":"08:10","room":null,"day":"tuesday"}\n' +
    '"טעות, נעם עס צוריק" -> {"intent":"undo","tefilla":null,"time":null,"new_time":null,"room":null,"day":null}\n' +
    '"ווען איז מנחה?" -> {"intent":"none","tefilla":null,"time":null,"new_time":null,"room":null,"day":null}\n\n' +
    'Answer with the JSON form only.';
}
/* The plain command for a text in the sender's own words, or null (not a change, not understood, or the AI is not there). */
async function understand(env, cfg, text, nowMs) {
  if (!env.AI || !String(text || '').trim() || String(text).length > 300) return null;
  var schema = { type: 'object', properties: { intent: { type: 'string', enum: ['add', 'cancel', 'move', 'undo', 'help', 'none'] }, tefilla: { type: ['string', 'null'] }, time: { type: ['string', 'null'] }, new_time: { type: ['string', 'null'] }, room: { type: ['string', 'null'] }, day: { type: ['string', 'null'] } }, required: ['intent'] };
  var out = await env.AI.run(AI_MODEL, { messages: [{ role: 'system', content: aiPrompt(cfg, nowMs) }, { role: 'user', content: String(text).trim() }], response_format: { type: 'json_schema', json_schema: schema }, temperature: 0, max_tokens: 200 });
  var f = out && out.response;
  if (typeof f === 'string') { var m = /\{[\s\S]*\}/.exec(f); f = m ? JSON.parse(m[0]) : null; }
  if (!f || typeof f !== 'object') return null;
  return formToCommand(cfg, f);
}
/* the filled-in form as a plain command; anything in it that is not a real tefilla, time, room or day is left out, not trusted */
function formToCommand(cfg, f) {
  if (f.intent === 'undo') return 'undo';
  if (f.intent === 'help') return 'gabbai';
  if (['add', 'cancel', 'move'].indexOf(f.intent) < 0) return null;
  var tefs = MinyanEngine(cfg).tefillos().filter(function (t) { return t.kind !== 'event'; }), tf = tefs.filter(function (t) { return t.id === f.tefilla || t.name === f.tefilla; })[0];
  var T24 = /^([01]?\d|2[0-3]):[0-5]\d$/, parts = [f.intent];
  if (tf) parts.push(/^(shacharis|mincha|maariv)$/.test(tf.id) ? tf.id : tf.name);
  if (!T24.test(f.time || '')) return null;
  parts.push(f.time);
  if (f.intent === 'move' && T24.test(f.new_time || '') && f.new_time !== f.time) { parts.push('to'); parts.push(f.new_time); }
  var nums = cfg.roomNumbers || {}, known = {};
  String(cfg.rooms || '').split(',').forEach(function (r) { if (r.trim()) known[r.trim()] = 1; });
  Object.keys(nums).forEach(function (k) { known[nums[k]] = 1; });
  var room = typeof f.room === 'string' ? f.room.trim() : '';
  if (room && !known[room] && nums[room.replace(/\D/g, '')]) room = nums[room.replace(/\D/g, '')];
  if (room && known[room]) parts.push(room);
  var day = String(f.day || '').toLowerCase();
  if (day === 'tomorrow' || AI_DAYS.indexOf(day) >= 0) parts.push(day === 'saturday' ? 'shabbos' : day);
  return parts.join(' ');
}
/* Is this one of the ordinary texts (מנין, מנחה, today, zmanim, שערן, a reminder command …)? Those are answered as always, with no AI. */
function ordinaryText(cfg, text) {
  var t = String(text || '').trim(), n = t.split(/\s+/).length;
  if (!t) return true;
  if (MinyanNotify.parseCommand(t, cfg)) return true;
  if (typeof MinyanShere !== 'undefined' && MinyanShere.reply(cfg, t, Date.now())) return true;
  return n <= 2 && !/\d/.test(t) && MinyanSms.keyword(t) !== 'next';
}
/* What a gabbai's text asks for: { text: the plain command, by: 'rules' | 'ai', lang } or null when it is not a change at all.
   A text written the plain way never goes to the AI. One in his own words does, and so does a plain one that did not add up. */
async function readEdit(env, cfg, text, now) {
  var lang = MinyanEdit.hasHebrew(text) ? 'yi' : 'en', plain = MinyanEdit.parse(text), first = plain ? MinyanEdit.run(cfg, text, now) : null;
  if (first && (first.cfg || first.wantsUndo || plain.action === 'help')) return { text: text, by: 'rules', lang: first.lang };
  if (!plain && ordinaryText(cfg, text)) return null;
  var cmd = null, aiError = '';
  try { cmd = await understand(env, cfg, text, now); } catch (e) { aiError = String(e && e.message || e).slice(0, 160); }
  if (cmd) return { text: cmd, by: 'ai', lang: lang, aiError: aiError };
  return plain ? { text: text, by: 'rules', lang: first.lang, aiError: aiError } : (aiError ? { text: null, by: 'none', lang: lang, aiError: aiError } : null);
}

/* The reply to a gabbai's change, or null when this text is not one (the sender is not on the list, or it is an ordinary text).
   cfg is the settings with the changes so far already laid over them; siteCfg is the published settings alone. */
async function textEdit(env, cfg, siteCfg, days, text, from) {
  var who = phoneDigits(from), ed = ((await env.SUBS.get('editors', 'json')) || []).filter(function (e) { return e.n === who; })[0];
  if (!ed) return null;
  var now = Date.now(), read = await readEdit(env, cfg, text, now);
  if (!read || !read.text) return null; /* not a change: answered like anyone's text */
  var res = MinyanEdit.run(cfg, read.text, now, read.lang), L = MinyanEdit.T[res.lang], undoKey = 'undo:' + who;
  function note(ok, reply) { return editLog(env, { at: now, who: ed.name || ('…' + who.slice(-4)), text: String(text).trim().slice(0, 140), ok: ok, reply: String(reply).split('\n')[0].slice(0, 200), read: read.by === 'ai' ? read.text : undefined }); }
  if (MinyanNotify.holyNow(cfg, now)) { await note(false, 'Shabbos / Yom Tov: nothing changed, nothing answered'); return ''; } /* nothing is changed or sent on Shabbos and Yom Tov */
  try {
    if (res.wantsUndo) {
      var rec = await env.SUBS.get(undoKey, 'json');
      if (!rec) return L.noUndo;
      res = MinyanEdit.undo(cfg, rec, res.lang, now);
      if (res.cfg) { await keepDay(env, siteCfg, days, res.cfg, rec.iso, rec.tefilla); await env.SUBS.delete(undoKey); }
    } else if (res.cfg) {
      await keepDay(env, siteCfg, days, res.cfg, res.undo.iso, res.undo.tefilla);
      await env.SUBS.put(undoKey, JSON.stringify(res.undo), { expirationTtl: 86400 });
    } else if (read.text === 'gabbai' || (MinyanEdit.parse(read.text) || {}).action === 'help') return res.reply; /* the examples: not worth a line in the log */
  } catch (e) { await note(false, 'not saved: ' + (e && e.message || e)); return L.failed; }
  await note(!!res.cfg, res.reply);
  return res.reply;
}

/* "Quick change" in the back end: what the gabbai wants, in his own words, done at once the way a gabbai's text is done. The
   admin PIN was checked by the caller. One day only, kept with the texted changes, and "undo" takes the last one back. */
async function adminEdit(env, text) {
  var siteCfg = await loadSiteConfig(env), days = await textDays(env, siteCfg), cfg = MinyanEngine.withDayLines(siteCfg, days), now = Date.now(), undoKey = 'undo:admin';
  var read = await readEdit(env, cfg, text, now), out = { ok: false, ai: !!env.AI, by: read ? read.by : 'none', aiError: read && read.aiError || undefined, reply: '' };
  if (!read || !read.text) return out; /* not a change it can make */
  var res = MinyanEdit.run(cfg, read.text, now, read.lang), L = MinyanEdit.T[res.lang];
  if (read.by === 'ai') out.read = read.text;
  try {
    if (res.wantsUndo) {
      var rec = await env.SUBS.get(undoKey, 'json');
      if (!rec) { out.reply = L.noUndo; return out; }
      res = MinyanEdit.undo(cfg, rec, res.lang, now);
      if (res.cfg) { await keepDay(env, siteCfg, days, res.cfg, rec.iso, rec.tefilla); await env.SUBS.delete(undoKey); }
    } else if (res.cfg) {
      await keepDay(env, siteCfg, days, res.cfg, res.undo.iso, res.undo.tefilla);
      await env.SUBS.put(undoKey, JSON.stringify(res.undo), { expirationTtl: 86400 });
      out.canUndo = true;
    }
  } catch (e) { out.reply = L.failed; return out; }
  out.ok = !!res.cfg; out.reply = String(res.reply || '').replace('\n' + L.undoHint, '');
  if (res.cfg) await editLog(env, { at: now, who: 'Back end', text: String(text).trim().slice(0, 140), ok: true, reply: String(res.reply).split('\n')[0].slice(0, 200), read: out.read });
  return out;
}

export default {
  async fetch(request, env) {
    var url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    if (path === '/push/key') return new Response((await vapidKeys(env)).pub, { headers: cors(env, { 'content-type': 'text/plain' }) });
    if (path === '/push/subscribe' && request.method === 'POST') {
      var body = await request.json().catch(function () { return null; });
      if (!body || !body.subscription || !body.subscription.endpoint || !body.subscription.keys) return json(env, { error: 'bad request' }, 400);
      var id = body.id && /^[a-z0-9]{8,32}$/.test(body.id) ? body.id : crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      var sub = { channel: 'push', push: { endpoint: body.subscription.endpoint, keys: body.subscription.keys }, reminders: (body.reminders || []).slice(0, 10).map(function (r) { var lead = Math.min(180, Math.max(1, +r.lead || 10)), o; if (/^(alos|sunrise|shema|tefilla|chatzos|minchag|plag|candles|sunset|tzeis|tzeis60|tzeis72)$/.test(r.zman || '')) o = { zman: r.zman, lead: lead }; else { o = { tefilla: String(r.tefilla), time: r.time == null ? null : +r.time, lead: lead }; if (o.time == null && /^(first|last|before:(chatzos|tefilla|shema|sunset|tzeis|plag|minchag))$/.test(r.pick || '')) o.pick = r.pick; if (r.ref === 'milestone') o.ref = 'milestone'; } if (/^\d{4}-\d{2}-\d{2}$/.test(r.once || '')) o.once = r.once; return o; }),
        daily: body.daily == null ? null : +body.daily, lang: body.lang === 'en' ? 'en' : 'he', updated: Date.now() };
      await env.SUBS.put('push:' + id, JSON.stringify(sub));
      return json(env, { id: id });
    }
    if (path === '/push/unsubscribe' && request.method === 'POST') {
      var b2 = await request.json().catch(function () { return {}; });
      if (b2.id && /^[a-z0-9]{8,32}$/.test(b2.id)) await env.SUBS.delete('push:' + b2.id);
      return json(env, { ok: true });
    }
    /* The gabbai sends a notification to every device that turned reminders on. Authorised by the admin PIN (the site's config carries its hash)
       or the BROADCAST_KEY secret; ten wrong tries lock that address out for an hour. {test: id} sends to that one device only. */
    if (path === '/push/broadcast' && request.method === 'POST') {
      var bb = await request.json().catch(function () { return null; });
      if (!bb) return json(env, { error: 'bad request' }, 400);
      var bcfg = await loadConfig(env);
      if (MinyanNotify.holyNow(bcfg, Date.now())) return json(env, { error: 'Nothing is sent on Shabbos or Yom Tov.' }, 409); /* no notifications on Shabbos and Yom Tov */
      var refused = await adminRefusal(request, env, bb, bcfg);
      if (refused) return refused;
      var title = String(bb.title || bcfg.name || '').trim().slice(0, 80), text = String(bb.body || '').trim().slice(0, 300);
      if (!text) return json(env, { error: 'empty message' }, 400);
      var names = await allSubscriptions(env), payload = JSON.stringify({ title: title, body: text, tag: 'gabbai-' + Date.now() }), penv = await pushEnv(env), sent = 0, failed = 0, gone = 0, k;
      if (bb.test) names = names.filter(function (nm) { return nm === 'push:' + bb.test; });
      for (k = 0; k < names.length; k++) {
        var ps = await env.SUBS.get(names[k], 'json');
        if (!ps || ps.channel !== 'push') continue;
        try {
          var pr = await WebPush.send(ps.push, payload, penv);
          if (pr.status === 404 || pr.status === 410) { await env.SUBS.delete(names[k]); gone++; } else if (pr.status < 300) sent++; else failed++;
        } catch (e) { failed++; }
      }
      return json(env, { sent: sent, failed: failed, gone: gone });
    }
    /* the one-day changes that were texted in, for the board and the app to lay over the settings: schedule lines only, nothing private */
    if (path === '/changes') return new Response(JSON.stringify({ days: await textDays(env, await loadSiteConfig(env)) }), { headers: { 'Access-Control-Allow-Origin': '*', 'content-type': 'application/json', 'cache-control': 'no-store' } });
    /* Who may change the schedule by a text: the admin page reads and saves the list here, with the admin PIN. The numbers live in KV
       only. Also tells the page whether the service can do it yet, and the last changes that were texted in. */
    if (path === '/editors' && request.method === 'POST') {
      var eb = await request.json().catch(function () { return null; });
      if (!eb) return json(env, { error: 'bad request' }, 400);
      var no = await adminRefusal(request, env, eb, await loadConfig(env));
      if (no) return no;
      if (Array.isArray(eb.editors)) {
        var seen = {}, clean = [];
        eb.editors.slice(0, 20).forEach(function (e) { var n = phoneDigits(e && e.number); if (/^\d{11,15}$/.test(n) && !seen[n]) { seen[n] = 1; clean.push({ n: n, name: String(e.name || '').trim().slice(0, 40) }); } });
        await env.SUBS.put('editors', JSON.stringify(clean));
      }
      var keyError = '';
      /* the Twilio Auth Token, handed over the same way (or '' to forget it): it only proves a text is from Twilio; it is not used to send */
      /* the Account SID, given together with the token: lets the service ask Twilio about a relayed text */
      if (typeof eb.twilioSid === 'string') {
        if (!eb.twilioSid) await env.SUBS.delete('twacct');
        else if (!/^AC[0-9a-fA-F]{32}$/.test(eb.twilioSid.trim())) keyError = 'That does not look like a Twilio Account SID: it starts with AC and is 34 letters and digits.';
        else await env.SUBS.put('twacct', eb.twilioSid.trim());
      }
      /* both given: try them on Twilio at once, so a typing mistake is said now and not found out on the next text */
      if (!keyError && typeof eb.twilioKey === 'string' && eb.twilioKey && typeof eb.twilioSid === 'string' && eb.twilioSid) {
        var probeTw = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + eb.twilioSid.trim() + '.json', { headers: { Authorization: 'Basic ' + btoa(eb.twilioSid.trim() + ':' + eb.twilioKey.trim()) } }).catch(function () { return null; });
        if (!probeTw) keyError = 'Twilio did not answer. Try again in a minute.';
        else if (!probeTw.ok) { keyError = 'Twilio does not accept this Account SID and Auth Token together. Copy both again from the Twilio home page.'; await env.SUBS.delete('twacct'); eb.twilioKey = null; }
      }
      if (typeof eb.twilioKey === 'string') {
        if (!eb.twilioKey) { await env.SUBS.delete('twkey'); await env.SUBS.delete('twacct'); }
        else if (!/^[A-Za-z0-9]{32}$/.test(eb.twilioKey.trim())) keyError = 'That does not look like a Twilio Auth Token: it is 32 letters and digits.';
        else await env.SUBS.put('twkey', eb.twilioKey.trim());
      }
      /* "Try a text": what the service would make of a text and answer, without changing anything */
      var tried;
      if (typeof eb.tryText === 'string' && eb.tryText.trim()) {
        var tSite = await loadSiteConfig(env), tCfg = MinyanEngine.withDayLines(tSite, await textDays(env, tSite)), tNow = Date.now(), tRead = await readEdit(env, tCfg, eb.tryText, tNow);
        if (!tRead || !tRead.text) tried = { change: false, by: tRead ? tRead.by : 'none', aiError: tRead && tRead.aiError || undefined, reply: MinyanSms.buildReply(tCfg, eb.tryText, tNow).text, ordinary: true };
        else { var tRes = MinyanEdit.run(tCfg, tRead.text, tNow, tRead.lang); tried = { change: !!tRes.cfg, by: tRead.by, read: tRead.by === 'ai' ? tRead.text : undefined, aiError: tRead.aiError || undefined, reply: tRes.wantsUndo ? '(takes back the sender\'s last change)' : tRes.reply }; }
        tried.ai = !!env.AI;
      }
      var done;
      if (typeof eb.doText === 'string' && eb.doText.trim() && eb.doText.length <= 300) done = await adminEdit(env, eb.doText.trim());
      if (typeof eb.clearDay === 'string') { var td = (await env.SUBS.get('textdays', 'json')) || {}; delete td[eb.clearDay]; await env.SUBS.put('textdays', JSON.stringify(td)); } /* a day's texted changes taken back from the admin page */
      if (eb.forgetAccount) await env.SUBS.delete('twsid'); /* start over: the next text from Twilio says which account is the shul's */
      var kvTw = !!(await env.SUBS.get('twkey')), sid = await env.SUBS.get('twsid');
      return json(env, { editors: ((await env.SUBS.get('editors', 'json')) || []).map(function (e) { return { number: '+' + e.n, name: e.name }; }),
        log: (await env.SUBS.get('editlog', 'json')) || [], keyError: keyError || undefined,
        lastText: (await env.SUBS.get('lasttext', 'json')) || undefined, days: await textDays(env), tried: tried, done: done, ai: !!env.AI,
        /* how the service knows a text is really from Twilio: 'signature' (the Auth Token checks every text), 'account' (texts must
           come from the Twilio account the first text came from), or '' (no text has come yet) */
        ready: { trust: env.TWILIO_AUTH_TOKEN || kvTw ? 'signature' : sid ? 'account' : '', twilioFrom: env.TWILIO_AUTH_TOKEN ? 'secret' : kvTw ? 'device' : '', twilioAccount: !!(await env.SUBS.get('twacct')) } });
    }
    /* Twilio webhook (SMS or WhatsApp): POST form. GET ?q=text[&from=+1…] answers in plain text for testing. */
    var isPost = request.method === 'POST', text = '', params = {}, from = '', signed = false;
    if (isPost) {
      var form = await request.formData();
      form.forEach(function (v, k) { params[k] = v; });
      text = params.Body || ''; from = params.From || '';
      /* Is this text really from Twilio, so that the sender's number can be believed?
         - With the TWILIO_AUTH_TOKEN secret every text is checked by its signature, and one that fails is refused, as always.
         - With the Auth Token the gabbai pasted into the admin page (KV "twkey") the same check, but a text that fails is still
           answered like any other; it only cannot change anything. A wrong token must not silence the shul's number.
         - With neither: Twilio sends its account's ID with every text. The first text to arrive says which account is the shul's
           (KV "twsid"); from then on only texts carrying that ID are believed. The ID is long and is not published anywhere, which
           keeps out someone who merely knows this address and a gabbai's number; the Auth Token is the stronger lock. */
      var hadSig = !!request.headers.get('X-Twilio-Signature'), twk = env.TWILIO_AUTH_TOKEN || (await env.SUBS.get('twkey'));
      if (twk) { signed = await twilioSignatureOk(request, params, twk); if (!signed && env.TWILIO_AUTH_TOKEN) return new Response('forbidden', { status: 403 }); }
      /* A text passed on by the shul's own relay (a Twilio Function that keeps only Body, From, To and MessageSid) has no signature to
         check. With the account's SID and Auth Token (given on the admin page) the service asks Twilio itself about that message ID:
         it is believed only if Twilio has it as a text that came in to the shul's number from that sender with those words. */
      if (twk) { if (!signed && !hadSig && /^(SM|MM)[0-9a-fA-F]{32}$/.test(params.MessageSid || '')) signed = await twilioHasMessage(env, twk, params); }
      else if (/^AC[0-9a-fA-F]{32}$/.test(params.AccountSid || '')) { /* with or without the signature header: some setups pass Twilio's text on through a function of their own, which drops it */
        var pinned = await env.SUBS.get('twsid');
        if (!pinned) { pinned = params.AccountSid; await env.SUBS.put('twsid', pinned); }
        signed = pinned === params.AccountSid;
      }
      /* when the last text arrived and whether it was believed: the admin page shows it, to tell "texts do not reach this service" from the rest */
      /* also the shape of it, never its contents: which fields and which headers came. That tells a text passed on by something
         else (no signature, perhaps no account ID) from one straight from Twilio. */
      var hdrs = []; request.headers.forEach(function (v, k) { if (/^(x-|user-agent$|content-type$|i-twilio)/i.test(k) && !/^x-(real-ip|forwarded-for)$/i.test(k)) hdrs.push(/^(user-agent|content-type)$/i.test(k) ? k + ': ' + String(v).slice(0, 60) : k); });
      await env.SUBS.put('lasttext', JSON.stringify({ at: Date.now(), signed: signed, hadSignature: hadSig, hasAccount: /^AC[0-9a-fA-F]{32}$/.test(params.AccountSid || ''), fields: Object.keys(params).sort().slice(0, 40), headers: hdrs.sort().slice(0, 30), path: path || '/' }));
    } else { text = url.searchParams.get('q') || url.searchParams.get('Body') || ''; from = url.searchParams.get('from') || ''; }
    var reply;
    try {
      var siteCfg = await loadSiteConfig(env), days = await textDays(env, siteCfg), cfg = MinyanEngine.withDayLines(siteCfg, days), cmd = MinyanNotify.parseCommand(text, cfg);
      /* a change to the schedule: only by a text that is really from Twilio (so the sender's number is real), never by the test address */
      var edited = isPost && signed ? await textEdit(env, cfg, siteCfg, days, text, from) : null;
      if (edited != null) reply = edited;
      else if (cmd) {
        if (!from) reply = MinyanNotify.T[cmd.lang].notAvail;
        else {
          var key = 'sub:' + from, s = (await env.SUBS.get(key, 'json')) || {};
          s.channel = /^whatsapp:/.test(from) ? 'whatsapp' : 'sms'; s.to = from;
          reply = MinyanNotify.apply(cmd, s, cfg);
          if (!s.reminders.length && s.daily == null) await env.SUBS.delete(key); else await env.SUBS.put(key, JSON.stringify(s));
        }
      } else reply = MinyanSms.buildReply(cfg, text, Date.now()).text;
    } catch (e) { reply = 'Sorry, the schedule is unavailable right now. / הלוח אינו זמין כרגע'; }
    if (isPost) return twiml(reply);
    return new Response(reply, { headers: cors(env, { 'content-type': 'text/plain; charset=utf-8' }) });
  },
  async scheduled(event, env) {
    var cfg = await loadConfig(env), now = Date.now(), names = await allSubscriptions(env), i, j;
    for (i = 0; i < names.length; i++) {
      var sub = await env.SUBS.get(names[i], 'json');
      if (!sub) continue;
      if (MinyanNotify.prune(cfg, sub, now)) { /* a "today only" reminder whose day has passed */
        if (!sub.reminders.length && sub.daily == null) { await env.SUBS.delete(names[i]); continue; }
        await env.SUBS.put(names[i], JSON.stringify(sub));
      }
      var due = MinyanNotify.due(cfg, sub, now, 5);
      for (j = 0; j < due.length; j++) {
        var sentKey = 'sent:' + names[i] + ':' + due[j].key;
        if (await env.SUBS.get(sentKey)) continue;
        await env.SUBS.put(sentKey, '1', { expirationTtl: 86400 });
        try {
          if (sub.channel === 'push') {
            var r = await WebPush.send(sub.push, JSON.stringify({ title: due[j].title, body: due[j].text, tag: due[j].key }), await pushEnv(env));
            if (r.status === 404 || r.status === 410) await env.SUBS.delete(names[i]);
          } else await sendTwilio(env, sub.to, due[j].text);
        } catch (e) {}
      }
    }
  }
};
