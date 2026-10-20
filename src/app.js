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
      el('div', { class: 'shul', text: cfg.name || 'לוח המנינים' }),
      el('h1', { class: 'dayline', text: dayLine(info, rd) }),
      el('div', { class: 'dates' }, [el('span', { text: hebLine }), el('span', { class: 'num', text: gregStr(rd) })]),
      chips.length ? el('div', { class: 'chips' }, chips) : null])]));

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
    var notices = noticesPanel();
    if (notices) colB.appendChild(notices);
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
  function noticesPanel() {
    var items = [];
    (cfg.notices || []).forEach(function (n) {
      if (!(n.body || '').trim()) return;
      items.push(el('div', { class: 'notice' }, [el('div', { class: 't', text: n.title || '' }), el('div', { class: 'b', text: n.body || '' })]));
    });
    if (!items.length) return null;
    return el('section', { class: 'side' }, [el('h3', { text: 'הודעות' })].concat(items));
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

    /* general */
    var g = el('div', { class: 'col' });
    var fName = inp('f-name', d.name), fLocName = inp('f-locname', d.location.name), fLat = inp('f-lat', d.location.lat, { inputmode: 'decimal' }),
      fLng = inp('f-lng', d.location.lng, { inputmode: 'decimal' }), fTz = inp('f-tz', d.location.tz || 'America/New_York', { list: 'tz-list' }),
      fElev = inp('f-elev', d.location.elev || 0, { inputmode: 'numeric' }), fCandles = inp('f-candles', d.candles == null ? 18 : d.candles, { inputmode: 'numeric' }),
      fTzeisMin = inp('f-tzeismin', d.tzeisMinutes || '', { inputmode: 'numeric', placeholder: 'blank = by degrees' }), fTzeisDeg = inp('f-tzeisdeg', d.tzeisDeg || 8.5, { inputmode: 'decimal' }),
      fPin = inp('f-pin', d.pin == null ? '1234' : d.pin);
    var fSms = inp('f-sms', d.smsNumber || '', { dir: 'ltr', placeholder: '+1 718 555 0100' });
    g.appendChild(el('div', { class: 'fields' }, [field('Shul name (shown on the board)', fName), field('Location name (shown in the footer)', fLocName), field('SMS number (once the text service is set up)', fSms)]));
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

    /* schedule */
    var sp = el('div', { class: 'col' });
    sp.appendChild(el('details', { class: 'help' }, [el('summary', { text: 'How to write the schedule' }), el('div', { class: 'hint' }, [
      el('p', { text: 'One minyan per line: the time first, then the room or minyan name, then an optional // note (notes show on the tile).' }),
      el('p', null, ['Fixed time: ', el('code', { text: '6:20 ברך משה' }), ' · by zman: ', el('code', { text: 'sunset-15 דברי יואל' }), ' , ', el('code', { text: 'candles לב אהרן' }), ' , ', el('code', { text: 'tzeis+5 שלמה יודא' }), ' , ', el('code', { text: 'plag-10' }), ' , ', el('code', { text: 'sunrise-45' }), ' , ', el('code', { text: 'chatzos-30' }), ' , ', el('code', { text: 'alos+60' }), ' (Hebrew words work too: שקיעה, הדלקה, צאת, פלג, נץ, חצות, עלות).']),
      el('p', null, ['Round down to 5 minutes: ', el('code', { text: 'sunset-20~5 ברך משה' }), ' · lines starting with # are ignored.']),
      el('p', { text: 'An empty schedule uses the more general one (Rosh Chodesh empty → Weekdays; Yom Tov empty → Shabbos). The preview under each box uses today\'s zmanim.' })])]));
    var typeTabs = el('div', { class: 'tabs' }), typePages = {};
    sp.appendChild(typeTabs);
    Cal.DAY_TYPES.forEach(function (t) {
      var key = t[0], b = el('button', { type: 'button', id: 'dt-' + key, text: t[3], 'aria-selected': 'false', onclick: function () { showType(key); } });
      typeTabs.appendChild(b);
      var page = el('div', { class: 'col' });
      page.hidden = true;
      page.appendChild(el('div', { class: 'hint', text: FALLBACK[key] ? t[3] + ' schedule. Leave a box empty to use the ' + TYPE_EN[FALLBACK[key]] + ' schedule.' : t[3] + ' is the base schedule.' }));
      var row = el('div', { class: 'fields three' });
      d.tefillos.forEach(function (tf, i) {
        var ta = el('textarea', { id: 'sch-' + key + '-' + tf.id, spellcheck: 'false', dir: 'auto' });
        ta.value = (d.schedules[key] && d.schedules[key][tf.id]) || '';
        var pv = el('div', { class: 'preview' });
        ta.addEventListener('input', function () { preview(ta, pv, i, key); markTabs(); });
        preview(ta, pv, i, key);
        row.appendChild(el('div', { class: 'field' }, [el('label', { for: ta.id, text: tf.name }), ta, pv]));
      });
      page.appendChild(row);
      typePages[key] = { page: page, button: b };
      sp.appendChild(page);
    });
    function preview(ta, pv, i, key) {
      var tf = liveTefilla(i);
      pv.innerHTML = '';
      ta.value.split('\n').forEach(function (line, n) {
        var p = parseLine(line, tf);
        if (!p) return;
        if (!p.spec) { pv.appendChild(el('span', { class: 'bad', text: 'Line ' + (n + 1) + ': cannot read ' }, [el('bdi', { text: p.tok })])); return; }
        pv.appendChild(el('span', { class: 'num', dir: 'auto', text: fmtTime(resolveMin(p.spec, todayRd, key)) + (p.room ? ' ' + p.room : '') }));
      });
    }
    function markTabs() {
      Cal.DAY_TYPES.forEach(function (t) {
        var has = d.tefillos.some(function (tf) { var ta = $('#sch-' + t[0] + '-' + tf.id); return ta && ta.value.trim(); });
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
    np.appendChild(el('div', { class: 'hint', text: 'Sponsor panels and announcements shown beside the schedule. A notice with empty text is not shown.' }));
    np.appendChild(nList);
    np.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', text: '+ Notice', onclick: function () { addNotice({ title: '', body: '' }); } })]));
    pages.notices = np;

    /* overrides */
    var op = el('div', { class: 'col' }), oList = el('div', { class: 'col' }), oRows = [];
    function addOverride(o) {
      var id = ++uid, r = { date: inp('o-date-' + id, o.date, { type: 'date' }), label: inp('o-label-' + id, o.label), lines: {} };
      var row = el('div', { class: 'fields three' });
      d.tefillos.forEach(function (tf) {
        var ta = el('textarea', { id: 'o-' + id + '-' + tf.id, spellcheck: 'false', dir: 'auto' });
        ta.value = (o.lines && o.lines[tf.id]) || ''; ta.style.minHeight = '90px';
        r.lines[tf.id] = ta;
        row.appendChild(field(tf.name + ' (blank = as usual)', ta));
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
      out.schedules = {};
      Cal.DAY_TYPES.forEach(function (t) {
        var o = {};
        d.tefillos.forEach(function (tf) { var ta = $('#sch-' + t[0] + '-' + tf.id); if (ta && ta.value.trim()) o[tf.id] = ta.value.replace(/\r/g, ''); });
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
