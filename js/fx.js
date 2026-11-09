// ===== Particle systems (port of Unity ParticleSystem subset) + game feel FX =====
'use strict';
const fxImg = new Map();
let softDot = null;
function getSoftDot() {
  if (softDot) return softDot;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); softDot = c; return c;
}
async function loadFxTex(f) { if (!f || fxImg.has(f)) return; fxImg.set(f, null); fxImg.set(f, await loadImg(A + 'fx/' + f)); }

// curve helpers
function evalCurve(pts, t) {
  if (!pts || !pts.length) return 1;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; const k = (t - a[0]) / ((b[0] - a[0]) || 1); return a[1] + (b[1] - a[1]) * k; }
  return pts[pts.length - 1][1];
}
// MinMaxCurve: r = random 0..1 fixed per particle, t = normalized time
function mmv(m, t = 0, r = Math.random()) {
  if (!m) return 0;
  switch (m.s) {
    case 0: return m.a;
    case 1: return m.a * evalCurve(m.c, t);
    case 2: return m.a * lerp(evalCurve(m.c2, t), evalCurve(m.c, t), r);
    case 3: return lerp(m.b, m.a, r);
  }
  return m.a;
}
function evalGrad(g, t) {
  if (!g) return [1, 1, 1, 1];
  const c = g.c, a = g.a; let rgb = [1, 1, 1], al = 1;
  if (c && c.length) {
    if (t <= c[0][0]) rgb = c[0].slice(1); else if (t >= c[c.length - 1][0]) rgb = c[c.length - 1].slice(1);
    else for (let i = 1; i < c.length; i++) if (t <= c[i][0]) { const k = (t - c[i - 1][0]) / ((c[i][0] - c[i - 1][0]) || 1); rgb = [0, 1, 2].map(j => lerp(c[i - 1][j + 1], c[i][j + 1], k)); break; }
  }
  if (a && a.length) {
    if (t <= a[0][0]) al = a[0][1]; else if (t >= a[a.length - 1][0]) al = a[a.length - 1][1];
    else for (let i = 1; i < a.length; i++) if (t <= a[i][0]) { const k = (t - a[i - 1][0]) / ((a[i][0] - a[i - 1][0]) || 1); al = lerp(a[i - 1][1], a[i][1], k); break; }
  }
  return [rgb[0], rgb[1], rgb[2], al];
}
function mmgv(m, t, r) {
  if (!m) return [1, 1, 1, 1];
  if (m.s === 0) return m.c;
  if (m.s === 2) return m.c.map((v, i) => lerp(m.c2[i], v, r));
  const a = evalGrad(m.g, m.s === 1 ? t : t);
  if (m.g2) { const b = evalGrad(m.g2, t); return a.map((v, i) => lerp(b[i], v, r)); }
  return a;
}
// quaternions for 3D emission directions
const Q = {
  mul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; },
  rot(q, v) { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; },
  euler(e) { // unity ZXY order, degrees
    const d = Math.PI / 360; const cx = Math.cos(e[0] * d), sx = Math.sin(e[0] * d), cy = Math.cos(e[1] * d), sy = Math.sin(e[1] * d), cz = Math.cos(e[2] * d), sz = Math.sin(e[2] * d);
    const qx = [sx, 0, 0, cx], qy = [0, sy, 0, cy], qz = [0, 0, sz, cz];
    return Q.mul(Q.mul(qy, qx), qz);
  },
};
function nodeQuat(sc, go) {
  let q = [0, 0, 0, 1]; let n = sc.node(go); const chain = [];
  while (n && chain.length < 200) { chain.unshift(n); n = sc.node(n.parent); }
  for (const m of chain) {
    let lq;
    if (m.rz != null) { const h = m.rz * Math.PI / 360; lq = [0, 0, Math.sin(h), Math.cos(h)]; }
    else { const t = sc.gos[m.id] && sc.gos[m.id].t; lq = t ? [t[3], t[4], t[5], t[6]] : [0, 0, 0, 1]; }
    if (m.sx < 0 || m.sy < 0) { /* mirrored: approximate */ }
    q = Q.mul(q, lq);
  }
  return q;
}

class PSys {
  constructor(sc, comp) {
    this.sc = sc; this.c = comp; this.p = comp.ps; this.go = comp.go;
    this.parts = []; this.playing = false; this.t = 0; this.acc = 0; this.burstDone = new Set(); this.last = null;
    const tex = this.p.r && this.p.r.tex; this.texF = tex && tex.f; this.add = tex ? !!tex.add : true;
    if (this.texF) loadFxTex(this.texF);
    this.children = null;
  }
  kids() {
    if (this.children) return this.children;
    this.children = this.sc.descendants(this.go).slice(1).flatMap(g => this.sc.compsOf(g, 'PS')).filter(c => c.sys).map(c => c.sys);
    return this.children;
  }
  play(withChildren = true) {
    if (!this.playing) { this.playing = true; this.t = 0; this.burstDone.clear(); this.acc = 0; this.last = null; this.delay = mmv(this.p.delay); if (this.p.pre && this.p.loop) this.prewarm(); }
    if (withChildren) for (const k of this.kids()) k.play(false);
  }
  stop(withChildren = true) { this.playing = false; if (withChildren) for (const k of this.kids()) k.stop(false); }
  clear() { this.parts.length = 0; }
  prewarm() { const n = Math.min(1.5, mmv(this.p.life, 0, 1)); for (let t = 0; t < n; t += 1 / 30) this.update(1 / 30, true); }
  emitter() {
    const m = this.sc.wm(this.go);
    return { x: m[4], y: m[5], s: this.p.scaling === 1 ? 1 : Math.hypot(m[0], m[1]) || 1, q: nodeQuat(this.sc, this.go) };
  }
  spawn(em) {
    const p = this.p; if (this.parts.length >= Math.min(p.max || 1000, 400)) return;
    const r = Math.random(); const sh = p.shape;
    let pos = [0, 0, 0], dir = [0, 0, 1];
    if (sh) {
      const ang = (sh.angle || 0) * Math.PI / 180; const rad = (sh.radius || 0) * (sh.rad === 0 ? 1 : Math.sqrt(Math.random()) * (sh.rad || 1) + (1 - (sh.rad ?? 1)));
      const arc = (sh.arc || 360) * Math.PI / 180; const th = Math.random() * arc;
      switch (sh.type) {
        case 0: case 1: case 2: case 3: { // sphere / hemisphere
          let v = [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)]; const L = Math.hypot(...v) || 1; v = v.map(a => a / L);
          if (sh.type >= 2) v[2] = Math.abs(v[2]);
          dir = v; pos = v.map(a => a * (sh.radius || 0) * Math.random()); break;
        }
        case 4: case 7: case 8: case 9: { // cone
          const rr = (sh.radius || 0) * Math.sqrt(Math.random()); const c = Math.cos(th), s = Math.sin(th);
          pos = [c * rr, s * rr, 0];
          const k = (sh.radius > 0 ? rr / sh.radius : Math.random());
          const a2 = ang * k; dir = [c * Math.sin(a2), s * Math.sin(a2), Math.cos(a2)]; break;
        }
        case 5: case 15: case 16: { const b = sh.scl || [1, 1, 1]; pos = [rnd(-.5, .5) * b[0], rnd(-.5, .5) * b[1], rnd(-.5, .5) * b[2]]; dir = [0, 0, 1]; break; }
        case 10: { const rr = (sh.radius || 0) * Math.sqrt(Math.random()); pos = [Math.cos(th) * rr, Math.sin(th) * rr, 0]; dir = [Math.cos(th), Math.sin(th), 0]; break; }
        case 12: { pos = [rnd(-1, 1) * (sh.radius || 1), 0, 0]; dir = [0, 1, 0]; break; }
        default: dir = [rnd(-1, 1), rnd(-1, 1), 0];
      }
      if (sh.scl && sh.type !== 5) pos = pos.map((v, i) => v * (sh.scl[i] || 1));
      if (sh.rot && (sh.rot[0] || sh.rot[1] || sh.rot[2])) { const sq = Q.euler(sh.rot); pos = Q.rot(sq, pos); dir = Q.rot(sq, dir); }
      if (sh.pos) pos = pos.map((v, i) => v + (sh.pos[i] || 0));
    }
    const wp = Q.rot(em.q, pos), wd = Q.rot(em.q, dir);
    let dl = Math.hypot(wd[0], wd[1]); // projected direction
    let dx = wd[0], dy = wd[1];
    if (dl < 1e-3) { dx = rnd(-.15, .15); dy = rnd(-.15, .15); dl = 1; } // pointing at camera: tiny spread
    const sp = mmv(p.speed, 0, r) * em.s;
    const life = Math.max(0.02, mmv(p.life, 0, Math.random()));
    this.parts.push({
      x: em.x + wp[0] * em.s, y: em.y + wp[1] * em.s, vx: dx * sp, vy: dy * sp, t: 0, life,
      size: mmv(p.size, 0, Math.random()) * em.s, rot: mmv(p.rot, 0, Math.random()), r, r2: Math.random(),
      col: mmgv(p.color, this.t / (p.dur || 1), Math.random()),
      ox: em.x, oy: em.y,
    });
  }
  update(dt, pre) {
    const p = this.p;
    const active = this.sc.activeIH(this.go);
    if (this.playing && active) {
      if (this.delay > 0) this.delay -= dt;
      else {
        const em = this.emitter();
        this.t += dt;
        const dur = p.dur || 1;
        if (this.t > dur) { if (p.loop) { this.t -= dur; this.burstDone.clear(); } else { this.playing = false; } }
        if (this.playing) {
          this.acc += mmv(p.rate, this.t / dur) * dt;
          if (p.rateD && p.rateD.a > 0 && this.last) this.acc += Math.hypot(em.x - this.last[0], em.y - this.last[1]) * mmv(p.rateD, this.t / dur);
          this.last = [em.x, em.y];
          let n = Math.min(60, Math.floor(this.acc)); this.acc -= n;
          (p.bursts || []).forEach((b, i) => { if (!this.burstDone.has(i) && this.t >= b.t) { this.burstDone.add(i); n += Math.min(80, Math.round(mmv(b.n))); } });
          for (let i = 0; i < n; i++) this.spawn(em);
        }
      }
    }
    if (!this.parts.length) return;
    const g = mmv(p.grav) * 9.81;
    const vel = p.vel;
    const keep = [];
    for (const q of this.parts) {
      q.t += dt; if (q.t >= q.life) continue;
      const k = q.t / q.life;
      q.vy -= g * dt;
      let ex = 0, ey = 0; if (vel) { ex = mmv(vel.x, k, q.r2); ey = mmv(vel.y, k, q.r2); }
      q.x += (q.vx + ex) * dt; q.y += (q.vy + ey) * dt;
      if (p.rotL) q.rot += mmv(p.rotL, k, q.r2) * dt;
      keep.push(q);
    }
    this.parts = keep;
  }
  draw(ctx) {
    const p = this.p; if (!this.parts.length) return;
    const im = (this.texF && fxImg.get(this.texF)) || getSoftDot();
    const local = !p.world; let offx = 0, offy = 0;
    if (local) { const m = this.sc.wm(this.go); offx = m[4]; offy = m[5]; }
    const uv = p.uv; const tiles = uv ? Math.max(1, uv.tx * uv.ty) : 1;
    const fw = uv ? im.width / uv.tx : im.width, fh = uv ? im.height / uv.ty : im.height;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = this.add ? 'lighter' : 'source-over';
    const mode = p.r ? p.r.mode : 0;
    for (const q of this.parts) {
      const k = q.t / q.life;
      let c = q.col; if (p.col) { const cl = mmgv(p.col, k, q.r2); c = [c[0] * cl[0], c[1] * cl[1], c[2] * cl[2], c[3] * cl[3]]; }
      if (c[3] <= 0.01) continue;
      let s = q.size * (p.sz ? mmv(p.sz, k, q.r2) : 1); if (s <= 0.001) continue;
      const x = local ? q.x - q.ox + offx : q.x, y = local ? q.y - q.oy + offy : q.y;
      ctx.save(); ctx.translate(x, y);
      ctx.globalAlpha = clamp(c[3], 0, 1);
      const img = tintFx(im, c);
      let sx = 0, sy = 0;
      if (uv) { const fr = Math.floor(clamp(mmv(uv.fr, k, q.r2), 0, 0.9999) * tiles * (uv.cyc || 1)) % tiles; sx = (fr % uv.tx) * fw; sy = Math.floor(fr / uv.tx) * fh; }
      if (mode === 1) { // stretched billboard along velocity
        const v = Math.hypot(q.vx, q.vy) || 1; ctx.rotate(Math.atan2(q.vy, q.vx));
        const len = s * (p.r.ls || 1) + v * (p.r.vs || 0);
        ctx.scale(1, -1); ctx.drawImage(img, sx, sy, fw, fh, -len / 2, -s / 2, len, s);
      } else {
        ctx.rotate(-q.rot); ctx.scale(1, -1);
        ctx.drawImage(img, sx, sy, fw, fh, -s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = prevOp; ctx.globalAlpha = 1;
  }
}
const fxTint = new WeakMap();
function tintFx(im, c) {
  if (c[0] > 0.96 && c[1] > 0.96 && c[2] > 0.96) return im;
  let m = fxTint.get(im); if (!m) { m = new Map(); fxTint.set(im, m); }
  const key = [c[0], c[1], c[2]].map(v => Math.round(clamp(v, 0, 1) * 12)).join(',');
  let cv = m.get(key); if (cv) return cv;
  cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const x = cv.getContext('2d');
  x.drawImage(im, 0, 0); x.globalCompositeOperation = 'multiply';
  x.fillStyle = `rgb(${key.split(',').map(v => (v / 12 * 255) | 0).join(',')})`; x.fillRect(0, 0, cv.width, cv.height);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(im, 0, 0);
  m.set(key, cv); return cv;
}
function initParticles(sc) {
  const all = Object.values(sc.comps).filter(c => c.k === 'PS' && c.ps);
  for (const c of all) c.sys = new PSys(sc, c);
  for (const c of all) if (c.ps.awake) c.autoPlay = true;
}
function tickParticles(sc, dt) {
  for (const c of Object.values(sc.comps)) {
    if (c.k !== 'PS' || !c.sys) continue;
    if (c.autoPlay && !c.sys.playing && sc.activeIH(c.go) && !c.autoDone) { c.sys.play(false); if (!c.ps.loop) c.autoDone = true; }
    c.sys.update(dt);
  }
}
function psOfRef(ref) { const c = S.comp(ref); if (c && c.k === 'PS') return c; const go = S.goOf(ref); return go ? S.compsOf(go, 'PS')[0] : null; }
function stopParticlesUnder(go) { for (const g of S.descendants(go)) for (const c of S.compsOf(g, 'PS')) if (c.sys) c.sys.stop(false); }

// ---------- screen-space juice: confetti, step "shine" ----------
const Juice = {
  bits: [], flash: 0,
  confetti(n = 120) {
    const cols = ['#ff5a5f', '#ffb52e', '#35c46a', '#3aa0ff', '#b46bff', '#ff7ac8'];
    for (let i = 0; i < n; i++) this.bits.push({ x: rnd(0.1, 0.9), y: rnd(-0.2, 0), vx: rnd(-0.15, 0.15), vy: rnd(0.15, 0.45), r: rnd(0, 6), vr: rnd(-8, 8), s: rnd(6, 12), c: cols[i % cols.length], t: 0, life: rnd(2.2, 3.5) });
  },
  burst(cx = 0.5, cy = 0.45, n = 28) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = rnd(0.25, 0.7); this.bits.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0, vr: rnd(-4, 4), s: rnd(8, 16), c: '#fff6c8', star: true, t: 0, life: rnd(0.6, 1.0), drag: 2.2 }); }
    this.flash = 0.35;
  },
  draw(ctx, W, H, dt) {
    if (this.flash > 0) { ctx.globalAlpha = this.flash; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; this.flash = Math.max(0, this.flash - dt * 1.5); }
    if (!this.bits.length) return;
    const k = W / 400;
    for (const b of this.bits) {
      b.t += dt; if (b.drag) { b.vx *= 1 - b.drag * dt; b.vy *= 1 - b.drag * dt; } else b.vy += 0.25 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt * (b.star ? 1 : 1); b.r += b.vr * dt;
      const a = 1 - Math.max(0, (b.t - b.life * 0.7) / (b.life * 0.3));
      ctx.save(); ctx.translate(b.x * W, b.y * H); ctx.rotate(b.r); ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = b.c;
      if (b.star) { const s = b.s * k * (1 - b.t / b.life * 0.5); ctx.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? s * 0.4 : s; const an = i * Math.PI / 5; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(-b.s * k / 2, -b.s * k / 4, b.s * k, b.s * k / 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    this.bits = this.bits.filter(b => b.t < b.life);
  },
};
