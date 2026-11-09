// ===== Core: math, tweens, assets, audio =====
'use strict';
const A = 'assets/';
const G = {
  time: 0, dt: 0, tweens: [], frameWaiters: [], gen: 0,
  sprites: null, spines: null, so: null, audioMap: null,
  muted: false, vib: true,
};

// ---------- math ----------
const M = {
  mul(a, b) { // 2D affine [a,b,c,d,e,f]
    return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  },
  inv(m) {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  },
  ap(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- easing ----------
const E = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => t * (2 - t),
  inOutQuad: t => t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  inBack: t => { const s = 1.70158; return t * t * ((s + 1) * t - s); },
  outBack: t => { const s = 1.70158; t -= 1; return t * t * ((s + 1) * t + s) + 1; },
};

// ---------- tweens / async ----------
function tween(dur, fn, ease = E.linear, tag = null) {
  const gen = G.gen;
  return new Promise(res => {
    if (dur <= 0) { fn(1); res(); return; }
    G.tweens.push({ t: 0, dur, fn, ease, res, tag, gen });
  });
}
function killTweens(tag) {
  if (tag == null) return;
  for (const tw of G.tweens) if (tw.tag === tag) { tw.dead = true; tw.res(); }
  G.tweens = G.tweens.filter(t => !t.dead);
}
const wait = s => tween(s, () => { });
const frame = () => new Promise(r => G.frameWaiters.push({ r, gen: G.gen }));
async function waitUntil(fn) { while (!fn()) await frame(); }
function tickTweens(dt) {
  const list = G.tweens; G.tweens = [];
  const keep = [];
  for (const tw of list) {
    if (tw.dead || tw.gen !== G.gen) continue;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    try { tw.fn(tw.ease(k)); } catch (e) { console.warn(e); }
    if (k >= 1) tw.res(); else keep.push(tw);
  }
  G.tweens = keep.concat(G.tweens);
  const fw = G.frameWaiters; G.frameWaiters = [];
  for (const w of fw) if (w.gen === G.gen) w.r();
}

// ---------- assets ----------
const imgCache = new Map();
function loadImg(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const p = new Promise(res => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => { console.warn('img fail', src); res(null); };
    im.src = src;
  });
  imgCache.set(src, p);
  return p;
}
const spriteImg = new Map(); // guid -> HTMLImageElement
async function loadSprite(g) {
  if (!g || spriteImg.has(g)) return;
  const s = G.sprites[g]; if (!s) return;
  const im = await loadImg(A + 'sp/' + s.f);
  spriteImg.set(g, im);
}
const getJSON = u => fetch(u).then(r => r.json());

// ---------- audio ----------
const Audio2 = {
  ctx: null, buf: new Map(), loopSrc: null, loopId: 0, bgm: null,
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { }
  },
  async get(name) {
    if (!this.ctx) return null;
    if (this.buf.has(name)) return this.buf.get(name);
    const p = fetch(A + 'audio/' + name + '.ogg').then(r => r.ok ? r.arrayBuffer() : null)
      .then(ab => ab ? new Promise(res => this.ctx.decodeAudioData(ab, res, () => res(null))) : null).catch(() => null);
    this.buf.set(name, p);
    return p;
  },
  nameOf(id) { return typeof id === 'string' ? id : (G.audioMap && G.audioMap[id]); },
  async play(id, vol = 0.8) {
    const n = this.nameOf(id); if (!n || G.muted || !this.ctx) return;
    const b = await this.get(n); if (!b) return;
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = vol; s.connect(g).connect(this.ctx.destination); s.start();
  },
  async loop(id) {
    const n = this.nameOf(id); if (!n || G.muted || !this.ctx) return;
    if (this.loopName === n && this.loopSrc) return;
    this.stopLoop();
    this.loopName = n; const my = ++this.loopId;
    const b = await this.get(n); if (!b || my !== this.loopId) return;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = 0.7; s.connect(g).connect(this.ctx.destination); s.start();
    this.loopSrc = s;
  },
  stopLoop() { this.loopId++; this.loopName = null; if (this.loopSrc) { try { this.loopSrc.stop(); } catch (e) { } this.loopSrc = null; } },
  async startBgm() {
    if (!this.ctx || this.bgm) return;
    const b = await this.get('BGM_1'); if (!b) return;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = G.muted ? 0 : 0.25; s.connect(g).connect(this.ctx.destination); s.start();
    this.bgm = g;
  },
  setMuted(m) { G.muted = m; if (this.bgm) this.bgm.gain.value = m ? 0 : 0.25; if (m) this.stopLoop(); },
};
function vibrate(ms = 15) { if (G.vib && navigator.vibrate) try { navigator.vibrate(ms); } catch (e) { } }
