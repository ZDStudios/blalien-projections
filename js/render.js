/* Blalien Projections — WebGL2 renderer: warped surfaces, generators, effects, masks */
'use strict';
(function () {
  const BP = window.BP;

  const VS = `#version 300 es
in vec3 aPos; in vec2 aUV; out vec2 vUV;
void main(){ vUV = aUV; gl_Position = vec4((aPos.x*2.0-1.0)*aPos.z, (1.0-aPos.y*2.0)*aPos.z, 0.0, aPos.z); }`;

  const FS_HEAD = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outColor;
uniform float uTime, uBeat, uAspect, uLevel, uBass, uMid, uHigh, uAudioOn;
uniform sampler2D uTexA, uTexB, uMask, uSpec;
uniform int uKindA, uKindB, uGenA, uGenB, uFitA, uFitB;
uniform vec3 uC1A, uC2A, uC1B, uC2B, uGlowColor;
uniform float uSpdA, uSpdB, uScA, uScB, uTexAspA, uTexAspB, uMix;
uniform float uZoom, uRot, uTile, uKaleido, uBlur, uHue, uSat, uContrast, uBright, uOpacity, uGlow, uGlowW;
uniform vec2 uSlide;
uniform int uMono, uInvert, uFlipX, uFlipY;

const float PI = 3.14159265, TAU = 6.2831853;
vec3 hsv2rgb(vec3 c){ vec4 K=vec4(1.,2./3.,1./3.,3.); vec3 p=abs(fract(c.xxx+K.xyz)*6.-K.www); return c.z*mix(K.xxx,clamp(p-K.xxx,0.,1.),c.y); }
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }
vec3 hueShift(vec3 c, float h){ const vec3 k=vec3(0.57735); float ca=cos(h); return c*ca + cross(k,c)*sin(h) + k*dot(k,c)*(1.-ca); }
float specAt(float x){ float v = texture(uSpec, vec2(x, .5)).r;
  float fake = .35 + .3*sin(x*17. + uTime*3.) * sin(x*5. - uTime*1.7) + .2*sin(uTime*4. + x*40.);
  return mix(clamp(fake,0.,1.), v, uAudioOn); }
float hexDist(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1., 1.732))), p.x); }

vec4 gen(int id, vec2 uv, vec3 c1, vec3 c2, float spd, float sc){
  float t = uTime * spd;
  vec2 p = (uv - .5) * vec2(uAspect, 1.) / sc;
  float r = length(p), a = atan(p.y, p.x);
  vec3 col = c1;
  if(id==0){ col = c1; }
  else if(id==1){ col = mix(c1, c2, clamp(uv.y + .25*sin(t + uv.x*3.), 0., 1.)); }
  else if(id==2){ float v = sin(p.x*6.+t) + sin(p.y*6.+t*1.3) + sin((p.x+p.y)*6.+t*.7) + sin(length(p*8.)-t*2.);
    col = mix(c1, c2, .5+.5*sin(v*1.5)); col = mix(col, hsv2rgb(vec3(v*.1+t*.05, .8, 1.)), .2); }
  else if(id==3){ float z = .3/max(r,.001) + t*1.5; float an = a/PI;
    float s1 = step(.5, fract(z*2.)), s2 = step(.5, fract(an*4. + t*.2));
    col = mix(c1, c2, abs(s1-s2)) * clamp(r*2.5, 0., 1.); }
  else if(id==4){ float v = .5+.5*sin(r*30. - t*4. - uBass*6.); col = mix(c1, c2, smoothstep(.3,.7,v)); }
  else if(id==5){ col = mix(c1, c2, step(.5, fract(uv.x*8./sc + t*.5))); }
  else if(id==6){ vec2 g = floor(p*6. + vec2(t*.5, 0.)); col = mix(c1, c2, mod(g.x+g.y, 2.)); }
  else if(id==7){ float hz = .45;
    if(uv.y < hz){ col = mix(vec3(0.), c2*.45, uv.y/hz);
      float d = length((uv - vec2(.5, hz-.12)) * vec2(uAspect, 1.));
      col += c1 * smoothstep(.16, .15, d) * (.55 + .45*step(.35, fract(uv.y*28.)));
    } else { float dy = uv.y - hz, z = .12/dy, x = (uv.x-.5)*z*uAspect;
      vec2 g = abs(fract(vec2(x*2., z + t*.8)) - .5);
      float l = max(1.-smoothstep(0., .05*z+.01, g.x), 1.-smoothstep(0., .05*z+.01, g.y));
      col = c1*l*min(1., dy*5.) + c2*.08; } }
  else if(id==8){ float f = fbm(p*3. + vec2(t*.2, t*.1)); f = fbm(p*3. + f*2. + t*.1); col = mix(c1*.1, mix(c1, c2, f), f*1.4); }
  else if(id==9){ col = vec3(0.);
    for(int i=0;i<3;i++){ float fi=float(i); vec2 q = p*(8.+fi*8.) + vec2(t*(.3+fi*.4), 0.);
      vec2 cid = floor(q), f = fract(q)-.5; float hh = hash(cid + fi*13.);
      vec2 o = vec2(hash(cid+3.1), hash(cid+7.7)) - .5;
      col += mix(c1, c2, hh) * smoothstep(.07, 0., length(f - o*.7)) * step(.55, hh) * (.6+.4*sin(t*3.+hh*20.)); } }
  else if(id==10){ float n = 6.; float aa = mod(a + t*.1, TAU/n); aa = abs(aa - PI/n); vec2 q = vec2(cos(aa), sin(aa))*r;
    float v = sin(q.x*20. - t*2.)*cos(q.y*20. + t) + sin(r*15. - t*3.);
    col = mix(c1, c2, .5+.5*v); col = mix(col, hsv2rgb(vec3(r - t*.1, .7, 1.)), .3); }
  else if(id==11){ col = c2*.05;
    for(int i=0;i<3;i++){ float fi=float(i); float y = .5 + sin(uv.x*(8.+fi*5.)/sc + t*(2.+fi)) * (.12 + uLevel*.2) * (1.-fi*.25);
      float d = abs(uv.y - y); col += mix(c1, c2, fi/2.) * (smoothstep(.012, 0., d) + smoothstep(.12, 0., d)*.25); } }
  else if(id==12){ col = hsv2rgb(vec3(t*.1, 1., 1.)); }
  else if(id==13){ col = mix(c2*0., c1, step(.5, 1.-fract(uBeat*max(spd,.25)*2.))); }
  else if(id==14){ float bins = 32.; float bx = floor(uv.x*bins)/bins; float v = specAt(bx + .5/bins);
    float on = step(1.-uv.y, v) * step(.12, fract(uv.x*bins)); col = mix(c2, c1, uv.y) * on; }
  else if(id==15){ vec2 q = vec2(uv.x, 1.-uv.y); float n = fbm(vec2(q.x*4.*uAspect/sc, q.y*3. - t*2.));
    float f = clamp(n*1.7 - q.y*1.3 + .2, 0., 1.); col = mix(c1*f, mix(c1, c2, f*f) , f*f*f) * 1.4; }
  else if(id==16){ vec2 g = fract(p*6.) - .5, cid = floor(p*6.); float ph = hash(cid);
    float rad = .18 + .15*sin(t*3. + ph*TAU) + uBass*.15; col = mix(c1, c2, ph) * smoothstep(rad, rad-.03, length(g)); }
  else if(id==17){ float v = sin(a*3. + r*20. - t*4.); col = mix(c1, c2, smoothstep(-.2, .2, v)); }
  else if(id==18){ float d = min(min(uv.x, 1.-uv.x), min(uv.y, 1.-uv.y));
    col = c1 * (smoothstep(.025, .0, d) + .015/(d+.02)) * (.7 + .3*sin(t*3.)); }
  else if(id==19){ float pos = fract(t*.3); float d = abs(uv.x - pos);
    col = c1*smoothstep(.06, 0., d) + c1*smoothstep(.3, 0., d)*.2 + c2*.05; }
  else if(id==20){ float v = 0.;
    for(int i=0;i<6;i++){ float fi=float(i); vec2 c = vec2(sin(t*.5+fi*1.7)*.4*uAspect, cos(t*.37+fi*2.3)*.35); vec2 d = p-c; v += .025/dot(d,d); }
    col = mix(c2*.15, c1, smoothstep(.9, 1.1, v)) + c2*smoothstep(1.6, 3., v)*.6; }
  else if(id==21){ float cols = 32./sc; float cx = floor(uv.x*cols); float sp = .4 + hash(vec2(cx, 1.))*1.2;
    float head = fract(t*sp*.25 + hash(vec2(cx, 9.))); float d = fract(head - uv.y);
    float trail = exp(-d*7.); float flick = step(.35, hash(floor(vec2(cx, uv.y*cols/uAspect*1.5)) + floor(t*6.)));
    col = mix(c2, c1, exp(-d*40.)) * trail * flick * step(.18, fract(uv.x*cols)); }
  else if(id==22){ float bins = 16.; float bx = floor(uv.x*bins)/bins; float v = specAt(bx + .5/bins);
    float hgt = abs(uv.y - .5)*2.; float on = step(hgt, v) * step(.15, fract(uv.x*bins)) * step(.3, fract(uv.y*24.));
    col = mix(c1, c2, hgt) * on; }
  else if(id==23){ vec2 hp = p*6.; vec2 rr = vec2(1., 1.732), hh = rr*.5;
    vec2 ga = mod(hp, rr) - hh, gb = mod(hp - hh, rr) - hh; vec2 gv = dot(ga,ga) < dot(gb,gb) ? ga : gb; vec2 cid = hp - gv;
    float pulse = .5+.5*sin(t*2. + hash(cid)*TAU + uBass*4.);
    col = mix(c1*(.15 + .85*pulse), c2, smoothstep(.42, .47, hexDist(gv))); }
  return vec4(col, 1.);
}
`;

  const FS_TAIL = `
vec4 sampleTex(sampler2D tex, vec2 uv, float texAsp, int fit){
  vec2 q = uv - .5;
  if(fit==0){ if(texAsp > uAspect) q.x *= uAspect/texAsp; else q.y *= texAsp/uAspect; }
  else if(fit==1){ if(texAsp > uAspect) q.y *= texAsp/uAspect; else q.x *= uAspect/texAsp; }
  q += .5;
  if(q.x<0.||q.x>1.||q.y<0.||q.y>1.) return vec4(0.);
  return texture(tex, q);
}
// Every source function has exactly one call site, and the loops use uniform
// bounds so the GPU compiler can't unroll/inline them into a giant shader.
vec4 src(int s, vec2 uv){
  int kind = s==0 ? uKindA : uKindB;
  if(kind==1){ bool a = s==0; return gen(a?uGenA:uGenB, uv, a?uC1A:uC1B, a?uC2A:uC2B, a?uSpdA:uSpdB, a?uScA:uScB); }
  if(kind==2) return s==0 ? sampleTex(uTexA, uv, uTexAspA, uFitA) : sampleTex(uTexB, uv, uTexAspB, uFitB);
  if(kind==3) return s==0 ? customA(uv, uTime*uSpdA) : customB(uv, uTime*uSpdB);
  if(kind==4) return vec4(0.,0.,0.,1.);
  return vec4(0.);
}
uniform int uSlot0, uSlot1, uTaps;
vec4 srcMix(vec2 uv){
  uv = fract(uv);
  vec4 r = vec4(0.);
  for(int s=uSlot0; s<uSlot1; s++){
    float w = uSlot1 - uSlot0 == 1 ? 1. : (s==0 ? 1.-uMix : uMix);
    r += src(s, uv) * w;
  }
  return r;
}
float maskAt(vec2 uv){ if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) return 0.; return texture(uMask, uv).a; }

void main(){
  vec2 uv = vUV;
  if(uFlipX==1) uv.x = 1.-uv.x;
  if(uFlipY==1) uv.y = 1.-uv.y;
  vec2 p = uv - .5; p.x *= uAspect;
  if(uKaleido > 1.5){ float seg = TAU/uKaleido; float an = mod(atan(p.y,p.x), seg); an = abs(an - seg*.5); p = vec2(cos(an), sin(an))*length(p); }
  float cs = cos(uRot), sn = sin(uRot); p = mat2(cs, -sn, sn, cs) * p;
  p /= uZoom; p.x /= uAspect;
  vec2 q = (p + .5) * uTile + uSlide;
  vec4 c = vec4(0.); float rad = uBlur*.04;
  for(int i=0;i<uTaps;i++){
    float an = float(i-1)*.785398;
    vec2 o = i==0 ? vec2(0.) : vec2(cos(an)/uAspect, sin(an))*rad;
    c += srcMix(q + o);
  }
  c /= float(uTaps);
  vec3 col = c.a > 0.0001 ? c.rgb / c.a : vec3(0.);
  if(uHue != 0.) col = hueShift(col, uHue*TAU);
  float l = dot(col, vec3(.299,.587,.114));
  col = mix(vec3(l), col, uSat);
  col = (col - .5)*uContrast + .5;
  col *= uBright;
  if(uMono==1) col = vec3(dot(col, vec3(.299,.587,.114)));
  if(uInvert==1) col = 1. - col;
  col = clamp(col, 0., 1.);
  float alpha = c.a;
  float m = maskAt(vUV);
  if(uGlow > 0.){ float s = 0.; vec2 w = vec2(uGlowW/uAspect, uGlowW);
    for(int i=0;i<12;i++){ float an = float(i)*.5236; s += maskAt(vUV + vec2(cos(an), sin(an))*w); }
    s /= 12.; float edge = clamp((m - s)*3., 0., 1.);
    col = mix(col, uGlowColor, edge*uGlow); alpha = max(alpha, edge*uGlow); }
  alpha *= m * uOpacity;
  outColor = vec4(col*alpha, alpha);
}`;

  const STUB = (name) => `vec4 ${name}(vec2 uv, float time){ return vec4(0.); }\n`;
  function fragmentSource(codeA, codeB) {
    const wrap = (name, code) => code ? `#define effect ${name}\n${code}\n#undef effect\n` : STUB(name);
    return FS_HEAD + wrap('customA', codeA) + wrap('customB', codeB) + FS_TAIL;
  }

  const hexCache = {};
  function rgb(hex) {
    if (hexCache[hex]) return hexCache[hex];
    let h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return (hexCache[hex] = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]);
  }

  // ------------------------------------------------------------ 2D canvas painters
  function fitFont(ctx, lines, w, h, font) {
    let size = (h / lines.length) * 0.82;
    ctx.font = `bold ${size}px "${font}", Impact, sans-serif`;
    const maxW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    if (maxW > w * 0.94) { size *= (w * 0.94) / maxW; ctx.font = `bold ${size}px "${font}", Impact, sans-serif`; }
    return size;
  }
  function paintText(ctx, w, h, text, font, color, bg) {
    ctx.clearRect(0, 0, w, h);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    const lines = String(text == null ? '' : text).split('\n');
    const size = fitFont(ctx, lines, w, h, font);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lh = size * 1.08, y0 = h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, y0 + i * lh));
  }
  function paintStrokes(ctx, w, h, strokes, progress) {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let total = 0;
    for (const s of strokes) total += s.pts.length / 2;
    let budget = progress < 1 ? total * progress : Infinity;
    for (const s of strokes) {
      const n = s.pts.length / 2, m = Math.min(n, Math.floor(budget));
      if (m < 1) break;
      budget -= n;
      ctx.strokeStyle = s.c; ctx.lineWidth = Math.max(1, s.w * w);
      ctx.shadowColor = s.c; ctx.shadowBlur = s.g ? s.w * w * 2.5 : 0;
      ctx.beginPath();
      ctx.moveTo(s.pts[0] * w, s.pts[1] * h);
      if (m === 1) ctx.lineTo(s.pts[0] * w + 0.1, s.pts[1] * h);
      for (let i = 1; i < m; i++) ctx.lineTo(s.pts[i * 2] * w, s.pts[i * 2 + 1] * h);
      ctx.stroke();
      if (s.g) ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
  function shapePath(ctx, mask, x, y, W, H) {
    const cx = x + W / 2, cy = y + H / 2;
    ctx.beginPath();
    switch (mask.shape) {
      case 'circle': ctx.ellipse(cx, cy, W / 2, H / 2, 0, 0, Math.PI * 2); break;
      case 'triangle': ctx.moveTo(cx, y); ctx.lineTo(x + W, y + H); ctx.lineTo(x, y + H); ctx.closePath(); break;
      case 'polygon': {
        const n = Math.max(3, Math.round(mask.sides || 6));
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
          ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * W / 2, cy + Math.sin(a) * H / 2);
        }
        ctx.closePath(); break;
      }
      case 'star':
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.42 : 1;
          ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r * W / 2, cy + Math.sin(a) * r * H / 2);
        }
        ctx.closePath(); break;
      case 'heart': {
        const X = (u) => x + u * W, Y = (v) => y + v * H;
        ctx.moveTo(X(0.5), Y(0.25));
        ctx.bezierCurveTo(X(0.5), Y(0.05), X(0.0), Y(0.0), X(0.0), Y(0.32));
        ctx.bezierCurveTo(X(0.0), Y(0.6), X(0.35), Y(0.75), X(0.5), Y(1.0));
        ctx.bezierCurveTo(X(0.65), Y(0.75), X(1.0), Y(0.6), X(1.0), Y(0.32));
        ctx.bezierCurveTo(X(1.0), Y(0.0), X(0.5), Y(0.05), X(0.5), Y(0.25));
        ctx.closePath(); break;
      }
      default: {
        const r = Math.min(W, H) / 2 * (mask.radius || 0);
        if (ctx.roundRect && r > 0) ctx.roundRect(x, y, W, H, r); else ctx.rect(x, y, W, H);
      }
    }
  }
  function paintMask(ctx, w, h, mask, img) {
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    const f = (mask.feather || 0) * Math.min(w, h) * 0.12;
    if (f > 0.5 && 'filter' in ctx) ctx.filter = `blur(${f.toFixed(1)}px)`;
    ctx.fillStyle = '#fff';
    const pad = mask.shape === 'path' || mask.shape === 'image' ? 0 : f;
    if (mask.shape === 'text') {
      ctx.translate(pad, pad);
      paintText(ctx, w - pad * 2, h - pad * 2, mask.text, mask.font, '#fff', null);
    } else if (mask.shape === 'path') {
      const pts = mask.path || [];
      if (pts.length < 6) ctx.fillRect(0, 0, w, h);
      else {
        ctx.beginPath(); ctx.moveTo(pts[0] * w, pts[1] * h);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * w, pts[i + 1] * h);
        ctx.closePath(); ctx.fill();
      }
    } else if (mask.shape === 'image') {
      if (img && img.naturalWidth) {
        const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
        const tc = tmp.getContext('2d', { willReadFrequently: true });
        tc.drawImage(img, 0, 0, w, h);
        const id = tc.getImageData(0, 0, w, h), d = id.data;
        let hasAlpha = false;
        for (let i = 3; i < d.length; i += 16) if (d[i] < 250) { hasAlpha = true; break; }
        const thr = mask.threshold * 255;
        for (let i = 0; i < d.length; i += 4) {
          let a;
          if (hasAlpha && mask.useAlpha) a = d[i + 3];
          else {
            const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            a = BP.clamp((l - thr) * 6 + 128, 0, 255);
          }
          d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = a;
        }
        tc.putImageData(id, 0, 0);
        ctx.drawImage(tmp, 0, 0);
      } else ctx.fillRect(0, 0, w, h);
    } else {
      shapePath(ctx, mask, pad, pad, w - pad * 2, h - pad * 2);
      ctx.fill();
    }
    ctx.restore();
    if (mask.invert) {
      ctx.globalCompositeOperation = 'xor';
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  BP.paint = { text: paintText, strokes: paintStrokes, mask: paintMask, shapePath };

  // ------------------------------------------------------------ Renderer
  const FIT = { cover: 0, contain: 1, stretch: 2 };
  const BLEND = { normal: 0, add: 1, screen: 2, multiply: 3 };

  class Renderer {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.opts = opts;
      const gl = (this.gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.preserve }));
      if (!gl) throw new Error('This browser does not support WebGL2.');
      this.frame = 0;
      this.N = 24;
      this.lost = false;
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; console.warn('WebGL context lost'); });
      canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.init(); });
      this.init();
    }

    init() {
      const gl = this.gl;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      if (this.media) this.media.forEach((e) => e.el && e.el.pause && e.el.pause());
      this.progs = new Map();
      this.media = new Map();
      this.canv = new Map();
      this.cam = null;
      const N = this.N, idx = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = y * (N + 1) + x;
        idx.push(i, i + 1, i + N + 1, i + 1, i + N + 2, i + N + 1);
      }
      this.indexCount = idx.length;
      this.verts = new Float32Array((N + 1) * (N + 1) * 5);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.verts.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

      this.blackTex = this.makeTex(new Uint8Array([0, 0, 0, 0]));
      this.whiteTex = this.makeTex(new Uint8Array([255, 255, 255, 255]));
      this.specTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.specTex);
      this.texParams();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 64, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(64));
      this.program('', '');
    }

    texParams() {
      const gl = this.gl;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    makeTex(px) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      this.texParams();
      if (px) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return t;
    }
    upload(tex, src) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (e) { /* not ready */ }
    }

    compile(codeA, codeB) {
      const gl = this.gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log); }
        return s;
      };
      const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, fragmentSource(codeA, codeB));
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUV');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const locs = {};
      return { p, loc: (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n))) };
    }
    program(codeA, codeB) {
      const key = codeA + '\u0001' + codeB;
      let pr = this.progs.get(key);
      if (pr) return pr;
      if (this.lost || this.gl.isContextLost()) return null;
      try { pr = this.compile(codeA, codeB); }
      catch (e) {
        console.warn('Shader error', e.message);
        if (key === '\u0001') return null;
        pr = this.program('', '');
      }
      if (pr) this.progs.set(key, pr);
      return pr;
    }
    // Returns null if code compiles, else the error log (used by the editor).
    testShader(code) {
      try { const pr = this.compile(code, ''); this.progs.set(code + '\u0001', pr); return null; }
      catch (e) { return e.message; }
    }

    // ---------------------------------------------------------- sources
    mediaEntry(state, id) {
      let e = this.media.get(id);
      if (e) return e;
      const m = (state.media || []).find((x) => x.id === id);
      if (!m) return null;
      e = { id, kind: m.kind, el: null, tex: this.makeTex(), ready: false, w: 1, h: 1, used: 0, fresh: true };
      this.media.set(id, e);
      BP.Media.url(m).then((url) => {
        if (!url) { e.missing = true; return; }
        if (m.kind === 'video') {
          const v = document.createElement('video');
          v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
          v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
          v.addEventListener('loadeddata', () => { e.w = v.videoWidth; e.h = v.videoHeight; e.ready = true; });
          if ('requestVideoFrameCallback' in v) {
            e.rvfc = true;
            const cb = () => { e.fresh = true; v.requestVideoFrameCallback(cb); };
            v.requestVideoFrameCallback(cb);
          }
          v.src = url; v.play().catch(() => {});
          e.el = v;
        } else {
          const im = new Image();
          im.onload = () => { e.w = im.naturalWidth; e.h = im.naturalHeight; this.upload(e.tex, im); e.ready = true; };
          im.src = url;
          e.el = im;
        }
      });
      return e;
    }
    mediaTex(state, id) {
      const e = this.mediaEntry(state, id);
      if (!e || !e.ready) return null;
      e.used = this.frame;
      if (e.kind === 'video') {
        const v = e.el;
        if (v.paused) v.play().catch(() => {});
        if (e.uploaded !== this.frame && (e.fresh || !e.rvfc) && v.readyState >= 2) {
          this.upload(e.tex, v); e.fresh = false; e.uploaded = this.frame;
        }
      }
      return e;
    }
    cameraTex() {
      if (!this.cam) {
        const cam = (this.cam = { tex: this.makeTex(), ready: false, w: 16, h: 9 });
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then((stream) => {
            const v = document.createElement('video');
            v.muted = true; v.playsInline = true; v.srcObject = stream;
            v.onloadeddata = () => { cam.w = v.videoWidth; cam.h = v.videoHeight; cam.ready = true; };
            v.play().catch(() => {});
            cam.el = v;
          }).catch((err) => { cam.error = err.message || String(err); });
        } else cam.error = 'Camera needs https or localhost';
      }
      const cam = this.cam;
      if (cam.ready && cam.uploaded !== this.frame) { this.upload(cam.tex, cam.el); cam.uploaded = this.frame; }
      return cam.ready ? cam : null;
    }
    canvasTex(key, hash, w, h, paint) {
      let e = this.canv.get(key);
      if (!e) { e = { c: document.createElement('canvas'), tex: this.makeTex(), hash: null }; this.canv.set(key, e); }
      e.used = this.frame;
      if (e.hash !== hash) {
        if (e.c.width !== w || e.c.height !== h) { e.c.width = w; e.c.height = h; }
        paint(e.c.getContext('2d'), w, h);
        this.upload(e.tex, e.c);
        e.hash = hash;
      }
      return e;
    }

    bindSource(pr, slot, c, unit, state, s, aspect, t) {
      const gl = this.gl;
      let kind = 0, tex = this.blackTex, texAsp = 1, fit = FIT[c.fit] || 0, gen = 0;
      switch (c.type) {
        case 'gen': kind = 1; gen = BP.GEN_INDEX[c.gen] || 0; break;
        case 'color': kind = 1; gen = 0; break;
        case 'custom': kind = 3; break;
        case 'black': kind = 4; break;
        case 'media': { const e = c.media && this.mediaTex(state, c.media); if (e) { kind = 2; tex = e.tex; texAsp = e.w / e.h; } break; }
        case 'camera': { const e = this.cameraTex(); if (e) { kind = 2; tex = e.tex; texAsp = e.w / e.h; } break; }
        case 'text': {
          const W = 1024, H = BP.clamp(Math.round(1024 / aspect), 32, 2048);
          const e = this.canvasTex(s.id + slot + 't', [c.text, c.font, c.textColor, c.bgColor, W, H].join('|'), W, H,
            (ctx, w, h) => paintText(ctx, w, h, c.text, c.font, c.textColor, c.bgColor));
          kind = 2; tex = e.tex; texAsp = W / H; fit = 2; break;
        }
        case 'draw': {
          const W = 1024, H = BP.clamp(Math.round(1024 / aspect), 32, 2048);
          const strokes = c.strokes || [];
          const last = strokes[strokes.length - 1];
          const prog = c.drawAnim ? (t / Math.max(0.5, c.drawDur)) % 1.15 : 1;
          const hash = [strokes.length, last ? last.pts.length : 0, last ? last.c + last.w : '', W, H, c.drawAnim ? prog.toFixed(3) : ''].join('|');
          const e = this.canvasTex(s.id + slot + 'd', hash, W, H, (ctx, w, h) => paintStrokes(ctx, w, h, strokes, Math.min(1, prog)));
          kind = 2; tex = e.tex; texAsp = W / H; fit = 2; break;
        }
        default: kind = 0;
      }
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const L = pr.loc;
      gl.uniform1i(L('uTex' + slot), unit);
      gl.uniform1i(L('uKind' + slot), kind);
      gl.uniform1i(L('uGen' + slot), gen);
      gl.uniform1i(L('uFit' + slot), fit);
      gl.uniform1f(L('uTexAsp' + slot), texAsp);
      gl.uniform3fv(L('uC1' + slot), rgb(c.c1));
      gl.uniform3fv(L('uC2' + slot), rgb(c.c2));
      gl.uniform1f(L('uSpd' + slot), c.speed);
      gl.uniform1f(L('uSc' + slot), Math.max(0.05, c.scale));
    }

    maskTex(state, s, aspect) {
      const m = s.mask;
      if (m.shape === 'rect' && !m.radius && !m.feather && !m.invert) return this.whiteTex;
      const W = 512, H = BP.clamp(Math.round(512 / aspect), 16, 1536);
      let img = null, imgKey = '';
      if (m.shape === 'image' && m.image) {
        const e = this.mediaEntry(state, m.image);
        if (e && e.ready && e.kind === 'image') { img = e.el; imgKey = 'ok'; }
      }
      const pathKey = m.shape === 'path' ? m.path.length + ':' + (m.path[m.path.length - 1] || 0) : '';
      const hash = [m.shape, m.radius, m.sides, m.text, m.font, m.image, imgKey, m.threshold, m.useAlpha, m.invert, m.feather, pathKey, W, H].join('|');
      return this.canvasTex(s.id + 'mask', hash, W, H, (ctx, w, h) => paintMask(ctx, w, h, m, img)).tex;
    }

    // ---------------------------------------------------------- frame
    resize() {
      const c = this.canvas;
      if (this.opts.fixed) return;
      const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr || 2);
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }

    render(state, now, layers) {
      const gl = this.gl, S = state.settings;
      if (this.lost) return;
      this.frame++;
      this.resize();
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const bg = rgb(S.bg);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (this.frame % 90 === 0) this.housekeep();
      if (S.blackout) return;

      const t = now / 1000;
      const beat = ((Date.now() - (S.beatT0 || 0)) / (60000 / Math.max(20, S.bpm || 120)));
      const A = BP.Audio;
      if (!this.opts.noAudio) A.update(S.audioGain);
      const audioOn = A.an && A.ctx && A.ctx.state === 'running' ? 1 : 0;
      if (audioOn) {
        gl.bindTexture(gl.TEXTURE_2D, this.specTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 1, gl.RED, gl.UNSIGNED_BYTE, A.spec);
      }
      gl.enable(gl.BLEND);
      const frame = { t, beat, audioOn };
      for (const layer of layers || [{ surfaces: state.surfaces, mul: 1 }]) {
        if (layer.mul <= 0) continue;
        for (const s of layer.surfaces) if (s.visible) this.drawSurface(state, s, frame, layer.mul * S.master);
      }
    }

    drawSurface(state, s, F, mul) {
      const gl = this.gl, S = state.settings, fx = s.fx, A = BP.Audio;
      const mix = s.followX ? S.xfade : s.mix;
      const useA = mix < 0.999, useB = mix > 0.001;
      const pr = this.program(useA && s.a.type === 'custom' ? s.a.code : '', useB && s.b.type === 'custom' ? s.b.code : '');
      if (!pr) return;
      gl.useProgram(pr.p);
      const L = pr.loc;
      const aspect = BP.surfaceAspect(s, S.aspect);

      // modulation
      const band = { level: A.level, bass: A.bass, mid: A.mid, high: A.high }[fx.audioBand] || 0;
      const am = fx.audio * band;
      const tgt = fx.audioTarget;
      let opacity = fx.opacity * mul, bright = fx.bright, zoom = fx.zoom, hue = fx.hue + F.t * fx.hueSpeed, rot = (fx.rotate * Math.PI) / 180 + F.t * fx.rotSpeed;
      if (fx.audio > 0) {
        if (tgt === 'opacity') opacity *= 1 - fx.audio + am * 1.4;
        else if (tgt === 'bright') bright *= 1 + am * 2;
        else if (tgt === 'zoom') zoom *= 1 + am * 0.6;
        else if (tgt === 'hue') hue += am;
        else if (tgt === 'rotate') rot += am * Math.PI;
      }
      if (fx.pulse > 0) opacity *= 1 - fx.pulse + fx.pulse * Math.exp(-(F.beat % 1) * 5);
      if (fx.strobe > 0) opacity *= ((F.beat * fx.strobe) % 1) < 0.5 ? 1 : 0;
      if (opacity <= 0.001) return;

      gl.uniform1f(L('uTime'), F.t);
      gl.uniform1f(L('uBeat'), F.beat % 4096);
      gl.uniform1f(L('uAspect'), aspect);
      gl.uniform1f(L('uLevel'), A.level); gl.uniform1f(L('uBass'), A.bass);
      gl.uniform1f(L('uMid'), A.mid); gl.uniform1f(L('uHigh'), A.high);
      gl.uniform1f(L('uAudioOn'), F.audioOn);
      gl.uniform1f(L('uMix'), mix);
      gl.uniform1i(L('uSlot0'), useA ? 0 : 1);
      gl.uniform1i(L('uSlot1'), useB ? 2 : 1);
      gl.uniform1i(L('uTaps'), fx.blur > 0 ? 9 : 1);

      this.bindSource(pr, 'A', s.a, 0, state, s, aspect, F.t);
      this.bindSource(pr, 'B', s.b, 1, state, s, aspect, F.t);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex(state, s, aspect));
      gl.uniform1i(L('uMask'), 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.specTex);
      gl.uniform1i(L('uSpec'), 3);

      gl.uniform1f(L('uZoom'), Math.max(0.02, zoom));
      gl.uniform1f(L('uRot'), rot);
      gl.uniform1f(L('uTile'), Math.max(1, fx.tile));
      gl.uniform2f(L('uSlide'), (F.t * fx.slideX) % 1000, (F.t * fx.slideY) % 1000);
      gl.uniform1f(L('uKaleido'), Math.round(fx.kaleido));
      gl.uniform1f(L('uBlur'), fx.blur);
      gl.uniform1f(L('uHue'), hue % 1);
      gl.uniform1f(L('uSat'), fx.sat);
      gl.uniform1f(L('uContrast'), fx.contrast);
      gl.uniform1f(L('uBright'), bright);
      gl.uniform1f(L('uOpacity'), Math.min(1, opacity));
      gl.uniform1f(L('uGlow'), fx.glow);
      gl.uniform1f(L('uGlowW'), fx.glowWidth);
      gl.uniform3fv(L('uGlowColor'), rgb(fx.glowColor));
      gl.uniform1i(L('uMono'), fx.mono ? 1 : 0);
      gl.uniform1i(L('uInvert'), fx.invert ? 1 : 0);
      gl.uniform1i(L('uFlipX'), fx.flipX ? 1 : 0);
      gl.uniform1i(L('uFlipY'), fx.flipY ? 1 : 0);

      switch (BLEND[fx.blend] || 0) {
        case 1: gl.blendFunc(gl.ONE, gl.ONE); break;
        case 2: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); break;
        case 3: gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA); break;
        default: gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }

      // geometry
      const N = this.N, H = BP.homography(s.pts), v = this.verts;
      let k = 0;
      for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) {
        const u = x / N, w = y / N;
        const p = BP.warp(s, u, w, H);
        v[k++] = p[0]; v[k++] = p[1]; v[k++] = p[2] > 0 ? p[2] : 1e-4; v[k++] = u; v[k++] = w;
      }
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    }

    housekeep() {
      const gl = this.gl;
      for (const [id, e] of this.media) {
        if (e.kind === 'video' && e.el && !e.el.paused && this.frame - e.used > 120) e.el.pause();
      }
      for (const [k, e] of this.canv) {
        if (this.frame - e.used > 600) { gl.deleteTexture(e.tex); this.canv.delete(k); }
      }
    }
    forgetMedia(id) {
      const e = this.media.get(id);
      if (!e) return;
      if (e.el && e.el.pause) { e.el.pause(); e.el.removeAttribute('src'); }
      this.gl.deleteTexture(e.tex);
      this.media.delete(id);
    }
  }

  BP.Renderer = Renderer;
})();
