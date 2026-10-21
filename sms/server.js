#!/usr/bin/env node
/* Plain Node server for the SMS responder (any host that runs Node, or local testing).
   POST (Twilio webhook, form-encoded) -> TwiML; GET /?q=text -> plain text.
   Env: CONFIG_URL (your site's config.json) or CONFIG_FILE (local file), PORT (default 8788). */
const http = require('http'), fs = require('fs'), path = require('path'), qs = require('querystring');
global.Cal = require('../src/cal.js'); global.MinyanEngine = require('../src/engine.js');
const MinyanSms = require('../src/sms.js'); global.MinyanSms = MinyanSms; const MinyanNotify = require('../src/notify.js');
async function loadCfg() {
  if (process.env.CONFIG_URL) return (await fetch(process.env.CONFIG_URL, { cache: 'no-store' })).json();
  return JSON.parse(fs.readFileSync(process.env.CONFIG_FILE || path.join(__dirname, '..', 'config.default.json'), 'utf8'));
}
const escapeXml = s => s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const isPost = req.method === 'POST';
  const text = isPost ? (qs.parse(body).Body || '') : (new URL(req.url, 'http://x').searchParams.get('q') || '');
  let reply;
  try { const cfg = await loadCfg(), cmd = MinyanNotify.parseCommand(String(text), cfg); reply = cmd ? MinyanNotify.T[cmd.lang].notAvail : MinyanSms.buildReply(cfg, String(text), Date.now()).text; }
  catch (e) { reply = 'Sorry, the schedule is unavailable right now. / הלוח אינו זמין כרגע'; }
  if (isPost) { res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response>' + (reply ? '<Message>' + escapeXml(reply) + '</Message>' : '') + '</Response>'); }
  else { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(reply); }
}).listen(process.env.PORT || 8788, () => console.log('SMS responder on port ' + (process.env.PORT || 8788)));
