// Builds src/index.html (the claude.ai artifact page) and docs/ (complete static site + PWA, served by GitHub Pages) from config.default.json.
// Usage: node build.js [--remote https://your-site/config.json]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const T = require('./src/template.js');
const args = process.argv.slice(2), ri = args.indexOf('--remote');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.default.json'), 'utf8'));
if (ri >= 0 && args[ri + 1]) cfg.remoteConfigUrl = args[ri + 1];
const json = JSON.stringify(cfg, null, 1);
const body = T(json);
fs.writeFileSync(path.join(__dirname, 'src/index.html'), body);

const dist = path.join(__dirname, 'docs');
fs.mkdirSync(dist, { recursive: true });
const reset = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}';
const pwaHead = '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#223b68"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="מנינים"><link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" type="image/png" href="favicon.png">';
const full = '<!doctype html><html lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + reset + '</style>' + pwaHead + '</head><body>' + body + '</body></html>';
fs.writeFileSync(path.join(dist, 'index.html'), full);
for (const f of ['style.css', 'cal.js', 'engine.js', 'template.js', 'app.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(__dirname, 'src', f), path.join(dist, f));
fs.writeFileSync(path.join(dist, 'config.json'), json);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
const hash = crypto.createHash('sha256');
for (const f of ['index.html', 'style.css', 'cal.js', 'engine.js', 'template.js', 'app.js', 'manifest.webmanifest']) hash.update(fs.readFileSync(path.join(dist, f)));
const sw = fs.readFileSync(path.join(__dirname, 'src/sw.js'), 'utf8').replace("var VERSION = 'minyan-shell-dev';", "var VERSION = 'minyan-shell-" + hash.digest('hex').slice(0, 12) + "';");
fs.writeFileSync(path.join(dist, 'sw.js'), sw);
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.png']) {
  if (!fs.existsSync(path.join(dist, f))) console.warn('missing icon ' + f + ' (run node assets/make-icons.js)');
}
// SMS responder bundles: one file to paste into Twilio Functions, one to deploy as a Cloudflare Worker
const strip = t => t.replace(/^if \(typeof module !== 'undefined'\) module\.exports = .*;$/mg, '');
const core = ['cal.js', 'engine.js', 'sms.js'].map(f => strip(fs.readFileSync(path.join(__dirname, 'src', f), 'utf8'))).join('\n');
fs.mkdirSync(path.join(__dirname, 'sms/dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'sms/dist/twilio-function.js'), core + '\n' + fs.readFileSync(path.join(__dirname, 'sms/twilio.js'), 'utf8'));
fs.writeFileSync(path.join(__dirname, 'sms/dist/worker.js'), core + '\n' + fs.readFileSync(path.join(__dirname, 'sms/worker.js'), 'utf8'));
// Capacitor app: copy the site into app/www when the app project exists
const www = path.join(__dirname, 'app', 'www');
if (fs.existsSync(path.join(__dirname, 'app'))) {
  fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www, { recursive: true });
  for (const f of fs.readdirSync(dist)) fs.copyFileSync(path.join(dist, f), path.join(www, f));
}
console.log('built src/index.html, docs/, sms/dist/' + (fs.existsSync(www) ? ' and app/www' : '') + (cfg.remoteConfigUrl ? ' (remote: ' + cfg.remoteConfigUrl + ')' : ''));
