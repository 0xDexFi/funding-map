(function () {
  'use strict';
  var body = document.body;
  var ROOT = new URL(body.dataset.root || './', location.href);
  var SITE = 'Recipient Map USA';
  var NS = 'http://www.w3.org/2000/svg';
  var ST_FIPS = { '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY' };
  var PROFILE = 'https://www.usaspending.gov/recipient/';

  function $(id) { return document.getElementById(id); }
  function data(path) {
    return fetch(new URL('data/' + path + (body.dataset.v ? '?v=' + body.dataset.v : ''), ROOT)).then(function (r) {
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
  function perHead(v) {
    if (v >= 1e4) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v).toLocaleString();
  }
  function pct(v) {
    var x = Math.abs(v) >= 0.1 ? Math.round(v * 100) : Math.round(v * 1000) / 10;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(x) + '%';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function profile(id, name) {
    return id ? '<a class="nm" href="' + PROFILE + encodeURIComponent(id) + '/latest" target="_blank" rel="noopener" title="Open on USAspending.gov">' + esc(name) + '</a>'
      : '<span class="nm">' + esc(name) + '</span>';
  }
  var VIEW = { mode: 'total', ag: '' };
  function viewQuery() {
    var p = [];
    if (VIEW.mode !== 'total') p.push('view=' + VIEW.mode);
    if (VIEW.ag) p.push('agency=' + encodeURIComponent(VIEW.ag));
    return p.join('&');
  }
  function stateUrl(st, f) {
    var q = [f ? 'county=' + f : '', viewQuery()].filter(Boolean).join('&');
    return new URL((st ? st.toLowerCase() + '/' : '') + (q ? '?' + q : ''), ROOT).href;
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
    var map = $('map'), HOME = [0, 0, 975, 610], view = HOME.slice(), base = HOME.slice();
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var N = null, G = null, cache = {}, cur = { st: null, fp: null }, drawn = null, stEls = {}, coEls = {}, seq = 0;
    var showAll = false, scale = null, anim = 0;
    var STEPS = 7, CHG = [-0.5, -0.2, -0.05, 0.05, 0.2, 0.5];

    function el(tag, cls, d) {
      var e = document.createElementNS(NS, tag);
      if (cls) e.setAttribute('class', cls);
      if (d) e.setAttribute('d', d);
      return e;
    }
    // Hatched fill for places with no figure in the current view.
    map.innerHTML = '<defs><pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="6" height="6" class="nd-bg"></rect><line x1="0" y1="0" x2="0" y2="6" class="nd-ln"></line></pattern></defs>';
    var gStates = el('g'), gCounties = el('g'), mesh = el('path', 'mesh');
    map.appendChild(gStates); map.appendChild(gCounties); map.appendChild(mesh);

    /* Metrics ----------------------------------------------------------------------------- */
    function amount(e) { return VIEW.ag ? (e.ag && e.ag[VIEW.ag]) || 0 : e.a; }
    function metric(e) {
      if (!e) return null;
      if (VIEW.mode === 'pp') return e.pop ? amount(e) / e.pop : null;
      if (VIEW.mode === 'chg') return e.p > 0 && !VIEW.ag ? (e.a - e.p) / e.p : null;
      return amount(e) > 0 ? amount(e) : null;
    }
    function fmt(v) { return v == null ? 'No data' : VIEW.mode === 'pp' ? perHead(v) + ' per person' : VIEW.mode === 'chg' ? pct(v) : money(v); }
    function shortFmt(v) { return VIEW.mode === 'pp' ? perHead(v) : VIEW.mode === 'chg' ? pct(v) : money(v); }
    function nice(v) {
      if (v <= 0) return v;
      var p = Math.pow(10, Math.floor(Math.log10(v)) - 1);
      return Math.floor(v / p) * p;
    }
    // Quantile classes over the places on screen, so the full color range is always in use.
    function makeScale(entities) {
      var vals = entities.map(metric).filter(function (v) { return v != null && isFinite(v); });
      if (VIEW.mode === 'chg') return { div: true, breaks: CHG };
      vals.sort(function (a, b) { return a - b; });
      var br = [];
      // With few places, each gets its own shade; otherwise split into STEPS equal-sized groups.
      var cuts = [];
      if (vals.length <= STEPS) for (var j = 1; j < vals.length; j++) cuts.push(vals[j]);
      else for (var i = 1; i < STEPS; i++) cuts.push(vals[Math.floor(vals.length * i / STEPS)]);
      cuts.forEach(function (c) {
        var b = nice(c);
        if (b > vals[0] && (!br.length || b > br[br.length - 1])) br.push(b);
      });
      return { div: false, breaks: br };
    }
    function cls(v) {
      if (v == null || !isFinite(v)) return 'qn';
      var br = scale.breaks, i = 0;
      while (i < br.length && v >= br[i]) i++;
      if (scale.div) return 'd' + i;
      var k = br.length + 1;
      return 'q' + (k === 1 ? 3 : Math.round(i * (STEPS - 1) / (k - 1)));
    }
    function entitiesOnScreen() {
      var S = cur.st ? cache[cur.st] : null;
      if (S && S.b) return Object.keys(S.co).map(function (f) { return S.co[f]; });
      return Object.keys(N.states).filter(function (k) { return N.states[k].map; }).map(function (k) { return N.states[k]; });
    }
    function rankOf(e) {
      var list = entitiesOnScreen().map(function (x) { return [x, metric(x)]; })
        .filter(function (x) { return x[1] != null; }).sort(function (a, b) { return b[1] - a[1]; });
      for (var i = 0; i < list.length; i++) if (list[i][0] === e) return [i + 1, list.length];
      return null;
    }

    /* Tooltip ----------------------------------------------------------------------------- */
    function describe(e, name) {
      if (!e) return [name, 'No recorded grants'];
      var lines = [money(e.a) + ' in grants'];
      if (VIEW.ag) lines.push(agName() + ': ' + money(amount(e)));
      if (e.pop) lines.push(perHead(amount(e) / e.pop) + ' per person');
      if (e.p > 0) lines.push(pct((e.a - e.p) / e.p) + ' vs FY' + (N.fy - 1));
      var r = rankOf(e);
      if (r) lines.push('#' + r[0] + ' of ' + r[1] + ' by ' + modeLabel().toLowerCase());
      return [name, lines.join('\n')];
    }
    function tipOn(p, fn) {
      var tip = $('tip');
      p.addEventListener('pointermove', function (e) {
        if (e.pointerType === 'touch' || drag.moved) return;
        var t = fn();
        tip.innerHTML = '<b>' + esc(t[0]) + '</b>' + esc(t[1]).replace(/\n/g, '<br>');
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
        var v = N.states[k], p = el('path', 'st', G.s[k][0]);
        clickable(p, v ? v.n : k, function () { go(k, null); });
        tipOn(p, function () { return describe(v, v ? v.n : k); });
        gStates.appendChild(p);
        stEls[k] = p;
      });
    }
    function drawCounties(S) {
      gCounties.textContent = '';
      coEls = {};
      if (!S) return;
      Object.keys(S.s).forEach(function (f) {
        var v = S.co[f], p = el('path', 'co', S.s[f]);
        p.dataset.f = f;
        var name = v ? v.n : 'County ' + f;
        clickable(p, name, function () { go(S.st, f); });
        tipOn(p, function () { return describe(v && v.a ? v : null, name); });
        gCounties.appendChild(p);
        coEls[f] = p;
      });
    }
    function recolor() {
      var S = cur.st ? cache[cur.st] : null, mapped = !!(S && S.b);
      scale = makeScale(entitiesOnScreen());
      Object.keys(stEls).forEach(function (k) {
        var p = stEls[k];
        p.setAttribute('class', 'st ' + cls(metric(N.states[k])) + (mapped && k !== S.st ? ' dim' : ''));
        p.style.visibility = mapped && k === S.st ? 'hidden' : '';
        p.setAttribute('aria-label', N.states[k] ? N.states[k].n + ', ' + fmt(metric(N.states[k])) : k);
      });
      Object.keys(coEls).forEach(function (f) {
        var v = S.co[f], m = v && v.a ? metric(v) : null;
        coEls[f].setAttribute('class', 'co ' + cls(m) + (f === cur.fp ? ' on' : ''));
        coEls[f].setAttribute('aria-label', (v ? v.n : 'County ' + f) + ', ' + fmt(m));
      });
      legend(mapped);
    }

    /* Viewbox, zoom and pan --------------------------------------------------------------- */
    function setView(v) {
      var minW = base[2] / 10, maxW = base[2];
      var w = Math.max(minW, Math.min(maxW, v[2])), h = w * base[3] / base[2];
      var cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2;
      cx = Math.max(base[0] + w / 2, Math.min(base[0] + base[2] - w / 2, cx));
      cy = Math.max(base[1] + h / 2, Math.min(base[1] + base[3] - h / 2, cy));
      view = [cx - w / 2, cy - h / 2, w, h];
      map.setAttribute('viewBox', view.join(' '));
      var zoomed = w < base[2] * 0.999;
      map.style.touchAction = zoomed ? 'none' : 'pan-y';
      map.classList.toggle('zoomed', zoomed);
    }
    function zoomTo(box) {
      // Keep the map's aspect ratio so county shapes are never stretched.
      var r = HOME[2] / HOME[3], w = box[2], h = box[3];
      if (w / h > r) h = w / r; else w = h * r;
      base = [box[0] + box[2] / 2 - w / 2, box[1] + box[3] / 2 - h / 2, w, h];
      if (!cur.st) base = HOME.slice();
      var from = view.slice(), to = base.slice(), start = null, mine = ++anim;
      if (reduce) return setView(to);
      function step(t) {
        if (mine !== anim) return;
        if (start === null) start = t;
        var k = Math.min(1, (t - start) / 420), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        view = from.map(function (a, i) { return a + (to[i] - a) * e; });
        map.setAttribute('viewBox', view.join(' '));
        if (k < 1) requestAnimationFrame(step); else setView(to);
      }
      requestAnimationFrame(step);
    }
    function toSvg(clientX, clientY) {
      var r = map.getBoundingClientRect();
      return [view[0] + (clientX - r.left) / r.width * view[2], view[1] + (clientY - r.top) / r.height * view[3]];
    }
    function zoomAt(k, pt) {
      anim++;
      pt = pt || [view[0] + view[2] / 2, view[1] + view[3] / 2];
      var w = view[2] / k, h = view[3] / k;
      setView([pt[0] - (pt[0] - view[0]) / k, pt[1] - (pt[1] - view[1]) / k, w, h]);
    }
    function boxFor(b) {
      var w = b[2] - b[0], h = b[3] - b[1], pad = Math.max(w, h) * 0.08 + 6;
      return [b[0] - pad, b[1] - pad, w + pad * 2, h + pad * 2];
    }
    var drag = { id: null, x: 0, y: 0, moved: false, pts: {}, pinch: null };
    map.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag.pts[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(drag.pts);
      if (ids.length === 2) {
        var a = drag.pts[ids[0]], b = drag.pts[ids[1]];
        drag.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), w: view[2] };
      }
      drag.id = e.pointerId; drag.x = e.clientX; drag.y = e.clientY; drag.moved = false;
    });
    map.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in drag.pts)) return;
      drag.pts[e.pointerId] = [e.clientX, e.clientY];
      var ids = Object.keys(drag.pts);
      if (ids.length === 2 && drag.pinch) {
        var a = drag.pts[ids[0]], b = drag.pts[ids[1]];
        var d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d > 0) zoomAt(view[2] / (drag.pinch.w * drag.pinch.d / d), toSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
        drag.moved = true;
        return;
      }
      if (e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) {
        drag.moved = true;
        $('tip').hidden = true;
        try { map.setPointerCapture(e.pointerId); } catch (err) {}
      }
      var r = map.getBoundingClientRect();
      anim++;
      setView([view[0] - dx / r.width * view[2], view[1] - dy / r.height * view[3], view[2], view[3]]);
      drag.x = e.clientX; drag.y = e.clientY;
      map.classList.add('panning');
    });
    function endPointer(e) {
      delete drag.pts[e.pointerId];
      if (Object.keys(drag.pts).length < 2) drag.pinch = null;
      map.classList.remove('panning');
    }
    map.addEventListener('pointerup', endPointer);
    map.addEventListener('pointercancel', endPointer);
    // A drag ends with a click; don't treat it as selecting a place.
    map.addEventListener('click', function (e) {
      if (drag.moved) { e.stopPropagation(); e.preventDefault(); drag.moved = false; }
    }, true);
    map.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) { flashHint(); return; }
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.004), toSvg(e.clientX, e.clientY));
    }, { passive: false });
    var hintTimer = null;
    function flashHint() {
      var h = $('zoomhint');
      if (!h) return;
      h.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { h.hidden = true; }, 1400);
    }

    /* Map controls ------------------------------------------------------------------------ */
    function modeLabel() { return VIEW.mode === 'pp' ? 'Per person' : VIEW.mode === 'chg' ? 'Change' : 'Total'; }
    function agName() {
      for (var i = 0; i < N.agencies.length; i++) if (N.agencies[i][0] === VIEW.ag) return N.agencies[i][1];
      return '';
    }
    function buildControls() {
      var bar = $('mapbar');
      bar.innerHTML = '<div class="seg" role="radiogroup" aria-label="Color the map by">' +
        [['total', 'Total'], ['pp', 'Per person'], ['chg', 'Change since FY' + (N.fy - 1)]].map(function (m) {
          return '<button type="button" role="radio" data-mode="' + m[0] + '">' + esc(m[1]) + '</button>';
        }).join('') + '</div>' +
        '<label class="agsel"><span>Funding agency</span><select id="agency"><option value="">All agencies</option>' +
        N.agencies.map(function (a) { return '<option value="' + esc(a[0]) + '">' + esc(a[1]) + '</option>'; }).join('') +
        '</select></label>';
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-mode]');
        if (!b || b.disabled) return;
        VIEW.mode = b.dataset.mode;
        viewChanged();
      });
      $('agency').addEventListener('change', function () {
        VIEW.ag = this.value;
        if (VIEW.ag && VIEW.mode === 'chg') VIEW.mode = 'total';
        viewChanged();
      });
      var z = $('zoomctl');
      z.innerHTML = '<button type="button" data-z="in" aria-label="Zoom in">+</button>' +
        '<button type="button" data-z="out" aria-label="Zoom out">−</button>' +
        '<button type="button" data-z="fit" aria-label="Fit to view">⤢</button>';
      z.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.z === 'in') zoomAt(1.6);
        else if (b.dataset.z === 'fit') { anim++; zoomTo(base); }
        else if (view[2] < base[2] * 0.999) zoomAt(1 / 1.6);
        else zoomOut();
      });
    }
    function syncControls() {
      Array.prototype.forEach.call($('mapbar').querySelectorAll('button[data-mode]'), function (b) {
        b.setAttribute('aria-checked', String(b.dataset.mode === VIEW.mode));
        b.disabled = b.dataset.mode === 'chg' && !!VIEW.ag;
        b.title = b.disabled ? 'Change is shown for all agencies only' : '';
      });
      $('agency').value = VIEW.ag;
    }
    function viewChanged() {
      syncControls();
      recolor();
      ledger();
      try { history.replaceState(history.state, '', cur.st ? stateUrl(cur.st, cur.fp) : stateUrl(null)); } catch (e) {}
    }

    /* Legend ------------------------------------------------------------------------------ */
    function legend(zoomed) {
      var br = scale.breaks, items = [], i;
      if (scale.div) {
        var labs = ['Down 50%+', '−50 to −20%', '−20 to −5%', 'About the same', '+5 to +20%', '+20 to +50%', 'Up 50%+'];
        for (i = 0; i < 7; i++) items.push(['d' + i, labs[i]]);
      } else if (!br.length) {
        items.push(['q3', 'Any amount']);
      } else {
        var k = br.length + 1;
        for (i = 0; i < k; i++) {
          var c = 'q' + (k === 1 ? 3 : Math.round(i * (STEPS - 1) / (k - 1)));
          var lab = i === 0 ? 'Under ' + shortFmt(br[0]) : i === k - 1 ? shortFmt(br[k - 2]) + '+' : shortFmt(br[i - 1]) + '–' + shortFmt(br[i]);
          items.push([c, lab]);
        }
      }
      items.push(['qn', VIEW.mode === 'chg' ? 'No comparison' : 'No data']);
      var what = (VIEW.ag ? agName() + ' grants' : 'Grants') + ', ' + (zoomed ? 'by county' : 'by state') +
        (VIEW.mode === 'pp' ? ', per person' : VIEW.mode === 'chg' ? ', change since FY' + (N.fy - 1) : '');
      $('legend').innerHTML = '<span class="lt">' + esc(what) + '</span><span class="keys">' + items.map(function (x) {
        return '<button type="button" class="key" data-c="' + x[0] + '"><i class="s' + x[0] + '"></i>' + esc(x[1]) + '</button>';
      }).join('') + '</span>';
      var hint = zoomed ? 'Select a county to see its recipients.' : 'Select a state to see its counties.';
      if (VIEW.mode === 'total') hint += ' Colors split the places shown into equal-sized groups, so each shade holds about as many places.';
      if (VIEW.mode === 'pp') hint += ' Per-person figures use the population USAspending reports for each place.';
      hint += " Money is placed at the recipient's address, and state agencies pass much of it on, so capital counties look large.";
      $('hint').textContent = hint;
    }
    function highlight(c) {
      map.classList.toggle('picking', !!c);
      Array.prototype.forEach.call(map.querySelectorAll('path.st, path.co'), function (p) {
        p.classList.toggle('hit', !!c && p.classList.contains(c));
      });
    }
    $('legend').addEventListener('pointerover', function (e) { var k = e.target.closest('.key'); highlight(k ? k.dataset.c : null); });
    $('legend').addEventListener('pointerleave', function () { highlight(null); });
    $('legend').addEventListener('focusin', function (e) { var k = e.target.closest('.key'); highlight(k ? k.dataset.c : null); });
    $('legend').addEventListener('focusout', function () { highlight(null); });
    $('legend').addEventListener('click', function (e) { var k = e.target.closest('.key'); if (k) highlight(k.dataset.c); });

    /* Ledger ------------------------------------------------------------------------------ */
    function rows(list, total) {
      if (!list || !list.length) return '<p class="empty">No organizations to list here.</p>';
      var max = Math.max(1, list[0][1]);
      return '<ol class="rows">' + list.map(function (r) {
        var share = total > 0 ? r[1] / total : 0;
        return '<li>' + profile(r[2], r[0]) + '<span class="num">' + money(r[1]) + '</span>' +
          '<span class="bar"><i style="width:' + Math.max(1, r[1] / max * 100).toFixed(1) + '%"></i></span>' +
          (share >= 0.001 ? '<span class="meta">' + pct(share).replace('+', '') + ' of the total here</span>' : '') + '</li>';
      }).join('') + '</ol>';
    }
    function agencies(g, total) {
      return '<div><h3>Largest funders</h3><ol class="rows">' + g.map(function (x) {
        return '<li><span class="nm">' + esc(x[0]) + '</span><span class="num">' + money(x[1]) + '</span>' +
          '<span class="bar"><i style="width:' + Math.max(1, x[1] / total * 100).toFixed(1) + '%"></i></span></li>';
      }).join('') + '</ol></div>';
    }
    function head(name, e, sub) {
      var bits = [];
      if (e.pop) bits.push('<b>' + perHead(e.a / e.pop) + '</b> per person');
      if (e.p > 0) {
        var c = (e.a - e.p) / e.p;
        bits.push('<b class="' + (c > 0.05 ? 'up' : c < -0.05 ? 'down' : '') + '">' + pct(c) + '</b> vs FY' + (N.fy - 1));
      }
      var h = '<div><h2>' + esc(name) + '</h2><div class="sub">' + esc(sub) + '</div></div><div><div class="big">' + money(e.a) + '</div>' +
        '<div class="sub">in grants, ' + esc(N.period) + '</div>' + (bits.length ? '<div class="kpis">' + bits.join('') + '</div>' : '') + '</div>';
      if (VIEW.ag) h += '<div class="agline"><span>' + esc(agName()) + '</span><b class="num">' + money(amount(e)) + '</b>' +
        '<span class="sub">' + (e.a > 0 ? pct(amount(e) / e.a).replace('+', '') + ' of all grants here' : '') + '</span></div>';
      return h;
    }
    function ranking() {
      var S = cur.st ? cache[cur.st] : null, mapped = !!(S && S.b);
      var keys = mapped ? Object.keys(S.co) : Object.keys(N.states).filter(function (k) { return N.states[k].map; });
      var list = keys.map(function (k) { var e = mapped ? S.co[k] : N.states[k]; return [k, e, e && e.a ? metric(e) : null]; })
        .filter(function (x) { return x[2] != null; }).sort(function (a, b) { return b[2] - a[2]; });
      if (list.length < 3) return '';
      var top = list.slice(0, 5), low = list.length > 10 ? list.slice(-3).reverse() : [];
      function li(x) {
        return '<li><button type="button" class="rk" data-k="' + x[0] + '"><span>' + esc(x[1].n) + '</span><span class="num">' + esc(shortFmt(x[2])) + '</span></button></li>';
      }
      var label = VIEW.mode === 'chg' ? 'Biggest increase' : 'Highest ' + (VIEW.mode === 'pp' ? 'per person' : 'total');
      return '<div class="rank"><h3>' + esc(label) + (VIEW.ag ? ' · ' + esc(agName()) : '') + '</h3><ol>' + top.map(li).join('') + '</ol>' +
        (low.length ? '<h3>' + (VIEW.mode === 'chg' ? 'Biggest decrease' : 'Lowest') + '</h3><ol>' + low.map(li).join('') + '</ol>' : '') + '</div>';
    }
    function ledger() {
      var L = $('ledger'), st = cur.st, f = cur.fp, S = st ? cache[st] : null, h;
      if (!S) {
        h = head('United States', N, 'All states and territories') + ranking() +
          '<div><h3>Top recipients</h3>' + rows(N.t.map(function (r) { return [r[0], r[1], r[2]]; }), N.a) + '</div>' + agencies(N.g, N.a);
        L.innerHTML = h;
        return;
      }
      if (f) {
        var c = S.co[f];
        if (!c || !c.a) {
          L.innerHTML = '<div><h2>' + esc(c ? c.n : 'County') + ', ' + esc(S.n) + '</h2></div><p class="empty">No grants are recorded for recipients in this county in ' + esc(N.period) + '.</p>';
          return;
        }
        var list = showAll ? c.r : c.r.slice(0, 25);
        h = head(c.n + ', ' + S.n, c, 'County') + '<div><h3>Recipients</h3>' + rows(list, c.a) + '</div>';
        if (c.r.length > list.length) h += '<button type="button" class="btn" id="more">Show all ' + c.r.length + '</button>';
        if (c.more) h += '<p class="sub">Showing the largest ' + c.r.length + ' recipients. Open a name to see its full record on USAspending.gov.</p>';
        if (c.h) h += '<p class="sub">' + c.h.toLocaleString() + ' recipients with personal-looking names are counted but not listed.</p>';
      } else {
        h = head(S.n, S, S.b ? 'State' : 'Territory or freely associated state') + ranking() +
          '<div><h3>Top recipients</h3>' + rows(S.t, S.a) + '</div>' + agencies(S.g, S.a);
        if (S.u > S.a * 0.01) h += '<p class="sub">' + money(S.u) + ' went to recipients without a county on file.</p>';
      }
      h += '<button type="button" class="btn" id="csv">Download ' + esc(f ? S.co[f].n : S.n) + ' CSV</button>';
      L.innerHTML = h;
      var more = $('more');
      if (more) more.addEventListener('click', function () { showAll = true; ledger(); });
      $('csv').addEventListener('click', function () { download(S, f); });
    }
    $('ledger').addEventListener('click', function (e) {
      var b = e.target.closest('.rk');
      if (!b) return;
      if (/^\d/.test(b.dataset.k)) go(cur.st, b.dataset.k); else go(b.dataset.k, null);
    });
    $('ledger').addEventListener('pointerover', function (e) {
      var b = e.target.closest('.rk'), p = b && (stEls[b.dataset.k] || coEls[b.dataset.k]);
      Array.prototype.forEach.call(map.querySelectorAll('.peek'), function (x) { x.classList.remove('peek'); });
      if (p) p.classList.add('peek');
    });
    function download(S, f) {
      var out = [['Recipient', 'County', 'State', 'Grants USD (' + N.period + ')', 'USAspending profile']];
      Object.keys(S.co).filter(function (k) { return !f || k === f; }).forEach(function (k) {
        S.co[k].r.forEach(function (r) { out.push([r[0], S.co[k].n, S.n, r[1], r[2] ? PROFILE + r[2] + '/latest' : '']); });
      });
      if (!Object.keys(S.co).length) S.t.forEach(function (r) { out.push([r[0], '', S.n, r[1], r[2] ? PROFILE + r[2] + '/latest' : '']); });
      saveCsv('recipients-' + S.st.toLowerCase() + (f ? '-' + f : '') + '.csv', out);
    }
    function crumbs() {
      var S = cur.st ? cache[cur.st] : null, h = '';
      if (S) {
        h = '<a href="' + stateUrl(null) + '" data-go="">United States</a><span>/</span>';
        if (cur.fp && S.co[cur.fp]) h += '<a href="' + stateUrl(S.st) + '" data-go="' + S.st + '">' + esc(S.n) + '</a><span>/</span><b>' + esc(S.co[cur.fp].n) + '</b>';
        else h += '<b>' + esc(S.n) + '</b>';
      } else h = '<b>United States</b>';
      $('crumbs').innerHTML = h;
    }
    function paint() {
      var S = cur.st ? cache[cur.st] : null, mapped = !!(S && S.b);
      if (drawn !== (mapped ? S.st : null)) { drawCounties(mapped ? S : null); drawn = mapped ? S.st : null; }
      recolor();
      zoomTo(mapped ? boxFor(S.b) : HOME);
      ledger();
      crumbs();
      back.hidden = !cur.st;
      back.textContent = cur.fp ? '← Back to ' + S.n : '← Back to United States';
      var c = S && cur.fp ? S.co[cur.fp] : null;
      var t = c ? c.n + ', ' + S.n : S ? S.n : null;
      document.title = t ? t + ' | ' + SITE : SITE;
      $('title').textContent = t ? t + ' grant recipients' : SITE;
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
          try { history.pushState({ st: st, f: f }, '', stateUrl(st, f)); } catch (e) {}
        }
      }
      if (!st || cache[st]) return done();
      data('st/' + st + '.json').then(function (S) { cache[st] = S; done(); }).catch(function () {
        $('ledger').innerHTML = '<p class="empty">This data could not load. Refresh the page and try again.</p>';
      });
    }
    function fromUrl() {
      var qs = new URLSearchParams(location.search), st = body.dataset.st || null, f = qs.get('county');
      var m = location.pathname.match(/\/([a-z]{2})\/$/);
      if (m && N.states[m[1].toUpperCase()]) st = m[1].toUpperCase();
      else if (location.href.split(/[?#]/)[0] === ROOT.href) st = null;
      var mode = qs.get('view'), ag = qs.get('agency') || '';
      VIEW.mode = mode === 'pp' || mode === 'chg' ? mode : 'total';
      VIEW.ag = N.agencies.some(function (a) { return a[0] === ag; }) ? ag : '';
      if (VIEW.ag && VIEW.mode === 'chg') VIEW.mode = 'total';
      syncControls();
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

    // Zoom out one level: county -> state -> United States.
    function zoomOut() {
      if (cur.fp) go(cur.st, null);
      else if (cur.st) go(null, null);
    }
    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn zoomout';
    back.hidden = true;
    $('mapwrap').appendChild(back);
    back.addEventListener('click', zoomOut);
    map.addEventListener('click', function (e) { if (e.target === map) zoomOut(); });
    document.addEventListener('keydown', function (e) {
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (e.key === 'Escape' && cur.st) zoomOut();
      if ((e.key === '+' || e.key === '=') && !e.ctrlKey && !e.metaKey) zoomAt(1.6);
      if (e.key === '-' && !e.ctrlKey && !e.metaKey) { if (view[2] < base[2] * 0.999) zoomAt(1 / 1.6); else zoomOut(); }
    });

    var q = $('q'), res = $('results'), search = null, low = null, names = null;
    function lookup() {
      var v = q.value.trim().toLowerCase(), out = [];
      if (v.length < 2) { res.hidden = true; return; }
      for (var i = 0; i < low.length && out.length < 8; i++) if (low[i].indexOf(v) >= 0) out.push(search[i]);
      res.innerHTML = out.length ? out.map(function (r) {
        var st = /^\d/.test(r[1]) ? ST_FIPS[r[1].slice(0, 2)] : r[1];
        var where = (names[r[1]] ? names[r[1]] + ', ' : '') + (N.states[st] ? N.states[st].n : st);
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
      buildControls();
      drawStates();
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
        var r = x[0], where = (names[r[1]] ? names[r[1]] + ', ' : '') + (N.states[x[1]] ? N.states[x[1]].n : x[1]);
        return '<tr><td class="num">' + (n + 1) + '</td><td>' + esc(r[0]) + '</td><td><a href="' + placeUrl(r[1]) + '">' + esc(where) + '</a></td><td class="num r">' + money(r[2]) + '</td></tr>';
      }).join('') || '<tr><td colspan="4" class="empty">No recipient of $250K or more matches.</td></tr>';
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
