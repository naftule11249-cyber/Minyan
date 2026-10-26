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
const pwaHead = '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#3a332c"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="' + esc(name) + '"><link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" type="image/png" href="favicon.png">';
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
// Capacitor app: copy the site into app/www when the app project exists
const www = path.join(__dirname, 'app', 'www');
if (fs.existsSync(path.join(__dirname, 'app'))) {
  fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www, { recursive: true });
  for (const f of fs.readdirSync(dist)) fs.copyFileSync(path.join(dist, f), path.join(www, f));
}
console.log('built src/index.html, docs/, sms/dist/' + (fs.existsSync(www) ? ' and app/www' : '') + (cfg.remoteConfigUrl ? ' (remote: ' + cfg.remoteConfigUrl + ')' : ''));
