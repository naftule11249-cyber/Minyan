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
  /* Which view this URL asks for: ?view=display | ?room=NAME | ?view=week, or #display | #room1..#roomN | #week (hashes work on the claude.ai page too). */
  function currentView() {
    var q = {}, h = (location.hash || '').replace(/^#/, ''), m;
    try { location.search.replace(/^\?/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); }); } catch (e) {}
    if (q.room) return { kind: 'room', room: q.room };
    if (q.view === 'display' || h === 'display') return { kind: 'display' };
    if (q.view === 'week' || h === 'week') return { kind: 'week' };
    m = /^room(\d+)$/.exec(h);
    if (m) { var rooms = (cfg.rooms || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); if (rooms[+m[1] - 1]) return { kind: 'room', room: rooms[+m[1] - 1] }; }
    return { kind: 'board' };
  }

  /* ---------- schedule engine (engine.js) ---------- */
  var engine = null;
  var TEFILLA_DEFAULTS = MinyanEngine.TEFILLA_DEFAULTS, FALLBACK = MinyanEngine.FALLBACK, TYPE_NAME = MinyanEngine.TYPE_NAME, TYPE_EN = MinyanEngine.TYPE_NAME_EN;
  var sameEntry = MinyanEngine.sameEntry, gregStr = MinyanEngine.gregStr, parseLine = MinyanEngine.parseLine;
  function setCfg(c) { cfg = (c && typeof c === 'object') ? c : {}; cfg.location = cfg.location || {}; engine = MinyanEngine(cfg); applyLook(); }
  /* looks: the palette chosen in General is the default and what the lobby screen and door displays always use; each phone may pick its own in the footer */
  var LOOKS = [['shul', 'Shul'], ['classic', 'Classic'], ['contrast', 'High contrast']], LOOK_BAND = { shul: '#3a332c', classic: '#223b68', contrast: '#000000' };
  function isLook(v) { return LOOKS.some(function (l) { return l[0] === v; }); }
  function lookDefault() { return isLook(cfg.palette) ? cfg.palette : 'shul'; }
  function lookMode() {
    var view = currentView(); if (view.kind === 'display' || view.kind === 'room') return lookDefault();
    var v = null; try { v = localStorage.getItem('minyan-look'); } catch (e) {}
    return isLook(v) ? v : lookDefault();
  }
  function applyLook() {
    if (typeof document === 'undefined') return;
    var root = document.documentElement, look = lookMode();
    if (look === 'classic') root.removeAttribute('data-palette'); else root.setAttribute('data-palette', look);
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', LOOK_BAND[look]);
  }
  function loc() { return engine.loc(); }
  function zmanimFor(rd) { return engine.zmanimFor(rd); }
  function resolveMin(spec, rd, type) { return engine.resolveMin(spec, rd, type); }
  function expandLine(p, rd, type) { return engine.expand(p, rd, type); }
  function tefillos() { return engine.tefillos(); }
  function scheduleFor(rd) {
    var s = engine.scheduleFor(rd);
    if (!ui.roomFilter) return s;
    var out = { rd: s.rd, info: s.info, type: s.type, override: s.override, byTefilla: {}, all: [] };
    Object.keys(s.byTefilla).forEach(function (id) { out.byTefilla[id] = s.byTefilla[id].filter(function (e) { return e.room === ui.roomFilter; }); out.all = out.all.concat(out.byTefilla[id]); });
    out.all.sort(function (a, b) { return a.start - b.start; });
    return out;
  }
  /* Which number is big on a tile: the start (ברכות) or the milestone (הודו). The board's default is cfg.bigTime; each device may pick its own. */
  function bigMode() { var v = null; try { v = localStorage.getItem('minyan-big'); } catch (e) {} if (v !== 'milestone' && v !== 'start') v = cfg.bigTime === 'milestone' ? 'milestone' : 'start'; return v; }
  function bigIsMilestone(t) { return !!t.milestone && bigMode() === 'milestone'; }
  function startLabel(t) { return t.startLabel || (t.id === 'shacharis' ? 'ברכות' : 'התחלה'); }
  /* the moment a minyan counts from: its start, or its milestone when that is the big number */
  function keyMs(e) { return bigIsMilestone(e.tefilla) ? e.ms + (+e.tefilla.offset || 0) * 60000 : e.ms; }
  /* the zman countdown box: the next of the chosen zmanim still ahead today */
  var COUNTDOWN_DEFAULT = ['shema', 'tefilla', 'candles', 'sunset'], COUNTDOWN_KEYS = ['shema', 'tefilla', 'chatzos', 'minchag', 'plag', 'candles', 'sunset', 'tzeis', 'tzeis60', 'tzeis72'];
  /* ר״ת (72) is the same moment as the board's nightfall when that is set to 72 minutes: then it is left out everywhere */
  function rtSame() { return +cfg.tzeisMinutes === 72 && cfg.showTzeis !== false; }
  function zmanHidden(k) { return (k === 'tzeis' && cfg.showTzeis === false) || (k === 'tzeis72' && (!cfg.showRT || rtSame())) || (k === 'tzeis60' && cfg.show60 === false); }
  function countdownKeysOf(c) { return Array.isArray(c.countdownZmanim) ? c.countdownZmanim : COUNTDOWN_DEFAULT; }
  /* each device may choose its own set; the board's set (General tab) is the default */
  function countdownKeys() { var v = null; try { v = JSON.parse(localStorage.getItem('minyan-countdown') || 'null'); } catch (e) {} return Array.isArray(v) ? v : countdownKeysOf(cfg); }
  function openCountdownChooser() {
    var old = $('#zc-overlay'); if (old) old.remove();
    var cur = countdownKeys(), boxes = {}, ov = el('div', { class: 'overlay modal', id: 'zc-overlay', dir: 'ltr' });
    function close() { ov.remove(); }
    var list = el('div', { class: 'col' }, COUNTDOWN_KEYS.filter(function (k) { return !zmanHidden(k); }).map(function (k) { var c = el('input', { type: 'checkbox', id: 'zc-' + k }); c.checked = cur.indexOf(k) >= 0; boxes[k] = c; return el('label', { for: 'zc-' + k, class: 'push-row' }, [c, ' ' + Cal.ZMAN_NAMES[k]]); }));
    ov.appendChild(el('div', { class: 'panel small' }, [el('h2', { text: 'Countdown zmanim' }), el('p', { class: 'hint', text: 'The הזמן הבא box counts down to the next of these. Your choice stays on this device.' }), list,
      el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn', text: 'Board default', onclick: function () { try { localStorage.removeItem('minyan-countdown'); } catch (e) {} close(); render(); } }), el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: close }),
        el('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: function () { var sel = COUNTDOWN_KEYS.filter(function (k) { return boxes[k] && boxes[k].checked; }); try { localStorage.setItem('minyan-countdown', JSON.stringify(sel)); } catch (e) {} close(); render(); } })])]));
    ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
    document.body.appendChild(ov);
  }
  function nextZman(info, z, rd, now) {
    var tz = loc().tz, best = null;
    countdownKeys().forEach(function (k) {
      if (k === 'candles' && !(info.dow === 5 || info.erevYT)) return;
      if (zmanHidden(k)) return;
      var v = z[k]; if (v == null || isNaN(v)) return;
      var ms = Cal.epochFromWall(rd, Math.round(v), tz);
      if (ms > now && (!best || ms < best.ms)) best = { key: k, min: v, ms: ms };
    });
    return best;
  }
  function upcoming(nowMs, nowRd) {
    if (!ui.roomFilter && bigMode() !== 'milestone') return engine.upcoming(nowMs, nowRd);
    var i, j, s;
    for (i = -1; i < 10; i++) { s = scheduleFor(nowRd + i); /* from yesterday: a Maariv after midnight is still ahead */ for (j = 0; j < s.all.length; j++) if (keyMs(s.all[j]) > nowMs && s.all[j].tefilla.kind !== 'event') return { entry: s.all[j], sched: s, daysAhead: i }; }
    return null;
  }
  function fmtTime(min) { return engine.fmtTime(min); }
  function fmtCountdown(ms) { return engine.fmtCountdown(ms); }
  /* the board's labels in Hebrew or Yiddish: General -> Board labels sets the default (the lobby screen and door displays always use it); each phone may pick its own */
  var STR = {
    he: { today: 'היום', tomorrow: 'מחר', tonight: 'בערב', nextMinyan: 'מנין הבא', nextZman: 'הזמן הבא', zmanim: 'זמני היום', none: 'אין מנינים רשומים', showEarlier: 'הצג את הקודמים', badgeNext: 'הבא', badgeNow: 'עכשיו', board: 'לוח ', special: 'לוח מיוחד', noMinyanim: 'לא רשומים מנינים לימים הקרובים.', fastStart: 'תחילת הצום', fastEnd: 'צאת הצום', motzaeiShabbos: 'מוצאי שבת', motzaeiYT: 'מוצאי יום טוב', omerTonight: 'הלילה סופרים', omer: 'ספירת העומר', laomer: ' לעומר', clock: 'השעה', timesBy: 'הזמנים לפי ', chul: 'לוח חוץ לארץ', eretz: 'לוח ארץ ישראל', parsha: ' פרשת ',
      days: Cal.DAY_NAMES, types: {}, minyanim: function (name) { return 'מניני ' + name; } },
    yi: { today: 'היינט', tomorrow: 'מארגן', tonight: 'ביינאכט', nextMinyan: 'מנין הבא', nextZman: 'הזמן הבא', zmanim: 'היינטיגע זמנים', none: 'קיין מנינים נישט איינגעשריבן', showEarlier: 'ווייז די פריערדיגע', badgeNext: 'הבא', badgeNow: 'יעצט', board: 'לוח ', special: 'ספעציעלער לוח', noMinyanim: 'קיין מנינים נישט איינגעשריבן פאר די קומענדיגע טעג.', fastStart: 'אנהייב תענית', fastEnd: 'סוף תענית', motzaeiShabbos: 'מוצאי שבת', motzaeiYT: 'מוצאי יום טוב', omerTonight: 'היינט ביינאכט ציילט מען', omer: 'ספירת העומר', laomer: ' לעומר', clock: 'די שעה', timesBy: 'די זמנים לויט ', chul: 'לוח חוץ לארץ', eretz: 'לוח ארץ ישראל', parsha: ' פרשת ',
      days: ['זונטאג', 'מאנטאג', 'דינסטאג', 'מיטוואך', 'דאנערשטאג', 'פרייטאג', 'שבת קודש'], types: { weekday: 'וואכן טעג', sunday: 'זונטאג', friday: 'ערב שבת', shabbos: 'שבת', yomtov: 'יום טוב', erev_yomtov: 'ערב יום טוב', chol_hamoed: 'חול המועד', rosh_chodesh: 'ראש חודש', fast: 'תענית', chanukah: 'חנוכה', purim: 'פורים', yomkippur: 'יום כיפור' }, minyanim: function (name) { return name + ' מנינים'; } }
  };
  function langDefault() { return cfg.lang === 'yi' ? 'yi' : 'he'; }
  function langMode() {
    var view = currentView(); if (view.kind === 'display' || view.kind === 'room') return langDefault();
    var v = null; try { v = localStorage.getItem('minyan-lang'); } catch (e) {}
    return v === 'yi' || v === 'he' ? v : langDefault();
  }
  function S() { return STR[langMode()]; }
  function applyLang() { if (typeof document === 'undefined') return; var st = document.documentElement.style, L = S(); st.setProperty('--badge-next', '"' + L.badgeNext + '"'); st.setProperty('--badge-now', '"' + L.badgeNow + '"'); }
  function dayLine(info, rd) { var p = Cal.parshaOfWeek(rd, !!cfg.israel); return S().days[info.dow] + (p ? S().parsha + p : ''); }
  function typeLabel(s) { if (s.override) return S().special + (s.override.label ? ': ' + s.override.label : ''); return S().board + (S().types[s.type] || TYPE_NAME[s.type] || s.type); }

  /* ---------- rendering ---------- */
  function render() {
    var view = currentView();
    applyLook(); applyLang();
    if (view.kind === 'week') return renderWeek();
    var now = Date.now(), tz = loc().tz, n = Cal.nowInTz(now, tz), rd = n.rd;
    var info = Cal.dayInfo(rd, !!cfg.israel), z = zmanimFor(rd);
    var root = $('#app'), keepOv = ui.adminOpen ? $('#overlay') : null; /* an open settings panel survives a re-render of the board behind it */
    root.innerHTML = '';
    root.className = view.kind === 'display' ? 'display' : view.kind === 'room' ? 'display room' : '';
    ui.roomFilter = view.kind === 'room' ? view.room : null;
    var hebLine = Cal.formatHeb(info.heb);
    if (!isNaN(z.sunset) && n.min >= z.sunset) hebLine += ' · ' + S().tonight + ': ' + Cal.formatHeb(Cal.hebFromRD(rd + 1));
    var chips = info.labels.map(function (l) { return el('span', { class: 'chip', text: l }); });
    root.appendChild(el('header', { class: 'top' }, [el('div', { class: 'inner' }, [
      el('div', { class: 'shul' }, [view.kind === 'board' ? el('button', { type: 'button', class: 'gear-top', 'aria-label': 'Settings', title: 'Settings', text: '⚙', onclick: openSettings }) : null, cfg.logo ? el('img', { class: 'logo', src: cfg.logo, alt: '' }) : null, el('span', { text: (cfg.name || 'לוח המנינים') + (ui.roomFilter ? ' · ' + ui.roomFilter : '') })]),
      el('h1', { class: 'dayline', text: dayLine(info, rd) }),
      el('div', { class: 'dates' }, [el('span', { text: hebLine }), el('span', { class: 'num', text: engine.fmtDate(rd) })]),
      chips.length ? el('div', { class: 'chips' }, chips) : null,
      view.kind !== 'board' ? (ui.clock = el('div', { class: 'clock num', 'aria-label': S().clock }, [el('span', { class: 'hm' }), el('span', { class: 'ss' })])) : null])]));
    if (view.kind === 'board') ui.clock = null;
    updateClock(now);

    var banner = engine.activeBanner(now);
    if (banner) root.appendChild(el('div', { class: 'banner', role: 'status' }, [el('div', { class: 'banner-inner', text: banner.text.trim() })]));
    var strip = sponsorsStrip(rd);
    if (strip) root.appendChild(strip);
    var up = upcoming(now, rd);
    var main = el('main'), colA = el('div', { class: 'col' }), colB = el('div', { class: 'col' });
    var next = el('section', { class: 'next', 'aria-live': 'polite' }, [el('h2', { text: S().nextMinyan })]);
    ui.countdown = null; ui.countdownMs = 0;
    if (up) {
      var e = up.entry, bigMs = bigIsMilestone(e.tefilla);
      ui.countdownMs = keyMs(e);
      next.appendChild(el('div', { class: 'what', text: e.tefilla.name + (e.room ? ' – ' + e.room : '') }));
      if (bigMs) next.appendChild(el('div', { class: 'ms num pre', text: startLabel(e.tefilla) + ' ' + fmtTime(e.start) })); /* the start stays first: ברכות above, הודו big below */
      next.appendChild(el('div', { class: 'time num', text: fmtTime(bigMs ? e.milestone : e.start) }));
      if (e.tefilla.milestone && !bigMs) next.appendChild(el('div', { class: 'ms num', text: e.tefilla.milestone + ' ' + fmtTime(e.milestone) }));
      ui.countdown = el('div', { class: 'count num', text: fmtCountdown(ui.countdownMs - now) });
      next.appendChild(ui.countdown);
      /* the three after it, as small cards: tomorrow's first Shacharis included once the day runs out */
      var more = engine.after(now, rd, 3).filter(function (x) { return x.entry.tefilla.kind !== 'event' && !sameEntry(x.entry, e) && keyMs(x.entry) > now; }).slice(0, 3), canTapMore = canSetReminders();
      if (more.length) next.appendChild(el('div', { class: 'soon-row' }, more.map(function (x) {
        var en = x.entry, sub = (en.tefilla.id !== e.tefilla.id ? en.tefilla.name : '') + (x.daysAhead > up.daysAhead ? (en.tefilla.id !== e.tefilla.id ? ' · ' : '') + (x.daysAhead === 1 ? S().tomorrow : S().days[x.sched.info.dow]) : '');
        var card = el('div', { class: 'soon' }, [el('div', { class: 'time num', text: fmtTime(bigIsMilestone(en.tefilla) ? en.milestone : en.start) }), el('div', { class: 'room', text: en.room || en.tefilla.name }), sub ? el('div', { class: 'sub', text: sub }) : null]);
        if (canTapMore) makeTappable(card, en);
        return card;
      })));
      if (up.daysAhead > 0) next.appendChild(el('div', { class: 'when', text: (up.daysAhead === 1 ? S().tomorrow + ', ' : '') + S().days[up.sched.info.dow] + ' ' + Cal.formatHeb(up.sched.info.heb) }));
      if (e.note) next.appendChild(el('div', { class: 'when', text: e.note }));
    } else {
      next.appendChild(el('div', { class: 'empty', text: S().noMinyanim }));
    }
    var canTap = canSetReminders();
    if (up && canTap && up.entry.tefilla.kind !== 'event') makeTappable(next, up.entry); /* tap the next minyan to be reminded of it */
    colA.appendChild(next);
    ui.zcount = null; ui.zcountMs = 0;
    var nz = nextZman(info, z, rd, now);
    if (nz) {
      ui.zcountMs = nz.ms; ui.zcount = el('div', { class: 'count num', text: fmtCountdown(nz.ms - now) });
      var zb = el('section', { class: 'next zman' + (nz.ms - now < 30 * 60000 ? ' urgent' : ''), /* 'urgent', not 'soon': .soon is the next-three strip's box */ 'aria-live': 'polite' }, [el('h2', { text: S().nextZman }), el('div', { class: 'what', text: Cal.ZMAN_NAMES[nz.key] }), el('div', { class: 'time num', text: fmtTime(nz.min) }), ui.zcount,
        el('button', { type: 'button', class: 'gear', 'aria-label': 'Choose the countdown zmanim', title: 'Choose zmanim', text: '⚙', onclick: function (ev) { ev.stopPropagation(); openCountdownChooser(); } })]);
      if (canTap) makeTappable(zb, { zman: nz.key, rd: rd, min: nz.min }); /* tap the zman to be reminded before it */
      colA.appendChild(zb);
    }
    var sections = (view.kind === 'board' && isPhone()) ? phoneSections : daySections;
    if (ui.lastRenderDay !== rd) ui.showPast = false;
    colA.appendChild(sections(scheduleFor(rd), now, up, true));
    if (up && up.daysAhead > 0 && !(up.daysAhead === 1 && ui.todayAllSwitched)) colA.appendChild(sections(up.sched, now, up, false)); /* tomorrow is already shown section by section once today is over */
    colB.appendChild(zmanimPanel(info, z));
    if (view.kind === 'board') {
      var sms = smsPanel();
      if (sms) colB.appendChild(sms);
      var push = pushPanel();
      if (push) colB.appendChild(push);
    }
    main.appendChild(colA); main.appendChild(colB);
    root.appendChild(main);
    if (view.kind === 'board') root.appendChild(footer());
    if (keepOv) root.appendChild(keepOv);
    ui.lastRenderDay = rd; ui.lastMinute = Math.floor(now / 60000);
  }
  /* Printable weekly sheet (?view=week / #week): this week and next, Sunday to Shabbos */
  function renderWeek() {
    var root = $('#app'), now = Date.now(), tz = loc().tz, rd0 = Cal.nowInTz(now, tz).rd, start = rd0 - Cal.mod(rd0, 7);
    root.innerHTML = ''; root.className = 'week';
    root.appendChild(el('header', { class: 'top' }, [el('div', { class: 'inner' }, [el('div', { class: 'shul' }, [cfg.logo ? el('img', { class: 'logo', src: cfg.logo, alt: '' }) : null, el('span', { text: cfg.name || 'לוח המנינים' })]), el('h1', { class: 'dayline', text: 'לוח השבוע' })])]));
    var main = el('main', { class: 'week-main' });
    [0, 7].forEach(function (off) {
      var first = start + off, sec = el('section', { class: 'week-block' });
      var i0 = Cal.dayInfo(first, !!cfg.israel), i6 = Cal.dayInfo(first + 6, !!cfg.israel), parsha = Cal.parshaOfWeek(first, !!cfg.israel);
      sec.appendChild(el('h2', { text: (off ? 'השבוע הבא' : 'השבוע') + (parsha ? ' – פרשת ' + parsha : '') + ' · ' + Cal.formatHeb(i0.heb) + ' – ' + Cal.formatHeb(i6.heb) }));
      for (var d = 0; d < 7; d++) {
        var rd = first + d, info = Cal.dayInfo(rd, !!cfg.israel), sched = scheduleFor(rd), z = zmanimFor(rd), day = el('div', { class: 'wday' + (rd === rd0 ? ' today' : '') });
        var zs = [];
        if (info.dow === 5 || info.erevYT) zs.push('הדלקת נרות ' + fmtTime(z.candles));
        if (info.fast && !((info.heb.m === 7 && info.heb.d === 10) || info.heb.m === 5)) zs.push('תחילת הצום ' + fmtTime(z.alos));
        zs.push('שקיעה ' + fmtTime(z.sunset));
        if (info.shabbos || info.yomtov || info.fast) zs.push((info.fast && !info.yomKippur ? 'צאת הצום ' : info.shabbos ? 'מוצאי שבת ' : 'מוצאי יום טוב ') + fmtTime(z.tzeis));
        day.appendChild(el('div', { class: 'whead' }, [el('strong', { text: Cal.DAY_NAMES[info.dow] }), el('span', { text: Cal.formatHeb(info.heb) + ' · ' + engine.fmtDate(rd) }), info.labels.length ? el('span', { class: 'wlabels', text: info.labels.join(', ') }) : null, el('span', { class: 'wz num', text: zs.join(' · ') })]));
        tefillos().forEach(function (t) {
          var list = sched.byTefilla[t.id] || [];
          if (!list.length) return;
          day.appendChild(el('div', { class: 'wline' }, [el('b', { text: t.name + ': ' }), el('span', { class: 'num', text: list.map(function (e) { return fmtTime(e.start) + (e.room ? ' ' + e.room : ''); }).join(' · ') })]));
        });
        sec.appendChild(day);
      }
      main.appendChild(sec);
    });
    root.appendChild(main);
    var bar = el('div', { class: 'week-bar' }, [el('a', { class: 'btn', href: inArtifact ? '#' : './', text: 'ללוח' })]);
    if (!inArtifact) bar.appendChild(el('button', { class: 'btn primary', text: 'הדפסה', onclick: function () { window.print(); } }));
    root.appendChild(bar);
    ui.countdown = null; ui.countdownMs = 0; ui.lastRenderDay = rd0; ui.lastMinute = Math.floor(now / 60000);
  }
  /* How long a minyan that has started stays marked "now" (cfg.nowMinutes, default 20). After that it is dimmed, and the lobby screen hides it. */
  function nowWindowMs() { var m = cfg.nowMinutes; m = (m == null || m === '') ? 20 : +m; return (isNaN(m) || m < 0 ? 20 : m) * 60000; }
  /* per tefilla: today's list, or tomorrow's once all of today's minyanim are over (after chatzos for Shacharis) */
  function tefillaLists(s, now, isToday) {
    var tomorrow = isToday ? scheduleFor(s.rd + 1) : null, out = [], allSwitched = true;
    tefillos().forEach(function (t) {
      var list = s.byTefilla[t.id] || [], fromTomorrow = false;
      if (tomorrow && t.kind !== 'event' && list.every(function (e) { return now - e.ms >= nowWindowMs(); }) && (tomorrow.byTefilla[t.id] || []).length) { list = tomorrow.byTefilla[t.id]; fromTomorrow = true; }
      if (!fromTomorrow && t.kind !== 'event') allSwitched = false;
      out.push({ t: t, list: list, fromTomorrow: fromTomorrow, tomorrow: tomorrow });
    });
    if (isToday) ui.todayAllSwitched = allSwitched;
    return out;
  }
  function sectionTitle(x) { return x.t.kind === 'event' ? x.t.name : S().minyanim(x.t.name) + (x.fromTomorrow ? ' – ' + S().tomorrow + ', ' + S().days[x.tomorrow.info.dow] : ''); }
  function entryState(e, now, up) { if (up && sameEntry(e, up.entry)) return 'next'; if (e.ms <= now) return now - e.ms < nowWindowMs() ? 'now' : 'past'; return ''; }
  function dayHead(s, isToday) { return el('div', { class: 'day-head' }, [el('h2', { text: isToday ? S().today : S().days[s.info.dow] + ' – ' + Cal.formatHeb(s.info.heb) }), el('span', { class: 'sub', text: typeLabel(s) })]); }
  /* tablets, the lobby screen and door displays: a grid of tiles per tefilla */
  function daySections(s, now, up, isToday) {
    var wrap = el('div', { class: 'col' }), canRemind = canSetReminders();
    wrap.appendChild(dayHead(s, isToday));
    tefillaLists(s, now, isToday).forEach(function (x) {
      var t = x.t, list = x.list, sec = el('section', { class: 'tefilla' });
      if ($('#app').classList.contains('display') && !x.fromTomorrow && list.every(function (e) { return e.ms <= now && now - e.ms >= nowWindowMs(); })) return;
      sec.appendChild(el('h3', null, [sectionTitle(x)]));
      if (!list.length) { sec.appendChild(el('div', { class: 'none', text: S().none })); }
      else {
        var grid = el('div', { class: 'grid' }), onBoard = !$('#app').classList.contains('display');
        /* on the board, more than two past minyanim fold behind a button (the lobby screen hides them outright) */
        var past = onBoard ? list.filter(function (e) { return entryState(e, now, up) === 'past'; }) : [], fold = onBoard && !ui.showPast && past.length > 2 && past.length < list.length;
        if (fold) sec.appendChild(el('button', { type: 'button', class: 'btn small foldbtn', text: S().showEarlier + ' (' + past.length + ')', onclick: function () { ui.showPast = true; render(); } }));
        list.forEach(function (e) {
          var st = entryState(e, now, up), cls = 'tile' + (st ? ' ' + st : '') + (t.kind === 'event' ? ' event' : '');
          if (fold && st === 'past') return;
          var tile = el('div', { class: cls }, [
            el('div', { class: 'room', text: e.room || t.name }),
            bigIsMilestone(t) ? el('div', { class: 'ms num pre', text: startLabel(t) + ' ' + fmtTime(e.start) }) : null, /* chronological: ברכות above, הודו big below */
            el('div', { class: 'time num', text: fmtTime(bigIsMilestone(t) ? e.milestone : e.start) }),
            t.milestone && !bigIsMilestone(t) ? el('div', { class: 'ms num', text: t.milestone + ' ' + fmtTime(e.milestone) }) : null,
            e.note ? el('div', { class: 'note', text: e.note }) : null]);
          if (canRemind && t.kind !== 'event') makeTappable(tile, e);
          grid.appendChild(tile);
        });
        sec.appendChild(grid);
      }
      wrap.appendChild(sec);
    });
    return wrap;
  }
  /* phones: one tefilla at a time behind tabs, each minyan a row, the past ones folded away */
  function isPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches); }
  function phoneSections(s, now, up, isToday) {
    var wrap = el('div', { class: 'col phone' }), canRemind = canSetReminders();
    var lists = tefillaLists(s, now, isToday).filter(function (x) { return x.list.length || x.t.kind !== 'event'; });
    wrap.appendChild(dayHead(s, isToday));
    if (!lists.length) return wrap;
    var ids = lists.map(function (x) { return x.t.id; }), want = ui.phoneTab || (up ? up.entry.tefilla.id : null), active = ids.indexOf(want) >= 0 ? want : ids[0];
    var tabs = el('div', { class: 'ttabs', role: 'tablist' });
    lists.forEach(function (x) { tabs.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': String(x.t.id === active), text: x.t.name + (x.fromTomorrow ? ' · ' + S().tomorrow : ''), onclick: function () { ui.phoneTab = x.t.id; render(); } })); });
    wrap.appendChild(tabs);
    var x = lists.filter(function (l) { return l.t.id === active; })[0], t = x.t, sec = el('section', { class: 'tefilla' });
    sec.appendChild(el('h3', null, [sectionTitle(x)]));
    if (!x.list.length) sec.appendChild(el('div', { class: 'none', text: S().none }));
    else {
      var rows = el('div', { class: 'rows' }), past = x.list.filter(function (e) { return entryState(e, now, up) === 'past'; });
      var fold = !ui.showPast && past.length > 2 && past.length < x.list.length;
      if (fold) rows.appendChild(el('button', { type: 'button', class: 'btn small foldbtn', text: S().showEarlier + ' (' + past.length + ')', onclick: function () { ui.showPast = true; render(); } }));
      x.list.forEach(function (e) {
        var st = entryState(e, now, up);
        if (fold && st === 'past') return;
        var big = bigIsMilestone(t), row = el('div', { class: 'row' + (st ? ' ' + st : '') + (t.kind === 'event' ? ' event' : '') }, [
          el('div', { class: 'rtime' }, [el('span', { class: 'time num', text: fmtTime(big ? e.milestone : e.start) }), t.milestone ? el('span', { class: 'ms num', text: big ? startLabel(t) + ' ' + fmtTime(e.start) : t.milestone + ' ' + fmtTime(e.milestone) }) : null]),
          el('div', { class: 'rroom' }, [el('span', { class: 'room', text: e.room || t.name }), e.note ? el('span', { class: 'note', text: e.note }) : null]),
          st === 'next' ? el('span', { class: 'badge next', text: S().badgeNext }) : st === 'now' ? el('span', { class: 'badge now', text: S().badgeNow }) : null]);
        if (canRemind && t.kind !== 'event') makeTappable(row, e);
        rows.appendChild(row);
      });
      sec.appendChild(rows);
    }
    wrap.appendChild(sec);
    return wrap;
  }
  function zmanimPanel(info, z) {
    var keys = ['alos', 'sunrise', 'shema', 'tefilla', 'chatzos', 'minchag', 'plag', 'candles', 'sunset', 'tzeis', 'tzeis60', 'tzeis72'];
    var ul = el('ul', { class: 'zlist' }), rd = info.rd, nowMin = Cal.nowInTz(Date.now(), loc().tz).min, canRemind = canSetReminders(), nowMs = Date.now(), tz = loc().tz, zt = zmanimFor(rd + 1), L = S();
    var h = info.heb, nightFast = (h.m === 7 && h.d === 10) || (h.m === 5 && info.fast); /* Yom Kippur and Tisha B'Av begin the evening before */
    if (info.fast && !nightFast) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: L.fastStart }), el('span', { class: 'z num', text: fmtTime(z.alos) })]));
    if (info.fast || info.yomKippur) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: L.fastEnd }), el('span', { class: 'z num', text: fmtTime(z.tzeis) })]));
    if (info.shabbos || info.yomtov) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: info.shabbos ? L.motzaeiShabbos : L.motzaeiYT }), el('span', { class: 'z num', text: fmtTime(z.tzeis) })]));
    var omer = rd - Cal.rdFromHeb(h.m <= 6 ? h.y : h.y + 1, 1, 15); /* days since 15 Nisan of this spring */
    if (omer >= 0 && omer <= 49) {
      var tonight = omer + 1, today = omer;
      if (!isNaN(z.sunset) && nowMin >= z.sunset && tonight <= 49) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: L.omerTonight }), el('span', { class: 'z num', text: tonight + L.laomer })]));
      else if (today >= 1) ul.appendChild(el('li', { class: 'hi' }, [el('span', { text: L.omer }), el('span', { class: 'z num', text: today + L.laomer })]));
    }
    keys.forEach(function (k) {
      if (k === 'candles' && !(info.dow === 5 || info.erevYT)) return;
      if (zmanHidden(k)) return;
      if (k === 'tzeis' && (info.shabbos || info.yomtov || info.fast)) return;
      var hi = k === 'candles' || (k === 'tzeis' && (info.shabbos || info.yomtov)), v = z[k];
      /* a zman that has passed keeps today's time, dimmed; tapping it then sets a reminder for tomorrow's */
      var passed = !isNaN(v) && nowMs >= Cal.epochFromWall(rd, Math.round(v), tz) + 60000, nextDay = passed && !isNaN(zt[k]);
      var li = el('li', { class: (hi ? 'hi' : '') + (passed ? ' past' : '') }, [el('span', { text: Cal.ZMAN_NAMES[k] }), el('span', { class: 'z num', text: fmtTime(v) })]);
      if (canRemind && (nextDay || (!passed && !isNaN(v)))) makeTappable(li, nextDay ? { zman: k, rd: rd + 1, min: zt[k] } : { zman: k, rd: rd, min: v }); /* tap a zman to be reminded before it */
      ul.appendChild(li);
    });
    return el('section', { class: 'side' }, [el('h3', { text: L.zmanim }), ul]);
  }
  /* Sponsor boxes (פרנס החודש and friends) in a framed strip under the header */
  function sponsorsStrip(rd) {
    var items = [];
    engine.activeNotices(rd).forEach(function (n) {
      items.push(el('section', { class: 'sponsor' }, [
        el('div', { class: 'frame' }),
        el('h2', { class: 't', text: n.title || '' }),
        el('div', { class: 'b', text: n.body.trim() })]));
    });
    if (ui.sponsorTimer) { clearInterval(ui.sponsorTimer); ui.sponsorTimer = null; }
    if (!items.length) return null;
    var rotate = $('#app').classList.contains('display') && items.length > 1;
    if (!rotate) return el('div', { class: 'sponsors' }, [el('div', { class: 'sponsors-inner' }, items)]);
    /* lobby / door screens: one sponsor at a time, cycling with a fade; the index survives the minute-by-minute re-render */
    var idx = (ui.sponsorIndex || 0) % items.length, secs = Math.max(2, +cfg.sponsorSeconds || 8);
    function show(i) { items.forEach(function (it, k) { it.classList.toggle('on', k === i); it.setAttribute('aria-hidden', k === i ? 'false' : 'true'); }); }
    show(idx);
    ui.sponsorTimer = setInterval(function () { idx = (idx + 1) % items.length; ui.sponsorIndex = idx; show(idx); }, secs * 1000);
    return el('div', { class: 'sponsors' }, [el('div', { class: 'sponsors-inner rotating' }, items)]);
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
      el('a', { class: 'btn', href: 'sms:' + digits + '?&body=' + encodeURIComponent('מנין'), text: 'שליחת הודעה' }),
      cfg.siteUrl ? el('p', { class: 'hint' }, [el('a', { href: cfg.siteUrl.replace(/\/?$/, '/') + 'sms.html', text: 'פרטי השירות' })]) : null]);
  }
  /* ---------- app notifications (web push through the notification service) ---------- */
  /* a reminder service is configured for this board */
  function pushConfigured() { return !inArtifact && window.isSecureContext && !!(cfg.notifyUrl || '').trim(); }
  /* ...and this browser can actually receive notifications (on iPhone/iPad only the installed app can) */
  function pushSupported() { return pushConfigured() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  var INSTALL_FIRST = 'To get reminders on iPhone or iPad, add the board to your home screen first: in Safari tap Share, then "Add to Home Screen", and open it from that icon.';
  var NO_PUSH = 'This browser cannot receive notifications. Use Chrome, or the installed app.';
  function pushState() { try { return JSON.parse(localStorage.getItem('minyan-push') || 'null'); } catch (e) { return null; } }
  function urlB64ToBytes(b) { b = b.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; var bin = atob(b), out = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function notifyBase() { return cfg.notifyUrl.trim().replace(/\/+$/, ''); }
  /* ---------- reminders: which minyan, how long before, every day or today only ---------- */
  var PICK_LABELS = { first: 'First minyan of the day', last: 'Last minyan of the day', 'before:shema': 'Last minyan before sof zman Shema', 'before:tefilla': 'Last minyan before sof zman tefilla',
    'before:chatzos': 'Last minyan before chatzos', 'before:sunset': 'Last minyan before sunset', 'before:tzeis': 'Last minyan before zman Maariv (tzeis)' };
  var ZMAN_KEYS = ['alos', 'sunrise', 'shema', 'tefilla', 'chatzos', 'minchag', 'plag', 'candles', 'sunset', 'tzeis', 'tzeis60', 'tzeis72'];
  function picksFor(t) { return t.period === 'pm' ? ['first', 'last', 'before:sunset', 'before:tzeis'] : ['first', 'last', 'before:shema', 'before:tefilla', 'before:chatzos']; }
  function pushPrefs() { var st = pushState(); return (st && st.prefs) || { reminders: [], daily: null }; }
  function isoOf(rd) { return MinyanEngine.isoDate(rd); }
  function canSetReminders() { return pushConfigured() && !$('#app').classList.contains('display') && !ui.roomFilter; }
  function describeReminder(r) {
    if (r.zman) return r.lead + ' min before ' + (Cal.ZMAN_NAMES[r.zman] || r.zman) + (r.once ? ' (today only)' : '');
    var t = tefillos().filter(function (x) { return x.id === r.tefilla; })[0], name = t ? t.name : r.tefilla;
    return r.lead + ' min before ' + (r.time != null ? name + ' ' + fmtTime(r.time) : (PICK_LABELS[r.pick || 'first'] || '').replace('minyan', name)) + (r.ref === 'milestone' && t && t.milestone ? ' (' + t.milestone + ')' : '') + (r.once ? ' (today only)' : '');
  }
  /* a minyan tile on the board opens a small "remind me" box */
  function makeTappable(tile, e) {
    tile.classList.add('tap'); tile.setAttribute('role', 'button'); tile.setAttribute('tabindex', '0'); tile.setAttribute('title', 'Set a reminder');
    tile.addEventListener('click', function () { openReminder(e); });
    tile.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openReminder(e); } });
  }
  function openReminder(e) {
    if (isIOS() && !isStandalone()) { toast(INSTALL_FIRST, 9000); return; }
    if (!pushSupported()) { toast(NO_PUSH, 7000); return; }
    preparePush().catch(function () {}); /* ready before "Set reminder" is tapped */
    var old = $('#rem-overlay'); if (old) old.remove();
    var what = e.zman ? (Cal.ZMAN_NAMES[e.zman] || e.zman) + ' ' + fmtTime(e.min) : e.tefilla.name + (e.room ? ' – ' + e.room : '') + ' ' + fmtTime(e.start), dayIso = isoOf(e.rd), isToday = dayIso === isoOf(Cal.nowInTz(Date.now(), loc().tz).rd);
    var lead = el('input', { type: 'number', min: '1', max: '180', value: '10', class: 'mins', inputmode: 'numeric', id: 'rem-lead' });
    var once = el('input', { type: 'radio', name: 'rem-when', value: 'once', id: 'rem-once' }), daily = el('input', { type: 'radio', name: 'rem-when', value: 'daily', id: 'rem-daily' });
    once.checked = true;
    /* for a minyan with a milestone: count to the start or to הודו, as this phone's big number says unless changed here */
    var refStart = el('input', { type: 'radio', name: 'rem-ref', value: 'start', id: 'rem-ref-start' }), refMs = el('input', { type: 'radio', name: 'rem-ref', value: 'milestone', id: 'rem-ref-ms' });
    (bigMode() === 'milestone' ? refMs : refStart).checked = true;
    var refRow = (!e.zman && e.tefilla.milestone) ? el('div', { class: 'push-row' }, [el('span', { class: 'push-lbl', text: 'Before' }), el('label', { for: 'rem-ref-start' }, [refStart, ' ' + startLabel(e.tefilla) + ' ' + fmtTime(e.start)]), el('label', { for: 'rem-ref-ms' }, [refMs, ' ' + e.tefilla.milestone + ' ' + fmtTime(e.milestone)])]) : null;
    var msg = el('div', { class: 'hint', id: 'rem-msg' }), ov = el('div', { class: 'overlay modal', id: 'rem-overlay', dir: 'ltr' });
    function close() { ov.remove(); }
    var setB = el('button', { type: 'button', class: 'btn primary', text: 'Set reminder', onclick: function () {
      var prefs = pushPrefs(), ld = Math.max(1, Math.min(180, +lead.value || 10)), r = e.zman ? { zman: e.zman, lead: ld } : { tefilla: e.tefilla.id, time: e.start, lead: ld };
      if (once.checked) r.once = dayIso;
      if (refRow && refMs.checked) r.ref = 'milestone';
      prefs.reminders = (prefs.reminders || []).filter(function (x) { return e.zman ? x.zman !== e.zman : !(x.tefilla === r.tefilla && x.time === r.time); }).concat([r]).slice(-10);
      setB.disabled = true; msg.textContent = 'Setting…';
      subscribePush(prefs).then(function () { close(); ui.remDraft = null; toast('Reminder set: ' + describeReminder(r), 6000); render(); },
        function (err) { setB.disabled = false; msg.textContent = 'Could not set the reminder: ' + (err && err.message || err); });
    } });
    ov.appendChild(el('div', { class: 'panel small' }, [
      el('h2', { text: 'Remind me' }),
      el('div', { class: 'rem-what', dir: 'rtl', text: what }),
      el('div', { class: 'push-row' }, [el('label', { for: 'rem-lead', class: 'push-lbl', text: 'Minutes before' }), lead]),
      refRow,
      el('div', { class: 'push-row' }, [el('label', { for: 'rem-once' }, [once, isToday ? ' Today only' : ' That day only']), el('label', { for: 'rem-daily' }, [daily, e.zman ? ' Every day' : ' Every day at this time'])]),
      el('p', { class: 'hint', text: 'A notification on this device, even when the app is closed.' }),
      msg,
      el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: close }), setB])]));
    ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
    document.body.appendChild(ov);
    lead.focus();
  }
  function pushPanel() {
    if (!pushConfigured()) return null;
    var st = pushState(), box = el('section', { class: 'side ltr', dir: 'ltr' }, [el('h3', { text: 'Reminders on your phone' })]);
    if (isIOS() && !isStandalone()) { box.appendChild(el('p', { class: 'hint', text: INSTALL_FIRST })); return box; }
    if (!pushSupported()) { box.appendChild(el('p', { class: 'hint', text: NO_PUSH })); return box; }
    preparePush().catch(function () {}); /* ready before the first tap */
    var prefs = pushPrefs(), today = scheduleFor(Cal.nowInTz(Date.now(), loc().tz).rd), tfs = tefillos().filter(function (t) { return t.kind !== 'event'; });
    if (!tfs.length) return null;
    box.appendChild(el('p', { class: 'hint', text: 'A notification before the minyanim or zmanim you pick, even when the app is closed. Tip: tap any minyan on the board, or any zman in the list, to set a reminder for it.' }));
    /* the rows being edited survive the board's minute-by-minute refresh */
    var draft = ui.remDraft || { list: prefs.reminders.map(function (r) { return { tefilla: r.zman ? 'z:' + r.zman : r.tefilla, time: r.time == null ? null : +r.time, pick: r.pick || 'first', lead: +r.lead || 10, once: r.once || null, ref: r.ref === 'milestone' ? 'milestone' : 'start' }; }),
      daily: prefs.daily != null, dailyAt: prefs.daily != null ? pad2(Math.floor(prefs.daily / 60)) + ':' + pad2(prefs.daily % 60) : '06:00' };
    ui.remDraft = draft;
    var list = draft.list, rows = el('div', { class: 'col rem-rows' });
    function rowEl(r) {
      var tSel = el('select', { 'aria-label': 'Tefilla or zman' });
      tfs.forEach(function (t) { tSel.appendChild(el('option', { value: t.id, text: t.name })); });
      var zg = el('optgroup', { label: 'Zmanim' }); ZMAN_KEYS.forEach(function (k) { if (zmanHidden(k)) return; zg.appendChild(el('option', { value: 'z:' + k, text: Cal.ZMAN_NAMES[k] })); }); tSel.appendChild(zg);
      tSel.value = r.tefilla; if (tSel.selectedIndex < 0) { tSel.value = tfs[0].id; r.tefilla = tfs[0].id; }
      var wSel = el('select', { 'aria-label': 'Which minyan' });
      function fillWhich() {
        wSel.textContent = '';
        wSel.hidden = tSel.value.indexOf('z:') === 0; if (wSel.hidden) return; /* a zman is its own target */
        var t = tfs.filter(function (x) { return x.id === tSel.value; })[0] || tfs[0];
        picksFor(t).forEach(function (p) { wSel.appendChild(el('option', { value: 'p:' + p, text: PICK_LABELS[p] })); });
        (today.byTefilla[t.id] || []).forEach(function (x) { wSel.appendChild(el('option', { value: 't:' + x.start, text: fmtTime(x.start) + (x.room ? ' ' + x.room : '') })); });
        wSel.value = r.time != null ? 't:' + r.time : 'p:' + r.pick;
        if (wSel.selectedIndex < 0) { wSel.appendChild(el('option', { value: 't:' + r.time, text: fmtTime(r.time) })); wSel.value = 't:' + r.time; }
      }
      fillWhich();
      /* before the start or before the milestone (הודו), for a tefilla that has one */
      var refSel = el('select', { 'aria-label': 'Before the start or the milestone' }, [el('option', { value: 'start', text: 'start' }), el('option', { value: 'milestone', text: 'milestone' })]);
      function fillRef() {
        var t = tfs.filter(function (x) { return x.id === tSel.value; })[0], has = !!(t && t.milestone) && tSel.value.indexOf('z:') !== 0;
        refSel.hidden = !has;
        if (has) { refSel.options[0].text = startLabel(t); refSel.options[1].text = t.milestone; refSel.value = r.ref === 'milestone' ? 'milestone' : 'start'; }
      }
      fillRef();
      refSel.addEventListener('change', function () { r.ref = refSel.value; });
      tSel.addEventListener('change', function () { r.tefilla = tSel.value; r.time = null; r.pick = 'first'; r.ref = bigMode(); fillWhich(); fillRef(); });
      wSel.addEventListener('change', function () { var v = wSel.value; if (v.charAt(0) === 't') { r.time = +v.slice(2); r.pick = 'first'; } else { r.time = null; r.pick = v.slice(2); } });
      var lead = el('input', { type: 'number', min: '1', max: '180', value: String(r.lead), class: 'mins', inputmode: 'numeric', 'aria-label': 'Minutes before' });
      lead.addEventListener('input', function () { r.lead = Math.max(1, Math.min(180, +lead.value || 10)); });
      var when = el('select', { 'aria-label': 'Every day or today only' }, [el('option', { value: 'daily', text: 'Every day' }), el('option', { value: 'today', text: 'Today only' })]);
      when.value = r.once ? 'today' : 'daily';
      when.addEventListener('change', function () { r.once = when.value === 'today' ? isoOf(Cal.nowInTz(Date.now(), loc().tz).rd) : null; });
      var del = el('button', { type: 'button', class: 'btn small', text: '×', title: 'Remove this reminder', 'aria-label': 'Remove this reminder', onclick: function () { list.splice(list.indexOf(r), 1); renderRows(); } });
      return el('div', { class: 'rem-row' }, [tSel, wSel, el('span', { class: 'rem-lead' }, [lead, ' min before']), refSel, when, del]);
    }
    function renderRows() { rows.textContent = ''; list.forEach(function (r) { rows.appendChild(rowEl(r)); }); if (!list.length) rows.appendChild(el('div', { class: 'hint', text: 'No minyan reminders yet.' })); }
    renderRows();
    var addB = el('button', { type: 'button', class: 'btn small', text: '+ Add reminder', onclick: function () { if (list.length >= 10) { toast('Up to 10 reminders'); return; } list.push({ tefilla: tfs[0].id, time: null, pick: 'first', lead: 10, once: null, ref: bigMode() }); renderRows(); } });
    var daily = el('input', { type: 'checkbox', id: 'push-daily' }); daily.checked = draft.daily;
    daily.addEventListener('change', function () { draft.daily = daily.checked; });
    var dailyAt = el('input', { type: 'time', id: 'push-daily-at', value: draft.dailyAt });
    dailyAt.addEventListener('change', function () { draft.dailyAt = dailyAt.value; });
    var msg = el('div', { class: 'hint', id: 'push-msg' });
    var saveB = el('button', { class: 'btn primary small', id: 'push-save', text: st ? 'Update reminders' : 'Turn on reminders', onclick: function () {
      var reminders = list.map(function (r) { var o = r.tefilla.indexOf('z:') === 0 ? { zman: r.tefilla.slice(2), lead: r.lead } : { tefilla: r.tefilla, time: r.time, lead: r.lead }; if (!o.zman && r.time == null) o.pick = r.pick; if (!o.zman && r.ref === 'milestone') o.ref = 'milestone'; if (r.once) o.once = r.once; return o; });
      var d = daily.checked ? (function () { var m = /^(\d{2}):(\d{2})$/.exec(dailyAt.value); return m ? +m[1] * 60 + +m[2] : 6 * 60; })() : null;
      if (!reminders.length && d == null) { msg.textContent = 'Add at least one reminder.'; return; }
      saveB.disabled = true; msg.textContent = 'Turning on…';
      subscribePush({ reminders: reminders, daily: d }).then(function () { ui.remDraft = null; msg.textContent = 'Reminders are on for this device.'; render(); }, function (e) { saveB.disabled = false; msg.textContent = 'Could not turn on reminders: ' + (e && e.message || e); });
    } });
    var form = el('div', { class: 'col' }, [rows, el('div', { class: 'tabs' }, [addB]),
      el('div', { class: 'push-row' }, [el('label', { for: 'push-daily', class: 'push-lbl' }, [daily, ' Daily board every morning at ']), dailyAt]),
      el('div', { class: 'tabs' }, [saveB, st ? el('button', { class: 'btn small', text: 'Turn off reminders', onclick: function () { ui.remDraft = null; unsubscribePush().then(function () { render(); }); } }) : null]),
      msg]);
    box.appendChild(form);
    return box;
  }
  /* The service-worker registration and the push key are fetched ahead of time, so that subscribing can start inside the user's tap:
     Safari shows the notification prompt from subscribe() itself and refuses it once the tap has "expired". */
  function preparePush() {
    if (!pushSupported()) return Promise.reject(new Error(NO_PUSH));
    if (!ui.pushPrep) ui.pushPrep = Promise.all([
      navigator.serviceWorker.ready,
      fetch(notifyBase() + '/push/key').then(function (r) { if (!r.ok) throw new Error('The reminder service did not answer (' + r.status + ')'); return r.text(); })
    ]).then(function (x) { ui.swReg = x[0]; ui.pushKey = x[1].trim(); }, function (e) { ui.pushPrep = null; throw e; });
    return ui.pushPrep;
  }
  function subscribePush(prefs) {
    var base = notifyBase(), st = pushState(), p;
    function doSubscribe() { return ui.swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(ui.pushKey) }); }
    /* Safari only honours these calls while the tap is being handled. Permission not granted yet: ask for it first (that is what shows the
       system prompt), then subscribe straight away. Already granted and prepared: subscribe synchronously, right here. */
    var perm0 = (typeof Notification !== 'undefined' && Notification.permission) || '?', asked = '';
    if (perm0 !== 'granted') {
      p = Notification.requestPermission().then(function (res) { asked = res; if (res !== 'granted') throw new Error('Notification permission: ' + res); return (ui.swReg && ui.pushKey) ? doSubscribe() : preparePush().then(doSubscribe); });
    } else if (ui.swReg && ui.pushKey) { try { p = doSubscribe(); } catch (e) { p = Promise.reject(e); } }
    else p = preparePush().then(doSubscribe);
    return p.catch(function (e) {
      var ua = navigator.userAgent || '', eng = /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : 'Safari', osm = /OS (\d+)[_.](\d+)/.exec(ua);
      var perm = (typeof Notification !== 'undefined' && Notification.permission) || '?', detail = ' [was ' + perm0 + (asked ? ', asked: ' + asked : '') + ', now ' + perm + '; ' + ((e && e.name) || '') + ': ' + ((e && e.message) || e) + '; ' + eng + (osm ? ', iOS ' + osm[1] + '.' + osm[2] : '') + (isStandalone() ? ', installed' : ', browser tab') + ']';
      if (e && (e.name === 'NotAllowedError' || /denied/i.test(e.message || ''))) {
        if (perm === 'denied') throw new Error('Notifications are blocked for this app. iPhone/iPad: Settings → Notifications → ' + (cfg.name || 'the app') + ' → Allow Notifications; if the app is not listed there, check Settings → Apps → Safari → Advanced → Feature Flags (Notifications, Push API on), Screen Time restrictions and Lockdown Mode. Chrome: the lock next to the address → Notifications → Allow. Then tap again.' + detail);
        throw new Error('The device did not let the app ask for notifications. Tap "Set reminder" once more; if it fails again, close the app fully, open it again from its icon and retry.' + detail);
      }
      throw e;
    }).then(function (sub) {
      return fetch(base + '/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: st && st.id, subscription: sub.toJSON(), reminders: prefs.reminders, daily: prefs.daily, lang: 'en' }) /* notifications in English; room names stay as on the board */ })
        .then(function (r) { if (!r.ok) throw new Error('The service did not answer (' + r.status + ')'); return r.json(); });
    }).then(function (j) { try { localStorage.setItem('minyan-push', JSON.stringify({ id: j.id, prefs: prefs })); } catch (e) {} });
  }
  function unsubscribePush() {
    var st = pushState(), base = notifyBase();
    try { localStorage.removeItem('minyan-push'); } catch (e) {}
    return Promise.resolve(st && st.id ? fetch(base + '/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: st.id }) }).catch(function () {}) : null)
      .then(function () { return navigator.serviceWorker.ready; }).then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) { if (sub) return sub.unsubscribe(); }).catch(function () {});
  }
  /* ---------- Settings sheet: everything a person can set for themselves, in one place ---------- */
  function installApp() { if (!deferredInstall) return; var ev = deferredInstall; deferredInstall = null; ev.prompt(); ev.userChoice.then(refreshInstallBtn, refreshInstallBtn); }
  function openSettings() {
    var old = $('#set-overlay'); if (old) old.remove();
    var ov = el('div', { class: 'overlay modal', id: 'set-overlay', dir: 'ltr' });
    function close() { ov.remove(); }
    function section(title, desc, kids) { return el('section', { class: 'sset' }, [el('h3', { text: title }), desc ? el('p', { class: 'hint', text: desc }) : null].concat(kids)); }
    function srow(label, ctl, forId) { return el('label', { class: 'srow', for: forId }, [el('span', { text: label }), ctl]); }
    function keep(key, value, def) { try { if (value === def) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) {} render(); }
    var disp = [], msT = tefillos().filter(function (t) { return t.milestone && t.kind !== 'event'; })[0];
    if (msT) { /* the milestone (הודו) as the big number instead of the start */
      var bigSel = el('select', { id: 'big-time', 'aria-label': 'Which time is the big number' }, [el('option', { value: 'start', text: startLabel(msT) + ' (start)' }), el('option', { value: 'milestone', text: msT.milestone })]);
      bigSel.value = bigMode();
      bigSel.addEventListener('change', function () { try { localStorage.setItem('minyan-big', bigSel.value); } catch (e) {} render(); });
      disp.push(srow('Big number on the tiles', bigSel, 'big-time'));
    }
    var lookSel = el('select', { id: 'look', 'aria-label': 'Look of the board' }, LOOKS.map(function (l) { return el('option', { value: l[0], text: l[1] }); }));
    lookSel.value = lookMode();
    lookSel.addEventListener('change', function () { keep('minyan-look', lookSel.value, lookDefault()); });
    disp.push(srow('Look', lookSel, 'look'));
    var langSel = el('select', { id: 'lang', 'aria-label': 'Language of the labels' }, [el('option', { value: 'he', text: 'עברית' }), el('option', { value: 'yi', text: 'יידיש' })]);
    langSel.value = langMode();
    langSel.addEventListener('change', function () { keep('minyan-lang', langSel.value, langDefault()); });
    disp.push(srow('Labels', langSel, 'lang'));
    var sheet = el('div', { class: 'panel sheet' }, [
      el('div', { class: 'sheet-head' }, [el('h2', { text: 'Settings' }), el('button', { type: 'button', class: 'btn icon', text: '✕', 'aria-label': 'Close', onclick: close })]),
      section('Display', 'Your choices stay on this device; the screens in the shul keep the gabbai\'s.', disp),
      section('Countdown box (הזמן הבא)', 'Which zmanim it counts down to.', [el('button', { type: 'button', class: 'btn small', id: 'zc-open', text: 'Choose the zmanim…', onclick: openCountdownChooser })])]);
    var pp = pushPanel(); if (pp) { pp.classList.add('inset'); sheet.appendChild(pp); }
    var app = [];
    if (deferredInstall) app.push(el('button', { type: 'button', class: 'btn small primary', text: 'Install the app', onclick: function () { installApp(); close(); } }));
    if (!inArtifact && isIOS() && !isStandalone() && !deferredInstall) app.push(el('p', { class: 'hint', text: 'To install on iPhone or iPad: in Safari tap Share, then "Add to Home Screen". Reminders work from the installed app only.' }));
    app.push(el('button', { type: 'button', class: 'btn small', text: 'Check for updates', onclick: function () {
      var p = ('serviceWorker' in navigator) ? navigator.serviceWorker.getRegistration().then(function (r) { return r ? r.update() : null; }) : Promise.resolve();
      p.then(function () { return loadRemote(); }).then(function () { toast('Up to date. A newer version reloads by itself when it arrives.'); }, function () { toast('Could not check right now.'); });
    } }));
    sheet.appendChild(section('App', '', app));
    sheet.appendChild(el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn primary', text: 'Done', onclick: close })]));
    ov.appendChild(sheet);
    ov.addEventListener('click', function (ev) { if (ev.target === ov) close(); });
    document.body.appendChild(ov);
  }
  function footer() {
    var L = cfg.location || {};
    var f = el('footer', null, [el('span', { text: S().timesBy + (L.name || (L.lat + ', ' + L.lng)) + ' · ' + (cfg.israel ? S().eretz : S().chul) })]);
    var right = el('div', { class: 'tabs ltr', dir: 'ltr' });
    ui.iosHint = el('span', { class: 'hint', text: 'To install on iPhone: Share, then "Add to Home Screen"' });
    ui.installBtn = el('button', { class: 'btn small primary', text: 'Install the app', onclick: installApp });
    ui.editBtn = el('button', { class: 'btn small', text: 'Edit', onclick: openAdmin });
    ui.editBtn.hidden = !canEditNow();
    right.appendChild(el('button', { type: 'button', class: 'btn small', id: 'settings-open', text: '⚙ Settings', onclick: openSettings }));
    right.appendChild(ui.iosHint); right.appendChild(ui.installBtn); right.appendChild(ui.editBtn);
    refreshInstallBtn();
    f.appendChild(right);
    return f;
  }
  function updateClock(now) {
    if (!ui.clock) return;
    var p = Cal.tzParts(now, loc().tz), h = cfg.clock24 ? pad2(p.hh) : String(p.hh % 12 || 12);
    ui.clock.firstChild.textContent = h + ':' + pad2(p.mm);
    ui.clock.lastChild.textContent = pad2(p.ss);
  }
  function tick() {
    var now = Date.now();
    if (ui.adminOpen) return;
    updateClock(now);
    if (ui.countdownMs && now >= ui.countdownMs) { render(); return; }
    if (ui.zcountMs && now >= ui.zcountMs) { render(); return; }
    if (ui.countdown) ui.countdown.textContent = fmtCountdown(ui.countdownMs - now);
    if (ui.zcount) ui.zcount.textContent = fmtCountdown(ui.zcountMs - now);
    if (Math.floor(now / 60000) !== ui.lastMinute) render();
  }

  /* ---------- admin ---------- */
  function isAdminPage() { return /(^|\/)admin\.html$/i.test(location.pathname) || location.hash === '#admin'; }
  function canEditNow() { return isAdminPage() && (mode === 'artifact' ? canEdit : true); }
  function sha256Hex(str) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  function checkPin(value) {
    var subtle = window.crypto && crypto.subtle;
    if (cfg.pinHash && subtle) return sha256Hex(value).then(function (h) { return h === cfg.pinHash; });
    if (cfg.pin != null && cfg.pin !== '') return Promise.resolve(value === String(cfg.pin));
    if (cfg.pinHash) return Promise.resolve(false);
    return Promise.resolve(value === '1234');
  }
  function refreshEditBtn() { if (ui.editBtn) ui.editBtn.hidden = !canEditNow(); }
  function toast(msg, ms) {
    var t = $('#toast');
    if (t) t.remove();
    t = el('div', { id: 'toast', class: 'toast', dir: /[\u0590-\u05FF]/.test(msg) ? 'rtl' : 'ltr', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3500);
  }
  function overlay(content, cls) {
    var old = $('#overlay'); if (old) old.remove();
    var o = el('div', { id: 'overlay', class: 'overlay ' + (cls || 'full'), dir: 'ltr' }, [el('div', { class: 'panel' }, [content])]);
    $('#app').appendChild(o);
    ui.adminOpen = true;
  }
  function closeOverlay() { ui.adminOpen = false; render(); }
  function openAdmin() { ui.adminDirty = false; if (mode !== 'artifact' && !pinOk) showPin(); else buildAdmin(); }
  function showPin() {
    var input = el('input', { type: 'password', id: 'pin-input', inputmode: 'numeric', autocomplete: 'off' });
    var msg = el('div', { class: 'hint' });
    var form = el('form', { class: 'pin', onsubmit: function (ev) {
      ev.preventDefault();
      checkPin(input.value).then(function (ok) {
        if (ok) {
          pinOk = true;
          try { sessionStorage.setItem('minyan-pin', '1'); } catch (e) {}
          ui.pinValue = input.value; ui.adminDirty = false; closeOverlay(); buildAdmin();
        } else { msg.textContent = 'Wrong PIN'; input.select(); }
      });
    } }, [
      el('div', { class: 'pin-mark' }, [svgIcon('lock')]),
      el('h2', { text: cfg.name || 'Board settings' }),
      el('div', { class: 'hint', text: 'Enter the PIN to open the settings.' }),
      el('div', { class: 'field' }, [el('label', { for: 'pin-input', text: 'PIN' }), input]), msg,
      el('div', { class: 'bar' }, [el('button', { class: 'btn primary', type: 'submit', text: 'Enter' }), el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: closeOverlay })])]);
    overlay(form, 'modal');
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
  var ICONS = {
    today: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="12" cy="15.5" r="1.7" fill="currentColor" stroke="none"/>',
    general: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    notices: '<path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
    overrides: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    publish: '<path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 8.5a4 4 0 0 1-1 7.5"/><path d="M12 12v9M8.5 15.5 12 12l3.5 3.5"/>',
    data: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
    send: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M13 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>'
  };
  function svgIcon(name) {
    var sp = el('span', { class: 'ico', 'aria-hidden': 'true' });
    sp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return sp;
  }
  /* a minutes box with − and + beside it (5 at a time); typing still works */
  function stepper(input, big) {
    var w = el('span', { class: 'step' }), dec = el('button', { type: 'button', text: '−', 'aria-label': 'Less', tabindex: '-1' }), inc = el('button', { type: 'button', text: '+', 'aria-label': 'More', tabindex: '-1' });
    function bump(d) { var min = input.min === '' ? -Infinity : +input.min, v = (+input.value || 0) + d; if (v < min) v = min; input.value = String(v); input.dispatchEvent(new Event('input', { bubbles: true })); }
    dec.addEventListener('click', function () { bump(-(big || 1)); }); inc.addEventListener('click', function () { bump(big || 1); });
    w.appendChild(dec); w.appendChild(input); w.appendChild(inc);
    return w;
  }
  /* a titled card for the admin pages; fill card.body */
  function card(title, desc, opts) {
    var body = el('div', { class: 'cbody' });
    var c = el('section', { class: 'card' + (opts && opts.cls ? ' ' + opts.cls : '') }, [
      el('div', { class: 'chead' }, [el('div', null, [el('h3', { text: title }), desc ? el('div', { class: 'cdesc', text: desc }) : null]), opts && opts.extra ? opts.extra : null]), body]);
    c.body = body;
    return c;
  }
  var uid = 0;
  function buildAdmin(draft) {
    var d = draft ? clone(draft) : clone(cfg);
    d.location = d.location || {}; d.schedules = d.schedules || {}; d.overrides = d.overrides || []; d.notices = d.notices || [];
    d.tefillos = (d.tefillos && d.tefillos.length) ? d.tefillos : clone(TEFILLA_DEFAULTS);
    var todayRd = Cal.nowInTz(Date.now(), loc().tz).rd, todayInfo = Cal.dayInfo(todayRd, !!cfg.israel);
    var tabs = [['today', 'Today', 'Move, cancel or add a minyan for today only.'], ['general', 'General', 'Name, rooms, location, looks and the tefillos.'], ['schedule', 'Schedule', 'The regular minyanim for each kind of day.'], ['notices', 'Notices', 'Banner, sponsors and announcements on the board.'], ['overrides', 'Special dates', 'A different schedule for one date or for a day every year.', 'Special']];
    if (mode !== 'artifact') tabs.push(['publish', 'Publish', 'What is waiting to go out, and the connection to the website.']);
    if (mode !== 'artifact') tabs.push(['send', 'Send', 'A notification, right now, to everyone who turned reminders on.']);
    tabs.push(['data', 'Backup', 'Previous versions and the settings as text.']);
    var pages = {}, tabBar = el('div', { class: 'tabs', role: 'tablist' }), pageTitle = el('h2', { text: '' }), pageDesc = el('div', { class: 'cdesc', text: '' });
    tabs.forEach(function (t) { tabBar.appendChild(el('button', { type: 'button', role: 'tab', id: 'tab-' + t[0], 'aria-selected': 'false', onclick: function () { selectTab(t[0]); } }, [svgIcon(t[0]), el('span', { class: 'lbl', text: t[1] }), el('span', { class: 'lbl-s', text: t[3] || t[1] })])); });
    function selectTab(id) {
      ui.adminTab = id; /* a rebuild (adding a category, restoring a backup) keeps the gabbai on the same tab */
      tabs.forEach(function (t) { pages[t[0]].hidden = t[0] !== id; $('#tab-' + t[0], tabBar).setAttribute('aria-selected', String(t[0] === id)); if (t[0] === id) { pageTitle.textContent = t[1]; pageDesc.textContent = t[2]; } });
      try { $('#overlay').scrollTop = 0; } catch (e) {}
      if (id === 'data') dataArea.value = JSON.stringify(collect(), null, 2);
    }

    var oRows = [];
    /* general */
    var g = el('div', { class: 'col' });
    var cBoard = card('The board', 'The name on the board and the rooms the minyanim are in.'),
      cLook = card('Look and labels', 'How the board reads. Everyone may still switch the look and the labels on their own phone.'),
      cZman = card('Location and zmanim', 'Where the shul is, how nightfall is figured, and which zmanim the countdown box shows.'),
      cTef = card('Tefillos', 'Minyanim count for "next minyan" and reminders. A shiur or event category is listed on the board and in texts but never shown as the next minyan.'),
      cServices = card('Website and services', 'Addresses the app, the share preview and the reminders use.'),
      cSec = card('Security', 'The PIN keeps strangers out of this page.');
    var fName = inp('f-name', d.name), fLocName = inp('f-locname', d.location.name), fLat = inp('f-lat', d.location.lat, { inputmode: 'decimal' }),
      fLng = inp('f-lng', d.location.lng, { inputmode: 'decimal' }), fTz = inp('f-tz', d.location.tz || 'America/New_York', { list: 'tz-list' }),
      fElev = inp('f-elev', d.location.elev || 0, { inputmode: 'numeric' }), fCandles = inp('f-candles', d.candles == null ? 18 : d.candles, { inputmode: 'numeric' }),
      fTzeisMin = inp('f-tzeismin', d.tzeisMinutes || '', { inputmode: 'numeric', placeholder: 'blank = by degrees' }), fTzeisDeg = inp('f-tzeisdeg', d.tzeisDeg || 8.5, { inputmode: 'decimal' }),
      fPin = inp('f-pin', '', { type: 'password', autocomplete: 'new-password', placeholder: 'leave empty to keep the current PIN' });
    var fSms = inp('f-sms', d.smsNumber || '', { dir: 'ltr', placeholder: '+1 718 555 0100' });
    var fRooms = inp('f-rooms', d.rooms || '', { placeholder: 'ברך משה, דברי יואל, לב אהרן' });
    var fSite = inp('f-site', d.siteUrl || '', { dir: 'ltr', placeholder: 'https://yourname.github.io/minyan/' }), fLogo = inp('f-logo', d.logo || '', { dir: 'ltr', placeholder: 'logo.png' });
    var fNotify = inp('f-notify', d.notifyUrl || '', { dir: 'ltr', placeholder: 'https://minyan-sms.yourname.workers.dev' });
    var fSponsorSecs = inp('f-sponsor-secs', d.sponsorSeconds || 8, { type: 'number', min: '2', max: '120', inputmode: 'numeric' });
    var fDateFmt = el('select', { id: 'f-datefmt' }, [el('option', { value: 'mdy', text: 'Month/Day/Year (10/25/2026)' }), el('option', { value: 'dmy', text: 'Day.Month.Year (25.10.2026)' }), el('option', { value: 'iso', text: 'Year-Month-Day (2026-10-25)' })]);
    fDateFmt.value = d.dateFormat || (/^America\//.test((d.location || {}).tz || '') ? 'mdy' : 'dmy');
    var fBig = el('select', { id: 'f-bigtime' }, [el('option', { value: 'start', text: 'The start time (e.g. ברכות)' }), el('option', { value: 'milestone', text: 'The milestone (e.g. הודו)' })]);
    fBig.value = d.bigTime === 'milestone' ? 'milestone' : 'start';
    var fNowMins = inp('f-now-mins', d.nowMinutes == null || d.nowMinutes === '' ? 20 : d.nowMinutes, { type: 'number', min: '0', max: '180', inputmode: 'numeric' });
    cBoard.body.appendChild(el('div', { class: 'fields' }, [field('Shul name (shown on the board)', fName), field('Location name (shown in the footer)', fLocName)]));
    var roomSelects = [];
    function roomList() { return fRooms.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
    function roomsChanged() { refreshRooms(); paintRoomsEditor(); roomSelects.forEach(function (f) { try { f(); } catch (e) {} }); }
    function addRoomToList(name) { var l = roomList(); if (l.indexOf(name) < 0) { l.push(name); fRooms.value = l.join(', '); } roomsChanged(); }
    var roomsChips = el('div', { class: 'chips-row' }), roomAdd = el('input', { id: 'f-room-add', type: 'text', dir: 'auto', placeholder: 'Room / minyan name', class: 'room', autocomplete: 'off' });
    function paintRoomsEditor() {
      roomsChips.innerHTML = '';
      var all = roomList();
      all.forEach(function (name, idx) {
        function move(dir) { var l = roomList(), j = idx + dir; if (j < 0 || j >= l.length) return; l.splice(idx, 1); l.splice(j, 0, name); fRooms.value = l.join(', '); roomsChanged(); }
        roomsChips.appendChild(el('span', { class: 'rchip' }, [el('span', { class: 'n', text: (idx + 1) + '.' }), el('span', { text: name }),
          all.length > 1 ? el('button', { type: 'button', class: 'x', text: '◀', title: 'Earlier', 'aria-label': 'Move ' + name + ' earlier', onclick: function () { move(-1); } }) : null,
          all.length > 1 ? el('button', { type: 'button', class: 'x', text: '▶', title: 'Later', 'aria-label': 'Move ' + name + ' later', onclick: function () { move(1); } }) : null,
          el('button', { type: 'button', class: 'x', text: '✕', 'aria-label': 'Remove ' + name, onclick: function () { var l = roomList(); l.splice(idx, 1); fRooms.value = l.join(', '); roomsChanged(); } })]));
      });
      if (!roomList().length) roomsChips.appendChild(el('span', { class: 'hint', text: 'No rooms yet. Add the rooms or minyan names here; the schedule rows pick from this list.' }));
    }
    function addRoomFromInput() { var v = roomAdd.value.trim(); if (!v) return; roomAdd.value = ''; addRoomToList(v); }
    roomAdd.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); addRoomFromInput(); } });
    fRooms.hidden = true;
    cBoard.body.appendChild(el('div', { class: 'field' }, [el('label', { for: 'f-room-add', text: 'Rooms / minyan names' }), roomsChips,
      el('div', { class: 'mrow-l' }, [roomAdd, el('button', { type: 'button', class: 'btn small', text: '+ Add room', onclick: addRoomFromInput })]), fRooms,
      el('div', { class: 'hint', text: 'The schedule rows pick from this list, so a room is always spelled the same way. The order here is the order in the pickers and on the board when two minyanim start at the same time (◀ ▶ to move).' })]));
    /* a dropdown of the defined rooms; "New room…" adds one to the list */
    function roomPicker(current, onPick, label) {
      var sel = el('select', { 'aria-label': label || 'Room' }), newIn = el('input', { type: 'text', dir: 'auto', placeholder: 'New room name', class: 'room', 'aria-label': 'New room name' }), okBtn = el('button', { type: 'button', class: 'btn small', text: 'Add' });
      newIn.hidden = true; okBtn.hidden = true;
      function cur() { return (typeof current === 'function' ? current() : current) || ''; }
      function fill() {
        var c = cur(), names = knownRooms.slice();
        if (c && names.indexOf(c) < 0) names.push(c);
        sel.innerHTML = '';
        sel.appendChild(el('option', { value: '', text: label === 'Add a room' ? '+ add a room…' : '— no room —' }));
        names.forEach(function (n) { sel.appendChild(el('option', { value: n, text: n })); });
        sel.appendChild(el('option', { value: '__new', text: 'New room…' }));
        sel.value = c;
      }
      function hideNew() { newIn.hidden = true; okBtn.hidden = true; }
      sel.addEventListener('change', function () {
        if (sel.value === '__new') { newIn.hidden = false; okBtn.hidden = false; newIn.focus(); return; }
        hideNew(); onPick(sel.value); fill();
      });
      function commitNew() { var v = newIn.value.trim(); hideNew(); newIn.value = ''; if (!v) { fill(); return; } addRoomToList(v); fill(); sel.value = v; onPick(v); fill(); }
      okBtn.addEventListener('click', commitNew);
      newIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); commitNew(); } });
      fill(); roomSelects.push(fill);
      return [sel, newIn, okBtn];
    }
    cServices.body.appendChild(el('div', { class: 'fields' }, [field('Website address (used for share previews and the app)', fSite), field('Logo file shown in the header (file name next to index.html)', fLogo)]));
    cServices.body.appendChild(el('div', { class: 'fields' }, [field('Notification service address (the Cloudflare worker; enables reminders in the app)', fNotify), field('SMS number (once the text service is set up)', fSms)]));
    cZman.body.appendChild(el('div', { class: 'fields' }, [field('Latitude', fLat), field('Longitude', fLng), field('Time zone', fTz), field('Elevation (meters)', fElev)]));
    cZman.body.appendChild(el('datalist', { id: 'tz-list' }, ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Europe/London', 'Europe/Antwerp', 'Europe/Zurich', 'Asia/Jerusalem', 'Australia/Melbourne'].map(function (z) { return el('option', { value: z }); })));
    cZman.body.appendChild(el('div', { class: 'fields' }, [field('Candle lighting: minutes before sunset', fCandles), field('Nightfall (tzeis): minutes after sunset', fTzeisMin), field('Nightfall: degrees below the horizon (used when minutes is blank)', fTzeisDeg)]));
    var lookRow2 = el('div', { class: 'fields' }, [field('Civil date on the board and the weekly sheet', fDateFmt), field('Big number on the tiles, by default (everyone may switch it on their own phone)', fBig), field('Minutes a minyan stays marked "now" after it starts (then it is dimmed, and the lobby screen hides it)', fNowMins), field('Lobby screen: seconds per sponsor box (they take turns when there is more than one)', fSponsorSecs)]);
    var fPalette = el('select', { id: 'f-palette' }, [el('option', { value: 'shul', text: 'Shul: light stone, brass, charcoal, burgundy' }), el('option', { value: 'classic', text: 'Classic: parchment and navy' }), el('option', { value: 'contrast', text: 'High contrast: black on white, larger type' })]);
    fPalette.value = lookDefault.call(null) && isLook(d.palette) ? d.palette : 'shul';
    var fLang = el('select', { id: 'f-lang' }, [el('option', { value: 'he', text: 'Hebrew (היום, מחר, מנין הבא…)' }), el('option', { value: 'yi', text: 'Yiddish (היינט, מארגן, זונטאג…)' })]); fLang.value = d.lang === 'yi' ? 'yi' : 'he';
    cLook.body.appendChild(el('div', { class: 'fields' }, [field('Colors: the look everyone gets unless they pick another in the footer; the lobby screen and door displays always use it', fPalette), field('Board labels: the language everyone gets unless they pick another in the footer', fLang)]));
    cLook.body.appendChild(lookRow2);
    cZman.body.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Countdown box ("הזמן הבא"): the next of these zmanim still ahead today' }), el('div', { class: 'chipset' }, COUNTDOWN_KEYS.map(function (k) { return chk('cd-' + k, countdownKeysOf(d).indexOf(k) >= 0, Cal.ZMAN_NAMES[k]); }))]));
    cZman.body.appendChild(el('div', { class: 'checks' }, [chk('f-israel', d.israel, 'Eretz Yisroel calendar (one-day Yom Tov)'), chk('f-weekly', d.weeklyEarliest, 'Weekday zman-based times use the earliest sunset of the week (Sun–Thu)'), chk('f-24', d.clock24, '24-hour clock'), chk('f-tzeis', d.showTzeis !== false, 'Show צאת הכוכבים (the board\'s nightfall) in the zmanim list'), chk('f-rt', d.showRT, 'Show Rabbeinu Tam (72 minutes after sunset) in the zmanim list; hidden by itself while nightfall is 72 and צאת הכוכבים is shown'), chk('f-60', d.show60 !== false, 'Show 60 מינוט אחר השקיעה in the zmanim list')]));
    if (mode !== 'artifact') cSec.body.appendChild(el('div', { class: 'fields' }, [field('New PIN for the admin page', fPin, el('span', { class: 'hint', text: 'Stored scrambled (hashed), so it cannot be read from the site files. It keeps strangers out of the admin page; what everyone else sees can only be changed with the GitHub token on the Publish tab, which stays on the device that entered it.' }))]));
    var tRows = [];
    d.tefillos.forEach(function (t, i) {
      var r = { name: inp('t-name-' + i, t.name), ms: inp('t-ms-' + i, t.milestone), off: inp('t-off-' + i, t.offset, { inputmode: 'numeric' }), start: inp('t-start-' + i, t.startLabel || ''), night: inp('t-night-' + i, t.nightUntil == null ? '' : t.nightUntil, { type: 'number', min: '0', max: '11', inputmode: 'numeric', placeholder: '4' }),
        period: el('select', { id: 't-period-' + i }, [el('option', { value: 'am', text: 'Morning: 6:45 means 6:45 AM' }), el('option', { value: 'pm', text: 'Afternoon/evening: 6:45 means 6:45 PM' })]),
        kind: el('select', { id: 't-kind-' + i }, [el('option', { value: 'minyan', text: 'Minyan' }), el('option', { value: 'event', text: 'Shiur / event' })]) };
      r.period.value = t.period || 'am'; r.kind.value = t.kind === 'event' ? 'event' : 'minyan';
      tRows.push(r);
      var removeBtn = i >= 3 ? el('button', { type: 'button', class: 'btn small danger', text: 'Remove category', onclick: function () { var c = collect(); c.tefillos.splice(i, 1); ui.adminDirty = true; closeOverlay(); buildAdmin(c); } }) : null;
      var rowEl = el('div', { class: 'tef' }, [el('div', { class: 'tefhead' }, [el('span', { text: t.name || 'Category ' + (i + 1) }), removeBtn]), el('div', { class: 'fields' }, [field('Name (shown on the board)', r.name), field('Type', r.kind), field('Milestone shown under the time (e.g. הודו)', r.ms), field('Milestone: minutes after the start', r.off), field('Name of the start, shown small when the milestone is the big number (e.g. ברכות)', r.start), field('How to read the hours', r.period), field('Night cut-off: a time before this hour (0–11) still belongs to the previous night, e.g. a Maariv at 12:30 AM; blank = 4', r.night)])]);
      cTef.body.appendChild(rowEl);
    });
    cTef.body.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', text: '+ Add category (e.g. שיעור)', onclick: function () {
      var c = collect(); c.tefillos.push({ id: 'c' + Date.now().toString(36), name: 'שיעור', milestone: '', offset: 0, period: 'pm', kind: 'event' }); ui.adminDirty = true; closeOverlay(); buildAdmin(c);
    } })]));
    [cBoard, cLook, cZman, cTef, cServices, mode !== 'artifact' ? cSec : null].forEach(function (c) { if (c) g.appendChild(c); });
    pages.general = g;
    function liveTefilla(i) { var r = tRows[i], t = d.tefillos[i]; return { id: t.id, name: r.name.value.trim() || t.name, milestone: r.ms.value.trim(), offset: +r.off.value || 0, startLabel: r.start.value.trim(), nightUntil: r.night.value === '' ? undefined : Math.max(0, Math.min(11, +r.night.value || 0)), period: r.period.value, kind: r.kind.value === 'event' ? 'event' : 'minyan' }; }

    /* schedule: one row per minyan */
    var lines = {};
    Cal.DAY_TYPES.forEach(function (t) { lines[t[0]] = {}; d.tefillos.forEach(function (tf) { lines[t[0]][tf.id] = { value: (d.schedules[t[0]] && d.schedules[t[0]][tf.id]) || '' }; }); });
    var ZMAN_OPTS = [['fixed', 'Fixed time'], ['sunrise', 'Sunrise (netz)'], ['alos', 'Dawn (alos)'], ['shema', 'Sof zman Shema'], ['tefilla', 'Sof zman tefilla'], ['chatzos', 'Chatzos'], ['minchag', 'Mincha gedola'],
      ['plag', 'Plag hamincha'], ['candles', 'Candle lighting'], ['sunset', 'Sunset (shkiah)'], ['tzeis', 'Nightfall (tzeis)'], ['tzeis60', 'Sunset + 60 min'], ['tzeis72', 'Rabbeinu Tam (72 min)']];
    var ZWORD = { sunrise: 'sunrise', alos: 'alos', shema: 'shema', tefilla: 'tefilla', chatzos: 'chatzos', minchag: 'minchag', plag: 'plag', candles: 'candles', sunset: 'sunset', tzeis: 'tzeis', tzeis60: 'tzeis60', tzeis72: 'rt' };
    function hhmm(min) { min = Math.round(min); return pad2(Math.floor(min / 60) % 24) + ':' + pad2(min % 60); }
    function specToRow(spec) { return spec.kind === 'fixed' ? { kind: 'fixed', time: hhmm(spec.min), off: 0, round: false } : { kind: spec.zman, time: '', off: spec.offset || 0, round: !!spec.round }; }
    function lineToRow(line, tf) {
      var p = parseLine(line, tf);
      if (!p) return null;
      if (!p.spec) return { raw: line.trim() };
      if (p.series) {
        var st = specToRow(p.spec.start), en;
        if (p.spec.end) en = specToRow(p.spec.end);
        else { /* legacy "count N": same span, expressed as an end that moves with the start */
          var span = p.spec.every * Math.max(0, (p.spec.count || 1) - 1);
          en = st.kind === 'fixed' ? { kind: 'fixed', time: hhmm(p.spec.start.min + span), off: 0, round: false } : { kind: st.kind, time: '', off: st.off + span, round: false };
        }
        return { series: true, every: p.spec.every, start: st, endMode: 'to', end: en, rooms: p.rooms.join(', '), note: p.note, cond: condOf(p) };
      }
      var r = specToRow(p.spec); r.room = p.room; r.note = p.note; r.cond = condOf(p);
      return r;
    }
    /* the row's "show only" condition: {op: 'until'|'after', zman, off} or null */
    function condOf(p) { return p.cond ? { op: p.cond.op, zman: p.cond.spec.zman, off: p.cond.spec.offset || 0 } : null; }
    function condTok(r) { return r.cond && r.cond.op ? ' ' + r.cond.op + ' ' + (ZWORD[r.cond.zman] || r.cond.zman) + (r.cond.off ? (r.cond.off < 0 ? '-' : '+') + Math.abs(r.cond.off) : '') : ''; }
    function tokOf(w) { return w.kind === 'fixed' ? (w.time || '07:00') : (ZWORD[w.kind] + (w.off ? (w.off < 0 ? '-' : '+') + Math.abs(w.off) : '') + (w.round ? '~5' : '')); }
    function rowToLine(r) {
      if (r.raw != null) return r.raw;
      if (r.series) return 'every ' + (r.every || 10) + ' from ' + tokOf(r.start) + ' to ' + tokOf(r.end) + (r.rooms ? ' rooms ' + r.rooms : '') + condTok(r) + (r.note ? ' // ' + r.note : '');
      return tokOf(r) + (r.room ? ' ' + r.room : '') + condTok(r) + (r.note ? ' // ' + r.note : '');
    }
    var roomsList = el('datalist', { id: 'rooms-list' }), knownRooms = [];
    function refreshRooms() {
      var set = {}, probe = { period: 'am' };
      fRooms.value.split(',').forEach(function (x) { if (x.trim()) set[x.trim()] = 1; });
      function take(l) { var p = parseLine(l, probe); if (!p) return; if (p.rooms) p.rooms.forEach(function (x) { set[x] = 1; }); else if (p.room) set[p.room] = 1; }
      Object.keys(lines).forEach(function (k) { Object.keys(lines[k]).forEach(function (id) { lines[k][id].value.split('\n').forEach(take); }); });
      oRows.forEach(function (r) { Object.keys(r.lines).forEach(function (id) { r.lines[id].value.split('\n').forEach(take); }); });
      roomsList.innerHTML = '';
      var ordered = fRooms.value.split(',').map(function (x) { return x.trim(); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      knownRooms = ordered.concat(Object.keys(set).filter(function (x) { return ordered.indexOf(x) < 0; }).sort()); /* the list's order, then anything else found in the rows */
      knownRooms.forEach(function (name) { roomsList.appendChild(el('option', { value: name })); });
    }
    /* "דברי יואל ברך משה" typed without commas -> ["דברי יואל", "ברך משה"] when it is exactly a run of known room names */
    function splitKnown(str) {
      var names = knownRooms.filter(function (n) { return n !== str; }).sort(function (a, b) { return b.length - a.length; }), out = [], rest = str.trim(), hit, i;
      while (rest) {
        hit = null;
        for (i = 0; i < names.length; i++) if (rest.indexOf(names[i]) === 0) { hit = names[i]; break; }
        if (!hit) return [str];
        out.push(hit); rest = rest.slice(hit.length).trim();
      }
      return out.length ? out : [str];
    }
    /* store = {value: lines text}; tfIndex = index into d.tefillos; typeKeyFn() = day type used for the "today" preview */
    function minyanEditor(store, tfIndex, typeKeyFn, copyFrom) {
      var wrap = el('div', { class: 'editor' }), list = el('div', { class: 'rows' }), rows = [], ta = null;
      function tf() { return liveTefilla(tfIndex); }
      function sync() { store.value = rows.map(rowToLine).join('\n'); if (ta) ta.value = store.value; refreshRooms(); markTabs(); }
      /* rows are kept in time order (by today's time for zman-based ones); unreadable lines go last */
      function sortRows() { rows.sort(function (x, y) { var a = previewOf(x), b = previewOf(y); return (isNaN(a) ? 1e9 : a) - (isNaN(b) ? 1e9 : b); }); }
      function load() { rows = []; store.value.split('\n').forEach(function (l) { var r = lineToRow(l, tf()); if (r) rows.push(r); }); sortRows(); }
      function timesOf(r) { return expandLine(parseLine(rowToLine(r), tf()), todayRd, typeKeyFn()).map(function (x) { return x.start; }); }
      function previewOf(r) { var t = timesOf(r); return t.length ? t[0] : NaN; }
      function condText(r) {
        if (!r.cond || !r.cond.op) return '';
        var lim = engine.condLimit(parseLine(rowToLine(r), tf()), todayRd, typeKeyFn()), name = Cal.ZMAN_NAMES[r.cond.zman] || r.cond.zman;
        return (r.cond.op === 'until' ? 'before ' : 'from ') + name + (r.cond.off ? (r.cond.off < 0 ? ' −' : ' +') + Math.abs(r.cond.off) + ' min' : '') + (isNaN(lim) ? '' : ', today ' + fmtTime(lim));
      }
      function previewText(r) {
        var t = timesOf(r), c = condText(r);
        if (!t.length) return c ? 'not today: only ' + c : (r.series ? 'no minyanim today (check the times)' : '');
        if (!r.series) return 'today ' + fmtTime(t[0]) + (c ? ' · only ' + c : '');
        var head = t.slice(0, 3).map(fmtTime).join(', ');
        return 'today ' + head + (t.length > 4 ? ' … ' : t.length === 4 ? ', ' : '') + (t.length > 3 ? fmtTime(t[t.length - 1]) : '') + (c ? ' · only ' + c : '');
      }
      /* the "when" widget: fixed time picker, or zman + minutes before/after + rounding. Mutates w and calls onChange. */
      function timeWidget(w, onChange, label, roundLabel) {
        var when = el('select', { 'aria-label': label || 'Time type' });
        ZMAN_OPTS.forEach(function (o) { when.appendChild(el('option', { value: o[0], text: o[1] })); });
        when.value = w.kind;
        var time = el('input', { type: 'time', value: w.time || '', 'aria-label': 'Time' });
        var sign = el('select', { 'aria-label': 'Before or after' }, [el('option', { value: '-', text: 'min before' }), el('option', { value: '+', text: 'min after' })]);
        sign.value = w.off < 0 ? '-' : '+';
        var mins = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', class: 'mins', value: String(Math.abs(w.off || 0)), 'aria-label': 'Minutes' }), minsW = stepper(mins, 5);
        var roundC = el('input', { type: 'checkbox' }); roundC.checked = !!w.round;
        var roundL = el('label', { class: 'small' }, [roundC, ' ' + (roundLabel || 'round to 5')]);
        function show() { var fixed = when.value === 'fixed'; time.hidden = !fixed; sign.hidden = fixed; minsW.hidden = fixed; roundL.hidden = fixed || roundLabel === ''; }
        when.addEventListener('change', function () { w.kind = when.value; if (w.kind === 'fixed' && !w.time) { w.time = '07:00'; time.value = w.time; } show(); onChange(); });
        time.addEventListener('input', function () { w.time = time.value; onChange(); });
        function offChange() { w.off = (+mins.value || 0) * (sign.value === '-' ? -1 : 1); onChange(); }
        sign.addEventListener('change', offChange); mins.addEventListener('input', offChange);
        roundC.addEventListener('change', function () { w.round = roundC.checked; onChange(); });
        show();
        return [when, time, sign, minsW, roundL];
      }
      /* "Show: only while it starts before <zman>": a late Shacharis drops away by itself in summer, a run shortens by itself */
      function condWidget(r, onChange) {
        var op = el('select', { 'aria-label': 'Show only' }, [el('option', { value: '', text: 'Always' }), el('option', { value: 'until', text: 'Only while it starts before' }), el('option', { value: 'after', text: 'Only once it starts at or after' })]);
        var zman = el('select', { 'aria-label': 'Condition zman' }); ZMAN_OPTS.forEach(function (o) { if (o[0] !== 'fixed') zman.appendChild(el('option', { value: o[0], text: o[1] })); });
        var mins = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', class: 'cmins', 'aria-label': 'Condition minutes' }), minsW = stepper(mins, 5);
        var sign = el('select', { 'aria-label': 'Condition before or after' }, [el('option', { value: '-', text: 'min before it' }), el('option', { value: '+', text: 'min after it' })]);
        function paint() {
          var on = !!(r.cond && r.cond.op);
          op.value = on ? r.cond.op : ''; zman.hidden = minsW.hidden = sign.hidden = !on;
          if (on) { zman.value = r.cond.zman; if (zman.selectedIndex < 0) zman.value = 'tefilla'; sign.value = r.cond.off > 0 ? '+' : '-'; mins.value = String(Math.abs(r.cond.off || 0)); }
        }
        op.addEventListener('change', function () {
          if (!op.value) r.cond = null;
          else r.cond = { op: op.value, zman: (r.cond && r.cond.zman) || (tf().period === 'pm' ? 'sunset' : 'tefilla'), off: (r.cond && r.cond.off) || 0 };
          paint(); onChange();
        });
        zman.addEventListener('change', function () { r.cond.zman = zman.value; onChange(); });
        function offChange() { r.cond.off = (+mins.value || 0) * (sign.value === '-' ? -1 : 1); onChange(); }
        sign.addEventListener('change', offChange); mins.addEventListener('input', offChange);
        paint();
        return el('div', { class: 'mrow-l cond' }, [el('span', { class: 'k', text: 'Show:' }), op, zman, minsW, sign]);
      }
      function renderRow(r) {
        var row = el('div', { class: 'mrow' + (r.series ? ' series' : '') });
        var del = el('button', { type: 'button', class: 'btn small danger icon', text: '✕', title: 'Remove', 'aria-label': 'Remove', onclick: function () { rows.splice(rows.indexOf(r), 1); row.remove(); sync(); } });
        if (r.raw != null) {
          var rawIn = el('input', { type: 'text', dir: 'auto', value: r.raw, class: 'grow' });
          rawIn.addEventListener('input', function () { r.raw = rawIn.value; sync(); });
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: 'bad', text: 'Cannot read this line:' }), rawIn, del]));
          return row;
        }
        var pv = el('span', { class: 'pv num' });
        function changed() { sync(); pv.textContent = previewText(r); }
        var note = el('input', { type: 'text', dir: 'auto', placeholder: 'Note (optional)', value: r.note || '', class: 'grow' });
        note.addEventListener('input', function () { r.note = note.value; sync(); });
        if (r.series) {
          var every = el('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', class: 'mins', value: String(r.every || 10), 'aria-label': 'Every how many minutes' });
          every.addEventListener('input', function () { r.every = Math.max(1, +every.value || 1); changed(); });
          var endW = timeWidget(r.end, changed, 'Until time', '');
          var seq = (r.rooms || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
          if (seq.length === 1) { seq = splitKnown(seq[0]); if (seq.length > 1) r.rooms = seq.join(', '); }
          var chips = el('div', { class: 'chips-row' });
          function paint() {
            chips.innerHTML = '';
            seq.forEach(function (name, idx) {
              function move(dir) { var j = idx + dir; if (j < 0 || j >= seq.length) return; seq.splice(idx, 1); seq.splice(j, 0, name); commitRooms(); }
              chips.appendChild(el('span', { class: 'rchip' }, [
                el('span', { class: 'n', text: (idx + 1) + '.' }), el('span', { text: name }),
                seq.length > 1 ? el('button', { type: 'button', class: 'x', text: '◀', title: 'Earlier', 'aria-label': 'Move ' + name + ' earlier', onclick: function () { move(-1); } }) : null,
                seq.length > 1 ? el('button', { type: 'button', class: 'x', text: '▶', title: 'Later', 'aria-label': 'Move ' + name + ' later', onclick: function () { move(1); } }) : null,
                el('button', { type: 'button', class: 'x', text: '✕', 'aria-label': 'Remove ' + name, onclick: function () { seq.splice(idx, 1); commitRooms(); } })]));
            });
            if (!seq.length) chips.appendChild(el('span', { class: 'k', text: 'no rooms yet: pick them below in the order they take turns' }));
          }
          function commitRooms() { r.rooms = seq.join(', '); paint(); changed(); }
          var picker = roomPicker('', function (v) { if (v) { seq.push(v); commitRooms(); } }, 'Add a room');
          paint();
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: 'tag', text: 'Repeating' }), el('span', { class: 'k', text: 'every' }), stepper(every, 5), el('span', { class: 'k', text: 'min, from' })].concat(timeWidget(r.start, changed, 'From', 'round every minyan to 5'))));
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: 'k', text: 'to' })].concat(endW)));
          row.appendChild(el('div', { class: 'mrow-l' }, [el('span', { class: 'k', text: 'rooms, in this order (1st minyan, 2nd, …, then again from 1):' }), chips]));
          row.appendChild(el('div', { class: 'mrow-l' }, picker));
          row.appendChild(el('div', { class: 'mrow-l' }, [note, pv, del]));
          row.appendChild(condWidget(r, changed));
        } else {
          var room = roomPicker(function () { return r.room; }, function (v) { r.room = v; sync(); }, 'Room');
          row.appendChild(el('div', { class: 'mrow-l' }, timeWidget(r, changed).concat([pv])));
          row.appendChild(el('div', { class: 'mrow-l' }, room.concat([note, del])));
          row.appendChild(condWidget(r, changed));
        }
        pv.textContent = previewText(r);
        /* when the gabbai leaves this row, it moves to its place in time order */
        row.addEventListener('focusout', function (ev) {
          if (ev.relatedTarget && row.contains(ev.relatedTarget)) return;
          setTimeout(function () { if (document.activeElement && row.contains(document.activeElement)) return; var before = rows.slice(); sortRows(); if (before.some(function (x, i) { return x !== rows[i]; })) { renderAll(); sync(); } }, 50);
        });
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
      var repeatBtn = el('button', { type: 'button', class: 'btn small', text: '+ Add repeating', title: 'A run of minyanim every few minutes, in rooms taken in turn', onclick: function () {
        var last = rows.length ? rows[rows.length - 1] : null, m = last ? previewOf(last) : NaN;
        addRow({ series: true, every: 15, start: { kind: 'fixed', time: hhmm(isNaN(m) ? 7 * 60 : m + 15), off: 0, round: false }, endMode: 'to',
          end: { kind: 'fixed', time: hhmm(isNaN(m) ? 9 * 60 : m + 135), off: 0, round: false }, rooms: fRooms.value.trim(), note: '' });
        var inputs = list.lastChild.querySelectorAll('input, select'); if (inputs.length) inputs[0].focus();
      } });
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
      var sortBtn = el('button', { type: 'button', class: 'btn small', text: 'Sort by time', 'data-nodirty': '1', onclick: function () {
        sortRows(); renderAll(); sync();
      } });
      var textBtn = el('button', { type: 'button', class: 'btn small', text: 'Edit as text', 'data-nodirty': '1', onclick: function () {
        if (ta.hidden) { ta.value = store.value; ta.hidden = false; list.hidden = true; textBtn.textContent = 'Back to the list'; }
        else { load(); renderAll(); ta.hidden = true; list.hidden = false; textBtn.textContent = 'Edit as text'; }
      } });
      ta = el('textarea', { spellcheck: 'false', dir: 'auto' }); ta.hidden = true;
      ta.addEventListener('input', function () { store.value = ta.value; refreshRooms(); markTabs(); });
      load(); renderAll();
      wrap.reload = function () { load(); renderAll(); if (ta) ta.value = store.value; };
      wrap.appendChild(list); wrap.appendChild(ta);
      wrap.appendChild(el('div', { class: 'editor-bar' }, [addBtn, repeatBtn, copySel, sortBtn, textBtn]));
      return wrap;
    }
    var sp = el('div', { class: 'col' });
    sp.appendChild(roomsList);
    sp.appendChild(el('details', { class: 'help' }, [el('summary', { text: 'How this works' }), el('div', { class: 'hint' }, [
      el('p', { text: 'Pick a day type, then add one row per minyan: a fixed time, or a zman (sunset, chatzos, candle lighting…) with minutes before or after. Type the room name; names you already used are suggested. "today" shows what that row gives today.' }),
      el('p', { text: '"+ Add repeating" makes one row that stands for a whole run: every N minutes, from a time or a zman, until a time or zman, in the rooms you pick, taken in turn in the order shown. It is recalculated every day, so a run that starts at sunrise moves with sunrise. Mix repeating rows and single rows freely; the board shows them all sorted by time.' }),
      el('p', { text: '"Copy from…" starts a day type from another one. A day type with no rows uses the more general one (Rosh Chodesh empty → Weekdays; Yom Tov empty → Shabbos).' }),
      el('p', null, ['"Edit as text" shows the same rows as lines like ', el('code', { text: '6:20 ברך משה' }), ', ', el('code', { text: 'sunset-15 דברי יואל // note' }), ' or ', el('code', { text: 'every 10 from sunrise-30 to chatzos-30 rooms ברך משה, דברי יואל' }), ', handy for pasting a whole list.'])])]));
    var typeTabs = el('div', { class: 'tabs daytypes', role: 'tablist' }), typePages = {};
    sp.appendChild(typeTabs);
    var infoUpdaters = [];
    /* which day type actually supplies this tefilla for `key` when its own box is empty */
    function sourceOf(key, tfId) {
      var k = FALLBACK[key];
      while (k) { if (lines[k][tfId].value.trim()) return k; k = FALLBACK[k]; }
      return null;
    }
    Cal.DAY_TYPES.forEach(function (t) {
      var key = t[0], b = el('button', { type: 'button', id: 'dt-' + key, text: t[3], 'aria-selected': 'false', onclick: function () { showType(key); } });
      typeTabs.appendChild(b);
      var page = el('div', { class: 'col dtp tef-0', id: 'dtp-' + key });
      page.hidden = true;
      page.appendChild(el('div', { class: 'hint', text: FALLBACK[key] ? t[3] + ': each tefilla either follows the ' + TYPE_EN[FALLBACK[key]] + ' schedule or gets its own list for this day.' : t[3] + ' is the base schedule: every day that has no list of its own for a tefilla (Sunday, Friday, Rosh Chodesh…) uses it.' }));
      var row = el('div', { class: 'fields three' });
      d.tefillos.forEach(function (tf, i) {
        var store = lines[key][tf.id], fb = FALLBACK[key];
        var sources = Cal.DAY_TYPES.filter(function (o) { return o[0] !== key; }).map(function (o) { return { key: o[0], label: o[3], store: function () { return lines[o[0]][tf.id]; } }; });
        var editor = minyanEditor(store, i, function () { return key; }, sources);
        var block = el('div', { class: 'field tefcard' }, [el('label', { class: 'tefname', text: tf.name })]);
        if (fb) {
          var same = el('input', { type: 'checkbox', id: 'same-' + key + '-' + tf.id }), info = el('div', { class: 'hint same-info' });
          same.checked = !store.value.trim();
          editor.hidden = same.checked;
          var kept = '';
          function update() {
            if (!same.checked) { info.textContent = 'Own list for ' + t[3] + '.'; return; }
            var src = sourceOf(key, tf.id);
            info.textContent = src ? 'Follows the ' + TYPE_EN[src] + ' list.' : 'No list here and none to follow: no ' + tf.name + ' minyanim on this day.';
          }
          same.addEventListener('change', function () {
            if (same.checked) { kept = store.value; store.value = ''; editor.hidden = true; }
            else { var src = sourceOf(key, tf.id); store.value = kept.trim() ? kept : (src ? lines[src][tf.id].value : ''); editor.hidden = false; editor.reload(); }
            markTabs();
          });
          infoUpdaters.push(update);
          block.appendChild(el('label', { class: 'same', for: same.id }, [same, ' Same as ' + TYPE_EN[fb] + (fb === 'weekday' ? '' : ' (or whatever that day follows)')]));
          block.appendChild(info);
        }
        block.appendChild(editor);
        row.appendChild(block);
      });
      var seg = el('div', { class: 'seg', role: 'tablist' });
      d.tefillos.forEach(function (tf, i) {
        seg.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': String(i === 0), text: tf.name, 'data-nodirty': '1', onclick: function () {
          page.className = 'col dtp tef-' + i;
          Array.prototype.forEach.call(seg.children, function (x, j) { x.setAttribute('aria-selected', String(j === i)); });
        } }));
      });
      page.appendChild(seg);
      page.appendChild(row);
      typePages[key] = { page: page, button: b };
      sp.appendChild(page);
    });
    function markTabs() {
      Cal.DAY_TYPES.forEach(function (t) {
        var has = d.tefillos.some(function (tf) { return lines[t[0]][tf.id].value.trim(); });
        typePages[t[0]].button.classList.toggle('has', has);
      });
      infoUpdaters.forEach(function (f) { try { f(); } catch (e) {} });
    }
    function showType(key) { Cal.DAY_TYPES.forEach(function (t) { typePages[t[0]].page.hidden = t[0] !== key; typePages[t[0]].button.setAttribute('aria-selected', String(t[0] === key)); }); }
    refreshRooms();
    if (!fRooms.value.trim()) fRooms.value = knownRooms.join(', ');
    paintRoomsEditor(); roomsChanged();
    pages.schedule = sp;

    /* notices */
    var np = el('div', { class: 'col' }), nList = el('div', { class: 'col' }), nRows = [];
    function addNotice(n) {
      var id = ++uid, r = { title: inp('n-title-' + id, n.title), body: el('textarea', { id: 'n-body-' + id, dir: 'auto' }), from: inp('n-from-' + id, n.from || '', { type: 'date' }), to: inp('n-to-' + id, n.to || '', { type: 'date' }) };
      r.body.value = n.body || ''; r.body.style.minHeight = '70px';
      var headT = el('span', { text: n.title || 'Notice' }); r.title.addEventListener('input', function () { headT.textContent = r.title.value.trim() || 'Notice'; });
      r.wrap = el('div', { class: 'ovr' }, [el('div', { class: 'ohead' }, [headT, el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: function () { nRows.splice(nRows.indexOf(r), 1); r.wrap.remove(); } })]),
        el('div', { class: 'fields' }, [field('Title', r.title), field('Text', r.body)]),
        el('div', { class: 'fields' }, [field('Show from (blank = now)', r.from), field('Show until (blank = no end)', r.to)])]);
      nRows.push(r); nList.appendChild(r.wrap);
    }
    (d.notices.length ? d.notices : [{ title: 'פרנס החודש', body: '' }, { title: 'פרנס השבוע', body: '' }, { title: 'נר למאור', body: '' }]).forEach(addNotice);
    var bText = el('textarea', { id: 'banner-text', dir: 'auto', placeholder: 'e.g. אין מעריב בלב אהרן הערב' }), bUntil = inp('banner-until', (d.banner && d.banner.until) || '', { type: 'datetime-local' });
    bText.value = (d.banner && d.banner.text) || ''; bText.style.minHeight = '60px';
    var cBanner = card('Temporary banner', 'One line shown across the top of the board (and at the start of text replies) until the time you set, then it disappears by itself.');
    cBanner.body.appendChild(el('div', { class: 'fields' }, [field('Banner text', bText), field('Show until (shul time)', bUntil, el('button', { type: 'button', class: 'btn small', text: 'Clear banner', onclick: function () { bText.value = ''; bUntil.value = ''; } }))]));
    var cNotices = card('Sponsors and announcements', 'Sponsor panels (פרנס החודש, פרנס השבוע, נר למאור) and announcements, shown in framed boxes at the top of the board. Give each one dates and it appears and disappears by itself; several entries with the same title form a queue. A notice with empty text is not shown.');
    cNotices.body.appendChild(nList);
    cNotices.body.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', text: '+ Notice', onclick: function () { addNotice({ title: '', body: '' }); } })]));
    np.appendChild(cBanner); np.appendChild(cNotices);
    pages.notices = np;

    /* today: add, move or cancel a minyan for today only, without the editor; saved as a one-date special schedule */
    var tp = el('div', { class: 'col', id: 'page-today' }), todayIso = MinyanEngine.isoDate(todayRd), todaySched = scheduleFor(todayRd), quick = {};
    function hhmm(min) { var m = Math.round(min); return pad2(Math.floor(m / 60) % 24) + ':' + pad2(m % 60); }
    function parseHHMM(v) { var m = /^(\d{2}):(\d{2})$/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : null; }
    function todayList(tf) { return quick[tf.id] || (todaySched.byTefilla[tf.id] || []).map(function (e) { return { start: e.start, room: e.room, note: e.note }; }); }
    function touch(tf) { if (!quick[tf.id]) quick[tf.id] = todayList(tf).map(function (x) { return { start: x.start, room: x.room, note: x.note }; }); return quick[tf.id]; }
    function quickLines(tf) {
      var list = quick[tf.id]; if (!list) return null;
      if (!list.length) return '# בוטל להיום'; /* a comment line: the special schedule applies, with no minyanim */
      return list.slice().sort(function (a, b) { return a.start - b.start; }).map(function (x) { return hhmm(x.start) + (x.room ? ' ' + x.room : '') + (x.note ? ' // ' + x.note : ''); }).join('\n');
    }
    function renderToday() {
      tp.textContent = '';
      var existing = d.overrides.filter(function (o) { return o.date === todayIso; })[0], changed = Object.keys(quick).length > 0;
      tp.appendChild(el('div', { class: 'card today-head' }, [
        el('div', null, [el('div', { class: 'd', text: Cal.DAY_NAMES[todaySched.info.dow] + ' · ' + engine.fmtDate(todayRd) }), el('div', { class: 'cdesc', text: Cal.formatHeb(todaySched.info.heb) })]),
        el('div', { class: 'note' }, [existing ? el('span', { class: 'status dirty', text: 'Today has its own schedule' + (existing.label ? ' (' + existing.label + ')' : '') }) : null,
          el('span', { text: 'Move a time, cancel a minyan or add one. It applies to today only; the regular schedule stays as it is.' })])]));
      d.tefillos.filter(function (t) { return t.kind !== 'event'; }).forEach(function (tf) {
        var box = el('div', { class: 'col' }), list = todayList(tf);
        list.forEach(function (x, i) {
          var t = el('input', { type: 'time', value: hhmm(x.start), 'aria-label': 'Time' });
          t.addEventListener('change', function () { var m = parseHHMM(t.value); if (m == null) return; touch(tf)[i].start = m; renderToday(); });
          var roomSel = roomPicker(function () { return (quick[tf.id] ? quick[tf.id][i] : x).room || ''; }, function (v) { touch(tf)[i].room = v; }, 'Room'); /* change the room for today */
          box.appendChild(el('div', { class: 'mrow-l today-row' }, [t].concat(roomSel, [x.note ? el('span', { class: 'hint', text: x.note }) : null,
            el('button', { type: 'button', class: 'btn small danger', text: 'Cancel', title: 'No such minyan today', onclick: function () { touch(tf).splice(i, 1); renderToday(); } })])));
        });
        if (!list.length) box.appendChild(el('div', { class: 'hint', text: 'No ' + tf.name + ' minyanim today.' }));
        var addT = el('input', { type: 'time', 'aria-label': 'New time' }), addRoom = '';
        var picker = roomPicker(function () { return addRoom; }, function (v) { addRoom = v; }, 'Add a room');
        var addB = el('button', { type: 'button', class: 'btn small', text: '+ Add for today', onclick: function () { var m = parseHHMM(addT.value); if (m == null) { toast('Pick a time first'); return; } touch(tf).push({ start: m, room: addRoom, note: '' }); renderToday(); } });
        box.appendChild(el('div', { class: 'mrow-l today-add' }, [addT].concat(picker, [addB])));
        tp.appendChild(el('div', { class: 'field card tcard' }, [el('label', { text: tf.name }), box]));
      });
      var saveT = el('button', { type: 'button', class: 'btn primary', text: 'Save today\'s changes', 'data-nodirty': '1', onclick: function () {
        if (!Object.keys(quick).length) { toast('Nothing changed yet'); return; }
        var c = collect(), ovr = c.overrides.filter(function (o) { return o.date === todayIso; })[0];
        if (!ovr) { ovr = { date: todayIso, label: 'שינוי להיום', lines: {} }; c.overrides.push(ovr); }
        d.tefillos.forEach(function (tf) { var l = quickLines(tf); if (l != null) ovr.lines[tf.id] = l; });
        saveConfig(c);
      } });
      var row = el('div', { class: 'bar actions' }, [saveT]);
      if (existing) row.appendChild(el('button', { type: 'button', class: 'btn', text: 'Back to the regular schedule for today', 'data-nodirty': '1', onclick: function () { var c = collect(); c.overrides = c.overrides.filter(function (o) { return o.date !== todayIso; }); saveConfig(c); } }));
      tp.appendChild(row);
    }
    renderToday();
    pages.today = tp;

    /* overrides */
    var op = el('div', { class: 'col' }), oList = el('div', { class: 'col' });
    function addOverride(o) {
      var id = ++uid, r = { date: inp('o-date-' + id, o.date, { type: 'date' }), label: inp('o-label-' + id, o.label), lines: {} };
      r.when = el('select', { id: 'o-when-' + id }, [el('option', { value: 'date', text: 'One civil date' }), el('option', { value: 'hebrew', text: 'A Hebrew date, every year' }), el('option', { value: 'cal', text: 'A calendar day, every year' })]);
      r.hm = el('select', { id: 'o-hm-' + id }); r.hd = inp('o-hd-' + id, o.hd || '', { type: 'number', min: '1', max: '30', inputmode: 'numeric' }); r.cal = el('select', { id: 'o-cal-' + id });
      [[7, 'תשרי'], [8, 'חשון'], [9, 'כסלו'], [10, 'טבת'], [11, 'שבט'], ['adar', 'אדר (אדר ב׳ בשנה מעוברת)'], ['adar1', 'אדר א׳ (בשנה מעוברת בלבד)'], [1, 'ניסן'], [2, 'אייר'], [3, 'סיון'], [4, 'תמוז'], [5, 'אב'], [6, 'אלול']].forEach(function (m) { r.hm.appendChild(el('option', { value: String(m[0]), text: m[1] })); });
      Cal.LABELS.forEach(function (l) { r.cal.appendChild(el('option', { value: l, text: l })); });
      r.when.value = o.date ? 'date' : (o.hm != null ? 'hebrew' : (o.calLabel ? 'cal' : 'date'));
      if (o.hm != null) r.hm.value = String(o.hm);
      if (o.calLabel) r.cal.value = o.calLabel;
      function showWhen() { var w = r.when.value; r.date.hidden = w !== 'date'; r.hm.hidden = w !== 'hebrew'; r.hd.hidden = w !== 'hebrew'; r.cal.hidden = w !== 'cal'; }
      r.when.addEventListener('change', showWhen); showWhen();
      var row = el('div', { class: 'fields three' });
      function typeOfDate() {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date.value);
        if (r.when.value !== 'date' || !m) return 'weekday';
        return Cal.dayType(Cal.dayInfo(Cal.rdFromGreg(+m[1], +m[2], +m[3]), !!d.israel));
      }
      d.tefillos.forEach(function (tf, i) {
        r.lines[tf.id] = { value: (o.lines && o.lines[tf.id]) || '' };
        var sources = Cal.DAY_TYPES.map(function (t) { return { key: t[0], label: t[3], store: function () { return lines[t[0]][tf.id]; } }; });
        row.appendChild(el('div', { class: 'field tefcard' }, [el('label', { class: 'tefname', text: tf.name + ' (no rows = as usual)' }), minyanEditor(r.lines[tf.id], i, typeOfDate, sources)]));
      });
      var headO = el('span', { text: o.label || 'Special date' }); r.label.addEventListener('input', function () { headO.textContent = r.label.value.trim() || 'Special date'; });
      r.wrap = el('div', { class: 'ovr' }, [el('div', { class: 'ohead' }, [headO, el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: function () { oRows.splice(oRows.indexOf(r), 1); r.wrap.remove(); } })]),
        el('div', { class: 'mrow-l' }, [r.when, r.date, r.hm, r.hd, r.cal]), el('div', { class: 'fields' }, [field('Label shown on the board (e.g. yahrzeit, wedding, Chol Hamoed)', r.label)]), row]);
      oRows.push(r); oList.appendChild(r.wrap);
    }
    d.overrides.forEach(addOverride);
    var cOvr = card('Dates with their own schedule', 'A schedule that replaces the regular one for the tefillos you fill in: on one civil date (a yahrzeit, a wedding), on a Hebrew date every year, or on a calendar day every year (Chol Hamoed Sukkos, Purim, Tisha B\'Av, Rosh Chodesh…). A civil date wins over a Hebrew date, which wins over a calendar day.');
    var emptyO = el('div', { class: 'hint', text: 'No special dates yet. "+ Date" adds one.' }); emptyO.hidden = oRows.length > 0;
    cOvr.body.appendChild(emptyO); cOvr.body.appendChild(oList);
    cOvr.body.appendChild(el('div', null, [el('button', { type: 'button', class: 'btn', text: '+ Date', onclick: function () { emptyO.hidden = true; addOverride({ date: '', label: '', lines: {} }); } })]));
    op.appendChild(cOvr);
    pages.overrides = op;

    /* publish (self-hosted site / app) */
    var pp = el('div', { class: 'col' }), gh = ghSettings();
    var fRemote = inp('f-remote', d.remoteConfigUrl || '', { dir: 'ltr', placeholder: 'https://.../config.json' });
    var gRepo = inp('gh-repo', gh.repo || d.githubRepo || '', { dir: 'ltr', placeholder: 'username/minyan', autocomplete: 'off' }), gBranch = inp('gh-branch', gh.branch || d.githubBranch || 'main', { dir: 'ltr' }),
      gPath = inp('gh-path', gh.path || d.githubPath || 'docs/config.json', { dir: 'ltr' }), gToken = inp('gh-token', gh.token || '', { type: 'password', dir: 'ltr', autocomplete: 'off' });
    var ghMsg = el('div', { class: 'hint' });
    function saveGh() {
      var s = { repo: gRepo.value.trim(), branch: gBranch.value.trim() || 'main', path: gPath.value.trim() || 'config.json', token: gToken.value.trim() };
      try { if (s.repo || s.token) localStorage.setItem('minyan-github', JSON.stringify(s)); else localStorage.removeItem('minyan-github'); } catch (e) {}
      return s;
    }
    var connected = ghConfigured(gh);
    var cPub = card('Publishing to the website', 'The website and the app read the schedule from a file called config.json on the website. With a GitHub token here, Publish sends what you saved to everyone within a few minutes.',
      { extra: el('span', { class: 'status ' + (connected ? 'ok' : 'dirty'), text: connected ? 'Connected: ' + gh.repo : 'Not connected on this device' }) });
    cPub.body.appendChild(el('details', { class: 'help' }, [el('summary', { text: 'How to set it up' }), el('div', { class: 'hint' }, [
      el('p', null, ['1. In your GitHub repository: Settings → Pages is enabled.  2. Create a fine-grained token with "Contents: Read and write" for that repository only: ', el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener', text: 'github.com/settings/personal-access-tokens/new' }), '.  3. Paste it here. The token stays in this browser only; every device that should publish needs it once.'])])]));
    var tokenToggle = el('button', { type: 'button', class: 'btn small', text: 'Show', 'data-nodirty': '1', onclick: function () { var show = gToken.type === 'password'; gToken.type = show ? 'text' : 'password'; tokenToggle.textContent = show ? 'Hide' : 'Show'; } });
    cPub.body.appendChild(el('div', { class: 'fields' }, [field('Repository (owner/repo)', gRepo), field('Branch', gBranch), field('File path', gPath), field('Token', gToken, tokenToggle)]));
    cPub.body.appendChild(el('div', { class: 'bar actions' }, [el('button', { type: 'button', class: 'btn', text: 'Test connection', 'data-nodirty': '1', onclick: function () {
      var s = saveGh();
      if (!ghConfigured(s)) { ghMsg.textContent = 'Enter the repository and the token'; return; }
      ghMsg.textContent = 'Checking…';
      ghCheck(s).then(function (m) { ghMsg.textContent = m; }, function (e) { ghMsg.textContent = 'Failed: ' + e.message; });
    } }), ghMsg]));
    var cRemote = card('Store app', 'Only for a version of the app installed from an app store.');
    cRemote.body.appendChild(el('div', { class: 'fields' }, [field('Central schedule URL (blank = config.json on this site)', fRemote)]));
    var pubStatus = el('span', { class: 'status' }), cChanges = card('Not yet published', 'Save keeps changes on this device. Publishing sends them to the website and the app, for everyone. Here is what would go out.', { extra: pubStatus });
    function renderChanges() {
      var ch = pendingChanges(), pub = publishedCfg(), conn2 = ghConfigured(ghSettings());
      cChanges.body.textContent = '';
      pubStatus.textContent = ch.length ? ch.length + (ch.length === 1 ? ' change' : ' changes') : 'Everything is published';
      pubStatus.className = 'status ' + (ch.length ? 'dirty' : 'ok');
      if (!ch.length) { cChanges.body.appendChild(el('div', { class: 'hint', text: (pub && pub.savedAt ? 'The website has the version saved ' + new Date(pub.savedAt).toLocaleString() + '. ' : '') + 'Save a change and it is listed here before it goes out.' })); return; }
      cChanges.body.appendChild(el('ul', { class: 'changes' }, ch.map(function (x) { return el('li', { text: x }); })));
      cChanges.body.appendChild(el('div', { class: 'bar actions' }, [
        el('button', { type: 'button', class: 'btn primary', 'data-nodirty': '1', text: 'Publish now', onclick: function () { if (!conn2) { toast('Enter the GitHub token below first'); return; } if (ui.adminDirty) { if (confirm('Save the changes you are making here first, then publish?')) saveConfig(collect(), { publish: true }); return; } publishNow(); } }),
        pub ? el('button', { type: 'button', class: 'btn danger', 'data-nodirty': '1', text: 'Discard: back to the published version', onclick: function () {
          if (!confirm('Throw away the changes saved on this device and go back to what the website has?')) return;
          try { localStorage.removeItem('minyan-config'); } catch (e) {}
          setCfg(pub); ui.adminDirty = false; render(); buildAdmin(pub); toast('Back to the published version');
        } }) : null]));
      if (!conn2) cChanges.body.appendChild(el('div', { class: 'hint', text: 'To publish from this device, enter the GitHub token below once.' }));
    }
    renderChanges();
    pp.appendChild(cChanges); pp.appendChild(cPub); pp.appendChild(cRemote);
    pages.publish = pp;
    function history() { try { return JSON.parse(localStorage.getItem('minyan-history') || '[]'); } catch (e) { return []; } }

    /* send: a notification from the gabbai to every device with reminders on (the service checks the admin PIN) */
    var sp2 = el('div', { class: 'col' });
    if (mode !== 'artifact' && (d.notifyUrl || '').trim()) {
      var bcTitle = inp('bc-title', d.name || ''), bcPin = inp('bc-pin', ui.pinValue || '', { type: 'password', autocomplete: 'off', placeholder: 'the admin PIN' });
      var bcText = el('textarea', { id: 'bc-text', dir: 'auto', maxlength: '300', placeholder: 'e.g. Mincha today 1:45 instead of 1:30' }), bcCount = el('span', { class: 'hint', text: '0 / 300' }), bcMsg = el('div', { class: 'hint', id: 'bc-msg' });
      bcText.style.minHeight = '90px';
      var pvT = el('b', { text: d.name || '' }), pvB = el('div', { class: 'npv-b', text: '…' });
      bcTitle.addEventListener('input', function () { pvT.textContent = bcTitle.value || d.name || ''; });
      bcText.addEventListener('input', function () { bcCount.textContent = bcText.value.length + ' / 300'; pvB.textContent = bcText.value || '…'; });
      var pst = pushState();
      function sendBroadcast(test) {
        var text = bcText.value.trim();
        if (!text) { bcMsg.textContent = 'Write the message first.'; return; }
        if (!bcPin.value) { bcMsg.textContent = 'Enter the admin PIN.'; return; }
        bcMsg.textContent = test ? 'Sending to this device…' : 'Sending to everyone…';
        fetch(notifyBase() + '/push/broadcast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: bcPin.value, title: bcTitle.value.trim() || d.name, body: text, test: test ? (pst && pst.id) : undefined }) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('service ' + r.status)); return j; }, function () { throw new Error('service ' + r.status); }); })
          .then(function (j) {
            bcMsg.textContent = (test ? 'Test sent' : 'Sent') + ' to ' + j.sent + (j.sent === 1 ? ' device' : ' devices') + (j.failed ? ', ' + j.failed + ' failed' : '') + (j.gone ? ', ' + j.gone + ' no longer subscribed' : '') + '.';
            if (!test) { bcText.value = ''; bcCount.textContent = '0 / 300'; pvB.textContent = '…'; }
          }, function (e) { bcMsg.textContent = 'Could not send: ' + (e && e.message || e); });
      }
      var cSend = card('Send a notification', 'Goes out right now to everyone who turned reminders on in the app. Keep it short: a change for today, a simcha, a word from the gabbai.');
      cSend.body.appendChild(el('div', { class: 'fields' }, [field('Title', bcTitle), field('Admin PIN (the notification service checks it)', bcPin)]));
      cSend.body.appendChild(el('div', { class: 'field' }, [el('label', { for: 'bc-text', text: 'Message' }), bcText, bcCount]));
      cSend.body.appendChild(el('div', { class: 'npv' }, [el('div', { class: 'npv-h' }, [el('span', { text: '🔔' }), el('span', { text: 'How it looks on the phone' })]), pvT, pvB]));
      cSend.body.appendChild(el('div', { class: 'bar actions' }, [
        el('button', { type: 'button', class: 'btn primary', id: 'bc-send', 'data-nodirty': '1', text: 'Send to everyone', onclick: function () { if (confirm('Send this notification to everyone now?')) sendBroadcast(false); } }),
        pst && pst.id ? el('button', { type: 'button', class: 'btn', id: 'bc-test', 'data-nodirty': '1', text: 'Test on this device', onclick: function () { sendBroadcast(true); } }) : el('span', { class: 'hint', text: 'Turn reminders on for this device (Settings on the board) to be able to send yourself a test first.' }),
        bcMsg]));
      sp2.appendChild(cSend);
    } else sp2.appendChild(el('div', { class: 'hint lead', text: 'Enter the notification service address under General → Website and services to be able to send notifications.' }));
    pages.send = sp2;

    /* data */
    var dp = el('div', { class: 'col' }), dataArea = el('textarea', { id: 'data-json', spellcheck: 'false', dir: 'ltr' });
    dataArea.style.minHeight = '260px'; dataArea.style.fontFamily = 'monospace';
    var hist = history(), hBox = el('div', { class: 'col' });
    var cHist = card('Previous versions', 'Each Save made on this device keeps the version before it here, so a wrong save can be undone.');
    if (!hist.length) hBox.appendChild(el('div', { class: 'hint', text: 'No previous versions on this device yet.' }));
    hist.forEach(function (h) {
      var when = new Date(h.at);
      hBox.appendChild(el('div', { class: 'vrow' }, [el('span', { text: 'Saved ' + when.toLocaleString() }), el('button', { type: 'button', class: 'btn small', text: 'Restore', onclick: function () { setCfg(h.cfg); ui.adminDirty = true; closeOverlay(); buildAdmin(); toast('Restored into the editor. Click Save to keep it.', 6000); } })]));
    });
    cHist.body.appendChild(hBox);
    var cText = card('Settings as text', 'All settings as text: copy it as a backup, or paste and load it into another copy of the page.');
    cText.body.appendChild(dataArea);
    cText.body.appendChild(el('div', { class: 'bar actions' }, [
      el('button', { type: 'button', class: 'btn', text: 'Copy', 'data-nodirty': '1', onclick: function () {
        var done = function () { toast('Copied'); }, fail = function () { dataArea.select(); toast('Select the text and copy it manually'); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(dataArea.value).then(done, fail); else fail();
      } }),
      el('button', { type: 'button', class: 'btn danger', text: 'Clear local save', onclick: function () {
        try { localStorage.removeItem('minyan-config'); } catch (e) {}
        location.reload();
      } }),
      el('button', { type: 'button', class: 'btn', text: 'Load from text', onclick: function () {
        try { var c = JSON.parse(dataArea.value); if (!c || typeof c !== 'object') throw new Error('x'); setCfg(c); ui.adminDirty = true; closeOverlay(); buildAdmin(); toast('Loaded. Click Save to keep it.'); }
        catch (e) { toast('That text is not a valid settings file'); }
      } })]));
    dp.appendChild(cHist); dp.appendChild(cText);
    pages.data = dp;

    function collect() {
      var out = clone(d);
      out.name = fName.value.trim();
      out.location = { name: fLocName.value.trim(), lat: parseFloat(fLat.value), lng: parseFloat(fLng.value), tz: fTz.value.trim(), elev: parseFloat(fElev.value) || 0 };
      out.candles = fCandles.value === '' ? 18 : +fCandles.value;
      out.tzeisMinutes = fTzeisMin.value === '' ? 0 : +fTzeisMin.value;
      out.tzeisDeg = +fTzeisDeg.value || 8.5;
      out.israel = $('#f-israel').checked; out.weeklyEarliest = $('#f-weekly').checked; out.clock24 = $('#f-24').checked; out.showRT = $('#f-rt').checked; out.show60 = $('#f-60').checked; out.showTzeis = $('#f-tzeis').checked;
      delete out.pin;
      out.tefillos = d.tefillos.map(function (t, i) { return liveTefilla(i); });
      out.rooms = fRooms.value.trim();
      out.siteUrl = fSite.value.trim();
      out.notifyUrl = fNotify.value.trim();
      out.sponsorSeconds = Math.max(2, +fSponsorSecs.value || 8);
      out.nowMinutes = fNowMins.value === '' ? 20 : Math.max(0, Math.min(180, +fNowMins.value || 0));
      out.dateFormat = fDateFmt.value;
      out.bigTime = fBig.value;
      out.countdownZmanim = COUNTDOWN_KEYS.filter(function (k) { return $('#cd-' + k).checked; });
      out.palette = fPalette.value;
      out.lang = fLang.value;
      out.logo = fLogo.value.trim();
      out.schedules = {};
      Cal.DAY_TYPES.forEach(function (t) {
        var o = {};
        d.tefillos.forEach(function (tf) { var v = lines[t[0]][tf.id].value; if (v.trim()) o[tf.id] = v.replace(/\r/g, ''); });
        if (Object.keys(o).length) out.schedules[t[0]] = o;
      });
      out.notices = nRows.map(function (r) { return { title: r.title.value.trim(), body: r.body.value.trim(), from: r.from.value, to: r.to.value }; }).filter(function (n) { return n.title || n.body; });
      out.banner = { text: bText.value.trim(), until: bUntil.value };
      out.overrides = oRows.map(function (r) {
        var lines = {};
        d.tefillos.forEach(function (tf) { if (r.lines[tf.id].value.trim()) lines[tf.id] = r.lines[tf.id].value; });
        var o = { label: r.label.value.trim(), lines: lines };
        if (r.when.value === 'date') o.date = r.date.value;
        else if (r.when.value === 'hebrew') { o.hm = /^\d+$/.test(r.hm.value) ? +r.hm.value : r.hm.value; o.hd = +r.hd.value || 0; }
        else o.calLabel = r.cal.value;
        return o;
      }).filter(function (o) { return o.date || (o.hm != null && o.hd) || o.calLabel; });
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
    function saveConfig(c, opts) {
      var err = validate(c);
      if (err) { toast(err); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      if (mode !== 'artifact') saveGh();
      var ready = Promise.resolve();
      if (mode !== 'artifact' && fPin.value.trim()) {
        c.pinHash = null;
        ready = (window.crypto && crypto.subtle) ? sha256Hex(fPin.value.trim()).then(function (h) { c.pinHash = h; }) : Promise.resolve().then(function () { c.pin = fPin.value.trim(); delete c.pinHash; });
      }
      try { var hist2 = history(); hist2.unshift({ at: Date.now(), cfg: cfg }); localStorage.setItem('minyan-history', JSON.stringify(hist2.slice(0, 10))); } catch (e) {}
      ready.then(function () { return persist(c); }).then(function (r) {
        setCfg(c);
        if (r.reloads) { toast('Saved. Reloading the page…', 8000); return; }
        ui.adminDirty = false; render(); buildAdmin(c); /* stay in the settings, on the same tab, with the board behind refreshed */
        var pend = pendingChanges().length;
        if (opts && opts.publish) publishNow();
        else if (r.configured) toast(pend ? 'Saved. ' + pend + (pend === 1 ? ' change is' : ' changes are') + ' not yet published: Publish when you are ready.' : 'Saved. Nothing new to publish.', 6000);
        else toast(remoteUrl() ? 'Saved on this device only. Connect the website on the Publish tab to update everyone.' : 'Saved on this device', 6000);
      }, function (e) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; toast(errorText(e), 6000); });
    }
    var saveBtn = el('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: function () { saveConfig(collect()); } });
    var status = el('span', { class: 'status', text: '' });
    function setDirty(on) {
      ui.adminDirty = on;
      status.textContent = on ? 'Unsaved changes' : (cfg.savedAt ? 'Saved ' + new Date(cfg.savedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
      status.className = 'status' + (on ? ' dirty' : ''); saveBtn.classList.toggle('attn', on);
    }
    var closeBtn = el('button', { type: 'button', class: 'btn closebtn', 'aria-label': 'Close', onclick: function () { if (ui.adminDirty && !confirm('Close without saving? The changes made here will be lost.')) return; ui.adminDirty = false; closeOverlay(); } }, [el('span', { class: 'lbl', text: 'Close' }), svgIcon('x')]);
    var navFoot = el('div', { class: 'navfoot' }, mode === 'artifact' ? [] : [
      el('a', { class: 'btn ghost', href: 'index.html', target: '_blank', rel: 'noopener' }, [svgIcon('open'), el('span', { text: 'View the board' })]),
      el('button', { type: 'button', class: 'btn ghost', 'data-nodirty': '1', onclick: function () { if (ui.adminDirty && !confirm('Lock without saving? The changes made here will be lost.')) return; pinOk = false; try { sessionStorage.removeItem('minyan-pin'); } catch (e) {} ui.adminDirty = false; closeOverlay(); showPin(); } }, [svgIcon('lock'), el('span', { text: 'Lock' })])]);
    var ghNow = mode === 'artifact' ? null : ghSettings();
    var footHint = mode === 'artifact' ? 'Save publishes a new version of this page for everyone who has the link.' : (ghConfigured(ghNow) ? 'Save keeps the changes on this device. Publish sends them to the website and the app.' : 'Save keeps the settings on this device only. Connect the website on the Publish tab to be able to publish.');
    var main = el('div', { class: 'amain' }, [el('div', { class: 'ptitle' }, [pageTitle, pageDesc]), pages.today, pages.general, pages.schedule, pages.notices, pages.overrides, mode !== 'artifact' ? pages.publish : null, mode !== 'artifact' ? pages.send : null, pages.data,
      el('div', { class: 'bar afoot' }, [el('span', { class: 'hint', text: footHint }), saveBtn.cloneNode(true)])]);
    var pubBar = el('div', { class: 'pubbar' }); pubBar.hidden = true;
    function refreshPubBar() {
      var ch = pendingChanges(), k = ch.length, conn = mode !== 'artifact' && ghConfigured(ghSettings());
      pubBar.textContent = ''; pubBar.hidden = !k;
      if (!k) return;
      pubBar.appendChild(el('span', { class: 'pubmsg', text: k + (k === 1 ? ' change' : ' changes') + ' not yet published' }));
      pubBar.appendChild(el('div', { class: 'bar' }, [el('button', { type: 'button', class: 'btn small', 'data-nodirty': '1', text: 'What changed', onclick: function () { selectTab('publish'); } }),
        el('button', { type: 'button', class: 'btn small gold', 'data-nodirty': '1', text: conn ? 'Publish' : 'Connect to publish', onclick: function () { if (!conn) { selectTab('publish'); return; } if (ui.adminDirty) { if (confirm('Save the changes you are making here first, then publish?')) saveConfig(collect(), { publish: true }); return; } publishNow(); } })]));
    }
    var panel = el('div', { class: 'shell' }, [
      el('header', { class: 'abar' }, [
        el('div', { class: 'brand' }, [el('div', { class: 'bt' }, [el('h2', { text: cfg.name || 'Board settings' }), el('div', { class: 'sub', text: Cal.DAY_NAMES[todayInfo.dow] + ' · ' + engine.fmtDate(todayRd) + ' · ' + Cal.formatHeb(todayInfo.heb) })])]),
        el('div', { class: 'bar' }, [mode !== 'artifact' ? el('a', { class: 'btn toboard', href: 'index.html', target: '_blank', rel: 'noopener', 'aria-label': 'Open the board' }, [el('span', { text: 'Board' }), svgIcon('open')]) : null, status, saveBtn, closeBtn])]),
      el('div', { class: 'abody' }, [el('nav', { class: 'anav' }, [tabBar, navFoot]), main]), pubBar]);
    overlay(panel);
    refreshPubBar();
    selectTab(draft && ui.adminTab && pages[ui.adminTab] ? ui.adminTab : 'today'); showType('weekday'); markTabs();
    setDirty(!!ui.adminDirty);
    var bottomSave = main.lastChild.lastChild;
    bottomSave.addEventListener('click', function () { saveBtn.click(); });
    /* anything typed or clicked in the pages marks the settings as changed until the next Save */
    function markDirty(ev) {
      var t = ev.target;
      if (t && t.closest && t.closest('[data-nodirty]')) return;
      if (ev.type === 'click' && !(t && t.closest && t.closest('button'))) return;
      if (!ui.adminDirty) setDirty(true);
    }
    main.addEventListener('input', markDirty); main.addEventListener('change', markDirty); main.addEventListener('click', markDirty);
    if (!ui.keysBound) {
      ui.keysBound = true;
      document.addEventListener('keydown', function (ev) {
        if (!ui.adminOpen || !(ev.metaKey || ev.ctrlKey) || (ev.key !== 's' && ev.key !== 'S')) return;
        ev.preventDefault(); var b = $('#overlay .abar .btn.primary'); if (b) b.click();
      });
    }
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
    }).then(function () { return { reloads: false, published: false, configured: ghConfigured(ghSettings()) }; }); /* publishing is its own step: the Publish tab lists what changed first */
  }
  /* ---------- publishing: what is saved on this device vs. what the website has ---------- */
  function publishedCfg() { try { return JSON.parse(localStorage.getItem('minyan-remote') || 'null'); } catch (e) { return null; } }
  function localDraft() { try { return JSON.parse(localStorage.getItem('minyan-config') || 'null'); } catch (e) { return null; } }
  function pendingChanges() {
    var pub = publishedCfg(), mine = localDraft();
    if (!mine || mode === 'artifact') return [];
    if (pub && (mine.savedAt || 0) < (pub.savedAt || 0)) return []; /* the website is newer than this device's copy */
    return describeChanges(pub, mine);
  }
  /* a readable list of what differs between two settings files */
  function describeChanges(a, b) {
    if (!b) return [];
    if (!a) return ['Everything (this device has no copy of the published version yet)'];
    a = withDefaults(a); b = withDefaults(b);
    var out = [], names = {}, tfById = {};
    (a.tefillos || []).concat(b.tefillos || []).forEach(function (t) { tfById[t.id] = t; });
    /* a line in its parsed form, so "6:20" and "06:20" (how the editor writes it) are the same line */
    function canonLine(line, id) { var p = MinyanEngine.parseLine(line, tfById[id] || { period: 'am' }); if (!p) return null; return JSON.stringify({ s: p.spec, r: p.room || p.rooms, n: p.note, c: p.cond }); }
    function lineMap(text, id) { var m = {}; lines(text).forEach(function (l) { var k = canonLine(l, id) || l; if (!m[k]) m[k] = l; }); return m; }
    /* blank, missing, false and 0 count as the same; key order does not matter */
    function canon(v) {
      if (v == null || v === '' || v === false || v === 0) return null;
      if (Array.isArray(v)) return v.map(canon);
      if (typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { var c = canon(v[k]); if (c != null) o[k] = c; }); return o; }
      return v;
    }
    function same(x, y) { return JSON.stringify(canon(x)) === JSON.stringify(canon(y)); }
    function lines(t) { return (t || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean); }
    function few(list) { return list.slice(0, 5).join('; ') + (list.length > 5 ? ' … (' + list.length + ')' : ''); }
    (a.tefillos || []).concat(b.tefillos || []).forEach(function (t) { names[t.id] = t.name; });
    [['name', 'Shul name'], ['rooms', 'Rooms'], ['palette', 'Colors'], ['lang', 'Board labels'], ['bigTime', 'Big number'], ['dateFormat', 'Date format'], ['nowMinutes', '"Now" minutes'], ['countdownZmanim', 'Countdown zmanim'],
      ['candles', 'Candle lighting minutes'], ['tzeisMinutes', 'Nightfall minutes'], ['tzeisDeg', 'Nightfall degrees'], ['israel', 'Eretz Yisroel calendar'], ['weeklyEarliest', 'Weekly earliest sunset'], ['clock24', '24-hour clock'],
      ['showTzeis', 'Show צאת הכוכבים'], ['showRT', 'Show Rabbeinu Tam'], ['show60', 'Show 60 minutes'], ['siteUrl', 'Website address'], ['logo', 'Logo'], ['notifyUrl', 'Notification service'], ['smsNumber', 'SMS number'],
      ['sponsorSeconds', 'Sponsor seconds'], ['remoteConfigUrl', 'Central schedule URL'], ['location', 'Location'], ['pinHash', 'PIN'], ['pin', 'PIN']].forEach(function (f) {
      if (same(a[f[0]], b[f[0]])) return;
      var v = b[f[0]];
      out.push(f[1] + (f[0] === 'location' || f[0] === 'pinHash' || f[0] === 'pin' ? ' changed' : ': ' + (v == null || v === '' ? '(blank)' : typeof v === 'object' ? JSON.stringify(v) : String(v))));
    });
    if (!same(a.tefillos, b.tefillos)) out.push('Tefillos / categories changed');
    Cal.DAY_TYPES.forEach(function (t) {
      var k = t[0], sa = (a.schedules || {})[k] || {}, sb = (b.schedules || {})[k] || {}, ids = {};
      Object.keys(sa).concat(Object.keys(sb)).forEach(function (id) { ids[id] = 1; });
      Object.keys(ids).forEach(function (id) {
        var ma = lineMap(sa[id], id), mb = lineMap(sb[id], id), added = Object.keys(mb).filter(function (k) { return !ma[k]; }).map(function (k) { return mb[k]; }), removed = Object.keys(ma).filter(function (k) { return !mb[k]; }).map(function (k) { return ma[k]; });
        if (!added.length && !removed.length) return;
        out.push(t[3] + ' · ' + (names[id] || id) + ': ' + [added.length ? 'added ' + few(added) : '', removed.length ? 'removed ' + few(removed) : ''].filter(Boolean).join('; '));
      });
    });
    function okey(o) { return o.date ? o.date : o.hm != null ? 'hebrew ' + o.hm + '/' + o.hd : 'calendar ' + o.calLabel; }
    var oa = {}, ob = {};
    (a.overrides || []).forEach(function (o) { oa[okey(o)] = o; }); (b.overrides || []).forEach(function (o) { ob[okey(o)] = o; });
    Object.keys(ob).forEach(function (k) { if (!oa[k]) out.push('Special date added: ' + k + (ob[k].label ? ' (' + ob[k].label + ')' : '')); else if (!same(oa[k], ob[k])) out.push('Special date changed: ' + k + (ob[k].label ? ' (' + ob[k].label + ')' : '')); });
    Object.keys(oa).forEach(function (k) { if (!ob[k]) out.push('Special date removed: ' + k + (oa[k].label ? ' (' + oa[k].label + ')' : '')); });
    var na = {}, nb = {};
    (a.notices || []).forEach(function (x) { na[x.title] = x; }); (b.notices || []).forEach(function (x) { nb[x.title] = x; });
    Object.keys(nb).forEach(function (k) { if (!na[k]) out.push('Notice added: ' + k); else if (!same(na[k], nb[k])) out.push('Notice changed: ' + k); });
    Object.keys(na).forEach(function (k) { if (!nb[k]) out.push('Notice removed: ' + k); });
    if (!same(a.banner, b.banner)) out.push(b.banner && b.banner.text ? 'Banner: ' + b.banner.text : 'Banner cleared');
    return out;
  }
  /* the settings the admin form fills in by itself, so a published file that never had them does not look changed */
  function withDefaults(c) {
    var o = clone(c), tz = (o.location || {}).tz || '';
    var d = { palette: 'shul', lang: 'he', bigTime: 'start', dateFormat: /^America\//.test(tz) ? 'mdy' : 'dmy', nowMinutes: 20, sponsorSeconds: 8, tzeisDeg: 8.5, candles: 18 };
    Object.keys(d).forEach(function (k) { if (o[k] == null || o[k] === '') o[k] = d[k]; });
    return o;
  }
  /* send what is saved on this device to the website (GitHub); the board and the app pick it up within minutes */
  function publishNow() {
    var s = ghSettings(), c = localDraft() || cfg;
    if (!ghConfigured(s)) { toast('Connect the website first: Publish tab, GitHub token'); return Promise.resolve(false); }
    toast('Publishing…', 4000);
    return ghPublish(c, s).then(function () {
      try { localStorage.setItem('minyan-remote', JSON.stringify(c)); localStorage.setItem('minyan-published-at', String(Date.now())); } catch (e) {}
      toast('Published. Everyone gets the update within a few minutes.', 6000);
      if (ui.adminOpen) { ui.adminDirty = false; buildAdmin(cfg); }
      return true;
    }, function (e) { toast('Publishing failed: ' + (e && e.message || e), 9000); return false; });
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
      /* look for a new version every 10 minutes and whenever the page comes back into view; a new one installs, takes over and reloads the page */
      var check = function () { reg.update().catch(function () {}); };
      setInterval(check, 10 * 60 * 1000);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
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
    if (window.matchMedia) { var mq = window.matchMedia('(max-width: 640px)'); (mq.addEventListener ? mq.addEventListener('change', function () { render(); }) : mq.addListener(function () { render(); })); } /* phone layout follows the width */
    window.addEventListener('hashchange', function () { refreshEditBtn(); if (isAdminPage() && canEditNow() && !ui.adminOpen) openAdmin(); });
    if (!inArtifact && isAdminPage()) openAdmin();
    if (!inArtifact) {
      loadRemote();
      setInterval(loadRemote, 15 * 60 * 1000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) loadRemote(); });
      window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; refreshInstallBtn(); });
      window.addEventListener('appinstalled', function () { deferredInstall = null; refreshInstallBtn(); toast('App installed'); });
      registerSW();
    }
    if (inArtifact) {
      window.claude.use('artifact').then(function (a) { if (a) artifactNs = a; else mode = 'static'; refreshEditBtn(); });
      window.claude.use('user').then(function (u) {
        canEdit = !!(u && typeof u.canEdit === 'function' && u.canEdit());
        refreshEditBtn();
        if (isAdminPage()) { if (canEdit && !ui.adminOpen) openAdmin(); else if (!canEdit) toast('Editing this board is available to its owner only', 6000); }
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
