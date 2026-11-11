// Builds src/index.html (the claude.ai artifact page) and docs/ (complete static site + PWA, served by GitHub Pages) from config.default.json.
// Usage: node build.js [--remote https://your-site/config.json]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const T = require('./src/template.js');
const args = process.argv.slice(2), ri = args.indexOf('--remote');
let cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.default.json'), 'utf8'));
// docs/config.json is what the admin page publishes (the gabbai's live data). When it is newer than config.default.json,
// it becomes the source, so a rebuild never undoes a published change.
try {
  const pub = JSON.parse(fs.readFileSync(path.join(__dirname, 'docs/config.json'), 'utf8'));
  if ((pub.savedAt || 0) > (cfg.savedAt || 0)) { cfg = pub; fs.writeFileSync(path.join(__dirname, 'config.default.json'), JSON.stringify(cfg, null, 1) + '\n'); console.log('config.default.json taken from the newer published docs/config.json'); }
} catch (e) {}
if (ri >= 0 && args[ri + 1]) cfg.remoteConfigUrl = args[ri + 1];
const json = JSON.stringify(cfg, null, 1);
const name = cfg.name || 'לוח המנינים';
const body = T(json).replace('<title>לוח המנינים</title>', '<title>' + name.replace(/</g, '&lt;') + '</title>').replace('<div class="shul">לוח המנינים</div>', '<div class="shul">' + name.replace(/</g, '&lt;') + '</div>');
fs.writeFileSync(path.join(__dirname, 'src/index.html'), body);

const dist = path.join(__dirname, 'docs');
fs.mkdirSync(dist, { recursive: true });
const reset = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}';
const esc = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pwaHead = '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#4a3a28"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="' + esc(name) + '"><link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" type="image/png" href="favicon.png">';
const site = (cfg.siteUrl || '').trim().replace(/\/?$/, m => cfg.siteUrl ? '/' : '');
const desc = 'המנין הבא, כל המנינים לפי חדרים וזמני היום';
// the share image URL carries a version, so WhatsApp and friends fetch a changed image instead of their cached copy
const ogVer = (() => { try { return '?v=' + crypto.createHash('sha1').update(fs.readFileSync(path.join(dist, 'og-image.png'))).digest('hex').slice(0, 8); } catch (e) { return ''; } })();
const ogHead = '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(cfg.name || 'לוח המנינים') + '"><meta property="og:description" content="' + desc + '">' +
  '<meta property="og:image" content="' + (site ? site : '') + 'og-image.png' + ogVer + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:locale" content="he_IL">' +
  (site ? '<meta property="og:url" content="' + esc(site) + '">' : '') + '<meta name="twitter:card" content="summary_large_image"><meta name="description" content="' + desc + '">';
if (!site) console.warn('siteUrl is empty: share previews need the full site address (set it under Edit → General once the site is online, or in config.default.json).');
const full = '<!doctype html><html lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + reset + '</style>' + pwaHead + ogHead + '</head><body>' + body + '</body></html>';
fs.writeFileSync(path.join(dist, 'index.html'), full);
const adminFull = full.replace('<title>' + esc(name) + '</title>', '<title>' + esc(name) + ' – Admin</title>').replace('<head>', '<head><meta name="robots" content="noindex,nofollow">');
fs.writeFileSync(path.join(dist, 'admin.html'), adminFull);
// short ways in: /admin for the back end, /screen for the TV itself, /tv for the preview on a phone.
// They are plain pages next to the others, never folders: a folder address ends in "/", which the service
// worker of an older visit treats as the board. screen.html steps aside to the display; 404.html catches
// the rest, so /admin and /admin/ both land on the admin page whatever the host does with the address.
const jump = (target, title, body) => '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">' +
  '<title>' + esc(name) + ' \u2013 ' + esc(title) + '</title><link rel="icon" href="favicon.png">' +
  (target ? '<meta http-equiv="refresh" content="0; url=' + esc(target) + '">' : '') +
  '<style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#cdc5b6;color:#2e2923;font:16px -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;text-align:center;padding:1rem}a{color:#87662e}</style></head>' +
  '<body>' + body + '</body></html>';
fs.writeFileSync(path.join(dist, 'screen.html'), jump('index.html?view=display&full=1', 'Hallway screen',
  '<p>Opening the hallway screen\u2026 <a href="index.html?view=display&amp;full=1">carry on</a></p>' +
  '<script>location.replace("index.html?view=display&full=1" + (location.search ? "&" + location.search.slice(1) : "") + location.hash);<\/script>'));
fs.writeFileSync(path.join(dist, '404.html'), jump('', 'Page not found',
  '<p id="m">Looking for that page\u2026</p><p><a href="index.html">The board</a> \u00b7 <a href="admin.html">Admin</a> \u00b7 ' +
  '<a href="screen.html">Hallway screen</a> \u00b7 <a href="tv.html">Preview</a></p><script>' +
  '(function(){var parts=location.pathname.replace(/\\/+$/,"").split("/");' +
  'var seg=(parts.pop()||"").replace(/\\.html$/,"").toLowerCase();' +
  'if(seg==="index"||seg==="")seg=(parts.pop()||"").toLowerCase();' + /* /admin/ and /admin/index.html land here too */
  'var base=parts.join("/")+"/";' + /* the site root, whether that is "/" or "/minyan/" */
  'var to={admin:"admin.html",screen:"screen.html",tv:"tv.html",sign:"sign.html",sms:"sms.html",board:"index.html"}[seg];' +
  'if(to&&base+to!==location.pathname)location.replace(base+to+location.search+location.hash);' +
  'else document.getElementById("m").textContent="That page is not here.";})();<\/script>'));
// offline.html: what the store app shows when the phone has no connection (the app opens the website itself; see app/capacitor.config.json).
// It stands on its own — no file beside it, nothing from the network — waits, looks again by itself, and opens the board when the connection is back.
const OFFLINE = {
  he: { dir: 'rtl', title: 'אין חיבור לאינטרנט', text: 'הלוח ייפתח מעצמו ברגע שהחיבור יחזור.', button: 'לנסות שוב', waiting: 'ממתין לחיבור…', checking: 'בודק את החיבור…', found: 'החיבור חזר. פותח את הלוח…' },
  yi: { dir: 'rtl', title: 'קיין אינטערנעט', text: 'דער לוח עפנט זיך אליין ווי נאר די פארבינדונג קומט צוריק.', button: 'פרובירן נאכאמאל', waiting: 'מען ווארט אויף די פארבינדונג…', checking: 'מען קוקט נאך די פארבינדונג…', found: 'די פארבינדונג איז צוריק. דער לוח עפנט זיך…' },
  en: { dir: 'ltr', title: 'No internet connection', text: 'The board will open by itself as soon as the connection is back.', button: 'Try again', waiting: 'Waiting for the connection…', checking: 'Checking the connection…', found: 'Back online. Opening the board…' }
};
if (site) {
  const o = OFFLINE[cfg.lang] || OFFLINE.he, lang = OFFLINE[cfg.lang] ? cfg.lang : 'he';
  const fill = { LANG: lang, DIR: o.dir, NAME: esc(name), TITLE: esc(o.title), TEXT: esc(o.text), BUTTON: esc(o.button),
    SITE: JSON.stringify(site).replace(/</g, '\\u003c'), STRINGS: JSON.stringify({ waiting: o.waiting, checking: o.checking, found: o.found }).replace(/</g, '\\u003c') };
  fs.writeFileSync(path.join(dist, 'offline.html'), fs.readFileSync(path.join(__dirname, 'src/offline.html'), 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => fill[k]));
}
for (const f of ['style.css', 'cal.js', 'engine.js', 'template.js', 'app.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(__dirname, 'src', f), path.join(dist, f));
fs.writeFileSync(path.join(dist, 'config.json'), json);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
const hash = crypto.createHash('sha256');
for (const f of ['index.html', 'style.css', 'cal.js', 'engine.js', 'template.js', 'app.js', 'manifest.webmanifest']) hash.update(fs.readFileSync(path.join(dist, f)));
const sw = fs.readFileSync(path.join(__dirname, 'src/sw.js'), 'utf8').replace("var VERSION = 'minyan-shell-dev';", "var VERSION = 'minyan-shell-" + hash.digest('hex').slice(0, 12) + "';");
fs.writeFileSync(path.join(dist, 'sw.js'), sw);
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.png', 'og-image.png']) {
  if (!fs.existsSync(path.join(dist, f))) console.warn('missing ' + f + ' (run node assets/make-icons.js and node assets/make-og.js)');
}
// SMS responder bundles: one file to paste into Twilio Functions, one to deploy as a Cloudflare Worker
const strip = t => t.replace(/^if \(typeof module !== 'undefined'\) module\.exports = .*;$/mg, '');
const core = ['src/cal.js', 'src/engine.js', 'src/sms.js', 'src/notify.js'].map(f => strip(fs.readFileSync(path.join(__dirname, f), 'utf8'))).join('\n');
fs.mkdirSync(path.join(__dirname, 'sms/dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'sms/dist/twilio-function.js'), core + '\n' + fs.readFileSync(path.join(__dirname, 'sms/twilio.js'), 'utf8'));
fs.writeFileSync(path.join(__dirname, 'sms/dist/worker.js'), core + '\n' + strip(fs.readFileSync(path.join(__dirname, 'sms/webpush.js'), 'utf8')) + '\n' + fs.readFileSync(path.join(__dirname, 'sms/worker.js'), 'utf8'));
// Capacitor app: copy the site into app/www when the app project exists, and point the app at the website itself.
// The app then shows whatever the website shows — a change published to the site needs no new build of the app — and falls back
// to offline.html, which stands on its own, when the phone has no connection.
const capFile = path.join(__dirname, 'app', 'capacitor.config.json');
if (fs.existsSync(capFile) && /^https:\/\//.test(site)) {
  const before = fs.readFileSync(capFile, 'utf8'), cap = JSON.parse(before);
  cap.server = Object.assign({}, cap.server, { url: site.replace(/\/$/, ''), errorPath: 'offline.html' });
  cap.appendUserAgent = ' MinyanBoardApp'; /* how the site knows it is inside the app, so it does not offer to "install the app" there */
  const after = JSON.stringify(cap, null, 2) + '\n';
  if (after !== before) fs.writeFileSync(capFile, after);
}
const www = path.join(__dirname, 'app', 'www');
if (fs.existsSync(path.join(__dirname, 'app'))) {
  fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www, { recursive: true });
  fs.cpSync(dist, www, { recursive: true }); /* folders too, such as docs/admin */
}
console.log('built src/index.html, docs/, sms/dist/' + (fs.existsSync(www) ? ' and app/www' : '') + (cfg.remoteConfigUrl ? ' (remote: ' + cfg.remoteConfigUrl + ')' : ''));
