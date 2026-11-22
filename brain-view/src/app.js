/* Brain View — UI wiring. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = JSON.parse($('#brain-data').textContent);
  const app = $('#app'), canvas = $('#gl');
  const SW = ['#FF3B30', '#FF7A18', '#FFC83D', '#3DDC84', '#22D3EE', '#3D7BFF', '#9B6BFF', '#FF4FA3', '#FFFFFF'];
  const params = new URLSearchParams(location.search);
  const small = () => window.innerWidth <= 860;

  let eng;
  try { eng = BrainEngine.create(canvas, D, { color: SW[0], preserve: params.has('capture') }); }
  catch (e) {
    const er = $('#err'); er.style.display = 'flex';
    er.innerHTML = 'Brain View needs WebGL2 to draw.<br>' + esc(e.message || e);
    console.error(e); return;
  }
  const NN = D.notes.length, areas = D.areas, folders = D.folders, notes = D.notes;
  const noteArea = eng.noteArea, noteFolder = eng.noteFolder;
  const areaCount = new Int32Array(areas.length), folderCount = new Int32Array(folders.length);
  for (let i = 0; i < NN; i++) { areaCount[noteArea[i]]++; folderCount[noteFolder[i]]++; }
  const hay = notes.map((n, i) => (n.t + ' \u0001 ' + (n.s || '') + ' ' + folders[n.f].name + ' ' + areas[noteArea[i]].name + ' ' + (n.g || []).join(' ')).toLowerCase());
  const SRC = D.sources || {};
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (ms, day) => { if (!ms) return ''; const d = new Date(ms); return (day ? d.getUTCDate() + ' ' : '') + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };

  $('#nNotes').textContent = NN; $('#nLinks').textContent = eng.linkCount;
  if (D.title) { document.title = D.title; }

  const st = { area: -1, folder: -1, query: '', colorMode: 'one', color: SW[0], labels: false, sel: -1, viewOpen: true, galaxy: false, prev: null };

  // ---------------- filter ----------------
  function matcher() {
    const terms = st.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (st.area < 0 && !terms.length) return null;
    return (n) => (st.area < 0 || noteArea[n] === st.area) && (st.folder < 0 || noteFolder[n] === st.folder) && terms.every((t) => hay[n].indexOf(t) >= 0);
  }
  function applyFilter() { eng.setLit(matcher()); }

  // ---------------- areas panel ----------------
  const areaList = $('#areaList');
  function renderAreas() {
    areaList.textContent = '';
    areas.forEach((a, i) => {
      if (!areaCount[i]) return;
      const row = el('div', 'area' + (st.area === i ? ' sel' : st.area >= 0 ? ' dim' : ''));
      row.style.setProperty('--c', a.color);
      row.innerHTML = '<span class="dot"></span><span class="n">' + esc(a.name) + '</span><span class="c">' + areaCount[i] + '</span>';
      row.setAttribute('role', 'button'); row.tabIndex = 0;
      const pick = () => { if (st.area === i && st.folder < 0) { st.area = -1; } else { st.area = i; } st.folder = -1; renderAreas(); applyFilter(); };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      areaList.appendChild(row);
      if (st.area === i) {
        const box = el('div', 'folds');
        folders.map((f, fi) => fi).filter((fi) => folders[fi].area === i && folderCount[fi] > 0)
          .sort((x, y) => folderCount[y] - folderCount[x] || x - y)
          .forEach((fi) => {
            const fr = el('div', 'fold' + (st.folder === fi ? ' sel' : st.folder >= 0 ? ' dim' : ''));
            fr.innerHTML = '<span class="n">' + esc(folders[fi].name) + '</span><span class="c">' + folderCount[fi] + '</span>';
            fr.addEventListener('click', (e) => { e.stopPropagation(); st.folder = st.folder === fi ? -1 : fi; renderAreas(); applyFilter(); });
            box.appendChild(fr);
          });
        areaList.appendChild(box);
      }
    });
  }
  function renderLegend() {
    const lg = $('#legend');
    lg.className = st.galaxy ? '' : st.colorMode === 'time' ? 'time' : st.colorMode === 'one' ? '' : 'none';
    if (st.galaxy) { lg.textContent = 'Every ' + ({ area: 'area', folder: 'folder', month: 'month', source: 'source' }[$('#selCluster').value] || 'group') + ' is its own galaxy'; lg.title = ''; }
    else if (st.colorMode === 'time') {
      // colour follows writing order; when the dates are lopsided, say where the midpoint falls
      const mid = Math.abs(eng.medLin - 0.5) > 0.2 ? '<span>' + fmtDate(eng.dMed) + '</span>' : '';
      lg.innerHTML = '<div class="bar"></div><div class="ends"><span>' + fmtDate(eng.dMin) + '</span>' + mid + '<span>' + fmtDate(eng.dMax) + '</span></div>';
      lg.title = 'Oldest to newest, in the order notes were written';
    }
    else if (st.colorMode === 'one') lg.textContent = 'Everything in your color';
    else lg.textContent = '';
    $('#vHex').textContent = st.colorMode === 'one' ? st.color.toUpperCase() : 'body glow';
    $('#vHex').classList.toggle('hex', st.colorMode === 'one');
  }
  $('#showAll').addEventListener('click', () => {
    st.area = -1; st.folder = -1; st.query = ''; $('#q').value = ''; closeResults(); renderAreas(); applyFilter();
  });
  $('#areas .h').addEventListener('click', () => { if (small()) $('#areas').classList.toggle('folded'); });

  // ---------------- view panel ----------------
  const swBox = $('#swatches');
  function renderSwatches() {
    swBox.textContent = '';
    SW.forEach((c) => {
      const b = el('button', 'sw' + (st.color.toUpperCase() === c ? ' on' : '')); b.style.setProperty('--c', c); b.setAttribute('aria-label', 'Colour ' + c);
      b.addEventListener('click', () => setColor(c)); swBox.appendChild(b);
    });
    const custom = SW.indexOf(st.color.toUpperCase()) < 0;
    const rb = el('span', 'sw rainbow' + (custom ? ' on' : '')); rb.title = 'Pick any colour';
    const inp = el('input'); inp.type = 'color'; inp.value = st.color; inp.setAttribute('aria-label', 'Custom colour');
    inp.addEventListener('input', () => setColor(inp.value, true)); rb.appendChild(inp); swBox.appendChild(rb);
  }
  function setColor(hex, keepDom) {
    st.color = hex.toUpperCase(); eng.setColor(st.color);
    if (st.colorMode !== 'one') { st.colorMode = 'one'; $('#selColor').value = 'one'; eng.setColorMode('one'); }
    if (keepDom) { swBox.querySelectorAll('.sw').forEach((b) => b.classList.remove('on')); $('.sw.rainbow', swBox).classList.add('on'); }
    else renderSwatches();
    renderLegend();
  }
  $('#selColor').addEventListener('change', (e) => { st.colorMode = e.target.value; eng.setColorMode(st.colorMode); renderLegend(); });
  $('#selCluster').addEventListener('change', (e) => { eng.setClusterBy(e.target.value); buildLabels(); if (st.prev) st.prev.cluster = null; renderLegend(); });
  function slider(id, out, fn, fmt) {
    const s = $(id), o = out ? $(out) : null;
    const go = () => { const v = +s.value; if (o) o.textContent = fmt ? fmt(v) : v + '%'; fn(v); };
    s.addEventListener('input', go); go(); return s;
  }
  slider('#sForm', null, (v) => eng.set('form', v / 1000));
  slider('#sSpread', '#vSpread', (v) => eng.set('spread', v / 100));
  slider('#sSpeed', '#vSpeed', (v) => eng.set('speed', v / 100));
  slider('#sPoint', '#vPoint', (v) => eng.set('pointSize', v / 100));
  slider('#sGlow', '#vGlow', (v) => eng.set('glow', v / 100));
  slider('#sBriBody', '#vBriBody', (v) => eng.set('briBody', v / 100));
  slider('#sBriNotes', '#vBriNotes', (v) => eng.set('briNotes', v / 100));
  slider('#sDim', '#vDim', (v) => eng.set('dim', v / 100));
  document.querySelectorAll('.tg').forEach((b) => b.addEventListener('click', () => {
    const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    const k = b.dataset.k;
    if (k === 'labels') setLabels(on); else eng.set(k, on ? 1 : 0);
  }));
  function setLabels(on) {
    st.labels = on; $('#labels').style.display = on ? '' : 'none';
    const b = $('.tg[data-k=labels]'); b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  }
  // ---------------- galaxy form ----------------
  function setGalaxy(on) {
    if (on === st.galaxy) return;
    st.galaxy = on; app.classList.toggle('galaxy', on);
    const b = $('#galaxyBtn'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    const sel = $('#selCluster');
    if (on) {
      st.prev = { cluster: null, labels: st.labels };
      if (sel.value === 'folder') { st.prev.cluster = 'folder'; sel.value = 'area'; eng.setClusterBy('area'); buildLabels(); }   // a galaxy per area
      setLabels(true);
    } else if (st.prev) {
      if (st.prev.cluster) { sel.value = st.prev.cluster; eng.setClusterBy(st.prev.cluster); buildLabels(); }
      setLabels(st.prev.labels); st.prev = null;
    }
    eng.set('galaxy', on); renderLegend();
  }
  $('#galaxyBtn').addEventListener('click', () => setGalaxy(!st.galaxy));
  function setView(open) {
    st.viewOpen = open; $('#view').classList.toggle('closed', !open); $('#viewBtn').classList.toggle('on', open);
    $('#viewBtn').setAttribute('aria-expanded', open); app.classList.toggle('noview', !open);
  }
  $('#viewBtn').addEventListener('click', () => setView(!st.viewOpen));
  $('#viewClose').addEventListener('click', () => setView(false));

  // ---------------- tooltip ----------------
  const tip = $('#tip');
  function noteMeta(n) { return esc(areas[noteArea[n]].name) + ' › ' + esc(folders[noteFolder[n]].name); }
  eng.on('hover', (id, x, y) => {
    canvas.classList.toggle('pointing', id >= 0);
    if (id < 0) { tip.classList.remove('on'); return; }
    const n = notes[id];
    tip.style.setProperty('--c', areas[noteArea[id]].color);
    tip.innerHTML = '<div class="t">' + esc(n.t) + '</div><div class="m"><span class="dot"></span><span>' + noteMeta(id) + (eng.dates[id] ? ' · ' + fmtDate(eng.dates[id]) : '') + '</span></div>';
    const w = tip.offsetWidth, h = tip.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let tx = x + 16, ty = y + 18; if (tx + w > W - 8) tx = x - w - 14; if (ty + h > H - 8) ty = y - h - 12;
    tip.style.transform = 'translate(' + Math.max(8, tx) + 'px,' + Math.max(8, ty) + 'px)'; tip.classList.add('on');
  });
  canvas.addEventListener('pointerdown', () => canvas.classList.add('grabbing'));
  window.addEventListener('pointerup', () => canvas.classList.remove('grabbing'));

  // ---------------- note card ----------------
  const card = $('#note');
  function openNote(id) {
    st.sel = id; eng.setSelected(id);
    const n = notes[id], a = areas[noteArea[id]];
    card.style.setProperty('--c', a.color);
    const src = n.src ? (SRC[n.src] || n.src) : '';
    const meta = [eng.dates[id] ? fmtDate(eng.dates[id], true) : '', src, n.k || ''].filter(Boolean).join(' · ');
    const links = (n.l || []).filter((j) => j >= 0 && j < NN);
    let h = '<button class="x" aria-label="Close note">×</button><div class="crumb"><span class="dot"></span><span>' + noteMeta(id) + '</span></div><h2>' + esc(n.t) + '</h2>';
    if (meta) h += '<div class="meta">' + esc(meta) + '</div>';
    if (n.s) h += '<p>' + esc(n.s) + '</p>';
    if (links.length) {
      h += '<div class="lh">LINKED NOTES · ' + links.length + '</div><div class="links">';
      links.slice(0, 8).forEach((j) => { h += '<div class="lk" data-n="' + j + '" style="--c:' + areas[noteArea[j]].color + '"><span class="dot"></span><span>' + esc(notes[j].t) + '</span></div>'; });
      h += '</div>';
      if (links.length > 8) h += '<div class="more">+ ' + (links.length - 8) + ' more — they light up in the brain</div>';
    }
    card.innerHTML = h; card.scrollTop = 0; card.classList.add('on');
    $('.x', card).addEventListener('click', closeNote);
    card.querySelectorAll('.lk').forEach((e) => e.addEventListener('click', () => openNote(+e.dataset.n)));
  }
  function closeNote() { st.sel = -1; eng.setSelected(-1); card.classList.remove('on'); }
  eng.on('click', (id) => { tip.classList.remove('on'); if (id >= 0) openNote(id); else if (st.sel >= 0) closeNote(); closeResults(); });

  // ---------------- search ----------------
  const q = $('#q'), res = $('#results'); let resIdx = [], act = -1;
  function closeResults() { res.classList.remove('open'); act = -1; }
  function search() {
    st.query = q.value; applyFilter();
    const terms = st.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) { closeResults(); return; }
    const scored = [];
    for (let n = 0; n < NN; n++) {
      const hs = hay[n]; let ok = true, s = 0;
      for (const t of terms) { const p = hs.indexOf(t); if (p < 0) { ok = false; break; } const cut = hs.indexOf('\u0001'); s += p < cut ? (p === 0 ? 4 : 3) : 1; }
      if (ok) scored.push([s, n]);
    }
    scored.sort((a, b) => b[0] - a[0] || eng.dates[b[1]] - eng.dates[a[1]]);
    resIdx = scored.slice(0, 8).map((s) => s[1]); act = -1;
    res.innerHTML = resIdx.length ? resIdx.map((n, i) => '<div class="r" data-i="' + i + '" style="--c:' + areas[noteArea[n]].color + '"><span class="dot"></span><div style="min-width:0"><div class="t">' + esc(notes[n].t) + '</div><div class="m">' + noteMeta(n) + '</div></div></div>').join('')
      + (scored.length > 8 ? '<div class="none">' + scored.length + ' notes lit</div>' : '') : '<div class="none">Nothing in your brain matches that.</div>';
    res.querySelectorAll('.r').forEach((e) => e.addEventListener('mousedown', (ev) => { ev.preventDefault(); openNote(resIdx[+e.dataset.i]); closeResults(); }));
    res.classList.add('open');
  }
  q.addEventListener('input', search);
  q.addEventListener('focus', () => { if (q.value.trim()) search(); });
  q.addEventListener('blur', () => setTimeout(closeResults, 120));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { q.value = ''; search(); q.blur(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!resIdx.length) return; e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + resIdx.length) % resIdx.length;
      res.querySelectorAll('.r').forEach((r, i) => r.classList.toggle('act', i === act));
    } else if (e.key === 'Enter' && resIdx.length) { openNote(resIdx[Math.max(0, act)]); closeResults(); }
  });
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName || '') && document.activeElement.type !== 'range';
    if (e.key === ' ' && !typing && !e.repeat) { e.preventDefault(); setGalaxy(!st.galaxy); }
    else if ((e.key === 'h' || e.key === 'H') && !typing && !e.metaKey && !e.ctrlKey) app.classList.toggle('clean');
    else if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
    else if (e.key === 'Escape' && document.activeElement !== q) { if (st.sel >= 0) closeNote(); }
  });

  // ---------------- labels ----------------
  const labBox = $('#labels'); let labs = [];
  labBox.style.display = 'none';
  function buildLabels() {
    labBox.textContent = '';
    labs = eng.groups().map((g) => {
      const e = el('div', 'lb', '<i></i><b>' + esc(g.name) + '</b><span>' + g.count + '</span>');
      e.style.setProperty('--c', g.color || 'var(--glow)'); labBox.appendChild(e); return { g, e, w: 0 };
    });
    labs.forEach((l) => { l.w = l.e.offsetWidth || (l.g.name.length * 6 + 30); });
    // names for the best-linked stars of each galaxy
    stars = [];
    const gs = eng.groups(), per = gs.length > 14 ? 1 : 2;
    gs.forEach((g) => (g.top || []).slice(0, per).forEach((n) => {
      const e = el('div', 'sl'); e.textContent = notes[n].t.length > 34 ? notes[n].t.slice(0, 33) + '…' : notes[n].t;
      labBox.appendChild(e); stars.push({ n, e, w: 0 });
    }));
  }
  let stars = [];
  buildLabels();
  eng.on('frame', (S) => {
    if (!st.labels) return;
    if (labs.length && !labs[0].w) labs.forEach((l) => { l.w = l.e.offsetWidth; });
    labBox.style.setProperty('--glow', st.color);
    const gxe = eng.galaxyEase(); labBox.classList.toggle('gx', gxe > 0.5);
    const bc = eng.project(eng.anatomy.brainCentre), f = Math.min(1, Math.max(0, (S.form - 0.15) / 0.7)), e = f * f * (3 - 2 * f);
    const placed = [], items = [];
    for (const l of labs) {
      const p = eng.groupScreen(l.g); if (p.w <= 0) { l.e.style.opacity = 0; continue; }
      let x = p.x, y = p.y;
      const dx = x - bc.x, dy = y - bc.y, d = Math.hypot(dx, dy) || 1, push = (1 - e) * (1 - gxe) * (34 + 0.55 * d);   // anatomy: fan the labels out of the brain
      x += dx / d * push; y += dy / d * push;
      items.push({ l, x, y, w: p.w });
    }
    items.sort((a, b) => a.w - b.w || b.l.g.count - a.l.g.count);
    const near = items.length ? items[0].w : 1, far = items.length ? items[items.length - 1].w : 1;
    for (const it of items) {
      const r = { x0: it.x + 6, y0: it.y - 8, x1: it.x + 10 + it.l.w, y1: it.y + 8 };
      let hit = false; for (const o of placed) if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) { hit = true; break; }
      if (hit) { it.l.e.style.opacity = 0; continue; }
      placed.push(r);
      const depth = far > near ? (it.w - near) / (far - near) : 0;
      it.l.e.style.opacity = (1 - 0.6 * depth).toFixed(2);
      it.l.e.style.transform = 'translate(' + (it.x + 8 - gxe * (8 + it.l.w / 2)).toFixed(1) + 'px,' + (it.y - 6 - gxe * 8).toFixed(1) + 'px)';
    }
    for (const s of stars) {
      if (gxe < 0.6) { s.e.style.opacity = 0; continue; }
      if (!s.w) s.w = s.e.offsetWidth;
      const p = eng.starScreen(s.n); if (p.w <= 0) { s.e.style.opacity = 0; continue; }
      const r = { x0: p.x + 8, y0: p.y - 8, x1: p.x + 14 + s.w, y1: p.y + 8 };
      let hit = false; for (const o of placed) if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) { hit = true; break; }
      if (hit) { s.e.style.opacity = 0; continue; }
      placed.push(r);
      s.e.style.opacity = ((gxe - 0.6) / 0.4 * 0.85).toFixed(2);
      s.e.style.transform = 'translate(' + (p.x + 11).toFixed(1) + 'px,' + (p.y - 7).toFixed(1) + 'px)';
    }
  });

  // ---------------- boot ----------------
  renderAreas(); renderLegend(); renderSwatches();
  if (small()) { $('#areas').classList.add('folded'); setView(false); }
  if (params.has('capture')) window.__brain = { eng, st, openNote, closeNote, setColor, setView, setGalaxy, applyFilter, renderAreas };
})();
