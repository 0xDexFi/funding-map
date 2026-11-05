(function () {
  'use strict';
  var body = document.body;
  var ROOT = new URL(body.dataset.root || './', location.href);
  var SITE = 'Recipient Map USA';
  var NS = 'http://www.w3.org/2000/svg';
  var ST_FIPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY' };

  function $(id) { return document.getElementById(id); }
  function data(path) {
    return fetch(new URL('data/' + path, ROOT)).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + path);
      return r.json();
    });
  }
  function money(v) {
    var n = Math.abs(v), s = v < 0 ? '−' : '';
    if (n >= 1e12) return s + '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return s + '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return s + '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return s + '$' + Math.round(n / 1e3) + 'K';
    return s + '$' + Math.round(n);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function stateUrl(st, f) {
    return new URL(st.toLowerCase() + '/' + (f ? '?county=' + f : ''), ROOT).href;
  }
  function placeUrl(place) {
    return /^\d/.test(place) ? stateUrl(ST_FIPS[place.slice(0, 2)], place) : stateUrl(place);
  }
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function saveCsv(name, rows) {
    var text = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* Map page */
  function mapPage() {
    var map = $('map'), HOME = [0, 0, 975, 610], view = HOME.slice();
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var ST_BINS = [5e9, 1e10, 2.5e10, 5e10, 1e11], CO_BINS = [1e6, 1e7, 1e8, 1e9, 1e10];
    var N = null, G = null, cache = {}, cur = { st: null, fp: null }, drawn = null, stEls = {}, seq = 0;
    var showAll = false;

    function bin(v, bins) { var i = 0; while (i < bins.length && v >= bins[i]) i++; return 'q' + i; }
    function el(tag, cls, d) {
      var e = document.createElementNS(NS, tag);
      if (cls) e.setAttribute('class', cls);
      if (d) e.setAttribute('d', d);
      return e;
    }
    var gStates = el('g'), gCounties = el('g'), mesh = el('path', 'mesh');
    map.appendChild(gStates); map.appendChild(gCounties); map.appendChild(mesh);

    function tipOn(p, fn) {
      var tip = $('tip');
      p.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch') return;
        var t = fn();
        tip.innerHTML = '<b>' + esc(t[0]) + '</b>' + esc(t[1]);
        tip.hidden = false;
        tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px';
        tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
      });
      p.addEventListener('pointerleave', function () { tip.hidden = true; });
    }
    function clickable(p, label, fn) {
      p.setAttribute('tabindex', '0');
      p.setAttribute('role', 'button');
      p.setAttribute('aria-label', label);
      p.addEventListener('click', fn);
      p.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
      });
    }
    function drawStates() {
      mesh.setAttribute('d', G.m);
      Object.keys(G.s).forEach(function (k) {
        var v = N.states[k], p = el('path', 'st ' + (v ? bin(v.a, ST_BINS) : 'qn'), G.s[k][0]);
        clickable(p, (v ? v.n + ', ' + money(v.a) : k), function () { go(k, null); });
        tipOn(p, function () { return [v ? v.n : k, v ? money(v.a) + ' · ' + v.c.toLocaleString() + ' recipients' : 'No data']; });
        gStates.appendChild(p);
        stEls[k] = p;
      });
    }
    function drawCounties(S) {
      gCounties.textContent = '';
      if (!S) return;
      Object.keys(S.s).forEach(function (f) {
        var v = S.co[f], p = el('path', 'co ' + (v ? bin(v.a, CO_BINS) : 'qn'), S.s[f]);
        p.dataset.f = f;
        var name = v ? v.n : 'County ' + f;
        clickable(p, name + (v ? ', ' + money(v.a) : ', no recorded funding'), function () { go(S.st, f); });
        tipOn(p, function () { return [name, v ? money(v.a) + ' · ' + v.c.toLocaleString() + ' recipients' : 'No recorded funding']; });
        gCounties.appendChild(p);
      });
    }
    function zoomTo(box) {
      var from = view.slice(), start = null;
      if (reduce) { view = box.slice(); map.setAttribute('viewBox', box.join(' ')); return; }
      function step(t) {
        if (start === null) start = t;
        var k = Math.min(1, (t - start) / 420), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        view = from.map(function (a, i) { return a + (box[i] - a) * e; });
        map.setAttribute('viewBox', view.join(' '));
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    function boxFor(b) {
      var w = b[2] - b[0], h = b[3] - b[1], pad = Math.max(w, h) * 0.08 + 6;
      return [b[0] - pad, b[1] - pad, w + pad * 2, h + pad * 2];
    }
    function legend(zoomed) {
      var bins = zoomed ? CO_BINS : ST_BINS, labs = ['Under ' + money(bins[0])];
      for (var i = 0; i < bins.length - 1; i++) labs.push(money(bins[i]) + ' to ' + money(bins[i + 1]));
      labs.push(money(bins[bins.length - 1]) + ' or more');
      $('legend').innerHTML = '<span>' + (zoomed ? 'County total' : 'State total') + '</span>' + labs.map(function (l, i) {
        return '<span><i class="bq' + i + '"></i>' + esc(l) + '</span>';
      }).join('');
      $('hint').textContent = (zoomed ? 'Select a county to see its recipients.' : 'Select a state to see its counties.') +
        " Money is placed at the recipient's address, and state agencies pass much of it on, so capital counties look large.";
    }
    function rows(list, prog) {
      if (!list || !list.length) return '<p class="empty">No organizations to list here.</p>';
      var max = Math.max(1, list[0][1]);
      return '<ol class="rows">' + list.map(function (r) {
        var meta = [r[2], prog(r[3])].filter(Boolean).join(' · ');
        return '<li><span class="nm">' + esc(r[0]) + '</span><span class="num">' + money(r[1]) + '</span>' +
          '<span class="bar"><i style="width:' + Math.max(1, r[1] / max * 100).toFixed(1) + '%"></i></span>' +
          (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</li>';
      }).join('') + '</ol>';
    }
    function agencies(g, total) {
      return '<div><h3>Largest funders</h3><ol class="rows">' + g.map(function (x) {
        return '<li><span class="nm">' + esc(x[0]) + '</span><span class="num">' + money(x[1]) + '</span>' +
          '<span class="bar"><i style="width:' + Math.max(1, x[1] / total * 100).toFixed(1) + '%"></i></span></li>';
      }).join('') + '</ol></div>';
    }
    function head(name, a, c) {
      return '<div><h2>' + esc(name) + '</h2></div><div><div class="big">' + money(a) + '</div><div class="sub">' +
        c.toLocaleString() + ' recipients, net total</div></div>';
    }
    function ledger() {
      var L = $('ledger'), st = cur.st, f = cur.fp, S = st ? cache[st] : null, h;
      if (!S) {
        h = head('United States', N.a, N.c) + '<div><h3>Top recipients</h3>' + rows(N.t, function (p) { return p; }) + '</div>' + agencies(N.g, N.a);
        L.innerHTML = h;
        return;
      }
      var prog = function (i) { return S.p[i]; };
      if (f) {
        var c = S.co[f];
        if (!c) {
          L.innerHTML = '<div><h2>' + esc(S.n) + '</h2></div><p class="empty">No funding is recorded for this county in this data.</p>';
          return;
        }
        var list = showAll ? c.r : c.r.slice(0, 25);
        h = head(c.n + ', ' + S.n, c.a, c.c) + '<div><h3>Recipients</h3>' + rows(list, prog) + '</div>';
        if (c.r.length > list.length) h += '<button type="button" class="btn" id="more">Show all ' + c.r.length + '</button>';
        if (c.l > c.r.length) h += '<p class="sub">Showing the largest ' + c.r.length + ' of ' + c.l.toLocaleString() + ' listed recipients.</p>';
        if (c.h) h += '<p class="sub">' + c.h.toLocaleString() + ' smaller recipients with personal-looking names are counted but not listed.</p>';
      } else {
        h = head(S.n, S.a, S.c) + '<div><h3>Top recipients</h3>' + rows(S.t, prog) + '</div>' + agencies(S.g, S.a);
      }
      h += '<button type="button" class="btn" id="csv">Download ' + esc(f ? S.co[f].n : S.n) + ' CSV</button>';
      L.innerHTML = h;
      var more = $('more');
      if (more) more.addEventListener('click', function () { showAll = true; ledger(); });
      $('csv').addEventListener('click', function () { download(S, f); });
    }
    function download(S, f) {
      var out = [['Recipient', 'County', 'State', 'City', 'Main program', 'Net amount USD', 'Award actions']];
      Object.keys(S.co).filter(function (k) { return !f || k === f; }).forEach(function (k) {
        S.co[k].r.forEach(function (r) { out.push([r[0], S.co[k].n, S.n, r[2], S.p[r[3]], r[1], r[4]]); });
      });
      if (!Object.keys(S.co).length) S.t.forEach(function (r) { out.push([r[0], '', S.n, r[2], S.p[r[3]], r[1], r[4]]); });
      saveCsv('recipients-' + S.st.toLowerCase() + (f ? '-' + f : '') + '.csv', out);
    }
    function crumbs() {
      var S = cur.st ? cache[cur.st] : null, h = '';
      if (S) {
        h = '<a href="' + ROOT.href + '" data-go="">United States</a><span>/</span>';
        if (cur.fp && S.co[cur.fp]) h += '<a href="' + stateUrl(S.st) + '" data-go="' + S.st + '">' + esc(S.n) + '</a><span>/</span><b>' + esc(S.co[cur.fp].n) + '</b>';
        else h += '<b>' + esc(S.n) + '</b>';
      } else h = '<b>United States</b>';
      $('crumbs').innerHTML = h;
    }
    function paint() {
      var S = cur.st ? cache[cur.st] : null, mapped = !!(S && S.b);
      if (drawn !== (mapped ? S.st : null)) { drawCounties(mapped ? S : null); drawn = mapped ? S.st : null; }
      Object.keys(stEls).forEach(function (k) {
        stEls[k].classList.toggle('dim', mapped && k !== S.st);
        stEls[k].style.visibility = mapped && k === S.st ? 'hidden' : '';
      });
      Array.prototype.forEach.call(gCounties.children, function (p) { p.classList.toggle('on', p.dataset.f === cur.fp); });
      zoomTo(mapped ? boxFor(S.b) : HOME);
      legend(mapped);
      ledger();
      crumbs();
      var c = S && cur.fp ? S.co[cur.fp] : null;
      var t = c ? c.n + ', ' + S.n : S ? S.n : null;
      document.title = t ? t + ' | ' + SITE : SITE;
      $('title').textContent = t ? t + ' recipients' : SITE;
    }
    function go(st, f, opts) {
      opts = opts || {};
      var mine = ++seq;
      $('tip').hidden = true;
      showAll = false;
      function done() {
        if (mine !== seq) return;
        cur.st = st; cur.fp = f;
        paint();
        if (opts.push !== false) {
          try { history.pushState({ st: st, f: f }, '', st ? stateUrl(st, f) : ROOT.href); } catch (e) {}
        }
      }
      if (!st || cache[st]) return done();
      data('st/' + st + '.json').then(function (S) { cache[st] = S; done(); }).catch(function () {
        $('ledger').innerHTML = '<p class="empty">This data could not load. Refresh the page and try again.</p>';
      });
    }
    function fromUrl() {
      var st = body.dataset.st || null, f = new URLSearchParams(location.search).get('county');
      var m = location.pathname.match(/\/([a-z]{2})\/$/);
      if (m && N.states[m[1].toUpperCase()]) st = m[1].toUpperCase();
      else if (location.href.split(/[?#]/)[0] === ROOT.href) st = null;
      go(st, f && /^\d{5}$/.test(f) ? f : null, { push: false });
    }

    $('crumbs').addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      go(a.dataset.go || null, null);
    });
    $('terr').addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      go(a.dataset.t, null);
    });
    window.addEventListener('popstate', function () { if (N) fromUrl(); });

    var q = $('q'), res = $('results'), search = null, low = null, names = null;
    function lookup() {
      var v = q.value.trim().toLowerCase(), out = [];
      if (v.length < 2) { res.hidden = true; return; }
      for (var i = 0; i < low.length && out.length < 8; i++) if (low[i].indexOf(v) >= 0) out.push(search[i]);
      res.innerHTML = out.length ? out.map(function (r) {
        var st = /^\d/.test(r[1]) ? ST_FIPS[r[1].slice(0, 2)] : r[1];
        var where = (names[r[1]] ? names[r[1]] + ', ' : '') + N.states[st].n;
        return '<button type="button" data-f="' + r[1] + '" data-s="' + st + '"><span>' + esc(r[0]) + '</span><span class="num">' + money(r[2]) + '</span><small>' + esc(where) + '</small></button>';
      }).join('') : '<div class="none">No recipient of $250K or more matches that name.</div>';
      res.hidden = false;
    }
    q.addEventListener('input', function () {
      if (low) return lookup();
      Promise.all([data('search.json'), data('counties.json')]).then(function (x) {
        search = x[0]; names = x[1];
        low = search.map(function (r) { return r[0].toLowerCase(); });
        lookup();
      });
    });
    res.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      go(b.dataset.s, /^\d/.test(b.dataset.f) ? b.dataset.f : null);
      res.hidden = true;
      q.value = '';
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.search')) res.hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') res.hidden = true; });

    Promise.all([data('nation.json'), data('shapes.json')]).then(function (x) {
      N = x[0]; G = x[1];
      drawStates();
      legend(false);
      fromUrl();
    }).catch(function () {
      $('hint').textContent = 'The map data could not load. Refresh the page and try again.';
    });
  }

  /* Recipients page */
  function recipientsPage() {
    var q = $('rq'), sel = $('rs'), tbody = $('rbody'), note = $('rnote'), search = null, low = null, names = null, N = null;
    var initial = tbody.innerHTML, initialNote = note.textContent;
    function run() {
      var v = q.value.trim().toLowerCase(), st = sel.value;
      if (v.length < 2 && !st) { tbody.innerHTML = initial; note.textContent = initialNote; return; }
      var out = [], total = 0;
      for (var i = 0; i < low.length; i++) {
        var r = search[i], s = /^\d/.test(r[1]) ? ST_FIPS[r[1].slice(0, 2)] : r[1];
        if ((st && s !== st) || (v.length >= 2 && low[i].indexOf(v) < 0)) continue;
        total++;
        if (out.length < 200) out.push([r, s]);
      }
      tbody.innerHTML = out.map(function (x, n) {
        var r = x[0], where = (names[r[1]] ? names[r[1]] + ', ' : '') + N.states[x[1]].n;
        return '<tr><td class="num">' + (n + 1) + '</td><td>' + esc(r[0]) + '</td><td><a href="' + placeUrl(r[1]) + '">' + esc(where) + '</a></td><td></td><td class="num r">' + money(r[2]) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="empty">No recipient of $250K or more matches.</td></tr>';
      note.textContent = total.toLocaleString() + ' recipients of $250K or more match' + (total > 200 ? '. Showing the largest 200.' : '.');
    }
    function ready(fn) {
      if (low) return fn();
      note.textContent = 'Loading recipients…';
      Promise.all([data('search.json'), data('counties.json'), data('nation.json')]).then(function (x) {
        search = x[0]; names = x[1]; N = x[2];
        low = search.map(function (r) { return r[0].toLowerCase(); });
        fn();
      }).catch(function () { note.textContent = 'Recipients could not load. Refresh the page and try again.'; });
    }
    q.addEventListener('input', function () { ready(run); });
    sel.addEventListener('change', function () { ready(run); });
  }

  if (body.dataset.page === 'map') mapPage();
  if (body.dataset.page === 'recipients') recipientsPage();
})();
