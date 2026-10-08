/* Blalien Projections — editor UI, stage interaction, output mode */
'use strict';
(function () {
  const BP = window.BP;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const IS_OUTPUT = params.has('output') || location.hash === '#output';
  const r3 = (n) => Math.round(n * 1000) / 1000;

  let state = null, R = null, ov = null, octx = null;
  const ui = {
    sel: null, slot: 'a', tool: 'select', tab: 'shape',
    brush: { c: '#ffffff', w: 0.012, g: true },
    drag: null, present: IS_OUTPUT, activeCorner: null,
    outputs: {}, remoteSel: null, genThumbs: {}, taps: [], rec: null, midi: false,
  };
  const undoStack = [], redoStack = [];
  let bound = [], staticBound = [];
  let lastSurfaces = null, seenSwitch = 0, fade = null;

  // ------------------------------------------------------------ helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  let toastT = 0;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }
  const sel = () => (state ? state.surfaces.find((s) => s.id === ui.sel) || null : null);
  function setSel(id) {
    if (ui.sel !== id) ui.activeCorner = null;
    ui.sel = id;
    BP.Sync.send('sel', { id });
    scheduleUI();
  }
  function commit() {
    state.rev = (state.rev || 0) + 1;
    BP.Sync.sendState(state);
    scheduleUI();
  }
  function pushUndo() {
    const j = JSON.stringify(state);
    if (undoStack[undoStack.length - 1] === j) return;
    undoStack.push(j);
    if (undoStack.length > 80) undoStack.shift();
    redoStack.length = 0;
  }
  function restore(json) {
    const media = state.media;
    state = BP.normalize(JSON.parse(json));
    state.media = media;
    if (!sel()) ui.sel = null;
    commit();
  }
  function undo() { if (undoStack.length) { redoStack.push(JSON.stringify(state)); restore(undoStack.pop()); } }
  function redo() { if (redoStack.length) { undoStack.push(JSON.stringify(state)); restore(redoStack.pop()); } }

  let uiQueued = false;
  function scheduleUI() {
    if (uiQueued || IS_OUTPUT) return;
    uiQueued = true;
    requestAnimationFrame(() => { uiQueued = false; refreshUI(); });
  }

  // ------------------------------------------------------------ bindings
  function resolve(path) {
    let parts = path.split('.'), obj;
    if (parts[0] === 'S') { obj = state.settings; parts = parts.slice(1); }
    else if (parts[0] === 'U') { obj = ui; parts = parts.slice(1); }
    else {
      const s = sel(); if (!s) return null;
      obj = s;
      if (parts[0] === 'C') { obj = s[ui.slot]; parts = parts.slice(1); }
    }
    for (let i = 0; i < parts.length - 1; i++) { obj = obj[parts[i]]; if (obj == null) return null; }
    return [obj, parts[parts.length - 1]];
  }
  function defaultFor(path) {
    const parts = path.split('.'), k = parts[parts.length - 1];
    const src = { S: BP.defSettings(), C: BP.defContent(), fx: BP.defFx(), mask: BP.defMask() }[parts[0]];
    return src ? src[k] : undefined;
  }
  function fmt(v, o) {
    if (o && o.fmt) return o.fmt(v);
    if (typeof v !== 'number') return '';
    return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
  }
  function bindEl(el, path, kind, o = {}) {
    const rec = { el, path, kind, o, out: null };
    const ev = kind === 'check' || kind === 'select' ? 'change' : 'input';
    el.addEventListener(ev, () => {
      const r = resolve(path); if (!r) return;
      let v;
      if (kind === 'check') v = el.checked;
      else if (kind === 'range' || kind === 'number') { v = parseFloat(el.value); if (isNaN(v)) return; }
      else v = el.value;
      if (o.map) v = o.map(v);
      if (!path.startsWith('U.')) pushUndoOnce();
      r[0][r[1]] = v;
      if (rec.out) rec.out.textContent = fmt(v, o);
      if (o.after) o.after(v);
      if (!path.startsWith('U.')) commit(); else scheduleUI();
    });
    if (kind === 'range') {
      el.addEventListener('dblclick', () => {
        const d = defaultFor(path); if (d === undefined) return;
        pushUndo();
        const r = resolve(path); r[0][r[1]] = d;
        syncValues(true); commit();
      });
    }
    return rec;
  }
  // one undo snapshot per continuous gesture
  let undoGesture = false;
  function pushUndoOnce() { if (!undoGesture) { pushUndo(); undoGesture = true; } }
  document.addEventListener('pointerup', () => { undoGesture = false; }, true);
  document.addEventListener('focusin', () => { undoGesture = false; }, true);

  function syncValues(force) {
    for (const rec of bound.concat(staticBound)) {
      if (!force && rec.el === document.activeElement && rec.kind !== 'check' && rec.kind !== 'select') continue;
      const r = resolve(rec.path); if (!r) continue;
      const v = r[0][r[1]];
      if (rec.kind === 'check') rec.el.checked = !!v;
      else if (v != null && String(rec.el.value) !== String(v)) rec.el.value = v;
      if (rec.out) rec.out.textContent = fmt(v, rec.o);
    }
  }

  const row = (label, ...c) => h('div', { class: 'row' }, h('label', {}, label), ...c);
  function Slider(label, path, min, max, step, o = {}) {
    const el = h('input', { type: 'range', min, max, step, title: 'Double-click to reset' });
    const rec = bindEl(el, path, 'range', o);
    rec.out = h('output');
    bound.push(rec);
    return row(label, el, rec.out);
  }
  function Check(label, path, o = {}) {
    const el = h('input', { type: 'checkbox' });
    bound.push(bindEl(el, path, 'check', o));
    return h('label', { class: 'check' }, el, h('span', {}, label));
  }
  function Color(label, path, o = {}) {
    const el = h('input', { type: 'color' });
    bound.push(bindEl(el, path, 'color', o));
    return row(label, el);
  }
  function Select(label, path, options, o = {}) {
    const el = h('select', {}, options.map(([v, t]) => h('option', { value: v }, t)));
    bound.push(bindEl(el, path, 'select', o));
    return row(label, el);
  }
  function TextIn(label, path, o = {}) {
    const el = o.multi ? h('textarea', { rows: o.rows || 3, spellcheck: 'false' }) : h('input', { type: 'text' });
    bound.push(bindEl(el, path, 'text', o));
    return label ? row(label, el) : el;
  }
  const btn = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, onclick: fn }, label);
  const sec = (title, ...kids) => h('section', { class: 'sec' }, title ? h('h4', {}, title) : null, ...kids);
  const note = (t) => h('p', { class: 'note' }, t);

  // ------------------------------------------------------------ surface ops
  function addShape(type) {
    pushUndo();
    const list = BP.makeShape(type, state.settings.aspect, state.surfaces.length);
    if (type === 'image') {
      const img = state.media.find((m) => m.kind === 'image');
      if (img) list[0].mask.image = img.id;
      else toast('Upload an image (PNG with transparency works best), then pick it under Shape.');
    }
    state.surfaces.push(...list);
    setSel(list[list.length - 1].id);
    if (type === 'path') { setTool('mask'); toast('Trace the outline of your object on the stage.'); }
    ui.tab = 'shape';
    commit();
  }
  function centroid(s) { return [s.pts.reduce((a, p) => a + p[0], 0) / 4, s.pts.reduce((a, p) => a + p[1], 0) / 4]; }
  function transform(s, fn) {
    pushUndo();
    const c = centroid(s), A = state.settings.aspect;
    s.pts = s.pts.map(([x, y]) => { const [dx, dy] = fn((x - c[0]) * A, y - c[1]); return [c[0] + dx / A, c[1] + dy]; });
    commit();
  }
  function moveLayer(s, dir) {
    const i = state.surfaces.indexOf(s), j = i + dir;
    if (j < 0 || j >= state.surfaces.length) return;
    pushUndo();
    state.surfaces.splice(i, 1); state.surfaces.splice(j, 0, s);
    commit();
  }
  function duplicate(s) {
    pushUndo();
    const n = BP.clone(s);
    n.id = BP.uid(); n.name = s.name + ' copy';
    n.pts = n.pts.map(([x, y]) => [x + 0.03, y + 0.03]);
    state.surfaces.splice(state.surfaces.indexOf(s) + 1, 0, n);
    setSel(n.id); commit();
  }
  function removeSurface(s) {
    if (!s) return;
    pushUndo();
    state.surfaces = state.surfaces.filter((x) => x !== s);
    setSel(null); commit();
  }

  // ------------------------------------------------------------ scenes
  function sceneData() {
    const data = {};
    state.surfaces.forEach((s) => { data[s.id] = BP.clone({ a: s.a, b: s.b, mix: s.mix, followX: s.followX, fx: s.fx, visible: s.visible }); });
    return data;
  }
  function saveScene() {
    pushUndo();
    const sc = { id: BP.uid(), name: 'Scene ' + (state.scenes.length + 1), data: sceneData() };
    state.scenes.push(sc); state.activeScene = sc.id;
    toast(`Saved "${sc.name}". Press ${state.scenes.length <= 9 ? state.scenes.length : ''} to recall.`);
    commit();
  }
  function recallScene(sc) {
    if (!sc) return;
    state.surfaces = state.surfaces.map((s) => {
      const n = BP.clone(s), d = sc.data && sc.data[s.id];
      if (d) {
        Object.assign(n, BP.clone(d));
        n.a = BP.defContent(n.a); n.b = BP.defContent(n.b); n.fx = Object.assign(BP.defFx(), n.fx);
      }
      return n;
    });
    state.activeScene = sc.id;
    state.sceneSwitch = { n: (state.sceneSwitch.n || 0) + 1 };
    commit();
  }

  // ------------------------------------------------------------ media
  async function uploadFiles(files) {
    files = [...files].filter((f) => /^(image|video)\//.test(f.type) || /\.(mp4|webm|mov|m4v|png|jpe?g|gif|webp|svg)$/i.test(f.name));
    if (!files.length) return;
    let last = null;
    for (const f of files) {
      toast(`Uploading ${f.name}…`, 60000);
      try {
        const m = await BP.Media.upload(f);
        state.media.push(m); last = m;
        commit();
      } catch (e) { toast('Upload failed: ' + e.message); return; }
    }
    toast(files.length > 1 ? `Added ${files.length} files` : `Added ${files[0].name}`);
    const s = sel();
    if (last && files.length === 1) assignMedia(last, s);
  }
  function assignMedia(m, s) {
    pushUndo();
    if (!s) {
      const ns = BP.makeShape('rect', state.settings.aspect, state.surfaces.length)[0];
      ns.name = m.name.replace(/\.[^.]+$/, '').slice(0, 24);
      state.surfaces.push(ns); s = ns; ui.sel = ns.id;
    }
    const c = s[ui.slot];
    c.type = 'media'; c.media = m.id;
    ui.tab = 'content';
    commit();
  }
  async function removeMedia(m) {
    if (!confirm(`Delete "${m.name}" from the library?`)) return;
    state.media = state.media.filter((x) => x.id !== m.id);
    await BP.Media.remove(m);
    R.forgetMedia(m.id);
    commit();
  }
  function mediaThumb(m, onclick, active) {
    const el = h('div', { class: 'media-tile' + (active ? ' active' : ''), title: m.name, onclick });
    BP.Media.url(m).then((url) => {
      if (!url) { el.append(h('span', { class: 'missing' }, 'missing')); return; }
      if (m.kind === 'video') el.prepend(h('video', { src: url + '#t=0.5', muted: true, preload: 'metadata', playsinline: true }));
      else el.prepend(h('img', { src: url, alt: '' }));
    });
    el.append(h('span', { class: 'kind' }, m.kind === 'video' ? '▶' : ''));
    return el;
  }

  // ------------------------------------------------------------ left panel
  const SHAPES = [['rect', 'Quad'], ['circle', 'Circle'], ['triangle', 'Triangle'], ['polygon', 'Hexagon'], ['star', 'Star'], ['heart', 'Heart'],
    ['text', 'Text'], ['box', 'Box'], ['image', 'Silhouette'], ['path', 'Freehand'], ['full', 'Full screen']];
  function shapeIcon(type) {
    const c = document.createElement('canvas'); c.width = c.height = 48;
    const x = c.getContext('2d');
    x.fillStyle = '#e9e7ff'; x.strokeStyle = '#e9e7ff'; x.lineWidth = 2.5; x.lineJoin = 'round';
    if (type === 'box') {
      const P = [[24, 6], [40, 15], [40, 33], [24, 42], [8, 33], [8, 15]];
      x.beginPath(); P.forEach((p, i) => x[i ? 'lineTo' : 'moveTo'](...p)); x.closePath(); x.stroke();
      x.beginPath(); x.moveTo(8, 15); x.lineTo(24, 24); x.lineTo(40, 15); x.moveTo(24, 24); x.lineTo(24, 42); x.stroke();
    } else if (type === 'text') {
      x.font = 'bold 26px Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Aa', 24, 26);
    } else if (type === 'image') {
      x.beginPath(); x.arc(24, 15, 7, 0, 7); x.fill();
      x.beginPath(); x.moveTo(10, 42); x.quadraticCurveTo(24, 16, 38, 42); x.fill();
    } else if (type === 'path') {
      x.beginPath(); x.moveTo(8, 30); x.bezierCurveTo(10, 6, 30, 8, 26, 22); x.bezierCurveTo(22, 36, 42, 40, 40, 16); x.stroke();
    } else if (type === 'full') {
      x.strokeRect(5, 11, 38, 26); x.fillRect(10, 16, 28, 16);
    } else {
      BP.paint.shapePath(x, { shape: type, sides: 6, radius: 0 }, 9, 9, 30, 30); x.fill();
    }
    return c.toDataURL();
  }
  function buildShapeGrid() {
    const g = $('#shapeGrid');
    SHAPES.forEach(([t, name]) => g.append(h('button', { class: 'shape-btn', title: 'Add ' + name, onclick: () => addShape(t) },
      h('img', { src: shapeIcon(t), alt: '' }), h('span', {}, name))));
  }

  let listKey = '';
  function renderSurfList() {
    const key = state.surfaces.map((s) => [s.id, s.name, s.visible, s.locked].join(':')).join('|') + ui.sel;
    if (key === listKey) return;
    listKey = key;
    const box = $('#surfList');
    box.innerHTML = '';
    $('#surfCount').textContent = state.surfaces.length || '';
    if (!state.surfaces.length) box.append(note('No surfaces yet. Add a shape above, then drag its corners onto your object.'));
    [...state.surfaces].reverse().forEach((s) => {
      box.append(h('div', { class: 'surf' + (s.id === ui.sel ? ' active' : '') + (s.visible ? '' : ' hidden'), onclick: () => { setSel(s.id); } },
        h('button', { class: 'ico', title: s.visible ? 'Hide' : 'Show', onclick: (e) => { e.stopPropagation(); pushUndo(); s.visible = !s.visible; commit(); } }, s.visible ? '◉' : '○'),
        h('span', { class: 'name' }, s.name),
        h('button', { class: 'ico', title: s.locked ? 'Unlock' : 'Lock', onclick: (e) => { e.stopPropagation(); pushUndo(); s.locked = !s.locked; commit(); } }, s.locked ? '🔒' : '·')));
    });
  }

  let mediaKey = '';
  function renderMedia() {
    const key = state.media.map((m) => m.id).join(',');
    if (key === mediaKey) return;
    mediaKey = key;
    const g = $('#mediaGrid');
    g.innerHTML = '';
    if (!state.media.length) g.append(note(BP.Sync.mode === 'server'
      ? 'Upload photos or videos. They are stored on the host computer and every device sees them.'
      : 'Upload photos or videos. Standalone mode keeps them in this browser only.'));
    state.media.forEach((m) => {
      const t = mediaThumb(m, () => assignMedia(m, sel()));
      t.append(h('button', { class: 'del', title: 'Delete', onclick: (e) => { e.stopPropagation(); removeMedia(m); } }, '×'));
      g.append(t);
    });
  }

  // ------------------------------------------------------------ inspector
  let inspKey = '';
  function inspectorKey() {
    const s = sel();
    if (!s) return 'none|' + ui.tab;
    return [s.id, ui.tab, ui.slot, s[ui.slot].type, s.mask.shape, state.media.map((m) => m.id).join(','), s.followX, s.visible, s.locked, ui.tool].join('|');
  }
  function renderInspector(force) {
    $$('#right .tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    const key = inspectorKey();
    if (!force && key === inspKey) { syncValues(); updateDynamic(); return; }
    inspKey = key;
    bound = [];
    const box = $('#inspector');
    const scroll = box.scrollTop;
    box.innerHTML = '';
    const s = sel();
    if (!s) {
      box.append(h('div', { class: 'empty' },
        h('div', { class: 'big' }, '◇'),
        h('p', {}, 'Select a surface on the stage, or add a shape from the left.'),
        h('p', { class: 'note' }, 'Tip: drag corners onto your real object while watching the projector. Press H to present on this screen.')));
    } else {
      box.append(ui.tab === 'shape' ? shapeTab(s) : ui.tab === 'content' ? contentTab(s) : fxTab(s));
      box.scrollTop = scroll;
    }
    syncValues(true);
    updateDynamic();
  }
  function updateDynamic() {
    const s = sel(); if (!s) return;
    const c = s[ui.slot];
    $$('[data-gen]').forEach((b) => b.classList.toggle('active', c.type === 'gen' && b.dataset.gen === c.gen));
    $$('[data-mid]').forEach((b) => b.classList.toggle('active', b.dataset.mid === (b.dataset.for === 'mask' ? s.mask.image : c.media)));
    const cam = $('#camStatus');
    if (cam) cam.textContent = R.cam ? (R.cam.error ? 'Camera error: ' + R.cam.error : R.cam.ready ? `Live ${R.cam.w}×${R.cam.h}` : 'Starting camera…') : '';
  }

  function shapeTab(s) {
    const m = s.mask;
    const shapeBtns = h('div', { class: 'chips' }, BP.MASKS.map(([k, name]) =>
      h('button', { class: 'chip' + (m.shape === k ? ' active' : ''), onclick: () => {
        pushUndo(); m.shape = k;
        if (k === 'image' && !m.image) { const img = state.media.find((x) => x.kind === 'image'); if (img) m.image = img.id; }
        if (k === 'path') { setTool('mask'); toast('Trace the outline on the stage'); }
        commit();
      } }, name)));
    const params = [];
    if (m.shape === 'rect') params.push(Slider('Corner radius', 'mask.radius', 0, 1, 0.01));
    if (m.shape === 'polygon') params.push(Slider('Sides', 'mask.sides', 3, 12, 1));
    if (m.shape === 'text') params.push(TextIn('Text', 'mask.text', { multi: true, rows: 2 }), Select('Font', 'mask.font', BP.FONTS.map((f) => [f, f])));
    if (m.shape === 'image') {
      const imgs = state.media.filter((x) => x.kind === 'image');
      params.push(imgs.length ? h('div', { class: 'media-grid small' }, imgs.map((x) => {
        const t = mediaThumb(x, () => { pushUndo(); m.image = x.id; commit(); }, x.id === m.image);
        t.dataset.mid = x.id; t.dataset.for = 'mask'; return t;
      })) : note('Upload an image to use its silhouette.'));
      params.push(Check('Use transparency (PNG alpha)', 'mask.useAlpha'), Slider('Brightness threshold', 'mask.threshold', 0, 1, 0.01));
    }
    if (m.shape === 'path') params.push(h('div', { class: 'btnrow' },
      btn(ui.tool === 'mask' ? 'Tracing… (click Map to finish)' : 'Trace outline', () => setTool(ui.tool === 'mask' ? 'select' : 'mask'), ui.tool === 'mask' ? 'on' : ''),
      btn('Clear', () => { pushUndo(); m.path = []; commit(); })), note('Hold and drag around your object on the stage. Release to close the shape.'));

    return h('div', { class: 'pane' },
      sec('Surface', TextIn('Name', 'name'),
        h('div', { class: 'btnrow' },
          btn(s.visible ? 'Hide' : 'Show', () => { pushUndo(); s.visible = !s.visible; commit(); }),
          btn(s.locked ? 'Unlock' : 'Lock', () => { pushUndo(); s.locked = !s.locked; commit(); }),
          btn('Duplicate', () => duplicate(s)),
          btn('Delete', () => removeSurface(s), 'danger'))),
      sec('Mask shape', shapeBtns, ...params, Check('Invert (cut a hole)', 'mask.invert'), Slider('Feather edges', 'mask.feather', 0, 1, 0.01)),
      sec('Mapping',
        h('div', { class: 'btngrid' },
          btn('Fit screen', () => { pushUndo(); s.pts = [[0, 0], [1, 0], [1, 1], [0, 1]]; s.bend = [[0, 0], [0, 0], [0, 0], [0, 0]]; commit(); }),
          btn('Center', () => { pushUndo(); const c = centroid(s); s.pts = s.pts.map(([x, y]) => [x - c[0] + 0.5, y - c[1] + 0.5]); commit(); }),
          btn('Make square', () => { pushUndo(); const c = centroid(s), w = 0.25; s.pts = BP.rectPts(c[0], c[1], w, w * state.settings.aspect); commit(); }),
          btn('Bigger', () => transform(s, (x, y) => [x * 1.1, y * 1.1])),
          btn('Smaller', () => transform(s, (x, y) => [x / 1.1, y / 1.1])),
          btn('Rotate 90°', () => transform(s, (x, y) => [-y, x])),
          btn('Flip H', () => transform(s, (x, y) => [-x, y])),
          btn('Flip V', () => transform(s, (x, y) => [x, -y])),
          btn('Straighten', () => { pushUndo(); s.bend = [[0, 0], [0, 0], [0, 0], [0, 0]]; commit(); })),
        note('Drag the round corners to warp. Drag the diamonds to bend an edge around curves. Shift = fine control, Alt = unlink shared corners, arrow keys nudge.')),
      sec('Layer',
        Slider('Opacity', 'fx.opacity', 0, 1, 0.01),
        Select('Blend', 'fx.blend', [['normal', 'Normal'], ['add', 'Add (light)'], ['screen', 'Screen'], ['multiply', 'Multiply']]),
        h('div', { class: 'btnrow' }, btn('Bring forward', () => moveLayer(s, 1)), btn('Send back', () => moveLayer(s, -1)))));
  }

  const TYPES = [['gen', 'Visuals'], ['media', 'Media'], ['color', 'Color'], ['draw', 'Draw'], ['text', 'Text'], ['camera', 'Camera'], ['custom', 'Shader'], ['black', 'Black-out'], ['none', 'Empty']];
  function contentTab(s) {
    const c = s[ui.slot];
    const slotSeg = h('div', { class: 'seg wide' },
      ['a', 'b'].map((k) => h('button', { class: ui.slot === k ? 'active' : '', onclick: () => { ui.slot = k; renderInspector(true); } }, 'Channel ' + k.toUpperCase())));
    const typeGrid = h('div', { class: 'chips' }, TYPES.map(([k, name]) =>
      h('button', { class: 'chip' + (c.type === k ? ' active' : ''), onclick: () => {
        pushUndo(); c.type = k;
        if (k === 'media' && !c.media && state.media[0]) c.media = state.media[0].id;
        if (k === 'draw') setTool('draw');
        commit();
      } }, name)));

    const body = [];
    if (c.type === 'gen') {
      body.push(h('div', { class: 'gen-grid' }, BP.GENS.map(([g, name]) =>
        h('button', { class: 'gen-tile', 'data-gen': g, title: name, onclick: () => { pushUndo(); c.gen = g; commit(); } },
          ui.genThumbs[g] ? h('img', { src: ui.genThumbs[g], alt: '' }) : h('i'), h('span', {}, name)))));
      body.push(h('div', { class: 'two' }, Color('Color 1', 'C.c1'), Color('Color 2', 'C.c2')),
        Slider('Speed', 'C.speed', -3, 3, 0.01), Slider('Scale', 'C.scale', 0.2, 4, 0.01));
      if (c.gen === 'spectrum' || c.gen === 'bars') body.push(note('Turn on Audio (bottom bar) to drive this from the microphone. It animates on its own until then.'));
    } else if (c.type === 'color') {
      body.push(Color('Color', 'C.c1'));
    } else if (c.type === 'media') {
      body.push(state.media.length ? h('div', { class: 'media-grid' }, state.media.map((m) => {
        const t = mediaThumb(m, () => { pushUndo(); c.media = m.id; commit(); }, m.id === c.media);
        t.dataset.mid = m.id; return t;
      })) : note('No media yet.'));
      body.push(h('label', { class: 'btn' }, '+ Upload image / video', h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', hidden: true, onchange: (e) => uploadFiles(e.target.files) })));
      body.push(Select('Fit', 'C.fit', [['cover', 'Fill (crop)'], ['contain', 'Fit (letterbox)'], ['stretch', 'Stretch']]));
    } else if (c.type === 'camera') {
      body.push(Select('Fit', 'C.fit', [['cover', 'Fill (crop)'], ['contain', 'Fit (letterbox)'], ['stretch', 'Stretch']]),
        h('p', { class: 'note', id: 'camStatus' }),
        note('The camera opens on each screen that renders it (the projector computer). Browsers only allow cameras on localhost or https.'));
    } else if (c.type === 'draw') {
      const bc = h('input', { type: 'color', value: ui.brush.c, oninput: (e) => { ui.brush.c = e.target.value; } });
      const bw = h('input', { type: 'range', min: 0.002, max: 0.08, step: 0.001, value: ui.brush.w, oninput: (e) => { ui.brush.w = +e.target.value; } });
      const bg = h('input', { type: 'checkbox', checked: ui.brush.g, onchange: (e) => { ui.brush.g = e.target.checked; } });
      body.push(
        h('div', { class: 'btnrow' },
          btn(ui.tool === 'draw' ? 'Drawing… (click to stop)' : 'Draw on surface', () => setTool(ui.tool === 'draw' ? 'select' : 'draw'), ui.tool === 'draw' ? 'on' : 'accent'),
          btn('Undo stroke', () => { pushUndo(); c.strokes.pop(); commit(); }),
          btn('Clear', () => { pushUndo(); c.strokes = []; commit(); })),
        row('Brush color', bc), row('Brush size', bw), h('label', { class: 'check' }, bg, h('span', {}, 'Neon glow')),
        h('div', { class: 'swatches' }, ['#ffffff', '#ff2bd6', '#00e5ff', '#7a5cff', '#39ff14', '#ffe600', '#ff6a00', '#ff1744'].map((col) =>
          h('button', { style: `background:${col}`, onclick: () => { ui.brush.c = col; bc.value = col; } }))),
        Check('Animate drawing (draws itself on a loop)', 'C.drawAnim'),
        Slider('Loop length (s)', 'C.drawDur', 0.5, 20, 0.1));
    } else if (c.type === 'text') {
      body.push(TextIn('Text', 'C.text', { multi: true, rows: 3 }),
        Select('Font', 'C.font', BP.FONTS.map((f) => [f, f])),
        h('div', { class: 'two' }, Color('Text', 'C.textColor'), Color('Background', 'C.bgColor')),
        note('To scroll text, use Effects → Slide X.'));
    } else if (c.type === 'custom') {
      const ta = h('textarea', { class: 'code', rows: 14, spellcheck: 'false' });
      ta.value = c.code;
      const err = h('pre', { class: 'err' });
      const apply = () => {
        const e = R.testShader(ta.value);
        if (e) { err.textContent = e; err.hidden = false; return; }
        err.hidden = true; pushUndo(); c.code = ta.value; commit(); toast('Shader applied');
      };
      ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); apply(); } e.stopPropagation(); });
      err.hidden = true;
      body.push(ta, h('div', { class: 'btnrow' }, btn('Apply  (Ctrl+Enter)', apply, 'accent'), btn('Reset example', () => { ta.value = BP.DEFAULT_CODE; apply(); })), err,
        Slider('Speed', 'C.speed', -3, 3, 0.01));
    } else if (c.type === 'black') {
      body.push(note('Projects pure black. Put it on top of other surfaces to stop light spilling onto things (windows, faces, a TV).'));
    } else {
      body.push(note('This channel is empty (transparent).'));
    }

    return h('div', { class: 'pane' },
      sec('Channels', slotSeg,
        Check('Follow the A/B crossfader in the bottom bar', 'followX'),
        s.followX ? null : Slider('A ⟷ B mix', 'mix', 0, 1, 0.01),
        h('div', { class: 'btnrow' },
          btn('Swap A/B', () => { pushUndo(); [s.a, s.b] = [s.b, s.a]; commit(); }),
          btn(`Copy ${ui.slot.toUpperCase()} → ${ui.slot === 'a' ? 'B' : 'A'}`, () => { pushUndo(); s[ui.slot === 'a' ? 'b' : 'a'] = BP.clone(c); commit(); }))),
      sec('Source', typeGrid, ...body));
  }

  function fxTab(s) {
    const deg = { fmt: (v) => Math.round(v) + '°' };
    return h('div', { class: 'pane' },
      sec('Motion',
        Slider('Zoom', 'fx.zoom', 0.1, 5, 0.01),
        Slider('Rotate', 'fx.rotate', -180, 180, 1, deg),
        Slider('Spin', 'fx.rotSpeed', -3, 3, 0.01),
        Slider('Slide X', 'fx.slideX', -1, 1, 0.01),
        Slider('Slide Y', 'fx.slideY', -1, 1, 0.01),
        Slider('Tile', 'fx.tile', 1, 10, 1),
        Slider('Kaleidoscope', 'fx.kaleido', 0, 16, 1, { fmt: (v) => (v < 2 ? 'off' : v) }),
        h('div', { class: 'two' }, Check('Mirror X', 'fx.flipX'), Check('Mirror Y', 'fx.flipY'))),
      sec('Color',
        Slider('Hue', 'fx.hue', 0, 1, 0.01),
        Slider('Color cycle', 'fx.hueSpeed', -1, 1, 0.01),
        Slider('Saturation', 'fx.sat', 0, 3, 0.01),
        Slider('Contrast', 'fx.contrast', 0, 3, 0.01),
        Slider('Brightness', 'fx.bright', 0, 3, 0.01),
        Slider('Blur', 'fx.blur', 0, 1, 0.01),
        h('div', { class: 'two' }, Check('Monochrome', 'fx.mono'), Check('Invert', 'fx.invert'))),
      sec('Rhythm (BPM)',
        Slider('Beat pulse', 'fx.pulse', 0, 1, 0.01),
        Slider('Strobe', 'fx.strobe', 0, 8, 0.5, { fmt: (v) => (v ? v + '/beat' : 'off') })),
      sec('Audio reactive',
        Slider('Amount', 'fx.audio', 0, 1, 0.01),
        h('div', { class: 'two' },
          Select('Listen to', 'fx.audioBand', [['level', 'Everything'], ['bass', 'Bass'], ['mid', 'Mids'], ['high', 'Highs']]),
          Select('Drives', 'fx.audioTarget', [['bright', 'Brightness'], ['opacity', 'Opacity'], ['zoom', 'Zoom'], ['hue', 'Hue'], ['rotate', 'Rotation']])),
        state.settings.audio ? null : note('Turn on Audio in the bottom bar.')),
      sec('Neon outline',
        Slider('Glow', 'fx.glow', 0, 1, 0.01),
        Slider('Width', 'fx.glowWidth', 0.002, 0.1, 0.001),
        Color('Glow color', 'fx.glowColor')),
      h('div', { class: 'btnrow' },
        btn('Randomize', () => randomFx(s), 'accent'),
        btn('Reset effects', () => { pushUndo(); const keep = { opacity: s.fx.opacity, blend: s.fx.blend }; s.fx = Object.assign(BP.defFx(), keep); commit(); })));
  }
  function randomFx(s) {
    pushUndo();
    const r = Math.random, pick = (a) => a[Math.floor(r() * a.length)];
    const fx = s.fx;
    fx.kaleido = r() < 0.4 ? pick([4, 6, 8, 12]) : 0;
    fx.hueSpeed = r() < 0.5 ? (r() - 0.5) * 0.4 : 0;
    fx.rotSpeed = r() < 0.4 ? (r() - 0.5) * 1 : 0;
    fx.zoom = r() < 0.5 ? 0.6 + r() * 1.6 : 1;
    fx.tile = r() < 0.25 ? pick([2, 3, 4]) : 1;
    fx.slideX = r() < 0.3 ? (r() - 0.5) * 0.4 : 0;
    fx.pulse = r() < 0.3 ? 0.5 : 0;
    fx.glow = r() < 0.35 ? 0.8 : 0;
    fx.glowColor = pick(['#ffffff', '#ff2bd6', '#00e5ff', '#39ff14']);
    const c = s[ui.slot];
    if (c.type === 'gen') {
      c.gen = pick(BP.GENS)[0];
      const hue = r();
      const hx = (hh) => { const f = (n) => { const k = (n + hh * 12) % 12; return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join(''); };
      c.c1 = hx(hue); c.c2 = hx((hue + 0.35 + r() * 0.3) % 1);
    }
    commit();
  }

  // ------------------------------------------------------------ footer / header
  let scenesKey = '';
  function renderScenes() {
    const key = state.scenes.map((s) => s.id + s.name).join('|') + state.activeScene;
    if (key === scenesKey) return;
    scenesKey = key;
    const box = $('#sceneList');
    box.innerHTML = '';
    state.scenes.forEach((sc, i) => {
      const active = sc.id === state.activeScene;
      box.append(h('div', { class: 'scene' + (active ? ' active' : '') },
        h('button', {
          class: 'scene-btn', title: 'Click: go · Shift-click: update with current look · Double-click: rename',
          onclick: (e) => {
            if (e.shiftKey) { pushUndo(); sc.data = sceneData(); toast(`Updated "${sc.name}"`); commit(); }
            else recallScene(sc);
          },
          ondblclick: () => { const n = prompt('Scene name', sc.name); if (n) { pushUndo(); sc.name = n; commit(); } },
        }, i < 9 ? h('kbd', {}, i + 1) : null, sc.name),
        active ? h('button', { class: 'ico', title: 'Update scene with the current look', onclick: () => { pushUndo(); sc.data = sceneData(); toast(`Updated "${sc.name}"`); commit(); } }, '⟳') : null,
        h('button', { class: 'ico', title: 'Delete scene', onclick: () => { if (confirm(`Delete "${sc.name}"?`)) { pushUndo(); state.scenes = state.scenes.filter((x) => x !== sc); commit(); } } }, '×')));
    });
  }
  function setTool(t) {
    ui.tool = t;
    $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    if (ov) ov.style.cursor = t === 'select' ? 'default' : 'crosshair';
    scheduleUI();
  }
  function refreshUI() {
    if (!state) return;
    renderSurfList();
    renderMedia();
    renderInspector();
    renderScenes();
    $$('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === ui.tool));
    $('#audioBtn').classList.toggle('on', !!state.settings.audio);
    $('#boBtn').classList.toggle('on', !!state.settings.blackout);
    $('#recBtn').classList.toggle('on', !!ui.rec);
    updateConn();
  }
  function updateConn() {
    const now = Date.now();
    const outs = Object.values(ui.outputs).filter((o) => now - o.t < 12000);
    let txt = BP.Sync.mode === 'server' ? `LAN · ${BP.Sync.peers} connected` : 'Standalone';
    if (outs.length) txt += ` · ${outs.length} output${outs.length > 1 ? 's' : ''}`;
    const el = $('#conn');
    el.textContent = txt;
    el.classList.toggle('live', BP.Sync.mode === 'server');
  }

  function bindStatic() {
    $$('[data-bind]').forEach((el) => {
      const kind = el.type === 'checkbox' ? 'check' : el.type === 'range' ? 'range' : el.type === 'number' ? 'number' : el.tagName === 'SELECT' ? 'select' : el.type === 'color' ? 'color' : 'text';
      staticBound.push(bindEl(el, el.dataset.bind, kind));
    });
  }

  function tap() {
    const now = Date.now();
    ui.taps = ui.taps.filter((t) => now - t < 2500);
    ui.taps.push(now);
    if (ui.taps.length >= 2) {
      const iv = (ui.taps[ui.taps.length - 1] - ui.taps[0]) / (ui.taps.length - 1);
      state.settings.bpm = Math.round(BP.clamp(60000 / iv, 20, 300));
    }
    state.settings.beatT0 = now;
    syncValues(true);
    commit();
  }

  function toggleRecord() {
    if (ui.rec) { ui.rec.stop(); return; }
    const canvas = $('#gl');
    if (!canvas.captureStream || !window.MediaRecorder) return toast('Recording is not supported in this browser');
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(canvas.captureStream(30), mimeType ? { mimeType, videoBitsPerSecond: 12e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      ui.rec = null; refreshUI();
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `blalien-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}` });
      document.body.append(a); a.click(); a.remove();
      toast('Recording saved');
    };
    rec.start(500);
    ui.rec = rec;
    toast('Recording… press Rec again to stop');
    refreshUI();
  }

  async function enableMidi() {
    if (!navigator.requestMIDIAccess) return toast('Web MIDI is not supported in this browser (try Chrome or Edge)');
    try {
      const acc = await navigator.requestMIDIAccess();
      const hook = () => { for (const inp of acc.inputs.values()) inp.onmidimessage = onMidi; };
      hook(); acc.onstatechange = hook;
      ui.midi = true;
      toast('MIDI on · CC1 = A/B fader · CC7 = master · notes from C2 (36) = scenes', 5000);
    } catch (e) { toast('MIDI blocked: ' + e.message); }
  }
  function onMidi(e) {
    const [st, d1, d2] = e.data, cmd = st & 0xf0;
    if (cmd === 0xb0) {
      if (d1 === 1) state.settings.xfade = d2 / 127;
      else if (d1 === 7) state.settings.master = d2 / 127;
      else return;
      syncValues(true); commit();
    } else if (cmd === 0x90 && d2 > 0) recallScene(state.scenes[d1 - 36]);
  }

  // ------------------------------------------------------------ modals
  function openModal(title, ...content) {
    const body = $('#modalBody');
    body.innerHTML = '';
    body.append(h('h2', {}, title), ...content);
    $('#modal').hidden = false;
  }
  function closeModal() { $('#modal').hidden = true; staticBound = staticBound.filter((r) => document.body.contains(r.el) && !$('#modal').contains(r.el)); }

  function loadQR() {
    if (window.QRCode) return Promise.resolve(true);
    return new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = () => res(true); s.onerror = () => res(false);
      document.head.append(s);
    });
  }
  function qrBox(url) {
    const box = h('div', { class: 'qr' });
    loadQR().then((ok) => { if (ok) new window.QRCode(box, { text: url, width: 132, height: 132, correctLevel: window.QRCode.CorrectLevel.M }); });
    return box;
  }
  function linkRow(label, url) {
    return h('div', { class: 'link-row' },
      qrBox(url),
      h('div', {}, h('b', {}, label), h('a', { href: url, target: '_blank' }, url),
        h('button', { class: 'btn small', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url); toast('Copied'); } }, 'Copy')));
  }
  function shareModal() {
    const here = location.origin + location.pathname;
    if (BP.Sync.mode === 'server') {
      const urls = (BP.Sync.info.urls || []).filter((u) => !u.includes('localhost'));
      const base = urls[0] || here;
      openModal('Connect devices',
        h('p', {}, 'Phones, tablets and laptops on the same Wi-Fi can open these. Changes sync live.'),
        linkRow('Controller (edit from your phone)', base),
        linkRow('Projector output (fullscreen this on the projector)', base + (base.endsWith('/') ? '' : '/') + '?output'),
        urls.length > 1 ? h('p', { class: 'note' }, 'Other addresses for this computer: ' + urls.slice(1).join('  ·  ')) : null,
        h('p', { class: 'note' }, 'If another device cannot connect, allow Node.js through your firewall when Windows asks, and make sure both are on the same network.'));
    } else {
      openModal('Connect devices',
        h('p', {}, 'Standalone mode: this page has no server behind it (e.g. GitHub Pages or a file opened from disk), so it syncs only between tabs and windows in this browser.'),
        linkRow('Projector output (open on the projector screen)', here + '?output'),
        h('h3', {}, 'Control from other devices'),
        h('p', {}, 'Run the included server on the projector computer:'),
        h('pre', { class: 'code-inline' }, 'node server.js'),
        h('p', { class: 'note' }, 'Or double-click start-windows.bat. It prints a link that anyone on your Wi-Fi can open, and uploads go to the host computer.'));
    }
  }
  function settingsModal() {
    const aspects = [[16 / 9, '16:9'], [16 / 10, '16:10'], [4 / 3, '4:3'], [21 / 9, '21:9'], [1, '1:1'], [9 / 16, '9:16 (portrait)']];
    const sel = h('select', {}, aspects.map(([v, t]) => h('option', { value: v }, t)), h('option', { value: 'custom' }, 'Custom…'));
    const cur = aspects.find(([v]) => Math.abs(v - state.settings.aspect) < 0.001);
    sel.value = cur ? cur[0] : 'custom';
    sel.onchange = () => {
      let v = sel.value;
      if (v === 'custom') { const r = prompt('Output resolution or ratio (e.g. 1920x1080 or 2.35)', '1920x1080'); if (!r) return; const m = r.match(/([\d.]+)\s*[x:×/]\s*([\d.]+)/); v = m ? m[1] / m[2] : parseFloat(r); }
      if (!(v > 0)) return;
      pushUndo(); state.settings.aspect = +v; commit();
    };
    const outs = Object.values(ui.outputs).filter((o) => Date.now() - o.t < 12000);
    const add = (el, path) => { staticBound.push(bindEl(el, path, el.type === 'checkbox' ? 'check' : el.type === 'range' ? 'range' : 'color')); return el; };
    openModal('Settings',
      row('Output shape', sel),
      outs.length ? h('div', { class: 'btnrow' }, outs.map((o) => btn(`Match output ${o.w}×${o.h}`, () => { pushUndo(); state.settings.aspect = o.w / o.h; commit(); closeModal(); }))) : h('p', { class: 'note' }, 'Open the output on the projector and its resolution appears here.'),
      h('label', { class: 'check' }, add(h('input', { type: 'checkbox' }), 'S.showOnOutput'), h('span', {}, 'Show outlines & handles on the projector while mapping (P)')),
      h('label', { class: 'check' }, add(h('input', { type: 'checkbox' }), 'S.testPattern'), h('span', {}, 'Show test grid on the projector (T)')),
      row('Scene fade (s)', add(h('input', { type: 'range', min: 0, max: 5, step: 0.1 }), 'S.fade')),
      row('Audio sensitivity', add(h('input', { type: 'range', min: 0.2, max: 6, step: 0.1 }), 'S.audioGain')),
      row('Background', add(h('input', { type: 'color' }), 'S.bg')),
      h('div', { class: 'btnrow' }, btn(ui.midi ? 'MIDI enabled' : 'Enable MIDI controller', enableMidi)));
    syncValues(true);
  }
  function helpModal() {
    const keys = [['V / D / M', 'Map, draw and outline tools'], ['H', 'Present on this screen (hide the UI)'], ['F', 'Fullscreen'], ['P', 'Show outlines on the projector'], ['T', 'Test grid'],
      ['B', 'Blackout'], ['1 – 9', 'Go to a scene'], ['Space', 'Tap tempo'], ['Tab', 'Next surface'], ['Arrows', 'Nudge a corner or the whole surface (Shift = 10×)'],
      ['Ctrl+D', 'Duplicate'], ['Delete', 'Delete surface'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Esc', 'Leave present mode or deselect']];
    openModal('How it works',
      h('ol', { class: 'steps' },
        h('li', {}, 'Connect the projector as a second screen. Click ', h('b', {}, 'Output ↗'), ', drag that window onto the projector and click it to go fullscreen. You can also open the output link on any device plugged into a projector.'),
        h('li', {}, 'Add shapes and drag their corners until they sit exactly on your real objects. Turn on ', h('b', {}, 'P'), ' to see the outlines on the projector while you work.'),
        h('li', {}, 'Choose what plays on each surface under ', h('b', {}, 'Content'), ': built-in visuals, your own photos and videos, a drawing, text, the camera, or your own GLSL shader.'),
        h('li', {}, 'Add ', h('b', {}, 'Effects'), ', switch on ', h('b', {}, 'Audio'), ' so it moves with music, and save ', h('b', {}, 'Scenes'), '. Each surface has two channels (A and B), and the crossfader blends between them.')),
      h('table', { class: 'keys' }, keys.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))));
  }
  function exportShow() {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'blalien-show.json' });
    document.body.append(a); a.click(); a.remove();
    if (BP.Sync.mode !== 'server' && state.media.length) toast('Saved. Standalone media stays in this browser, so re-upload it on another machine.', 5000);
  }
  function importShow(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const st = BP.normalize(JSON.parse(fr.result));
        pushUndo();
        const known = new Set(state.media.map((m) => m.id));
        st.media = state.media.concat(st.media.filter((m) => !known.has(m.id)));
        state = st; ui.sel = null; commit(); toast('Show loaded');
      } catch (e) { toast('That file is not a valid show: ' + e.message); }
    };
    fr.readAsText(file);
  }
  function toggleMenu(force) {
    const m = $('#menu');
    m.hidden = force != null ? !force : !m.hidden;
  }

  // ------------------------------------------------------------ actions
  const ACTIONS = {
    'toggle-left': () => { document.body.classList.toggle('show-left'); document.body.classList.remove('show-right'); },
    'toggle-right': () => { document.body.classList.toggle('show-right'); document.body.classList.remove('show-left'); },
    undo, redo,
    share: shareModal,
    output: () => {
      const w = window.open(location.pathname + '?output', 'blalien-output', 'popup,width=1280,height=720');
      if (!w) toast('Pop-up blocked. Open ' + location.pathname + '?output in a new window.');
      else toast('Drag the output window onto the projector, then click it to go fullscreen.', 5000);
    },
    present: () => setPresent(!ui.present),
    menu: () => toggleMenu(),
    'close-modal': closeModal,
    'scene-add': saveScene,
    tap,
    audio: () => {
      state.settings.audio = !state.settings.audio;
      if (state.settings.audio) BP.Audio.start().then(() => { if (BP.Audio.err) toast('Microphone: ' + BP.Audio.err, 5000); });
      commit();
    },
    blackout: () => { state.settings.blackout = !state.settings.blackout; commit(); },
    record: toggleRecord,
    settings: () => { toggleMenu(false); settingsModal(); },
    help: () => { toggleMenu(false); helpModal(); },
    export: () => { toggleMenu(false); exportShow(); },
    import: () => { toggleMenu(false); $('#importIn').click(); },
    demo: () => { toggleMenu(false); if (!confirm('Replace surfaces with the demo? (Undo works.)')) return; pushUndo(); const d = BP.demoState(); state.surfaces = d.surfaces; ui.sel = null; commit(); },
    'new': () => { toggleMenu(false); if (!confirm('Start a new empty show? (Undo works.)')) return; pushUndo(); state.surfaces = []; state.scenes = []; state.activeScene = null; ui.sel = null; commit(); },
    fullscreen: () => { toggleMenu(false); toggleFullscreen(); },
    midi: () => { toggleMenu(false); enableMidi(); },
  };
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen || (() => {})).call(document.documentElement);
  }
  function setPresent(on) {
    ui.present = on;
    document.body.classList.toggle('present', on);
    if (on) toast('Presenting. Press H or Esc to return to the editor.');
  }

  // ------------------------------------------------------------ stage interaction
  function stagePt(e) { const r = ov.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
  function pxDist(a, b) { const r = ov.getBoundingClientRect(); return Math.hypot((a[0] - b[0]) * r.width, (a[1] - b[1]) * r.height); }
  function edgeMids(s) { const H = BP.homography(s.pts); return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]].map(([u, v]) => BP.warp(s, u, v, H)); }
  function hitHandles(s, p, touch) {
    if (!s || s.locked || !s.visible) return null;
    const rc = touch ? 24 : 14, rb = touch ? 18 : 10;
    for (let i = 0; i < 4; i++) if (pxDist(s.pts[i], p) < rc) return { type: 'corner', i };
    const m = edgeMids(s);
    for (let i = 0; i < 4; i++) if (pxDist(m[i], p) < rb) return { type: 'bend', i };
    return null;
  }
  function hitBody(s, p) { const [u, v] = BP.invWarp(s, p[0], p[1]); return u >= 0 && u <= 1 && v >= 0 && v <= 1; }
  const canEditStage = () => !IS_OUTPUT && (!ui.present || state.settings.showOnOutput);

  function onDown(e) {
    if (!canEditStage() || e.button === 2) return;
    document.body.classList.remove('show-left', 'show-right');
    const p = stagePt(e), touch = e.pointerType === 'touch';
    ov.setPointerCapture(e.pointerId);
    const s = sel();
    if (ui.tool === 'draw' || ui.tool === 'mask') {
      if (!s) { toast('Select a surface first'); return; }
      pushUndo();
      const [u, v] = BP.invWarp(s, p[0], p[1]);
      if (ui.tool === 'draw') {
        const c = s[ui.slot];
        if (c.type !== 'draw') c.type = 'draw';
        const st = { c: ui.brush.c, w: ui.brush.w, g: ui.brush.g, pts: [r3(u), r3(v)] };
        c.strokes.push(st);
        ui.drag = { type: 'draw', s, st };
      } else {
        s.mask.shape = 'path'; s.mask.path = [r3(u), r3(v)];
        ui.drag = { type: 'mask', s };
      }
      commit();
      return;
    }
    let hit = hitHandles(s, p, touch), target = s;
    if (!hit) {
      for (let i = state.surfaces.length - 1; i >= 0 && !hit; i--) {
        const o = state.surfaces[i];
        if (o === s) continue;
        const hh = hitHandles(o, p, touch);
        if (hh && hh.type === 'corner') { hit = hh; target = o; }
      }
    }
    if (!hit) {
      for (let i = state.surfaces.length - 1; i >= 0; i--) {
        const o = state.surfaces[i];
        if (o.visible && hitBody(o, p)) { target = o; hit = { type: 'move' }; break; }
      }
    }
    if (!hit) { setSel(null); return; }
    if (target.id !== ui.sel) setSel(target.id);
    if (target.locked) return;
    pushUndo();
    if (hit.type === 'corner') {
      ui.activeCorner = hit.i;
      const P = target.pts[hit.i], links = [];
      if (!e.altKey) for (const o of state.surfaces) { if (o !== target) o.pts.forEach((q, j) => { if (pxDist(q, P) < 3) links.push([o, j]); }); }
      ui.drag = { type: 'corner', s: target, i: hit.i, links, start: p, orig: [...P] };
    } else if (hit.type === 'bend') {
      ui.drag = { type: 'bend', s: target, i: hit.i, start: p, orig: [...target.bend[hit.i]] };
    } else {
      ui.activeCorner = null;
      ui.drag = { type: 'move', s: target, start: p, orig: target.pts.map((q) => [...q]) };
    }
  }
  function onMove(e) {
    const d = ui.drag;
    const p = stagePt(e);
    if (!d) {
      if (!canEditStage()) return;
      if (ui.tool !== 'select') { ov.style.cursor = 'crosshair'; return; }
      const s = sel(), hh = hitHandles(s, p);
      let cur = hh ? (hh.type === 'corner' ? 'grab' : 'ns-resize') : 'default';
      if (!hh) for (const o of state.surfaces) if (o.visible && hitBody(o, p)) { cur = 'move'; break; }
      ov.style.cursor = cur;
      return;
    }
    if (d.type === 'draw' || d.type === 'mask') {
      const [u, v] = BP.invWarp(d.s, p[0], p[1]);
      const pts = d.type === 'draw' ? d.st.pts : d.s.mask.path;
      if (Math.hypot(u - pts[pts.length - 2], v - pts[pts.length - 1]) > 0.004) { pts.push(r3(u), r3(v)); commit(); }
      return;
    }
    let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
    if (e.shiftKey) { dx *= 0.2; dy *= 0.2; }
    if (d.type === 'corner') {
      let np = [d.orig[0] + dx, d.orig[1] + dy];
      if (!e.altKey) {
        outer: for (const o of state.surfaces) {
          if (o === d.s) continue;
          for (let j = 0; j < 4; j++) {
            if (d.links.some(([lo, lj]) => lo === o && lj === j)) continue;
            if (pxDist(o.pts[j], np) < 10) { np = [...o.pts[j]]; break outer; }
          }
        }
      }
      d.s.pts[d.i] = np;
      d.links.forEach(([o, j]) => { o.pts[j] = [...np]; });
    } else if (d.type === 'bend') {
      d.s.bend[d.i] = [d.orig[0] + dx, d.orig[1] + dy];
    } else if (d.type === 'move') {
      d.s.pts = d.orig.map((q) => [q[0] + dx, q[1] + dy]);
    }
    commit();
  }
  function onUp() {
    if (!ui.drag) return;
    ui.drag = null;
    commit();
  }
  function onDbl(e) {
    if (!canEditStage() || ui.tool !== 'select') return;
    const s = sel(), hh = hitHandles(s, stagePt(e));
    if (hh && hh.type === 'bend') { pushUndo(); s.bend[hh.i] = [0, 0]; commit(); }
  }
  function nudge(dx, dy) {
    const s = sel(); if (!s || s.locked) return;
    const r = ov.getBoundingClientRect();
    pushUndo();
    const ax = dx / r.width, ay = dy / r.height;
    if (ui.activeCorner != null) { const q = s.pts[ui.activeCorner]; s.pts[ui.activeCorner] = [q[0] + ax, q[1] + ay]; }
    else s.pts = s.pts.map(([x, y]) => [x + ax, y + ay]);
    commit();
  }

  // ------------------------------------------------------------ overlay drawing
  function drawTestPattern(ctx, W, H, dpr) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1 * dpr;
    const nx = 16, ny = 9;
    ctx.beginPath();
    for (let i = 0; i <= nx; i++) { const x = Math.round((i / nx) * (W - 1)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let j = 0; j <= ny; j++) { const y = Math.round((j / ny) * (H - 1)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.strokeStyle = '#00e5ff';
    ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(dpr, dpr, W - 2 * dpr, H - 2 * dpr);
    ctx.restore();
  }
  function drawOverlay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(ov.clientWidth * dpr), H = Math.round(ov.clientHeight * dpr);
    if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
    const ctx = octx;
    ctx.clearRect(0, 0, W, H);
    const S = state.settings;
    if (S.testPattern) drawTestPattern(ctx, W, H, dpr);
    const showHandles = IS_OUTPUT || ui.present ? S.showOnOutput : true;
    if (!showHandles) return;
    const selId = IS_OUTPUT ? ui.remoteSel : ui.sel;
    const P = (q) => [q[0] * W, q[1] * H];
    for (const s of state.surfaces) {
      const selected = s.id === selId;
      if (!s.visible && !selected && (IS_OUTPUT || ui.present)) continue;
      const Hm = BP.homography(s.pts);
      const edge = (fn) => { for (let k = 0; k <= 16; k++) { const [u, v] = fn(k / 16); const q = P(BP.warp(s, u, v, Hm)); ctx.lineTo(q[0], q[1]); } };
      ctx.beginPath();
      const p0 = P(s.pts[0]); ctx.moveTo(p0[0], p0[1]);
      edge((t) => [t, 0]); edge((t) => [1, t]); edge((t) => [1 - t, 1]); edge((t) => [0, 1 - t]);
      ctx.setLineDash(s.visible ? [] : [6 * dpr, 5 * dpr]);
      ctx.lineWidth = (selected ? 2 : 1.25) * dpr;
      ctx.strokeStyle = selected ? '#00e5ff' : 'rgba(255,255,255,0.45)';
      ctx.stroke();
      ctx.setLineDash([]);
      if (!selected) continue;
      // inner grid
      ctx.strokeStyle = 'rgba(0,229,255,0.25)'; ctx.lineWidth = 1 * dpr;
      for (const t of [0.25, 0.5, 0.75]) {
        ctx.beginPath(); for (let k = 0; k <= 16; k++) { const q = P(BP.warp(s, t, k / 16, Hm)); ctx[k ? 'lineTo' : 'moveTo'](q[0], q[1]); } ctx.stroke();
        ctx.beginPath(); for (let k = 0; k <= 16; k++) { const q = P(BP.warp(s, k / 16, t, Hm)); ctx[k ? 'lineTo' : 'moveTo'](q[0], q[1]); } ctx.stroke();
      }
      // mask path preview while tracing
      if (s.mask.shape === 'path' && s.mask.path.length >= 4 && ui.tool === 'mask') {
        ctx.beginPath();
        for (let k = 0; k < s.mask.path.length; k += 2) { const q = P(BP.warp(s, s.mask.path[k], s.mask.path[k + 1], Hm)); ctx[k ? 'lineTo' : 'moveTo'](q[0], q[1]); }
        ctx.closePath(); ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 2 * dpr; ctx.stroke();
      }
      if (s.locked) continue;
      // bend handles
      edgeMids(s).forEach((m) => {
        const q = P(m), r = 6 * dpr;
        ctx.beginPath(); ctx.moveTo(q[0], q[1] - r); ctx.lineTo(q[0] + r, q[1]); ctx.lineTo(q[0], q[1] + r); ctx.lineTo(q[0] - r, q[1]); ctx.closePath();
        ctx.fillStyle = 'rgba(122,92,255,0.9)'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
      });
      // corners
      s.pts.forEach((pt, i) => {
        const q = P(pt), act = i === ui.activeCorner && !IS_OUTPUT;
        ctx.beginPath(); ctx.arc(q[0], q[1], (act ? 10 : 8) * dpr, 0, Math.PI * 2);
        ctx.fillStyle = act ? '#ff2bd6' : 'rgba(0,229,255,0.95)'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.stroke();
      });
      // label
      const c = P(centroid(s));
      ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(s.name).width + 14 * dpr;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(c[0] - tw / 2, c[1] - 10 * dpr, tw, 20 * dpr);
      ctx.fillStyle = '#fff'; ctx.fillText(s.name, c[0], c[1]);
    }
  }

  // ------------------------------------------------------------ main loop
  function layoutStage() {
    const st = $('#stage');
    if (ui.present) { if (st.style.width) { st.style.width = ''; st.style.height = ''; } return; }
    const wrap = $('#stageWrap');
    const W = wrap.clientWidth - 24, H = wrap.clientHeight - 24, a = state.settings.aspect;
    let w = W, hh = W / a;
    if (hh > H) { hh = H; w = H * a; }
    st.style.width = Math.max(10, Math.floor(w)) + 'px';
    st.style.height = Math.max(10, Math.floor(hh)) + 'px';
  }
  function frameLayers(now) {
    const n = state.sceneSwitch ? state.sceneSwitch.n : 0;
    if (n !== seenSwitch) {
      if (lastSurfaces && state.settings.fade > 0) fade = { from: lastSurfaces, t0: now, dur: state.settings.fade * 1000 };
      seenSwitch = n;
    }
    lastSurfaces = state.surfaces;
    if (fade) {
      const e = (now - fade.t0) / fade.dur;
      if (e >= 1) fade = null;
      else return [{ surfaces: fade.from, mul: Math.min(1, 2 - 2 * e) }, { surfaces: state.surfaces, mul: Math.min(1, 2 * e) }];
    }
    return null;
  }
  function loop(now) {
    requestAnimationFrame(loop);
    const S = state.settings;
    if (S.audio && !BP.Audio.started) BP.Audio.start();
    else if (!S.audio && BP.Audio.started) BP.Audio.stop();
    layoutStage();
    R.render(state, now, frameLayers(now));
    drawOverlay();
    if (!IS_OUTPUT) {
      const beat = (Date.now() - (S.beatT0 || 0)) / (60000 / S.bpm);
      $('#beatLed').classList.toggle('on', beat % 1 < 0.15);
      $('#meter i').style.width = Math.round(BP.Audio.level * 100) + '%';
    } else {
      const hint = $('#hint');
      const needAudio = S.audio && (BP.Audio.suspended || (BP.Audio.err && !hint.dataset.err));
      if (needAudio && hint.dataset.mode !== 'audio') {
        hint.dataset.mode = 'audio';
        hint.textContent = BP.Audio.err ? 'Microphone unavailable here: ' + BP.Audio.err : 'Click anywhere to enable audio-reactive visuals';
        hint.classList.add('show');
      } else if (!needAudio && hint.dataset.mode === 'audio') { hint.dataset.mode = ''; hint.classList.remove('show'); }
    }
  }

  // ------------------------------------------------------------ remote
  function onRemoteState(st) {
    if (ui.drag) return; // don't yank the thing being dragged
    state = BP.normalize(st);
    if (ui.sel && !sel()) ui.sel = null;
    scheduleUI();
  }
  function onMsg(m) {
    if (m.type === 'sel') ui.remoteSel = m.data && m.data.id;
    else if (m.type === 'hello' && IS_OUTPUT) announce();
    else if (m.type === 'output' && !IS_OUTPUT) { ui.outputs[m.from] = Object.assign({ t: Date.now() }, m.data); updateConn(); }
  }
  function announce() {
    const dpr = window.devicePixelRatio || 1;
    BP.Sync.send('output', { w: Math.round(innerWidth * dpr), h: Math.round(innerHeight * dpr) });
  }

  // ------------------------------------------------------------ keyboard
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && !['range', 'checkbox', 'color'].includes(e.target.type) || tag === 'textarea' || tag === 'select') return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === 'f' || k === 'F') { if (!mod) { toggleFullscreen(); e.preventDefault(); } return; }
    if (IS_OUTPUT) return;
    if (mod && (k === 'z' || k === 'Z')) { e.shiftKey ? redo() : undo(); e.preventDefault(); return; }
    if (mod && (k === 'y' || k === 'Y')) { redo(); e.preventDefault(); return; }
    if (mod && (k === 'd' || k === 'D')) { const s = sel(); if (s) duplicate(s); e.preventDefault(); return; }
    if (mod) return;
    const s = sel();
    switch (k) {
      case 'Escape':
        if (!$('#modal').hidden) closeModal();
        else if (ui.present) setPresent(false);
        else if (ui.tool !== 'select') setTool('select');
        else setSel(null);
        break;
      case 'h': case 'H': setPresent(!ui.present); break;
      case 'v': case 'V': setTool('select'); break;
      case 'd': case 'D': setTool('draw'); break;
      case 'm': case 'M': setTool('mask'); break;
      case 'p': case 'P': state.settings.showOnOutput = !state.settings.showOnOutput; toast('Outlines on projector: ' + (state.settings.showOnOutput ? 'on' : 'off')); commit(); break;
      case 't': case 'T': state.settings.testPattern = !state.settings.testPattern; commit(); break;
      case 'b': case 'B': ACTIONS.blackout(); break;
      case ' ': tap(); e.preventDefault(); break;
      case 'Delete': case 'Backspace': if (s) { removeSurface(s); e.preventDefault(); } break;
      case 'Tab': {
        e.preventDefault();
        const L = state.surfaces; if (!L.length) break;
        const i = L.indexOf(s), j = s ? (i + (e.shiftKey ? -1 : 1) + L.length) % L.length : 0;
        setSel(L[j].id); break;
      }
      case 'ArrowLeft': nudge(e.shiftKey ? -10 : -1, 0); e.preventDefault(); break;
      case 'ArrowRight': nudge(e.shiftKey ? 10 : 1, 0); e.preventDefault(); break;
      case 'ArrowUp': nudge(0, e.shiftKey ? -10 : -1); e.preventDefault(); break;
      case 'ArrowDown': nudge(0, e.shiftKey ? 10 : 1); e.preventDefault(); break;
      default:
        if (/^[1-9]$/.test(k)) recallScene(state.scenes[+k - 1]);
    }
  }

  // ------------------------------------------------------------ generator thumbnails
  function makeGenThumbs() {
    try {
      const c = document.createElement('canvas'); c.width = 120; c.height = 68;
      const r = new BP.Renderer(c, { preserve: true, fixed: true, noAudio: true });
      for (const [g] of BP.GENS) {
        const st = BP.normalize({ settings: { aspect: 120 / 68 }, surfaces: [{ pts: [[0, 0], [1, 0], [1, 1], [0, 1]], followX: false, mix: 0, a: { type: 'gen', gen: g } }] });
        r.render(st, 2600);
        ui.genThumbs[g] = c.toDataURL('image/jpeg', 0.8);
      }
      const ext = r.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch (e) { console.warn('thumbs', e); }
  }

  // ------------------------------------------------------------ boot
  function initEditor() {
    buildShapeGrid();
    bindStatic();
    $$('[data-act]').forEach((b) => b.addEventListener('click', (e) => { const f = ACTIONS[b.dataset.act]; if (f) { e.stopPropagation(); f(e); } }));
    $$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $$('#right .tabs button').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; renderInspector(true); }));
    $('#fileIn').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });
    $('#importIn').addEventListener('change', (e) => { if (e.target.files[0]) importShow(e.target.files[0]); e.target.value = ''; });
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('click', (e) => { if (!$('#menu').hidden && !e.target.closest('#menu')) toggleMenu(false); });

    // drag & drop uploads
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('dropping'); } });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping'); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });

    ov.addEventListener('pointerdown', onDown);
    ov.addEventListener('pointermove', onMove);
    ov.addEventListener('pointerup', onUp);
    ov.addEventListener('pointercancel', onUp);
    ov.addEventListener('dblclick', onDbl);
    window.addEventListener('keydown', onKey);
    setTimeout(() => { makeGenThumbs(); inspKey = ''; scheduleUI(); }, 50);
    BP.Sync.send('hello', {});
    setInterval(updateConn, 4000);
    refreshUI();
    if (!localStorage.getItem('blalien-seen-help')) { try { localStorage.setItem('blalien-seen-help', '1'); } catch (e) { /* private mode */ } helpModal(); }
  }

  function initOutput() {
    document.body.classList.add('output', 'present');
    const hint = $('#hint');
    hint.textContent = 'Output ready · click to go fullscreen · F toggles fullscreen';
    hint.classList.add('show');
    setTimeout(() => { if (!hint.dataset.mode) hint.classList.remove('show'); }, 5000);
    document.addEventListener('click', () => {
      if (!document.fullscreenElement) toggleFullscreen();
      if (BP.Audio.ctx) BP.Audio.ctx.resume();
      R.media.forEach((m) => m.el && m.el.play && m.el.play().catch(() => {}));
    });
    window.addEventListener('keydown', onKey);
    let idle;
    document.addEventListener('mousemove', () => { document.body.classList.remove('hide-cursor'); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add('hide-cursor'), 2000); });
    window.addEventListener('resize', announce);
    announce();
    setInterval(announce, 5000);
    document.title = 'Output · Blalien Projections';
  }

  async function boot() {
    if (IS_OUTPUT) document.body.classList.add('output', 'present');
    const init = await BP.Sync.init();
    let fresh = false;
    if (init && Array.isArray(init.surfaces)) state = BP.normalize(init);
    else { state = BP.demoState(); fresh = true; }
    seenSwitch = state.sceneSwitch.n || 0;
    ov = $('#ov'); octx = ov.getContext('2d');
    try { R = new BP.Renderer($('#gl')); }
    catch (e) { document.body.innerHTML = `<div class="fatal"><h1>Can't start</h1><p>${e.message}</p><p>Try a recent Chrome, Edge, Firefox or Safari.</p></div>`; return; }
    BP.Sync.on('state', onRemoteState);
    BP.Sync.on('msg', onMsg);
    BP.Sync.on('peers', updateConn);
    if (IS_OUTPUT) initOutput();
    else { initEditor(); if (fresh) BP.Sync.sendState(state); }
    requestAnimationFrame(loop);
  }
  boot();
})();
