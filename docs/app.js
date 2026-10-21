/* app.js — minyan board: schedule engine, rendering, admin panel, persistence. Needs cal.js and template.js. */
(function () {
  'use strict';
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag), k;
    if (attrs) for (k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    if (children) children.forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var cfg = {}, mode = 'static', inArtifact = false, artifactNs = null, canEdit = false, pinOk = false, ui = {}, deferredInstall = null;

  /* ---------- schedule engine (engine.js) ---------- */
  var engine = null;
  var TEFILLA_DEFAULTS = MinyanEngine.TEFILLA_DEFAULTS, FALLBACK = MinyanEngine.FALLBACK, TYPE_NAME = MinyanEngine.TYPE_NAME, TYPE_EN = MinyanEngine.TYPE_NAME_EN;
  var sameEntry = MinyanEngine.sameEntry, gregStr = MinyanEngine.gregStr, parseLine = MinyanEngine.parseLine;
  function setCfg(c) { cfg = (c && typeof c === 'object') ? c : {}; cfg.location = cfg.location || {}; engine = MinyanEngine(cfg); }
  function loc() { return engine.loc(); }
  function zmanimFor(rd) { return engine.zmanimFor(rd); }
  function resolveMin(spec, rd, type) { return engine.resolveMin(spec, rd, type); }
  function tefillos() { return engine.tefillos(); }
  function scheduleFor(rd) { return engine.scheduleFor(rd); }
  function upcoming(nowMs, nowRd) { return engine.upcoming(nowMs, nowRd); }
  function fmtTime(min) { return engine.fmtTime(min); }
  function fmtCountdown(ms) { return engine.fmtCountdown(ms); }
  function dayLine(info, rd) { return engine.dayLine(info, rd); }
  function typeLabel(s) { return engine.typeLabel(s); }

  /* ---------- rendering ---------- */
  function render() {
    var now = Date.now(), tz = loc().tz, n = Cal.nowInTz(now, tz), rd = n.rd;
    var info = Cal.dayInfo(rd, !!cfg.israel), z = zmanimFor(rd);
    var root = $('#app');
    root.innerHTML = '';
    var hebLine = Cal.formatHeb(info.heb);
    if (!isNaN(z.sunset) && n.min >= z.sunset) hebLine += ' · בערב: ' + Cal.formatHeb(Cal.hebFromRD(rd + 1));
    var chips = info.labels.map(function (l) { return el('span', { class: 'chip', text: l }); });
    root.appendChild(el('header', { class: 'top' }, [el('div', { class: 'inner' }, [
      el('div', { class: 'shul' }, [cfg.logo ? el('img', { class: 'logo', src: cfg.logo, alt: '' }) : null, el('span', { text: cfg.name || 'לוח המנינים' })]),
      el('h1', { class: 'dayline', text: dayLine(info, rd) }),
      el('div', { class: 'dates' }, [el('span', { text: hebLine }), el('span', { class: 'num', text: gregStr(rd) })]),
      chips.length ? el('div', { class: 'chips' }, chips) : null])]));

    var strip = sponsorsStrip();
    if (strip) root.appendChild(strip);
    var up = upcoming(now, rd);
    var main = el('main'), colA = el('div', { class: 'col' }), colB = el('div', { class: 'col' });
    var next = el('section', { class: 'next', 'aria-live': 'polite' }, [el('h2', { text: 'מנין הבא' })]);
    ui.countdown = null; ui.countdownMs = 0;
    if (up) {
      var e = up.entry;
      ui.countdownMs = e.ms;
      next.appendChild(el('div', { class: 'what', text: e.tefilla.name + (e.room ? ' – ' + e.room : '') }));
      next.appendChild(el('div', { class: 'time num', text: fmtTime(e.start) }));
      if (e.tefilla.milestone) next.appendChild(el('div', { class: 'ms num', text: e.tefilla.milestone + ' ' + fmtTime(e.milestone) }));
      ui.countdown = el('div', { class: 'count num', text: fmtCountdown(e.ms - now) });
      next.appendChild(ui.countdown);
      if (up.daysAhead > 0) next.appendChild(el('div', { class: 'when', text: (up.daysAhead === 1 ? 'מחר, ' : '') + Cal.DAY_NAMES[up.sched.info.dow] + ' ' + Cal.formatHeb(up.sched.info.heb) }));
      if (e.note) next.appendChild(el('div', { class: 'when', text: e.note }));
    } else {
      next.appendChild(el('div', { class: 'empty', text: 'לא רשומים מנינים לימים הקרובים. בכפתור Edit למטה אפשר להוסיף.' }));
    }
    colA.appendChild(next);
    colA.appendChild(daySections(scheduleFor(rd), now, up, true));
    if (up && up.daysAhead > 0) colA.appendChild(daySections(up.sched, now, up, false));
    colB.appendChild(zmanimPanel(info, z));
    var sms = smsPanel();
    if (sms) colB.appendChild(sms);
    main.appendChild(colA); main.appendChild(colB);
    root.appendChild(main);
    root.appendChild(footer());
    ui.lastRenderDay = rd; ui.lastMinute = Math.floor(now / 60000);
  }
  function daySections(s, now, up, isToday) {
    var wrap = el('div', { class: 'col' });
    wrap.appendChild(el('div', { class: 'day-head' }, [
      el('h2', { text: isToday ? 'היום' : Cal.DAY_NAMES[s.info.dow] + ' – ' + Cal.formatHeb(s.info.heb) }),
      el('span', { class: 'sub', text: typeLabel(s) })]));
    tefillos().forEach(function (t) {
      var list = s.byTefilla[t.id] || [], sec = el('section', { class: 'tefilla' });
      sec.appendChild(el('h3', null, ['מניני ' + t.name, list.length ? el('span', { class: 'n num', text: list.length + ' מנינים' }) : null]));
      if (!list.length) { sec.appendChild(el('div', { class: 'none', text: 'אין מנינים רשומים' })); }
      else {
        var grid = el('div', { class: 'grid' });
        list.forEach(function (e) {
          var cls = 'tile';
          if (up && sameEntry(e, up.entry)) cls += ' next';
          else if (e.ms <= now) cls += (now - e.ms < 45 * 60000) ? ' now' : ' past';
          grid.appendChild(el('div', { class: cls }, [
            el('div', { class: 'room', text: e.room || t.name }),
            el('div', { class: 'time num', text: fmtTime(e.start) }),
            t.milestone ? el('div', { class: 'ms num', text: t.milestone + ' ' + fmtTime(e.milestone) }) : null,
            e.note ? el('div', { class: 'note', text: e.note }) : null]));
        });
        sec.appendChild(grid);
      }
      wrap.appendChild(sec);
    });
    return wrap;
  }
  function zmanimPanel(info, z) {
    var keys = ['alos', 'sunrise', 'shema', 'tefilla', 'chatzos', 'minchag', 'plag', 'candles', 'sunset', 'tzeis', 'tzeis72'];
    var ul = el('ul', { class: 'zlist' });
    keys.forEach(function (k) {
      if (k === 'candles' && !(info.dow === 5 || info.erevYT)) return;
      if (k === 'tzeis72' && !cfg.showRT) return;
      var hi = k === 'candles' || (k === 'tzeis' && (info.shabbos || info.yomtov));
      ul.appendChild(el('li', { class: hi ? 'hi' : '' }, [el('span', { text: Cal.ZMAN_NAMES[k] }), el('span', { class: 'z num', text: fmtTime(z[k]) })]));
    });
    return el('section', { class: 'side' }, [el('h3', { text: 'זמני היום' }), ul]);
  }
  /* Sponsor boxes (פרנס החודש and friends) in a framed strip under the header */
  function sponsorsStrip() {
    var items = [];
    (cfg.notices || []).forEach(function (n) {
      if (!(n.body || '').trim()) return;
      items.push(el('section', { class: 'sponsor' }, [
        el('div', { class: 'frame' }),
        el('h2', { class: 't', text: n.title || '' }),
        el('div', { class: 'b', text: n.body.trim() })]));
    });
    if (!items.length) return null;
    return el('div', { class: 'sponsors' }, [el('div', { class: 'sponsors-inner' }, items)]);
  }
  function smsPanel() {
    var num = (cfg.smsNumber || '').trim();
    if (!num) return null;
    var digits = num.replace(/[^\d+]/g, '');
    return el('section', { class: 'side' }, [
      el('h3', { text: 'המנין הבא בהודעת טקסט' }),
      el('p', { class: 'sms-text', text: 'שלחו את המילה „מנין” למספר' }),
      el('div', { class: 'sms-num num', dir: 'ltr', text: num }),
      el('p', { class: 'hint', text: 'אפשר גם: שחרית, מנחה, מעריב, היום, מחר, זמנים' }),
      el('a', { class: 'btn', href: 'sms:' + digits + '?&body=' + encodeURIComponent('מנין'), text: 'שליחת הודעה' })]);
  }
  function footer() {
    var L = cfg.location || {};
    var f = el('footer', null, [el('span', { text: 'הזמנים לפי ' + (L.name || (L.lat + ', ' + L.lng)) + ' · ' + (cfg.israel ? 'לוח ארץ ישראל' : 'לוח חוץ לארץ') })]);
    var right = el('div', { class: 'tabs' });
    ui.iosHint = el('span', { class: 'hint', text: 'להתקנה באייפון: „שיתוף” ואז „הוספה למסך הבית”' });
    ui.installBtn = el('button', { class: 'btn small primary', text: 'התקנת האפליקציה', onclick: function () {
      if (!deferredInstall) return;
      var ev = deferredInstall; deferredInstall = null;
      ev.prompt(); ev.userChoice.then(refreshInstallBtn, refreshInstallBtn);
    } });
    ui.editBtn = el('button', { class: 'btn small', text: 'Edit', onclick: openAdmin });
    ui.editBtn.hidden = !canEditNow();
    right.appendChild(ui.iosHint); right.appendChild(ui.installBtn); right.appendChild(ui.editBtn);
    refreshInstallBtn();
    f.appendChild(right);
    return f;
  }
  function tick() {
    var now = Date.now();
    if (ui.adminOpen) return;
    if (ui.countdownMs && now >= ui.countdownMs) { render(); return; }
    if (ui.countdown) ui.countdown.textContent = fmtCountdown(ui.countdownMs - now);
    if (Math.floor(now / 60000) !== ui.lastMinute) render();
  }

  /* ---------- admin ---------- */
  function canEditNow() { return mode === 'artifact' ? canEdit : true; }
  function refreshEditBtn() { if (ui.editBtn) ui.editBtn.hidden = !canEditNow(); }
  function toast(msg, ms) {
    var t = $('#toast');
    if (t) t.remove();
    t = el('div', { id: 'toast', class: 'toast', dir: 'rtl', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3500);
  }
  function overlay(content) {
    var o = el('div', { id: 'overlay', class: 'overlay', dir: 'ltr' }, [el('div', { class: 'panel' }, [content])]);
    $('#app').appendChild(o);
    ui.adminOpen = true;
  }
  function closeOverlay() { ui.adminOpen = false; render(); }
  function openAdmin() { if (mode !== 'artifact' && !pinOk) showPin(); else buildAdmin(); }
  function showPin() {
    var input = el('input', { type: 'password', id: 'pin-input', inputmode: 'numeric', autocomplete: 'off' });
    var msg = el('div', { class: 'hint' });
    var form = el('form', { class: 'pin', onsubmit: function (ev) {
      ev.preventDefault();
      if (input.value === String(cfg.pin == null ? '1234' : cfg.pin)) {
        pinOk = true;
        try { sessionStorage.setItem('minyan-pin', '1'); } catch (e) {}
        closeOverlay(); buildAdmin();
      } else { msg.textContent = 'Wrong PIN'; input.select(); }
    } }, [
      el('h2', { text: 'Edit access' }),
      el('div', { class: 'field' }, [el('label', { for: 'pin-input', text: 'PIN' }), input]), msg,
      el('div', { class: 'bar' }, [el('button', { class: 'btn primary', type: 'submit', text: 'Enter' }), el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeOverlay })])]);
    overlay(form);
    input.focus();
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function field(label, input, extra) { return el('div', { class: 'field' }, [el('label', { for: input.id, text: label }), input, extra || null]); }
  function inp(id, value, attrs) {
    var a = { id: id, type: 'text', dir: 'auto', value: value == null ? '' : String(value) }, k;
    if (attrs) for (k in attrs) a[k] = attrs[k];
    return el('input', a);
  }
  function chk(id, checked, label) {
    var c = el('input', { id: id, type: 'checkbox' });
    c.checked = !!checked;
    return el('label', { for: id }, [c, ' ' + label]);
  }
  var uid = 0;
  function buildAdmin() {
    var d = clone(cfg);
    d.location = d.location || {}; d.schedules = d.schedules || {}; d.overrides = d.overrides || []; d.notices = d.notices || [];
    d.tefillos = (d.tefillos && d.tefillos.length) ? d.tefillos : clone(TEFILLA_DEFAULTS);
    var todayRd = Cal.nowInTz(Date.now(), loc().tz).rd;
    var tabs = [['general', 'General'], ['schedule', 'Schedule'], ['notices', 'Notices'], ['overrides', 'Special dates']];
    if (mode !== 'artifact') tabs.push(['publish', 'Publish']);
    tabs.push(['data', 'Backup']);
    var pages = {}, tabBar = el('div', { class: 'tabs', role: 'tablist' });
    tabs.forEach(function (t) { tabBar.appendChild(el('button', { type: 'button', role: 'tab', id: 'tab-' + t[0], 'aria-selected': 'false', text: t[1], onclick: function () { selectTab(t[0]); } })); });
    function selectTab(id) {
      tabs.forEach(function (t) { pages[t[0]].hidden = t[0] !== id; $('#tab-' + t[0], tabBar).setAttribute('aria-selected', String(t[0] === id)); });
      if (id === 'data') dataArea.value = JSON.stringify(collect(), null, 2);
    }

    var oRows = [];
    /* general */
    var g = el('div', { class: 'col' });
    var fName = inp('f-name', d.name), fLocName = inp('f-locname', d.location.name), fLat = inp('f-lat', d.location.lat, { inputmode: 'decimal' }),
      fLng = inp('f-lng', d.location.lng, { inputmode: 'decimal' }), fTz = inp('f-tz', d.location.tz || 'America/New_York', { list: 'tz-list' }),
      fElev = inp('f-elev', d.location.elev || 0, { inputmode: 'numeric' }), fCandles = inp('f-candles', d.candles == null ? 18 : d.candles, { inputmode: 'numeric' }),
      fTzeisMin = inp('f-tzeismin', d.tzeisMinutes || '', { inputmode: 'numeric', placeholder: 'blank = by degrees' }), fTzeisDeg = inp('f-tzeisdeg', d.tzeisDeg || 8.5, { inputmode: 'decimal' }),
      fPin = inp('f-pin', d.pin == null ? '1234' : d.pin);
    var fSms = inp('f-sms', d.smsNumber || '', { dir: 'ltr', placeholder: '+1 718 555 0100' });
    var fRooms = inp('f-rooms', d.rooms || '', { placeholder: 'ברך משה, דברי יואל, לב אהרן' });
    var fSite = inp('f-site', d.siteUrl || '', { dir: 'ltr', placeholder: 'https://yourname.github.io/minyan/' }), fLogo = inp('f-logo', d.logo || '', { dir: 'ltr', placeholder: 'logo.png' });
    g.appendChild(el('div', { class: 'fields' }, [field('Shul name (shown on the board)', fName), field('Location name (shown in the footer)', fLocName), field('SMS number (once the text service is set up)', fSms)]));
    g.appendChild(el('div', { class: 'fields' }, [field('Rooms / minyan names, comma-separated (suggested when you enter minyanim)', fRooms)]));
    g.appendChild(el('div', { class: 'fields' }, [field('Website address (used for share previews and the app)', fSite), field('Logo file shown in the header (file name next to index.html)', fLogo)]));
    g.appendChild(el('div', { class: 'fields' }, [field('Latitude', fLat), field('Longitude', fLng), field('Time zone', fTz), field('Elevation (meters)', fElev)]));
    g.appendChild(el('datalist', { id: 'tz-list' }, ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Europe/Antwerp', 'Europe/Zurich', 'Asia/Jerusalem', 'Australia/Melbourne'].map(function (z) { return el('option', { value: z }); })));
    g.appendChild(el('div', { class: 'fields' }, [field('Candle lighting: minutes before sunset', fCandles), field('Nightfall (tzeis): minutes after sunset', fTzeisMin), field('Nightfall: degrees below the horizon (used when minutes is blank)', fTzeisDeg)]));
    g.appendChild(el('div', { class: 'col' }, [chk('f-israel', d.israel, 'Eretz Yisroel calendar (one-day Yom Tov)'), chk('f-weekly', d.weeklyEarliest, 'Weekday zman-based times use the earliest sunset of the week (Sun–Thu)'), chk('f-24', d.clock24, '24-hour clock'), chk('f-rt', d.showRT, 'Show Rabbeinu Tam (72 minutes after sunset) in the zmanim list')]));
    if (mode !== 'artifact') g.appendChild(el('div', { class: 'fields' }, [field('Edit PIN', fPin, el('span', { class: 'hint', text: 'Stored inside the page. It prevents accidental edits; it is not security.' }))]));
    g.appendChild(el('h3', { text: 'Tefillos' }));
    var tRows = [];
    d.tefillos.forEach(function (t, i) {
      var r = { name: inp('t-name-' + i, t.name), ms: inp('t-ms-' + i, t.milestone), off: inp('t-off-' + i, t.offset, { inputmode: 'numeric' }),
        period: el('select', { id: 't-period-' + i }, [el('option', { value: 'am', text: 'Morning: 6:45 means 6:45 AM' }), el('option', { value: 'pm', text: 'Afternoon/evening: 6:45 means 6:45 PM' })]) };
      r.period.value = t.period || 'am';
      tRows.push(r);
      g.appendChild(el('div', { class: 'fields' }, [field('Name (shown on the board)', r.name), field('Milestone shown under the time (e.g. הודו)', r.ms), field('Milestone: minutes after the start', r.off), field('How to read the hours', r.period)]));
    });
    pages.general = g;
    function liveTefilla(i) { var r = tRows[i], t = d.tefillos[i]; return { id: t.id, name: r.name.value.trim() || t.name, milestone: r.ms.value.trim(), offset: +r.off.value || 0, period: r.period.value }; }

    /* schedule: one row per minyan */
    var lines = {};
    Cal.DAY_TYPES.forEach(function (t) { lines[t[0]] = {}; d.tefillos.forEach(function (tf) { lines[t[0]][tf.id] = { value: (d.schedules[t[0]] && d.schedules[t[0]][tf.id]) || '' }; }); });
    var ZMAN_OPTS = [['fixed', 'Fixed time'], ['sunrise', 'Sunrise (netz)'], ['alos', 'Dawn (alos)'], ['shema', 'Sof zman Shema'], ['chatzos', 'Chatzos'], ['minchag', 'Mincha gedola'],
      ['plag', 'Plag hamincha'], ['candles', 'Candle lighting'], ['sunset', 'Sunset (shkiah)'], ['tzeis', 'Nightfall (tzeis)'], ['tzeis72', 'Rabbeinu Tam (72 min)']];
    var ZWORD = { sunrise: 'sunrise', alos: 'alos', shema: 'shema', chatzos: 'chatzos', minchag: 'minchag', plag: 'plag', candles: 'candles', sunset: 'sunset', tzeis: 'tzeis', tzeis72: 'rt' };
    function hhmm(min) { min = Math.round(min); return pad2(Math.floor(min / 60) % 24) + ':' + pad2(min % 60); }
    function lineToRow(line, tf) {
      var p = parseLine(line, tf);
      if (!p) return null;
      if (!p.spec) return { raw: line.trim() };
      var r = { room: p.room, note: p.note, off: 0, round: false };
      if (p.spec.kind === 'fixed') { r.kind = 'fixed'; r.time = hhmm(p.spec.min); }
      else { r.kind = p.spec.zman; r.off = p.spec.offset || 0; r.round = !!p.spec.round; }
      return r;
    }
    function rowToLine(r) {
      if (r.raw != null) return r.raw;
      var tok = r.kind === 'fixed' ? (r.time || '07:00') : (ZWORD[r.kind] + (r.off ? (r.off < 0 ? '-' : '+') + Math.abs(r.off) : '') + (r.round ? '~5' : ''));
      return tok + (r.room ? ' ' + r.room : '') + (r.note ? ' // ' + r.note : '');
    }
    var roomsList = el('datalist', { id: 'rooms-list' });
    function refreshRooms() {
      var set = {}, probe = { period: 'am' };
      fRooms.value.split(',').forEach(function (x) { if (x.trim()) set[x.trim()] = 1; });
      Object.keys(lines).forEach(function (k) { Object.keys(lines[k]).forEach(function (id) { lines[k][id].value.split('\n').forEach(function (l) { var p = parseLine(l, probe); if (p && p.room) set[p.room] = 1; }); }); });
      oRows.forEach(function (r) { Object.keys(r.lines).forEach(function (id) { r.lines[id].value.split('\n').forEach(function (l) { var p = parseLine(l, probe); if (p && p.room) set[p.room] = 1; }); }); });
      roomsList.innerHTML = '';
      Object.keys(set).sort().forEach(function (name) { roomsList.appendChild(el('option', { value: name })); });
    }
    /* store = {value: lines text}; tfIndex = index into d.tefillos; typeKeyFn() = day type used for the "today" preview */
    function minyanEditor(store, tfIndex, typeKeyFn, copyFrom) {
      var wrap = el('div', { class: 'editor' }), list = el('div', { class: 'rows' }), rows = [], ta = null, seriesBox = null;
      function tf() { return liveTefilla(tfIndex); }
      function sync() { store.value = rows.map(rowToLine).join('\n'); if (ta) ta.value = store.value; refreshRooms(); markTabs(); }
      function load() { rows = []; store.value.split('\n').forEach(function (l) { var r = lineToRow(l, tf()); if (r) rows.push(r); }); }
      function previewOf(r) {
        var p = parseLine(rowToLine(r), tf());
        if (!p || !p.spec) return null;
        return resolveMin(p.spec, todayRd, typeKeyFn());
      }
      function renderRow(r) {
        var row = el('div', { class: 'mrow' });
        var del = el('button', { type: 'button', class: 'btn small danger', text: '✕', title: 'Remove this minyan', 'aria-label': 'Remove', onclick: function () { rows.splice(rows.indexOf(r), 1); row.remove(); sync(); } });
        if (r.raw != null) {
          var rawIn = el('input', { type: 'text', dir: 'auto', value: r.raw, class: 'grow' });
          rawIn.addEventListener('input', function () { r.raw = rawIn.value; sync(); });
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: 'bad', text: 'Cannot read this line:' }), rawIn, del]));
          return row;
        }
        var when = el('select', { 'aria-label': 'Time type' });
        ZMAN_OPTS.forEach(function (o) { when.appendChild(el('option', { value: o[0], text: o[1] })); });
        when.value = r.kind;
        var time = el('input', { type: 'time', value: r.time || '', 'aria-label': 'Time' });
        var sign = el('select', { 'aria-label': 'Before or after' }, [el('option', { value: '-', text: 'min before' }), el('option', { value: '+', text: 'min after' })]);
        sign.value = r.off < 0 ? '-' : '+';
        var mins = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', class: 'mins', value: String(Math.abs(r.off || 0)), 'aria-label': 'Minutes' });
        var roundC = el('input', { type: 'checkbox' }); roundC.checked = !!r.round;
        var roundL = el('label', { class: 'small' }, [roundC, ' round to 5']);
        var pv = el('span', { class: 'pv num' });
        var room = el('input', { type: 'text', list: 'rooms-list', dir: 'auto', placeholder: 'Room / minyan name', value: r.room || '', class: 'room', autocomplete: 'off' });
        var note = el('input', { type: 'text', dir: 'auto', placeholder: 'Note (optional)', value: r.note || '', class: 'grow' });
        function refresh() {
          var fixed = when.value === 'fixed';
          time.hidden = !fixed; sign.hidden = fixed; mins.hidden = fixed; roundL.hidden = fixed;
          var m = previewOf(r);
          pv.textContent = m == null || isNaN(m) ? '' : 'today ' + fmtTime(m);
        }
        when.addEventListener('change', function () { r.kind = when.value; if (r.kind === 'fixed' && !r.time) { r.time = '07:00'; time.value = r.time; } sync(); refresh(); });
        time.addEventListener('input', function () { r.time = time.value; sync(); refresh(); });
        function offChange() { r.off = (+mins.value || 0) * (sign.value === '-' ? -1 : 1); sync(); refresh(); }
        sign.addEventListener('change', offChange); mins.addEventListener('input', offChange);
        roundC.addEventListener('change', function () { r.round = roundC.checked; sync(); refresh(); });
        room.addEventListener('input', function () { r.room = room.value; sync(); });
        note.addEventListener('input', function () { r.note = note.value; sync(); });
        row.appendChild(el('div', { class: 'mrow-l' }, [when, time, sign, mins, roundL, pv]));
        row.appendChild(el('div', { class: 'mrow-l' }, [room, note, del]));
        refresh();
        return row;
      }
      function renderAll() { list.innerHTML = ''; rows.forEach(function (r) { list.appendChild(renderRow(r)); }); }
      function addRow(r) { rows.push(r); list.appendChild(renderRow(r)); sync(); }
      var addBtn = el('button', { type: 'button', class: 'btn small primary', text: '+ Add minyan', onclick: function () {
        var last = rows.length ? rows[rows.length - 1] : null, r = { kind: 'fixed', time: '07:00', off: 0, round: false, room: last ? last.room : '', note: '' };
        if (last && last.raw == null) { r.kind = last.kind; r.off = last.off; r.round = last.round; if (last.kind === 'fixed') { var m = previewOf(last); r.time = hhmm((isNaN(m) ? 7 * 60 : m) + 15); } }
        addRow(r);
        var inputs = list.lastChild.querySelectorAll('input, select'); if (inputs.length) inputs[0].focus();
      } });
      var seriesBtn = el('button', { type: 'button', class: 'btn small', text: 'Add a series…', onclick: function () { seriesBox.hidden = !seriesBox.hidden; } });
      var sFirst = el('input', { type: 'time', value: '06:20' }), sLast = el('input', { type: 'time', value: '12:00' }), sEvery = el('input', { type: 'number', min: '1', value: '20', class: 'mins', inputmode: 'numeric' }), sRooms = el('input', { type: 'text', dir: 'auto', placeholder: 'rooms in turn, e.g. ברך משה, דברי יואל', class: 'grow' });
      seriesBox = el('div', { class: 'series' }, [
        el('div', { class: 'mrow-l' }, ['From', sFirst, 'to', sLast, 'every', sEvery, 'min']),
        el('div', { class: 'mrow-l' }, [sRooms, el('button', { type: 'button', class: 'btn small primary', text: 'Add these', onclick: function () {
          var a = sFirst.value.split(':'), b = sLast.value.split(':'), step = +sEvery.value || 0;
          if (a.length < 2 || b.length < 2 || step < 1) { toast('Enter a first time, a last time and the minutes between minyanim'); return; }
          var start = +a[0] * 60 + +a[1], end = +b[0] * 60 + +b[1], names = sRooms.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), n = 0;
          for (var m = start; m <= end && n < 200; m += step, n++) addRow({ kind: 'fixed', time: hhmm(m), off: 0, round: false, room: names.length ? names[n % names.length] : '', note: '' });
          seriesBox.hidden = true;
        } })])]);
      seriesBox.hidden = true;
      var copySel = el('select', { 'aria-label': 'Copy from another day' });
      function fillCopy() {
        copySel.innerHTML = ''; copySel.appendChild(el('option', { value: '', text: 'Copy from…' }));
        (copyFrom || []).forEach(function (src) { if (src.store().value.trim()) copySel.appendChild(el('option', { value: src.key, text: src.label })); });
      }
      copySel.addEventListener('change', function () {
        var src = (copyFrom || []).filter(function (x) { return x.key === copySel.value; })[0];
        if (src) { store.value = src.store().value; load(); renderAll(); sync(); }
        copySel.value = '';
      });
      copySel.addEventListener('focus', fillCopy); fillCopy();
      var sortBtn = el('button', { type: 'button', class: 'btn small', text: 'Sort by time', onclick: function () {
        rows.sort(function (x, y) { var a = previewOf(x), b = previewOf(y); return (isNaN(a) ? 1e9 : a) - (isNaN(b) ? 1e9 : b); });
        renderAll(); sync();
      } });
      var textBtn = el('button', { type: 'button', class: 'btn small', text: 'Edit as text', onclick: function () {
        if (ta.hidden) { ta.value = store.value; ta.hidden = false; list.hidden = true; textBtn.textContent = 'Back to the list'; }
        else { load(); renderAll(); ta.hidden = true; list.hidden = false; textBtn.textContent = 'Edit as text'; }
      } });
      ta = el('textarea', { spellcheck: 'false', dir: 'auto' }); ta.hidden = true;
      ta.addEventListener('input', function () { store.value = ta.value; refreshRooms(); markTabs(); });
      load(); renderAll();
      wrap.appendChild(list); wrap.appendChild(ta);
      wrap.appendChild(el('div', { class: 'editor-bar' }, [addBtn, seriesBtn, copySel, sortBtn, textBtn]));
      wrap.appendChild(seriesBox);
      return wrap;
    }
    var sp = el('div', { class: 'col' });
    sp.appendChild(roomsList);
    sp.appendChild(el('details', { class: 'help' }, [el('summary', { text: 'How this works' }), el('div', { class: 'hint' }, [
      el('p', { text: 'Pick a day type, then add one row per minyan: a fixed time, or a zman (sunset, chatzos, candle lighting…) with minutes before or after. Type the room name; names you already used are suggested. "today" shows what that row gives today.' }),
      el('p', { text: '"Add a series" fills a run of minyanim at once, rotating through the rooms you list. "Copy from…" starts a day type from another one. A day type with no rows uses the more general one (Rosh Chodesh empty → Weekdays; Yom Tov empty → Shabbos).' }),
      el('p', null, ['"Edit as text" shows the same rows as lines like ', el('code', { text: '6:20 ברך משה' }), ' or ', el('code', { text: 'sunset-15 דברי יואל // note' }), ', handy for pasting a whole list.'])])]));
    var typeTabs = el('div', { class: 'tabs' }), typePages = {};
    sp.appendChild(typeTabs);
    Cal.DAY_TYPES.forEach(function (t) {
      var key = t[0], b = el('button', { type: 'button', id: 'dt-' + key, text: t[3], 'aria-selected': 'false', onclick: function () { showType(key); } });
      typeTabs.appendChild(b);
      var page = el('div', { class: 'col', id: 'dtp-' + key });
      page.hidden = true;
      page.appendChild(el('div', { class: 'hint', text: FALLBACK[key] ? t[3] + ' schedule. A tefilla with no rows here uses the ' + TYPE_EN[FALLBACK[key]] + ' schedule.' : t[3] + ' is the base schedule.' }));
      var row = el('div', { class: 'fields three' });
      d.tefillos.forEach(function (tf, i) {
        var sources = Cal.DAY_TYPES.filter(function (o) { return o[0] !== key; }).map(function (o) { return { key: o[0], label: o[3], store: function () { return lines[o[0]][tf.id]; } }; });
        row.appendChild(el('div', { class: 'field' }, [el('label', { text: tf.name }), minyanEditor(lines[key][tf.id], i, function () { return key; }, sources)]));
      });
      page.appendChild(row);
      typePages[key] = { page: page, button: b };
      sp.appendChild(page);
    });
    function markTabs() {
      Cal.DAY_TYPES.forEach(function (t) {
        var has = d.tefillos.some(function (tf) { return lines[t[0]][tf.id].value.trim(); });
        typePages[t[0]].button.classList.toggle('has', has);
      });
    }
    function showType(key) { Cal.DAY_TYPES.forEach(function (t) { typePages[t[0]].page.hidden = t[0] !== key; typePages[t[0]].button.setAttribute('aria-selected', String(t[0] === key)); }); }
    pages.schedule = sp;

    /* notices */
    var np = el('div', { class: 'col' }), nList = el('div', { class: 'col' }), nRows = [];
    function addNotice(n) {
      var id = ++uid, r = { title: inp('n-title-' + id, n.title), body: el('textarea', { id: 'n-body-' + id, dir: 'auto' }) };
      r.body.value = n.body || ''; r.body.style.minHeight = '70px';
      r.wrap = el('div', { class: 'ovr' }, [el('div', { class: 'fields' }, [field('Title', r.title), field('Text', r.body)]), el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: function () { nRows.splice(nRows.indexOf(r), 1); r.wrap.remove(); } })]);
      nRows.push(r); nList.appendChild(r.wrap);
    }
    (d.notices.length ? d.notices : [{ title: 'פרנס החודש', body: '' }, { title: 'פרנס השבוע', body: '' }, { title: 'נר למאור', body: '' }]).forEach(addNotice);
    np.appendChild(el('div', { class: 'hint', text: 'Sponsor panels (פרנס החודש, פרנס השבוע, נר למאור) and announcements, shown in framed boxes at the top of the board. A notice with empty text is not shown.' }));
    np.appendChild(nList);
    np.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', text: '+ Notice', onclick: function () { addNotice({ title: '', body: '' }); } })]));
    pages.notices = np;

    /* overrides */
    var op = el('div', { class: 'col' }), oList = el('div', { class: 'col' });
    function addOverride(o) {
      var id = ++uid, r = { date: inp('o-date-' + id, o.date, { type: 'date' }), label: inp('o-label-' + id, o.label), lines: {} };
      var row = el('div', { class: 'fields three' });
      function typeOfDate() {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date.value);
        if (!m) return 'weekday';
        return Cal.dayType(Cal.dayInfo(Cal.rdFromGreg(+m[1], +m[2], +m[3]), !!d.israel));
      }
      d.tefillos.forEach(function (tf, i) {
        r.lines[tf.id] = { value: (o.lines && o.lines[tf.id]) || '' };
        var sources = Cal.DAY_TYPES.map(function (t) { return { key: t[0], label: t[3], store: function () { return lines[t[0]][tf.id]; } }; });
        row.appendChild(el('div', { class: 'field' }, [el('label', { text: tf.name + ' (no rows = as usual)' }), minyanEditor(r.lines[tf.id], i, typeOfDate, sources)]));
      });
      r.wrap = el('div', { class: 'ovr' }, [el('div', { class: 'fields' }, [field('Date', r.date), field('Label shown on the board (e.g. yahrzeit, wedding)', r.label)]), row,
        el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: function () { oRows.splice(oRows.indexOf(r), 1); r.wrap.remove(); } })]);
      oRows.push(r); oList.appendChild(r.wrap);
    }
    d.overrides.forEach(addOverride);
    op.appendChild(el('div', { class: 'hint', text: 'A schedule for one date that replaces the regular one on that day only, for the tefillos you fill in.' }));
    op.appendChild(oList);
    op.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', text: '+ Date', onclick: function () { addOverride({ date: '', label: '', lines: {} }); } })]));
    pages.overrides = op;

    /* publish (self-hosted site / app) */
    var pp = el('div', { class: 'col' }), gh = ghSettings();
    var fRemote = inp('f-remote', d.remoteConfigUrl || '', { dir: 'ltr', placeholder: 'https://.../config.json' });
    var gRepo = inp('gh-repo', gh.repo || '', { dir: 'ltr', placeholder: 'username/minyan', autocomplete: 'off' }), gBranch = inp('gh-branch', gh.branch || 'main', { dir: 'ltr' }),
      gPath = inp('gh-path', gh.path || 'docs/config.json', { dir: 'ltr' }), gToken = inp('gh-token', gh.token || '', { type: 'password', dir: 'ltr', autocomplete: 'off' });
    var ghMsg = el('div', { class: 'hint' });
    function saveGh() {
      var s = { repo: gRepo.value.trim(), branch: gBranch.value.trim() || 'main', path: gPath.value.trim() || 'config.json', token: gToken.value.trim() };
      try { if (s.repo || s.token) localStorage.setItem('minyan-github', JSON.stringify(s)); else localStorage.removeItem('minyan-github'); } catch (e) {}
      return s;
    }
    pp.appendChild(el('div', { class: 'hint' }, [
      el('p', { text: 'The website and the app read the schedule from a file called config.json on the website. To make Save update everyone, set up automatic publishing to GitHub (the site is hosted there for free on GitHub Pages).' }),
      el('p', null, ['1. In your GitHub repository: Settings → Pages is enabled.  2. Create a fine-grained token with "Contents: Read and write" for that repository only: ', el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener', text: 'github.com/settings/personal-access-tokens/new' }), '.  3. Paste it here. The token stays in this browser only.'])]));
    pp.appendChild(el('div', { class: 'fields' }, [field('Repository (owner/repo)', gRepo), field('Branch', gBranch), field('File path', gPath), field('Token', gToken)]));
    pp.appendChild(el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn', text: 'Test connection', onclick: function () {
      var s = saveGh();
      if (!ghConfigured(s)) { ghMsg.textContent = 'Enter the repository and the token'; return; }
      ghMsg.textContent = 'Checking…';
      ghCheck(s).then(function (m) { ghMsg.textContent = m; }, function (e) { ghMsg.textContent = 'Failed: ' + e.message; });
    } }), ghMsg]));
    pp.appendChild(el('div', { class: 'fields' }, [field('Central schedule URL (for the store app; blank = config.json on this site)', fRemote)]));
    pages.publish = pp;

    /* data */
    var dp = el('div', { class: 'col' }), dataArea = el('textarea', { id: 'data-json', spellcheck: 'false', dir: 'ltr' });
    dataArea.style.minHeight = '260px'; dataArea.style.fontFamily = 'monospace';
    dp.appendChild(el('div', { class: 'hint', text: 'All settings as text: copy it as a backup, or paste and load it into another copy of the page.' }));
    dp.appendChild(dataArea);
    dp.appendChild(el('div', { class: 'bar' }, [
      el('button', { type: 'button', class: 'btn', text: 'Copy', onclick: function () {
        var done = function () { toast('Copied'); }, fail = function () { dataArea.select(); toast('Select the text and copy it manually'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(dataArea.value).then(done, fail); else fail();
      } }),
      el('button', { type: 'button', class: 'btn danger', text: 'Clear local save', onclick: function () {
        try { localStorage.removeItem('minyan-config'); } catch (e) {}
        location.reload();
      } }),
      el('button', { type: 'button', class: 'btn', text: 'Load from text', onclick: function () {
        try { var c = JSON.parse(dataArea.value); if (!c || typeof c !== 'object') throw new Error('x'); setCfg(c); closeOverlay(); buildAdmin(); toast('Loaded. Click Save to keep it.'); }
        catch (e) { toast('That text is not a valid settings file'); }
      } })]));
    pages.data = dp;

    function collect() {
      var out = clone(d);
      out.name = fName.value.trim();
      out.location = { name: fLocName.value.trim(), lat: parseFloat(fLat.value), lng: parseFloat(fLng.value), tz: fTz.value.trim(), elev: parseFloat(fElev.value) || 0 };
      out.candles = fCandles.value === '' ? 18 : +fCandles.value;
      out.tzeisMinutes = fTzeisMin.value === '' ? 0 : +fTzeisMin.value;
      out.tzeisDeg = +fTzeisDeg.value || 8.5;
      out.israel = $('#f-israel').checked; out.weeklyEarliest = $('#f-weekly').checked; out.clock24 = $('#f-24').checked; out.showRT = $('#f-rt').checked;
      if (mode !== 'artifact') out.pin = fPin.value;
      out.tefillos = d.tefillos.map(function (t, i) { return liveTefilla(i); });
      out.rooms = fRooms.value.trim();
      out.siteUrl = fSite.value.trim();
      out.logo = fLogo.value.trim();
      out.schedules = {};
      Cal.DAY_TYPES.forEach(function (t) {
        var o = {};
        d.tefillos.forEach(function (tf) { var v = lines[t[0]][tf.id].value; if (v.trim()) o[tf.id] = v.replace(/\r/g, ''); });
        if (Object.keys(o).length) out.schedules[t[0]] = o;
      });
      out.notices = nRows.map(function (r) { return { title: r.title.value.trim(), body: r.body.value.trim() }; }).filter(function (n) { return n.title || n.body; });
      out.overrides = oRows.map(function (r) {
        var lines = {};
        d.tefillos.forEach(function (tf) { if (r.lines[tf.id].value.trim()) lines[tf.id] = r.lines[tf.id].value; });
        return { date: r.date.value, label: r.label.value.trim(), lines: lines };
      }).filter(function (o) { return o.date; });
      out.remoteConfigUrl = fRemote.value.trim();
      out.smsNumber = fSms.value.trim();
      out.savedAt = Date.now();
      return out;
    }
    function validate(c) {
      if (isNaN(c.location.lat) || isNaN(c.location.lng)) return 'Enter the latitude and longitude';
      try { new Intl.DateTimeFormat('en-US', { timeZone: c.location.tz }); } catch (e) { return 'Invalid time zone'; }
      return null;
    }
    var saveBtn = el('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: function () {
      var c = collect(), err = validate(c);
      if (err) { toast(err); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      if (mode !== 'artifact') saveGh();
      persist(c).then(function (r) {
        setCfg(c);
        if (r.reloads) { toast('Saved. Reloading the page…', 8000); return; }
        closeOverlay();
        if (r.published) toast('Saved and published. Everyone gets the update within a few minutes.', 6000);
        else if (r.configured) toast('Saved on this device, but publishing to the site failed: ' + (r.error && r.error.message || ''), 8000);
        else toast(remoteUrl() ? 'Saved on this device only. Use the Publish tab to update everyone.' : 'Saved on this device', 6000);
      }, function (e) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; toast(errorText(e), 6000); });
    } });
    var panel = el('div', { class: 'col' }, [
      el('div', { class: 'bar' }, [el('h2', { text: 'Board settings' }), el('div', { class: 'tabs' }, [saveBtn, el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: closeOverlay })])]),
      tabBar, pages.general, pages.schedule, pages.notices, pages.overrides, mode !== 'artifact' ? pages.publish : null, pages.data,
      el('div', { class: 'bar' }, [el('span', { class: 'hint', text: mode === 'artifact' ? 'Save publishes a new version of this page for everyone who has the link.' : 'Save keeps the settings in this browser. Use the Publish tab to update the website and app, or Backup to copy them.' }), saveBtn.cloneNode(true)])]);
    overlay(panel);
    selectTab('general'); showType('weekday'); markTabs();
    var bottomSave = panel.lastChild.lastChild;
    bottomSave.addEventListener('click', function () { saveBtn.click(); });
  }

  /* ---------- persistence ---------- */
  function errorText(e) {
    var code = e && e.code;
    if (code === 'not_writer' || code === 'not_granted') return 'You do not have permission to save this board';
    if (code === 'conflict') return 'Someone else saved in the meantime; the page will reload';
    if (code === 'rate_limited') return 'Too many saves in a row; try again in a moment';
    return 'Save failed' + (e && e.message ? ': ' + e.message : '');
  }
  function skeleton(body) {
    var reset = ':root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#000}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}', st = document.head.querySelector('style');
    if (st && st.textContent) reset = st.textContent;
    return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + reset + '</style></head><body>' + body + '</body></html>';
  }
  function buildHtml(c) {
    var json = JSON.stringify(c, null, 1).replace(/<\//g, '<\\/');
    return fetch('index.html', { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; }, function () { return null; }).then(function (src) {
      var re = /(<script id="config"[^>]*>)[\s\S]*?(<\/script>)/;
      if (src && re.test(src)) {
        src = src.replace(re, function (m, a, b) { return a + json + b; });
        return /^\s*<!doctype/i.test(src) ? src : skeleton(src);
      }
      return skeleton(MinyanTemplate(json));
    });
  }
  function persist(c) {
    if (mode === 'artifact' && artifactNs) {
      try { sessionStorage.setItem('minyan-pending', JSON.stringify(c)); } catch (e) {}
      return buildHtml(c).then(function (html) { return artifactNs.publish(html); }).then(function () { return { reloads: true }; });
    }
    return new Promise(function (res, rej) {
      try { localStorage.setItem('minyan-config', JSON.stringify(c)); res(); } catch (e) { rej(e); }
    }).then(function () {
      var s = ghSettings();
      if (!ghConfigured(s)) return { reloads: false, published: false, configured: false };
      return ghPublish(c, s).then(function () { return { reloads: false, published: true, configured: true }; },
        function (e) { return { reloads: false, published: false, configured: true, error: e }; });
    });
  }

  /* ---------- central schedule file (self-hosted site and app) ---------- */
  function remoteUrl() {
    if (cfg.remoteConfigUrl && /^https?:\/\//.test(cfg.remoteConfigUrl)) return cfg.remoteConfigUrl;
    if (/^https?:$/.test(location.protocol)) return 'config.json';
    return null;
  }
  function applyIfNewer(c) {
    if (!c || typeof c !== 'object' || !c.schedules) return false;
    if ((c.savedAt || 0) < (cfg.savedAt || 0)) return false;
    setCfg(c);
    return true;
  }
  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function loadRemote() {
    var url = remoteUrl();
    if (!url) return Promise.resolve(false);
    return fetchJson(url).then(function (c) {
      if (c && c.remoteConfigUrl && /^https?:\/\//.test(c.remoteConfigUrl) && c.remoteConfigUrl !== url) return fetchJson(c.remoteConfigUrl).then(function (c2) { return c2 || c; });
      return c;
    }).then(function (c) {
      if (!c) return false;
      try { localStorage.setItem('minyan-remote', JSON.stringify(c)); } catch (e) {}
      var changed = applyIfNewer(c);
      if (changed && !ui.adminOpen) render();
      return changed;
    });
  }
  function ghSettings() { try { return JSON.parse(localStorage.getItem('minyan-github') || 'null') || {}; } catch (e) { return {}; } }
  function ghConfigured(s) { return !!(s && s.repo && s.token); }
  function utf8b64(str) {
    var bytes = new TextEncoder().encode(str), bin = '', i;
    for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function ghHeaders(s) { return { 'Authorization': 'Bearer ' + s.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
  function ghApi(s) { return 'https://api.github.com/repos/' + s.repo.replace(/^\/+|\/+$/g, '') + '/contents/' + (s.path || 'config.json').replace(/^\/+/, ''); }
  function ghCheck(s) {
    return fetch(ghApi(s) + '?ref=' + encodeURIComponent(s.branch || 'main'), { headers: ghHeaders(s), cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return 'The file is not there yet; it will be created on the first save';
      if (!r.ok) throw new Error('GitHub ' + r.status);
      return 'Connection OK';
    });
  }
  function ghPublish(c, s) {
    var branch = s.branch || 'main', api = ghApi(s), headers = ghHeaders(s);
    headers['Content-Type'] = 'application/json';
    return fetch(api + '?ref=' + encodeURIComponent(branch), { headers: headers, cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('GitHub ' + r.status);
      return r.json();
    }).then(function (existing) {
      var body = { message: 'Update minyan schedule', content: utf8b64(JSON.stringify(c, null, 1)), branch: branch };
      if (existing && existing.sha) body.sha = existing.sha;
      return fetch(api, { method: 'PUT', headers: headers, body: JSON.stringify(body) });
    }).then(function (r) {
      if (r.ok) return true;
      return r.json().then(function (j) { throw new Error('GitHub ' + r.status + (j && j.message ? ': ' + j.message : '')); }, function () { throw new Error('GitHub ' + r.status); });
    });
  }

  /* ---------- installable app ---------- */
  function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function refreshInstallBtn() {
    if (ui.installBtn) ui.installBtn.hidden = !deferredInstall;
    if (ui.iosHint) ui.iosHint.hidden = !(!inArtifact && isIOS() && !isStandalone() && !deferredInstall);
  }
  function registerSW() {
    if (inArtifact || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
    }).catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController && !reloaded && !ui.adminOpen) { reloaded = true; location.reload(); }
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    var raw = $('#config');
    var parsed = {};
    try { parsed = JSON.parse(raw ? raw.textContent : '{}'); } catch (e) { parsed = {}; }
    setCfg(parsed);
    inArtifact = !!(window.claude && typeof window.claude.use === 'function');
    if (inArtifact) mode = 'artifact';
    else {
      try { applyIfNewer(JSON.parse(localStorage.getItem('minyan-remote') || 'null')); } catch (e) {}
      try { applyIfNewer(JSON.parse(localStorage.getItem('minyan-config') || 'null')); } catch (e) {}
      try { pinOk = sessionStorage.getItem('minyan-pin') === '1'; } catch (e) {}
    }
    render();
    setInterval(tick, 1000);
    if (!inArtifact) {
      loadRemote();
      setInterval(loadRemote, 15 * 60 * 1000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) loadRemote(); });
      window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; refreshInstallBtn(); });
      window.addEventListener('appinstalled', function () { deferredInstall = null; refreshInstallBtn(); toast('האפליקציה הותקנה'); });
      registerSW();
    }
    if (inArtifact) {
      window.claude.use('artifact').then(function (a) { if (a) artifactNs = a; else mode = 'static'; refreshEditBtn(); });
      window.claude.use('user').then(function (u) { canEdit = !!(u && typeof u.canEdit === 'function' && u.canEdit()); refreshEditBtn(); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
