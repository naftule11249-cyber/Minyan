/* template.js — the canonical page body. index.html is generated from this, and the admin panel
   regenerates the page from it when it saves a new schedule. */
var MinyanTemplate = function (configJson) {
  return '<title>לוח המנינים</title>\n' +
    '<meta name="claude:viewport-fit-sides" content="cover">\n' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;700&family=Heebo:wght@400;500;700&display=swap">\n' +
    '<link rel="stylesheet" href="style.css">\n' +
    '<div id="app" dir="rtl" lang="he"><header class="top"><div class="inner"><div class="shul">לוח המנינים</div><h1 class="dayline">טוען את הלוח…</h1></div></header>' +
    '<main><div class="col"><section class="next"><h2>מנין הבא</h2><div class="empty">מחשב את המנין הקרוב…</div></section></div></main></div>\n' +
    '<script id="config" type="application/json">' + configJson.replace(/<\//g, '<\\/') + '</script>\n' +
    '<script src="cal.js"></script>\n<script src="engine.js"></script>\n<script src="template.js"></script>\n<script src="app.js"></script>\n';
};
if (typeof module !== 'undefined') module.exports = MinyanTemplate;
