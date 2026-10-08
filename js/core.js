/* Blalien Projections — core: state model, geometry, sync, media storage */
'use strict';
(function () {
  const BP = (window.BP = window.BP || {});

  BP.uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  BP.clone = (o) => JSON.parse(JSON.stringify(o));
  BP.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  BP.clientId = BP.uid();

  // ---------------------------------------------------------------- catalog
  BP.GENS = [
    ['solid', 'Solid'], ['gradient', 'Gradient'], ['plasma', 'Plasma'], ['tunnel', 'Tunnel'],
    ['rings', 'Rings'], ['stripes', 'Stripes'], ['checker', 'Checker'], ['grid', 'Neon Grid'],
    ['clouds', 'Clouds'], ['stars', 'Starfield'], ['kaleido', 'Kaleido'], ['waves', 'Waves'],
    ['cycle', 'Color Cycle'], ['strobe', 'Strobe'], ['spectrum', 'Spectrum'], ['fire', 'Fire'],
    ['dots', 'Pulse Dots'], ['spiral', 'Spiral'], ['border', 'Neon Border'], ['scan', 'Scanner'],
    ['lava', 'Lava'], ['matrix', 'Rain'], ['bars', 'Equalizer'], ['hexes', 'Hex Grid'],
  ];
  BP.GEN_INDEX = Object.fromEntries(BP.GENS.map((g, i) => [g[0], i]));
  BP.FONTS = ['Impact', 'Arial Black', 'Helvetica', 'Georgia', 'Courier New', 'Trebuchet MS', 'Verdana', 'Comic Sans MS', 'Times New Roman'];
  BP.MASKS = [
    ['rect', 'Rectangle'], ['circle', 'Circle'], ['triangle', 'Triangle'], ['polygon', 'Polygon'],
    ['star', 'Star'], ['heart', 'Heart'], ['text', 'Text'], ['image', 'Image silhouette'], ['path', 'Freehand outline'],
  ];

  BP.DEFAULT_CODE = `// GLSL: return a color for each point. uv = 0..1, time = seconds.
// Also available: uBass uMid uHigh uLevel (audio 0..1), uBeat, uAspect,
// hsv2rgb(vec3), noise(vec2), fbm(vec2)
vec4 effect(vec2 uv, float time) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float d = length(p);
  vec3 col = hsv2rgb(vec3(fract(d - time * 0.2), 0.8, 1.0));
  col *= 0.6 + 0.4 * sin(d * 40.0 - time * 6.0 + uBass * 10.0);
  return vec4(col, 1.0);
}`;

  // ---------------------------------------------------------------- defaults
  BP.defContent = (o = {}) => Object.assign({
    type: 'gen', gen: 'plasma', c1: '#ff2bd6', c2: '#00e5ff', speed: 1, scale: 1,
    media: null, fit: 'cover', text: 'HELLO', textColor: '#ffffff', bgColor: '#000000', font: 'Impact',
    strokes: [], drawAnim: false, drawDur: 4, code: BP.DEFAULT_CODE,
  }, BP.clone(o || {}));

  BP.defFx = () => ({
    zoom: 1, rotate: 0, rotSpeed: 0, slideX: 0, slideY: 0, tile: 1, kaleido: 0, blur: 0,
    hue: 0, hueSpeed: 0, sat: 1, contrast: 1, bright: 1, opacity: 1, mono: false, invert: false,
    strobe: 0, pulse: 0, audio: 0, audioTarget: 'bright', audioBand: 'level',
    glow: 0, glowColor: '#ffffff', glowWidth: 0.02, blend: 'normal', flipX: false, flipY: false,
  });

  BP.defMask = () => ({
    shape: 'rect', radius: 0, sides: 6, text: 'TEXT', font: 'Impact', image: null,
    threshold: 0.5, useAlpha: true, invert: false, path: [], feather: 0,
  });

  BP.defSettings = () => ({
    aspect: 16 / 9, master: 1, xfade: 0, blackout: false, bpm: 120, beatT0: 0,
    audio: false, audioGain: 1.5, showOnOutput: false, testPattern: false, fade: 1, bg: '#000000',
  });

  BP.rectPts = (cx, cy, w, h) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];

  BP.newSurface = (o = {}) => {
    const s = {
      id: BP.uid(), name: 'Surface', visible: true, locked: false,
      pts: BP.rectPts(0.5, 0.5, 0.3, 0.4), bend: [[0, 0], [0, 0], [0, 0], [0, 0]],
      mask: BP.defMask(), a: BP.defContent(), b: BP.defContent({ gen: 'tunnel' }),
      mix: 0, followX: true, fx: BP.defFx(),
    };
    if (o.mask) { Object.assign(s.mask, o.mask); delete o.mask; }
    if (o.fx) { Object.assign(s.fx, o.fx); delete o.fx; }
    if (o.a) { s.a = BP.defContent(o.a); delete o.a; }
    if (o.b) { s.b = BP.defContent(o.b); delete o.b; }
    return Object.assign(s, o);
  };

  BP.normSurface = (src) => {
    const s = BP.newSurface();
    Object.assign(s, src);
    s.fx = Object.assign(BP.defFx(), src.fx || {});
    s.mask = Object.assign(BP.defMask(), src.mask || {});
    s.a = BP.defContent(src.a || {});
    s.b = BP.defContent(Object.assign({ gen: 'tunnel' }, src.b || {}));
    if (!Array.isArray(s.pts) || s.pts.length !== 4) s.pts = BP.rectPts(0.5, 0.5, 0.3, 0.4);
    if (!Array.isArray(s.bend) || s.bend.length !== 4) s.bend = [[0, 0], [0, 0], [0, 0], [0, 0]];
    return s;
  };

  BP.normalize = (st) => {
    st = st && typeof st === 'object' ? st : {};
    return {
      v: 1,
      rev: st.rev || 0,
      settings: Object.assign(BP.defSettings(), st.settings || {}),
      surfaces: (Array.isArray(st.surfaces) ? st.surfaces : []).map(BP.normSurface),
      media: Array.isArray(st.media) ? st.media : [],
      scenes: Array.isArray(st.scenes) ? st.scenes : [],
      activeScene: st.activeScene || null,
      sceneSwitch: st.sceneSwitch || { n: 0 },
    };
  };

  // Shape presets. Returns an array of new surfaces.
  BP.makeShape = (type, aspect, n = 0) => {
    const off = (n % 6) * 0.03;
    const cx = 0.5 + off, cy = 0.5 + off * 0.6;
    const sq = (w) => BP.rectPts(cx, cy, w, w * aspect);
    const names = Object.fromEntries(BP.MASKS);
    switch (type) {
      case 'full':
        return [BP.newSurface({ name: 'Full screen', pts: [[0, 0], [1, 0], [1, 1], [0, 1]] })];
      case 'box': {
        const r = 0.13, P = (x, y) => [cx + x, cy + y * aspect];
        const T = P(0, -r), UL = P(-r * 0.866, -r / 2), UR = P(r * 0.866, -r / 2), C = P(0, 0),
          LL = P(-r * 0.866, r / 2), LR = P(r * 0.866, r / 2), B = P(0, r);
        return [
          BP.newSurface({ name: 'Box top', pts: [UL, T, UR, C], a: { gen: 'grid' } }),
          BP.newSurface({ name: 'Box left', pts: [UL, C, B, LL], a: { gen: 'plasma' } }),
          BP.newSurface({ name: 'Box right', pts: [C, UR, LR, B], a: { gen: 'kaleido' } }),
        ];
      }
      case 'text':
        return [BP.newSurface({ name: 'Text', pts: BP.rectPts(cx, cy, 0.5, 0.16 * aspect), mask: { shape: 'text', text: 'BLALIEN' }, a: { gen: 'cycle' } })];
      case 'polygon':
        return [BP.newSurface({ name: 'Hexagon', pts: sq(0.25), mask: { shape: 'polygon', sides: 6 }, a: { gen: 'hexes' } })];
      case 'rect':
        return [BP.newSurface({ name: 'Quad', pts: sq(0.28) })];
      default:
        return [BP.newSurface({ name: names[type] || 'Surface', pts: sq(0.25), mask: { shape: type } })];
    }
  };

  BP.demoState = () => {
    const a = 16 / 9;
    const box = BP.makeShape('box', a).map((s) => { s.pts = s.pts.map(([x, y]) => [x - 0.2, y]); return s; });
    const circle = BP.newSurface({ name: 'Circle', pts: BP.rectPts(0.72, 0.42, 0.2, 0.2 * a), mask: { shape: 'circle' }, a: { gen: 'tunnel', c1: '#7a5cff', c2: '#00e5ff' }, b: { gen: 'spiral' }, fx: { glow: 0.8, glowColor: '#00e5ff' } });
    const text = BP.newSurface({ name: 'Title', pts: BP.rectPts(0.72, 0.8, 0.34, 0.08 * a), mask: { shape: 'text', text: 'BLALIEN' }, a: { gen: 'cycle' }, b: { gen: 'scan' } });
    const st = BP.normalize({ surfaces: [...box, circle, text] });
    return st;
  };

  // ---------------------------------------------------------------- geometry
  // Square (0,0)(1,0)(1,1)(0,1) -> quad p0 p1 p2 p3 (TL, TR, BR, BL). Heckbert.
  BP.homography = (p) => {
    const [x0, y0] = p[0], [x1, y1] = p[1], [x2, y2] = p[2], [x3, y3] = p[3];
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
    let g = 0, h = 0;
    if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12) {
      const det = dx1 * dy2 - dx2 * dy1 || 1e-12;
      g = (sx * dy2 - dx2 * sy) / det;
      h = (dx1 * sy - sx * dy1) / det;
    }
    return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
  };
  BP.applyH = (H, u, v) => {
    const w = H[6] * u + H[7] * v + H[8];
    return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w, w];
  };
  BP.invert3 = (m) => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C || 1e-12;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  };
  // Edge-bend displacement (quadratic bump per edge; zero at corners).
  BP.bendAt = (bend, u, v) => {
    const bu = 4 * u * (1 - u), bv = 4 * v * (1 - v);
    return [
      bend[0][0] * bu * (1 - v) + bend[2][0] * bu * v + bend[3][0] * bv * (1 - u) + bend[1][0] * bv * u,
      bend[0][1] * bu * (1 - v) + bend[2][1] * bu * v + bend[3][1] * bv * (1 - u) + bend[1][1] * bv * u,
    ];
  };
  BP.warp = (s, u, v, H) => {
    H = H || BP.homography(s.pts);
    const p = BP.applyH(H, u, v);
    const d = BP.bendAt(s.bend, u, v);
    return [p[0] + d[0], p[1] + d[1], p[2]];
  };
  BP.invWarp = (s, x, y) => {
    const Hi = BP.invert3(BP.homography(s.pts));
    const p = BP.applyH(Hi, x, y);
    return [p[0], p[1]];
  };
  BP.surfaceAspect = (s, stageAspect) => {
    const p = s.pts, d = (a, b) => Math.hypot((b[0] - a[0]) * stageAspect, b[1] - a[1]);
    const w = (d(p[0], p[1]) + d(p[3], p[2])) / 2, h = (d(p[0], p[3]) + d(p[1], p[2])) / 2;
    return BP.clamp(w / Math.max(h, 1e-4), 0.05, 20);
  };

  // ---------------------------------------------------------------- tiny IndexedDB
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('blalien-media', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('files');
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('files', mode);
        const req = fn(t.objectStore('files'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      });
    },
    put(k, v) { return this.tx('readwrite', (s) => s.put(v, k)); },
    get(k) { return this.tx('readonly', (s) => s.get(k)); },
    del(k) { return this.tx('readwrite', (s) => s.delete(k)); },
  };

  // ---------------------------------------------------------------- media store
  BP.Media = {
    cache: {},
    kindOf(file) {
      const t = file.type || '', n = (file.name || '').toLowerCase();
      return t.startsWith('video') || /\.(mp4|webm|mov|m4v|ogv|mkv)$/.test(n) ? 'video' : 'image';
    },
    async upload(file) {
      const kind = this.kindOf(file);
      if (BP.Sync.mode === 'server') {
        const r = await fetch('api/upload?name=' + encodeURIComponent(file.name), {
          method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!r.ok) throw new Error('Upload failed: ' + r.status);
        const j = await r.json();
        return { id: j.id, name: file.name, kind, url: j.url, file: j.file };
      }
      const id = BP.uid();
      await IDB.put(id, file);
      return { id, name: file.name, kind, local: true };
    },
    async url(m) {
      if (!m) return null;
      if (!m.local) return m.url;
      if (this.cache[m.id]) return this.cache[m.id];
      try {
        const blob = await IDB.get(m.id);
        if (!blob) return null;
        return (this.cache[m.id] = URL.createObjectURL(blob));
      } catch (e) { return null; }
    },
    async remove(m) {
      if (m.local) { try { await IDB.del(m.id); } catch (e) { /* ignore */ } }
      else if (m.file) { try { await fetch('api/media?file=' + encodeURIComponent(m.file), { method: 'DELETE' }); } catch (e) { /* ignore */ } }
    },
  };

  // ---------------------------------------------------------------- sync
  // "server" mode: talks to server.js (LAN, many devices).
  // "local" mode: GitHub Pages / file — syncs tabs in this browser via BroadcastChannel.
  BP.Sync = {
    mode: 'local', info: null, peers: 1, handlers: { state: [], msg: [], peers: [] },
    on(ev, fn) { this.handlers[ev].push(fn); },
    emit(ev, d) { this.handlers[ev].forEach((f) => f(d)); },

    async init() {
      try {
        const ctl = new AbortController();
        setTimeout(() => ctl.abort(), 1500);
        const r = await fetch('api/info', { cache: 'no-store', signal: ctl.signal });
        if (r.ok) {
          const j = await r.json();
          if (j && j.server === 'blalien') { this.mode = 'server'; this.info = j; }
        }
      } catch (e) { /* standalone */ }

      if (this.mode === 'server') {
        let st = null;
        try { st = await (await fetch('api/state', { cache: 'no-store' })).json(); } catch (e) { /* none */ }
        this.es = new EventSource('api/events');
        this.es.addEventListener('state', (e) => {
          const d = JSON.parse(e.data);
          if (d && d.from !== BP.clientId && d.state) this.emit('state', d.state);
        });
        this.es.addEventListener('msg', (e) => {
          const d = JSON.parse(e.data);
          if (d && d.from !== BP.clientId) this.emit('msg', d);
        });
        this.es.addEventListener('peers', (e) => { this.peers = JSON.parse(e.data).n; this.emit('peers', this.peers); });
        return st && st.surfaces ? st : null;
      }

      try {
        this.bc = new BroadcastChannel('blalien-projections');
        this.bc.onmessage = (e) => {
          const d = e.data;
          if (!d || d.from === BP.clientId) return;
          if (d.kind === 'state') this.emit('state', d.state);
          else if (d.kind === 'msg') this.emit('msg', d);
        };
      } catch (e) { /* no BroadcastChannel */ }
      try { return JSON.parse(localStorage.getItem('blalien-state') || 'null'); } catch (e) { return null; }
    },

    _pending: null, _timer: 0, _last: 0,
    sendState(state) {
      this._pending = state;
      const wait = 40 - (Date.now() - this._last);
      if (this._timer) return;
      this._timer = setTimeout(() => this._flush(), Math.max(0, wait));
    },
    _flush() {
      this._timer = 0; this._last = Date.now();
      const st = this._pending; this._pending = null;
      if (!st) return;
      if (this.mode === 'server') {
        fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: BP.clientId, state: st }) }).catch(() => {});
      } else {
        if (this.bc) this.bc.postMessage({ kind: 'state', from: BP.clientId, state: st });
        clearTimeout(this._save);
        this._save = setTimeout(() => { try { localStorage.setItem('blalien-state', JSON.stringify(st)); } catch (e) { /* quota */ } }, 300);
      }
    },
    send(type, data) {
      const m = { from: BP.clientId, type, data };
      if (this.mode === 'server') fetch('api/msg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {});
      else if (this.bc) this.bc.postMessage(Object.assign({ kind: 'msg' }, m));
    },
  };

  // ---------------------------------------------------------------- audio input
  BP.Audio = {
    started: false, ctx: null, an: null, level: 0, bass: 0, mid: 0, high: 0, spec: new Uint8Array(64), err: null,
    async start() {
      if (this.started) { if (this.ctx) this.ctx.resume(); return; }
      this.started = true; this.err = null;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Microphone needs https or localhost');
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.an = this.ctx.createAnalyser();
        this.an.fftSize = 256; this.an.smoothingTimeConstant = 0.7;
        this.ctx.createMediaStreamSource(this.stream).connect(this.an);
        this.buf = new Uint8Array(this.an.frequencyBinCount);
      } catch (e) { this.err = e.message || String(e); }
    },
    stop() {
      this.started = false;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close();
      this.ctx = this.an = this.stream = null;
    },
    get suspended() { return this.ctx && this.ctx.state === 'suspended'; },
    update(gain) {
      const follow = (cur, v) => (v > cur ? v : cur * 0.88 + v * 0.12);
      if (!this.an || this.ctx.state !== 'running') {
        this.level *= 0.9; this.bass *= 0.9; this.mid *= 0.9; this.high *= 0.9;
        return;
      }
      const b = this.buf;
      this.an.getByteFrequencyData(b);
      const avg = (a, z) => { let s = 0; for (let i = a; i < z; i++) s += b[i]; return s / (z - a) / 255; };
      const g = gain || 1;
      this.bass = follow(this.bass, Math.min(1, avg(1, 5) * g));
      this.mid = follow(this.mid, Math.min(1, avg(5, 30) * g));
      this.high = follow(this.high, Math.min(1, avg(30, 90) * g * 1.6));
      this.level = follow(this.level, Math.min(1, avg(1, 90) * g * 1.3));
      for (let i = 0; i < 64; i++) this.spec[i] = Math.min(255, b[i + 1] * g);
    },
  };
})();
