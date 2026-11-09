// ===== Step logic (port of the Unity step system) =====
'use strict';
let S = null; // current Scene
const Input = { handler: null, enabled: false, down: false, pos: [0, 0], downPos: [0, 0] };
const HUD = { progress: 0, setProgress(p) { this.progress = p; window.onProgress && window.onProgress(p); } };

function cfgOf(ref, sname) {
  const g = ref && ref.guid;
  if (g && G.so.so[g]) return G.so.so[g].d;
  const dg = G.so.def[sname];
  return dg && G.so.so[dg] ? G.so.so[dg].d : {};
}

// ---------- Tool visual ----------
class Tool {
  constructor(mb) {
    this.ok = !!mb;
    if (!mb) return;
    Tool.all.push(this); this.tiltT = 0; this.held = false; this.hap = 0;
    const d = mb.d;
    this.go = S.goOf(d.toolTrans) || mb.go;
    this.tuts = (d.tuts || []).map(r => S.goOf(r)).filter(Boolean);
    this.sg = S.comp(d.sortingGroup);
    const n = S.node(this.go);
    this.osx = n.sx; this.osy = n.sy;
    this.home = null;
    this.park();
  }
  offPos() { return [R.cam.x + R.halfW() + 5.5, R.cam.y - R.cam.size * 0.45]; }
  restPos() { return [R.cam.x + R.halfW() * 0.48, R.cam.y - R.cam.size * 0.52]; }
  park() { if (!this.ok) return; const p = this.offPos(); S.setWpos(this.go, p[0], p[1]); }
  setLayer() {
    if (!this.ok) return;
    const sgs = S.descendants(this.go).flatMap(g => S.compsOf(g, 'SG'));
    if (this.sg) sgs.unshift(this.sg);
    for (const sg of sgs) { sg.l = LAYER_TOOL; sg.o = Math.max(sg.o0, 100) + (sg === this.sg ? 0 : sg.o0); }
    if (!sgs.length) for (const sr of S.srsUnder(this.go)) { sr.l = LAYER_TOOL; sr.o = 100 + sr.o0; }
  }
  async moveIn() {
    if (!this.ok) return;
    S.setActive(this.go, true);
    const n = S.node(this.go);
    const f = clamp(R.cam.size / 5, 0.4, 1);
    n.sx = this.osx * f; n.sy = this.osy * f;
    const a = this.offPos(), b = this.restPos();
    this.home = b;
    S.setWpos(this.go, a[0], a[1]);
    await tween(0.5, k => S.setWpos(this.go, lerp(a[0], b[0], k), lerp(a[1], b[1], k)), E.outQuad, this);
  }
  async moveOut() {
    if (!this.ok) return;
    killTweens(this);
    const a = S.wpos(this.go), b = this.offPos();
    await tween(0.5, k => S.setWpos(this.go, lerp(a[0], b[0], k), lerp(a[1], b[1], k)), E.inQuad, this);
  }
  async moveBack() {
    if (!this.ok || !this.home) return;
    killTweens(this);
    const a = S.wpos(this.go), b = this.home;
    await tween(0.25, k => S.setWpos(this.go, lerp(a[0], b[0], k), lerp(a[1], b[1], k)), E.outQuad, this);
  }
  onDown() {
    if (!this.ok) return; killTweens(this); for (const t of this.tuts) S.setActive(t, false);
    this.held = true;
    const tip = this.tipNode(); this.tipTarget = tip ? S.wpos(tip) : null;
    tween(0.18, k => this.punchV = 1 + 0.1 * Math.sin(k * Math.PI), E.outQuad).then(() => this.punchV = 1);
    vibrate(12);
  }
  onDrag(delta) {
    if (!this.ok) return; const p = S.wpos(this.go); S.setWpos(this.go, p[0] + delta[0], p[1] + delta[1]);
    if (this.tipTarget) { this.tipTarget = [this.tipTarget[0] + delta[0], this.tipTarget[1] + delta[1]]; this.fixTip(); }
    this.tiltT = clamp(-delta[0] / Math.max(G.dt, 0.008) * 1.2, -10, 10);
    this.hap += G.dt; if (this.hap > 0.09) { this.hap = 0; vibrate(6); }
  }
  onUp() { this.held = false; this.tiltT = 0; this.tipTarget = null; }
  tipNode() { return this.tip && S.node(this.tip) ? this.tip : null; }
  // keep the working tip exactly where the finger drove it, whatever rotation/scale the tool has
  fixTip() {
    const tip = this.tipNode(); if (!tip || !this.tipTarget) return;
    const c = S.wpos(tip), p = S.wpos(this.go);
    S.setWpos(this.go, p[0] + this.tipTarget[0] - c[0], p[1] + this.tipTarget[1] - c[1]);
  }
  // tilt / squash pivot around the tool's working tip so the clean point never drifts
  tick(dt) {
    if (!this.ok) return; const n = S.node(this.go); if (!n || !S.activeIH(this.go)) return;
    const tip = this.tip && S.node(this.tip) ? this.tip : null;
    const before = tip ? S.wpos(tip) : null;
    const cur = n.tilt || 0; const tgt = this.held ? this.tiltT : 0;
    n.tilt = cur + (tgt - cur) * Math.min(1, dt * 12); if (Math.abs(n.tilt) < 0.01) n.tilt = 0;
    this.tiltT *= Math.max(0, 1 - dt * 6);
    const wob = this.held && Input.down ? Math.sin(G.time * 38) * 0.01 : 0;
    n.punch = (this.punchV || 1) + wob;
    if (this.held && this.tipTarget) this.fixTip();
    else if (before) { const after = S.wpos(tip); const p = S.wpos(this.go); S.setWpos(this.go, p[0] + before[0] - after[0], p[1] + before[1] - after[1]); }
  }
  pos() { return this.ok ? S.wpos(this.go) : Input.pos; }
}

// ---------- Step animation controller ----------
class SAC {
  constructor(go) {
    this.mb = S.mbOf(go, 'StepAnimationController');
    this.d = this.mb ? this.mb.d : {};
    this.loops = []; this.ps = new Set();
    this.init();
  }
  phases() {
    const d = this.d;
    return [d.startPhase, d.pickToolPhase, d.dropPhase, d.endPhase, d.tutorialPhase, ...(d.interactionPhases || [])].filter(Boolean);
  }
  init() {
    for (const ph of this.phases()) for (const a of ph.animations || []) initAnim(a);
  }
  async play(ph) {
    if (!ph || !ph.animations) return;
    if (ph.playParallel) {
      const ps = ph.animations.map(a => playAnim(a, this));
      if (!ph.skipAnims) await Promise.all(ps);
    } else for (const a of ph.animations) await playAnim(a, this);
  }
  start() { return this.d.useStartAnimation ? this.play(this.d.startPhase) : Promise.resolve(); }
  end() { return this.d.useEndAnimation ? this.play(this.d.endPhase) : Promise.resolve(); }
  pick() { if (this.d.usePickToolAnimation) this.play(this.d.pickToolPhase); }
  stop() { for (const l of this.loops) l.stop = true; this.loops = []; for (const p of this.ps) p.stop(); this.ps.clear(); }
  interact(id) {
    if (!this.d.useInteractionPhases) return Promise.resolve();
    const ph = (this.d.interactionPhases || []).find(p => p.phaseId === id);
    return this.play(ph);
  }
}
function srOfRef(ref) { const c = S.comp(ref); if (c && c.k === 'SR') return c; const go = S.goOf(ref); return go ? S.srOf(go) : null; }
function spineOfRef(ref) { const c = S.comp(ref); if (c && c.k === 'SPINE') return c; const go = S.goOf(ref); return go ? S.compsOf(go, 'SPINE')[0] : null; }
function initAnim(a) {
  switch (a.typeAnimation) {
    case 1: { const r = srOfRef(a.fadeRender); if (r) r.alpha = 0; break; }
    case 3: { const g = S.goOf(a.scaleObject); if (g) { const n = S.node(g); n.isx = n.isx ?? n.sx; n.isy = n.isy ?? n.sy; n.sx = 0; n.sy = 0; } break; }
    case 5: { const r = srOfRef(a.blinkRender); if (r) r.alpha = 0; break; }
    case 11: { const t = S.goOf(a.targetObj), s = S.goOf(a.switchObj); if (t) S.setActive(t, true); if (s) S.setActive(s, false); break; }
    case 12: { const r = srOfRef(a.fadeRender); if (r) r.alpha = 0; break; }
    case 300: { const ps = psOfRef(a.particleSystem); if (ps && ps.sys) { ps.sys.stop(); ps.sys.clear(); ps.autoPlay = false; } break; }
    case 100: {
      const sp = spineOfRef(a.skeletonAnimation); if (!sp) break;
      sp.pending = inst => { if (a.useInitAnimation) { inst.setSkin(a.initSkin); inst.play(a.initAnimName, a.loopInitAnim); } else { inst.setSkin(a.animSkin); inst.freeze(a.animName); } };
      if (sp.inst) sp.pending(sp.inst);
      break;
    }
  }
}
async function playAnim(a, sac) {
  if (a.delay > 0) await wait(a.delay);
  switch (a.typeAnimation) {
    case 1: { const r = srOfRef(a.fadeRender); if (!r) break; S.setActive(r.go, true); const d = a.fadeInDuration || 0.5; await tween(d, k => r.alpha = k); break; }
    case 2: {
      const r = srOfRef(a.fadeRender); if (!r) break; const a0 = r.alpha;
      await tween(a.fadeOutDuration || 0.5, k => r.alpha = a0 * (1 - k)); if (!a.activeWhenFinished) S.setActive(r.go, false); break;
    }
    case 3: {
      const g = S.goOf(a.scaleObject); if (!g) break; const n = S.node(g); S.setActive(g, true);
      const tx = n.isx ?? 1, ty = n.isy ?? 1; await tween(a.scaleDuration || 0.5, k => { n.sx = tx * k; n.sy = ty * k; }); break;
    }
    case 4: {
      const g = S.goOf(a.scaleObject); if (!g) break; const n = S.node(g); const x0 = n.sx, y0 = n.sy;
      await tween(a.scaleDuration || 0.5, k => { n.sx = x0 * (1 - k); n.sy = y0 * (1 - k); }); if (!a.activeWhenFinished) S.setActive(g, false); break;
    }
    case 5: {
      const r = srOfRef(a.blinkRender); if (!r) break; S.setActive(r.go, true);
      for (let i = 0; i < 6; i++) await tween(0.25, k => r.alpha = i % 2 ? 1 - k : k);
      break;
    }
    case 6: {
      const g = S.goOf(a.wobbleRender); if (!g) break; const lp = { stop: false }; sac.loops.push(lp);
      const r0 = S.getRz(g); const n = S.node(g);
      (async () => { while (!lp.stop) { await tween(0.1, k => n.rz = r0 + 5 * k); await tween(0.2, k => n.rz = r0 + 5 - 10 * k); await tween(0.1, k => n.rz = r0 - 5 + 5 * k); } n.rz = r0; })();
      break;
    }
    case 7: { const g = S.goOf(a.offsetObject); if (g) S.node(g).rz = a.angleOffsetZ; break; }
    case 9: {
      const g = S.goOf(a.scaleObject); if (!g) break; const n = S.node(g); const x0 = n.sx, y0 = n.sy; const to = a.to || { x: 1, y: 1 };
      const once = () => tween(a.scaleDuration || 0.5, k => { n.sx = lerp(x0, to.x, k); n.sy = lerp(y0, to.y, k); });
      if (a.loop) {
        const lp = { stop: false }; sac.loops.push(lp); let c = 0;
        (async () => { while (!lp.stop && (!a.loopCount || c < a.loopCount)) { await once(); if (a.loopType === 1) await tween(a.scaleDuration || 0.5, k => { n.sx = lerp(to.x, x0, k); n.sy = lerp(to.y, y0, k); }); else { n.sx = x0; n.sy = y0; } c++; } })();
      } else await once();
      break;
    }
    case 10: {
      const g = S.goOf(a.moveObject); if (!g) break; const p0 = S.wpos(g); const t = a.moveTo || { x: 0, y: 0 };
      await tween(a.moveDuration || 0.5, k => S.setWpos(g, lerp(p0[0], t.x, k), lerp(p0[1], t.y, k))); break;
    }
    case 11: { const t = S.goOf(a.targetObj), s = S.goOf(a.switchObj); if (t) S.setActive(t, false); if (s) S.setActive(s, true); break; }
    case 12: { const r = srOfRef(a.fadeRender); if (!r) break; S.setActive(r.go, true); const a0 = r.alpha; await tween(a.fadeDuration || 0.5, k => r.alpha = lerp(a0, a.alphaValue, k)); break; }
    case 13: {
      const g = S.goOf(a.rotateObj); if (!g) break; const r0 = S.getRz(g); const to = (a.rotateTo || { z: 0 }).z; const n = S.node(g);
      const once = () => tween(a.rotateDuration || 0.5, k => n.rz = lerp(r0, a.rotateMode ? r0 + to : to, k));
      if (a.isLoopRotate) { const lp = { stop: false }; sac.loops.push(lp); let c = 0; (async () => { while (!lp.stop && (!a.rotateLoopCount || c < a.rotateLoopCount)) { await once(); c++; } })(); }
      else await once();
      break;
    }
    case 14: case 15: {
      const sp = spineOfRef(a.fadeSkeletonAnim); if (!sp) break; S.setActive(sp.go, true);
      const inn = a.typeAnimation === 14; const d = inn ? (a.fadeInSpineDuration || 0.15) : (a.fadeOutSpineDuration || 0.5);
      const a0 = sp.alpha; await tween(d, k => sp.alpha = inn ? k : a0 * (1 - k)); if (!inn && !a.activeWhenFinished) S.setActive(sp.go, false); break;
    }
    case 100: {
      const sp = spineOfRef(a.skeletonAnimation); if (!sp) break; S.setActive(sp.go, true);
      await waitUntil(() => sp.inst || sp.failed);
      if (!sp.inst) break;
      sp.inst.setSkin(a.animSkin); const pr = sp.inst.play(a.animName, a.loopAnim);
      if (!a.loopAnim) await pr; break;
    }
    case 200: { const g = S.goOf(a.obj); if (g) S.setActive(g, !!a.isActive); break; }
    case 300: { const ps = psOfRef(a.particleSystem); if (ps && ps.sys) { S.setActive(ps.go, true); ps.sys.play(true); sac.ps.add(ps.sys); } break; }
  }
}

// ---------- Mask drawer ----------
// Per-plane cache in sprite pixel space: strokes are applied incrementally,
// so rendering a plane is a single drawImage (no full-screen compositing).
class PlaneCache {
  constructor(sr, mode) {
    this.sr = sr; this.mode = mode;
    const s = G.sprites[sr.sp], im = spriteImg.get(sr.sp); this.ok = !!(s && im); if (!this.ok) return;
    const k = Math.min(1, 1024 / Math.max(im.width, im.height));
    this.cw = Math.max(1, Math.round(im.width * k)); this.ch = Math.max(1, Math.round(im.height * k));
    let src = im;
    if (k < 1) { src = document.createElement('canvas'); src.width = this.cw; src.height = this.ch; src.getContext('2d').drawImage(im, 0, 0, this.cw, this.ch); }
    this.src = src;
    this.cv = document.createElement('canvas'); this.cv.width = this.cw; this.cv.height = this.ch;
    this.cx = this.cv.getContext('2d');
    if (mode === 'mask') this.cx.drawImage(src, 0, 0, this.cw, this.ch);
    else this.pat = this.cx.createPattern(src, 'no-repeat');
  }
  T() { // world -> cache pixel
    const s = G.sprites[this.sr.sp]; let w = s.w / s.ppu, h = s.h / s.ppu; if (this.sr.dm) { w = this.sr.sz[0]; h = this.sr.sz[1]; }
    const P = [(this.sr.fx ? -1 : 1) * this.cw / w, 0, 0, -(this.sr.fy ? -1 : 1) * this.ch / h, s.px * this.cw, (1 - s.py) * this.ch];
    return M.mul(P, M.inv(S.wm(this.sr.go)));
  }
  stroke(a, b, r) {
    if (!this.ok) return;
    const c = this.cx, T = this.T();
    c.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
    if (this.mode === 'mask') { c.globalCompositeOperation = 'destination-out'; c.strokeStyle = c.fillStyle = '#000'; }
    else {
      c.globalCompositeOperation = 'source-over';
      const I = M.inv(T); try { this.pat.setTransform(new DOMMatrix([I[0], I[1], I[2], I[3], I[4], I[5]])); } catch (e) { }
      c.strokeStyle = c.fillStyle = this.pat;
    }
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = r * 2;
    c.beginPath();
    if (a && (a[0] !== b[0] || a[1] !== b[1])) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
    else { c.arc(b[0], b[1], r, 0, Math.PI * 2); c.fill(); }
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'source-over';
  }
  fadeStep(a) {
    if (!this.ok) return; const c = this.cx; c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = a;
    if (this.mode === 'mask') { c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000'; c.fillRect(0, 0, this.cw, this.ch); }
    else c.drawImage(this.src, 0, 0, this.cw, this.ch);
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
}
class Drawer {
  constructor(mb) {
    const d = mb.d; this.d = d;
    this.areas = (d.fillAreas || []).map(r => S.colOf(r)).filter(Boolean);
    this.maskPlanes = (d.maskingPlanes || []).map(r => S.comp(r)).filter(c => c && c.k === 'SR');
    this.unmaskPlanes = (d.unmaskingPlanes || []).map(r => S.comp(r)).filter(c => c && c.k === 'SR');
    this.unmaskPlanes.forEach(p => { const i = this.maskPlanes.indexOf(p); if (i >= 0) this.maskPlanes.splice(i, 1); });
    this.maskPoint = S.goOf(d.maskPoint);
    this.vr = Math.max(0.1, d.visualRadius || 0.5); this.fr = Math.max(0.1, d.fillRadius || 0.5);
    for (const p of this.maskPlanes) S.drawers.set(p.id, { drawer: this, mode: 'mask' });
    for (const p of this.unmaskPlanes) S.drawers.set(p.id, { drawer: this, mode: 'unmask' });
    this.caches = new Map();
    this.state = 'init';
  }
  cacheOf(sr) { return this.caches.get(sr.id); }
  generate() {
    this.caches.clear();
    for (const p of this.maskPlanes) this.caches.set(p.id, new PlaneCache(p, 'mask'));
    for (const p of this.unmaskPlanes) this.caches.set(p.id, new PlaneCache(p, 'unmask'));
    this.pts = []; this.total = 0; this.filled = 0;
    const cols = this.d.matrixCol || 20, rows = this.d.matrixRow || 20;
    for (const a of this.areas) {
      const bb = S.colBounds(a); const list = [];
      for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
        const p = [bb.x0 + (bb.x1 - bb.x0) * c / cols, bb.y0 + (bb.y1 - bb.y0) * r / rows];
        if (S.pointIn(a, p)) list.push({ p, f: false });
      }
      if (!list.length) for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) list.push({ p: [bb.x0 + (bb.x1 - bb.x0) * c / cols, bb.y0 + (bb.y1 - bb.y0) * r / rows], f: false });
      this.pts.push(...list);
    }
    if (!this.areas.length) { // fallback: grid over plane bounds
      const sr = this.maskPlanes[0] || this.unmaskPlanes[0];
      const bb = sr ? S.spriteBounds(sr) : { x0: -3, y0: -3, x1: 3, y1: 3 };
      for (let r = 0; r <= 10; r++) for (let c = 0; c <= 10; c++) this.pts.push({ p: [lerp(bb.x0, bb.x1, c / 10), lerp(bb.y0, bb.y1, r / 10)], f: false });
    }
    this.total = this.pts.length;
    this.last = null; this.state = 'drawing';
  }
  start() { this.last = null; }
  draw(p) {
    for (const c of this.caches.values()) c.stroke(this.last, p, this.vr);
    const a = this.last || p; const steps = Math.min(60, Math.max(1, Math.ceil(dist(a, p) / (this.fr * 0.5))));
    for (let i = 0; i <= steps; i++) {
      const s = [lerp(a[0], p[0], i / steps), lerp(a[1], p[1], i / steps)];
      for (const pt of this.pts) if (!pt.f && dist(pt.p, s) <= this.fr) { pt.f = true; this.filled++; }
    }
    this.last = p;
  }
  end() { this.last = null; }
  percent() { return this.total ? this.filled / this.total : 1; }
  async finish() {
    this.state = 'finishing';
    await tween(0.35, k => { for (const c of this.caches.values()) c.fadeStep(0.25); });
    this.state = 'finished'; this.caches.clear();
    for (const p of this.unmaskPlanes) { p.alpha = 1; S.setActive(p.go, true); }
    for (const p of this.maskPlanes) S.setActive(p.go, false);
    const top = this.unmaskPlanes[0]; if (top) Shine.play(top);
  }
}

// ---------- base step ----------
class Step {
  constructor(mb) {
    this.mb = mb; this.d = mb.d; this.go = mb.go;
    this.sac = new SAC(mb.go);
    this.done = false;
    this.pickAudio = this.d.pickToolAudioId; this.dragAudio = this.d.dragToolAudioId;
  }
  tool(ref) { const mb = S.comp(ref); return new Tool(mb && mb.k === 'MB' ? mb : null); }
  async run() {
    Input.handler = null;
    await this.prepare();
    if (this.tl) { this.tl.setLayer(); this.tl.tip = (this.dr && this.dr.maskPoint) || this.mp || this.vp || this.cp || null; }
    await this.start();
    Input.handler = this; Input.enabled = true;
    await this.execute();
    await waitUntil(() => this.canComplete());
    Input.enabled = false; Input.handler = null;
    Audio2.stopLoop();
    await this.complete();
    this.done = true;
  }
  async prepare() { }
  async start() { await this.sac.start(); if (this.tl) await this.tl.moveIn(); }
  async execute() { }
  canComplete() { return this.finished; }
  async complete() { if (this.tl) await this.tl.moveOut(); await this.sac.end(); }
  down() { } drag() { } up() { } hold() { }
  playPick() { Audio2.play(this.pickAudio); }
  dragLoop() { if (this.dragAudio) Audio2.loop(this.dragAudio); }
  progress(p) { HUD.setProgress(p); }
}

class MaskStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.toolVisual);
    const dm = S.comp(this.d.maskDrawer);
    this.dr = dm ? new Drawer(dm) : null;
  }
  async prepare() { if (this.dr) { this.dr.generate(); } }
  async start() { if (this.tl) await this.tl.moveIn(); }
  down(p) { this.tl.onDown(); this.dr && this.dr.start(); this.playPick(); this.sac.pick(); }
  drag(p, delta) {
    this.tl.onDrag(delta);
    if (!this.dr) { this.finished = true; return; }
    // only the tool's clean point cleans, and only while it is over the object's collider
    const mp = this.dr.maskPoint ? S.wpos(this.dr.maskPoint) : this.tl.pos();
    const inArea = !this.dr.areas.length || this.dr.areas.some(a => S.distTo(a, mp) <= this.dr.vr * 0.5);
    if (inArea) { this.dr.draw(mp); this.dragLoop(); } else { this.dr.end(); Audio2.stopLoop(); }
    const pc = this.dr.percent(); this.progress(Math.min(1, pc / 0.8));
    if (pc >= 0.8) this.finished = true;
    if (Math.random() < 0.08) vibrate(8);
  }
  up() { this.dr && this.dr.end(); Audio2.stopLoop(); stopParticlesUnder(this.go); this.sac.stop(); if (!this.finished) this.tl.moveBack(); }
  async complete() { this.progress(1); if (this.dr) await this.dr.finish(); if (this.tl) await this.tl.moveOut(); }
}

function setLayerTree(go, l, add) {
  const sgs = S.descendants(go).flatMap(g => S.compsOf(g, 'SG'));
  const saved = [];
  if (sgs.length) for (const sg of sgs) { saved.push([sg, sg.l, sg.o]); sg.l = l; sg.o = add + sg.o; }
  else for (const sr of S.srsUnder(go)) { saved.push([sr, sr.l, sr.o]); sr.l = l; sr.o = add + sr.o; }
  return saved;
}
const restoreLayers = saved => { for (const [c, l, o] of saved) { c.l = l; c.o = o; } };
const nearestRoot = () => S.root;

class DragAndDropStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.visual);
    this.cfg = cfgOf(this.d.config, 'DragStepConfigSO');
    this.pl = (this.d.dragPlacements || []).map(p => {
      const ob = S.comp(p.obj); return { ...p, go: ob ? ob.go : S.goOf(p.obj), mb: ob, target: S.goOf(p.targetTrans), snap: S.goOf(p.snapTrans), done: false };
    }).filter(p => p.go);
    this.snapCount = 0;
  }
  async prepare() { for (const p of this.pl) S.setActive(p.go, true); if (!this.pl.length) this.finished = true; }
  async start() { if (this.tl) await this.tl.moveIn(); }
  hit(p) {
    for (const q of this.pl) if (!q.done && S.activeIH(q.go) && S.colliders(q.go).some(c => S.pointIn(c, p))) return q;
    let best = null, bd = 1.5;
    for (const q of this.pl) if (!q.done && S.activeIH(q.go)) { const d = dist(p, S.wpos(q.go)); if (d <= bd) { bd = d; best = q; } }
    return best;
  }
  down(p) {
    if (this.cur || this.busy) return;
    const q = this.hit(p); if (!q) return;
    this.cur = q; q.origin = S.wpos(q.go); q.origParent = S.node(q.go).parent;
    q.grab = [S.wpos(q.go)[0] - p[0], S.wpos(q.go)[1] - p[1]];
    S.reparent(q.go, null);
    q.saved = setLayerTree(q.go, LAYER_TOOL, 200);
    Audio2.play((q.mb && q.mb.d.dragAudioId) || this.pickAudio); this.sac.pick();
  }
  drag(p) { if (this.cur) S.setWpos(this.cur.go, p[0], p[1]); }
  async up(p) {
    const q = this.cur; if (!q) return; this.cur = null; this.busy = true;
    const sd = this.cfg.snapDistance ?? 2.5, dur = this.cfg.snapDuration ?? 0.25;
    const pos = S.wpos(q.go);
    const tg = q.target || q.snap;
    const can = (tg && dist(pos, S.wpos(tg)) <= sd) || (q.snap && dist(pos, S.wpos(q.snap)) <= sd);
    if (can && q.snap) {
      const to = S.wpos(q.snap); const n = S.node(q.go); const sx = n.sx, sy = n.sy; const ss = this.cfg.snapScale > 0 ? this.cfg.snapScale : 1;
      const r0 = S.getRz(q.go); const rt = q.haveRotation && q.snapRotation ? q.snapRotation.z : null;
      await tween(dur, k => { S.setWpos(q.go, lerp(pos[0], to[0], k), lerp(pos[1], to[1], k)); n.sx = sx * lerp(1, ss, k); n.sy = sy * lerp(1, ss, k); if (rt != null) n.rz = lerp(r0, rt, k); }, E.outQuad);
      let par;
      if (this.cfg.setToolParent) par = (this.d.useCollection && S.goOf(this.d.collection)) || (this.tl.ok ? this.tl.go : null) || q.target || this.go;
      else par = q.target || q.snap || q.origParent;
      S.reparent(q.go, par);
      q.done = true;
      if (this.cfg.deActiveAfterSnap) S.setActive(q.go, false);
      else { let hasSG = false; let n2 = S.node(par); while (n2) { if (S.compsOf(n2.id, 'SG').length) { hasSG = true; break; } n2 = S.node(n2.parent); } if (!hasSG) restoreLayers(q.saved); }
      Audio2.play((q.mb && q.mb.d.dropAudioId) || 'Drop_1'); vibrate(20);
      this.snapCount++; this.progress(this.snapCount / this.pl.length);
      if (this.snapCount >= this.pl.length) this.finished = true;
    } else {
      await tween(dur || 0.25, k => S.setWpos(q.go, lerp(pos[0], q.origin[0], k), lerp(pos[1], q.origin[1], k)), E.outQuad);
      restoreLayers(q.saved); S.reparent(q.go, q.origParent);
    }
    this.sac.stop(); this.busy = false;
  }
  async complete() { if (this.tl) await this.tl.moveOut(); }
}

class ScrapeStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.visual);
    this.cfg = cfgOf(this.d.config, 'ScrapeStepConfigSO');
    const cont = S.goOf(this.d.scrapeContainer);
    let objs = cont ? S.findMBs('ScrapeObject', cont) : [];
    if (!objs.length) objs = S.findMBs('ScrapeObject', this.go);
    if (!objs.length) objs = S.findMBs('ScrapeObject');
    this.objs = objs.map(o => ({ go: o.go, hit: false }));
    this.mp = S.goOf(this.d.maskPointTrans);
    this.count = 0;
  }
  down() { this.tl.onDown(); this.playPick(); this.sac.pick(); }
  drag(p, delta) {
    this.tl.onDrag(delta);
    const r = Math.max(this.cfg.distanceScrape || 0, 0.85);
    const pts = [this.mp ? S.wpos(this.mp) : p, this.tl.pos()];
    for (const o of this.objs) {
      if (o.hit || !S.activeIH(o.go)) continue;
      const cols = S.colliders(o.go);
      const touched = pts.some(q => cols.length ? cols.some(c => S.distTo(c, q) <= r) : dist(q, S.wpos(o.go)) <= r);
      if (touched) { o.hit = true; this.count++; this.scrape(o); this.dragLoop(); vibrate(12); }
    }
    this.progress(this.count / Math.max(1, this.objs.length));
    if (this.count >= this.objs.length) this.finished = true;
  }
  async scrape(o) {
    const n = S.node(o.go); const x0 = n.px, y0 = n.py; const sd = this.cfg.shakeDuration || 0.3;
    Audio2.play(this.dragAudio);
    await tween(sd, k => { const s = 0.1 * (1 - k); n.px = x0 + rnd(-s, s); n.py = y0 + rnd(-s, s); });
    n.px = x0; n.py = y0;
    const fade = this.cfg.isFadeOut ? tween(this.cfg.fadeDuration || 0.3, k => S.setAlphaTree(o.go, 1 - k)) : null;
    if (this.cfg.isForward) { const p = S.wpos(o.go); await tween(this.cfg.timeDrop || 1, k => S.setWpos(o.go, p[0], p[1] - k), E.inQuad); }
    if (fade) await fade;
    S.setActive(o.go, false);
  }
  up() { Audio2.stopLoop(); this.sac.stop(); if (!this.finished) this.tl.moveBack(); }
}

class BlowStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.visual);
    this.cfg = Object.assign({ blowForce: 10, radius: 1.5, torqueForce: 5, maxAngular: 10, forceDelay: 0, mode: 0 }, cfgOf(this.d.config, 'BlowStepConfigSO'));
    const cont = S.goOf(this.d.blowContainer);
    let objs = cont ? S.findMBs(['BlowObject', 'Leaf'], cont) : [];
    if (!objs.length) objs = S.findMBs(['BlowObject', 'Leaf'], this.go);
    this.objs = objs.map(o => ({ go: o.go, on: false, v: [0, 0], av: 0, t: 0 }));
    this.mp = S.goOf(this.d.maskPoint); this.count = 0;
  }
  async start() { if (this.tl) await this.tl.moveIn(); }
  down(p) { this.tl.onDown(); this.playPick(); this.sac.pick(); this.dragLoop(); }
  drag(p, delta) { this.tl.onDrag(delta); }
  hold(p) {
    const mp = this.mp ? S.wpos(this.mp) : p;
    const modeDirs = { 1: [0, 1], 2: [0, -1], 3: [-1, 0], 4: [1, 0], 5: [-.707, .707], 6: [.707, .707], 7: [-.707, -.707], 8: [.707, -.707] };
    for (const o of this.objs) {
      if (o.on || !S.activeIH(o.go)) continue;
      if (dist(mp, S.wpos(o.go)) <= this.cfg.radius) {
        o.on = true;
        let dir = modeDirs[this.cfg.mode || this.cfg.directionMode];
        if (!dir) { const dx = p[0] - Input.downPos[0], dy = p[1] - Input.downPos[1]; const L = Math.hypot(dx, dy); dir = L < 0.05 ? [0, 1] : [dx / L, dy / L]; }
        setTimeout(() => { }, 0);
        o.delay = this.cfg.forceDelay || 0;
        o.v = [dir[0] * this.cfg.blowForce + rnd(-1, 1), dir[1] * this.cfg.blowForce + rnd(-1, 1)];
        o.av = rnd(-1, 1) * this.cfg.torqueForce * 8;
        Audio2.play(this.dragAudio); vibrate(10);
      }
    }
  }
  tick(dt) {
    for (const o of this.objs) {
      if (!o.on || o.gone) continue;
      if (o.delay > 0) { o.delay -= dt; continue; }
      o.t += dt; o.v[1] -= 9.81 * dt;
      o.av = clamp(o.av, -this.cfg.maxAngular, this.cfg.maxAngular);
      const p = S.wpos(o.go); S.setWpos(o.go, p[0] + o.v[0] * dt, p[1] + o.v[1] * dt);
      const n = S.node(o.go); n.rz = S.getRz(o.go) + o.av * dt;
      if (o.t >= 1.5) { o.gone = true; S.setActive(o.go, false); this.count++; this.progress(this.count / this.objs.length); }
    }
    if (this.objs.length && this.count >= this.objs.length) this.finished = true;
    if (!this.objs.length) this.finished = true;
  }
  up() { Audio2.stopLoop(); this.sac.stop(); if (!this.finished) this.tl.moveBack(); }
  async complete() { if (this.tl) await this.tl.moveOut(); }
}

class ClickObjectStep extends Step {
  constructor(mb) {
    super(mb);
    this.cfg = cfgOf(this.d.customConfig, 'ClickObjectConfigSO');
    this.pl = (this.d.clickPlacements || []).map(p => ({ go: S.goOf(p.targetTrans), done: false })).filter(p => p.go);
    this.count = 0;
  }
  async start() { await this.sac.start(); }
  down(p) {
    const md = this.cfg.minClickDistance || 1.5;
    for (const q of this.pl) {
      if (q.done) continue;
      const cols = S.colliders(q.go);
      if (dist(p, S.wpos(q.go)) <= md || cols.some(c => S.pointIn(c, p))) {
        q.done = true; S.setActive(q.go, false); this.count++; vibrate(25); Audio2.play(this.pickAudio || 'ButtonClick');
        this.progress(this.count / this.pl.length);
        break;
      }
    }
    if (this.count >= this.pl.length) this.finished = true;
  }
  async complete() { await this.sac.end(); }
}

class DragToolStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.visual);
    this.cfg = Object.assign({ radius: 2.5, snapDuration: 0, activeAfterSnap: 1, actionAfterSnap: 2 }, cfgOf(this.d.config, 'DragToolStepConfigSO'));
    this.pl = (this.d.dragPlacements || []).map(p => ({ ...p, target: S.goOf(p.targetTrans), snap: S.goOf(p.snapTrans), done: false }));
    this.count = 0;
  }
  down() { if (this.busy) return; this.tl.onDown(); this.playPick(); this.sac.pick(); }
  drag(p, d) { if (!this.busy) this.tl.onDrag(d); }
  async up(p) {
    if (this.busy) return; this.sac.stop();
    const r = Math.max(this.cfg.radius || 0, 1.5);
    const tp = this.tl.pos();
    let best = null, bd = 1e9;
    for (const q of this.pl) {
      if (q.done) continue; const t = q.target || q.snap; if (!t) continue;
      const d = dist(tp, S.wpos(t));
      if (d < bd) { bd = d; best = q; }
    }
    if (best && bd <= r) {
      this.busy = true; best.done = true;
      if (best.snap) {
        const a = S.wpos(this.tl.go), b = S.wpos(best.snap); const r0 = S.getRz(this.tl.go);
        const rt = best.haveRotation && best.snapRotation ? best.snapRotation.z : null; const n = S.node(this.tl.go);
        await tween(this.cfg.snapDuration || 0, k => { S.setWpos(this.tl.go, lerp(a[0], b[0], k), lerp(a[1], b[1], k)); if (rt != null) n.rz = lerp(r0, rt, k); }, E.outQuad);
      }
      if (!this.cfg.activeAfterSnap) S.setActive(this.tl.go, false);
      Audio2.play(this.dragAudio); vibrate(20);
      await this.sac.interact(best.id);
      this.count++; this.progress(this.count / this.pl.length);
      if (this.count >= this.pl.length) this.finished = true;
      else {
        const n = S.node(this.tl.go); n.rz = null;
        if (this.cfg.actionAfterSnap === 0) await this.tl.moveIn();
        else if (this.cfg.actionAfterSnap === 1) { S.setActive(this.tl.go, true); await this.tl.moveBack(); }
        else S.setActive(this.tl.go, true);
      }
      this.busy = false;
    } else this.tl.moveBack();
  }
  async complete() { S.setActive(this.tl.go, true); await this.tl.moveOut(); await this.sac.end(); }
}

class SweepObjectStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.visual);
    this.cfg = cfgOf(this.d.config, 'SweepObjectConfigSO');
    let objs = (this.d.sweepObjects || []).map(r => S.goOf(r)).filter(Boolean);
    if (!objs.length) objs = S.findMBs('SweepObject', this.go).map(m => m.go);
    this.objs = objs.map(go => ({ go, gone: false }));
  }
  async start() { if (this.tl) await this.tl.moveIn(); }
  down(p) {
    if (this.cur) return;
    let q = this.objs.find(o => !o.gone && S.activeIH(o.go) && S.colliders(o.go).some(c => S.pointIn(c, p)));
    if (!q) { let bd = 1.5; for (const o of this.objs) if (!o.gone && S.activeIH(o.go)) { const d = dist(p, S.wpos(o.go)); if (d <= bd) { bd = d; q = o; } } }
    if (!q) return;
    this.cur = q; q.start = S.wpos(q.go); this.playPick();
  }
  drag(p, d) { if (this.cur) { const w = S.wpos(this.cur.go); S.setWpos(this.cur.go, w[0] + d[0], w[1] + d[1]); } }
  async up() {
    const q = this.cur; if (!q) return; this.cur = null;
    const now = S.wpos(q.go); const mv = dist(now, q.start);
    if (mv >= (this.cfg.distanceSweep || 1.5)) {
      q.gone = true; Audio2.play(this.dragAudio || 'drop_something'); vibrate(15);
      const dir = [(now[0] - q.start[0]) / mv, (now[1] - q.start[1]) / mv];
      tween(0.5, k => S.setWpos(q.go, now[0] + dir[0] * 2 * k, now[1] + dir[1] * 2 * k), E.outQuad);
      await tween(0.75, k => S.setAlphaTree(q.go, 1 - k));
      S.setActive(q.go, false);
      const left = this.objs.filter(o => !o.gone).length; this.progress(1 - left / this.objs.length);
      if (!left) this.finished = true;
    } else await tween(0.25, k => S.setWpos(q.go, lerp(now[0], q.start[0], k), lerp(now[1], q.start[1], k)), E.outQuad);
  }
  async prepare() { if (!this.objs.length) this.finished = true; }
  async complete() { if (this.tl) await this.tl.moveOut(); }
}

class VacuumStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.visual);
    this.cfg = cfgOf(this.d.config, 'VacuumStepconfigSO');
    this.vp = S.goOf(this.d.vacuumPoint);
    const cont = S.goOf(this.d.vacummContainer);
    let objs = S.findMBs(['VacuumObject', 'VacuumTrash'], this.go);
    if (!objs.length) objs = S.findMBs(['VacuumObject', 'VacuumTrash']).filter(o => !cont || !S.isUnder(o.go, cont));
    this.objs = objs.map(o => ({ go: o.go, on: false }));
    this.count = 0;
  }
  async start() { if (this.tl) await this.tl.moveIn(); }
  async prepare() { if (!this.objs.length) this.finished = true; }
  down() { this.tl.onDown(); this.playPick(); this.sac.pick(); this.dragLoop(); }
  drag(p, d) {
    this.tl.onDrag(d);
    const vp = this.vp ? S.wpos(this.vp) : this.tl.pos();
    for (const o of this.objs) if (!o.on && S.activeIH(o.go) && dist(vp, S.wpos(o.go)) <= 1.5) { o.on = true; this.count++; vibrate(8); }
    this.progress(this.count / this.objs.length);
    if (this.count >= this.objs.length) this.finished = true;
  }
  tick(dt) {
    const vp = this.vp ? S.wpos(this.vp) : this.tl.pos();
    const sp = Math.max(this.cfg.vacuumDuration || 5, 6);
    for (const o of this.objs) {
      if (!o.on || o.gone) continue;
      const p = S.wpos(o.go); const f = clamp(dt * sp, 0, 1);
      S.setWpos(o.go, lerp(p[0], vp[0], f), lerp(p[1], vp[1], f));
      const n = S.node(o.go); n.sx *= 1 - f * 0.3; n.sy *= 1 - f * 0.3;
      if (dist(S.wpos(o.go), vp) < 0.1) { o.gone = true; S.setActive(o.go, false); }
    }
  }
  up() { Audio2.stopLoop(); this.sac.stop(); if (!this.finished) this.tl.moveBack(); }
  async complete() { for (const o of this.objs) S.setActive(o.go, false); if (this.tl) await this.tl.moveOut(); }
}

class PesticideStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.visual);
    this.cfg = cfgOf(this.d.customConfig, 'PesticideConfigSO');
    const cont = S.goOf(this.d.pestContainer);
    let pests = cont ? S.findMBs('PestObject', cont) : [];
    if (!pests.length) pests = S.findMBs('PestObject');
    this.pests = pests.map(m => ({ go: m.go, d: m.d, on: false, area: S.colOf(m.d.areaCollider), sp: spineOfRef(m.d.skeletonAnimation), target: null }));
    this.mp = S.goOf(this.d.maskPoint);
    for (const p of this.pests) {
      if (p.area && p.area.k === 'POLY') { const pts = S.colliderPoly(p.area)[0]; const v = pts[(Math.random() * pts.length) | 0]; S.setWpos(p.go, v[0], v[1]); }
    }
    this.count = 0;
  }
  async execute() { this.walking = true; for (const p of this.pests) if (p.sp && p.sp.inst) p.sp.inst.play(p.d.walkAnimationName, true); }
  tick(dt) {
    if (!this.walking) return;
    for (const p of this.pests) {
      if (p.on || !p.area) continue;
      if (p.sp && p.sp.inst && !p.walkSet) { p.sp.inst.play(p.d.walkAnimationName, true); p.walkSet = true; }
      const pos = S.wpos(p.go);
      if (!p.target || dist(pos, p.target) < 0.05) {
        if (p.area.k === 'POLY') { const pts = S.colliderPoly(p.area)[0]; p.target = pts[(Math.random() * pts.length) | 0]; }
        else { const b = S.colBounds(p.area); p.target = [rnd(b.x0, b.x1), rnd(b.y0, b.y1)]; }
      }
      const dx = p.target[0] - pos[0], dy = p.target[1] - pos[1]; const L = Math.hypot(dx, dy) || 1;
      const sp = (p.d.moveSpeed || 1) * dt; const st = Math.min(sp, L);
      S.setWpos(p.go, pos[0] + dx / L * st, pos[1] + dy / L * st);
      S.setWorldRz(p.go, Math.atan2(dy, dx) * 180 / Math.PI + (p.d.angleOffset || 0));
    }
  }
  down() { this.tl.onDown(); this.playPick(); this.sac.pick(); this.dragLoop(); }
  drag(p, d) {
    this.tl.onDrag(d);
    const mp = this.mp ? S.wpos(this.mp) : this.tl.pos(); const r = this.cfg.radius || 1.5;
    for (const q of this.pests) if (!q.on && S.activeIH(q.go) && dist(mp, S.wpos(q.go)) <= r) { q.on = true; this.count++; this.kill(q); }
    this.progress(this.count / Math.max(1, this.pests.length));
  }
  async kill(q) {
    if (q.sp && q.sp.inst) q.sp.inst.play(q.d.idleAnimationName, true);
    vibrate(20); Audio2.play('Droplet');
    await wait(0.25); const n = S.node(q.go); const x0 = n.sx, y0 = n.sy;
    await tween(0.5, k => { n.sx = x0 * (1 - k); n.sy = y0 * (1 - k); }, E.inBack);
    S.setActive(q.go, false); q.dead = true;
  }
  up() { Audio2.stopLoop(); this.sac.stop(); if (this.count >= this.pests.length) this.finished = true; else this.tl.moveBack(); }
  async prepare() { if (!this.pests.length) this.finished = true; }
  async complete() { await waitUntil(() => this.pests.every(p => p.dead || !p.on)); this.walking = false; if (this.tl) await this.tl.moveOut(); await this.sac.end(); }
}

// Tweezers / peel step: drag the tool onto a patch (or tap the patch) -> it grabs it,
// then pull: the tool keeps holding the peeled edge and follows the finger (relative),
// release over the finish area -> the patch flies off with the tool.
class WaxToolStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.toolVisual);
    this.cfg = Object.assign({ snapDistance: 3, snapDuration: 0.25, delayToPeelDuration: 0.5 }, cfgOf(this.d.customConfig, 'WaxToolStepConfigSO'));
    const nz = o => o && (o.x || o.y);
    this.pl = (this.d.waxPlacements || []).map((p, i) => {
      const q = { ...p, target: S.goOf(p.targetTrans), snapT: S.goOf(p.snapTransform), back: S.goOf(p.waxBack), front: S.goOf(p.waxFront), mask: S.goOf(p.maskTransform), peel: S.colOf(p.peelArea), bound: S.colOf(p.boundArea), fin: S.colOf(p.finishArea), done: false };
      // serialized origins are runtime values (0,0 in the asset): use the authored local pose
      if (q.back) { const n = S.node(q.back); q.bo = [nz(p.peelOrigin) ? p.peelOrigin.x : n.px, nz(p.peelOrigin) ? p.peelOrigin.y : n.py, n.rz, n.m0.slice()]; }
      if (q.mask) { const n = S.node(q.mask); q.mo = [nz(p.maskOrigin) ? p.maskOrigin.x : n.px, nz(p.maskOrigin) ? p.maskOrigin.y : n.py, n.rz, n.m0.slice()]; }
      q.frontGo = q.front || (q.peel ? S.node(q.peel.go).parent : null);
      // restore the peel-fold masking lost in the rip: both the patch and its flipped flap are
      // visible only outside the mask, which sits above the fold line and slides with the peel
      const hasMask = q.mask && S.descendants(q.mask).some(g => S.compsOf(g, 'SM').length);
      for (const sr of q.back ? S.compsOf(q.back, 'SR') : []) { sr.o = 10 + i * 5 + 2; if (hasMask) sr.mi = 2; }
      for (const sr of q.frontGo ? S.compsOf(q.frontGo, 'SR') : []) { sr.o = 10 + i * 5 + 1; if (hasMask) sr.mi = 2; }
      return q;
    });
    this.count = 0;
  }
  origin(q) { const bn = S.node(q.back); const pm = bn.parent ? S.wm(bn.parent) : [1, 0, 0, 1, 0, 0]; return M.ap(pm, q.bo[0], q.bo[1]); }
  grabPoint(q) { return q.snapT ? S.wpos(q.snapT) : q.target ? S.wpos(q.target) : S.wpos(q.back); }
  finPoint(q) { return q.fin ? S.colCenter(q.fin) : null; }
  async start() { if (this.tl) await this.tl.moveIn(); }
  down(p) {
    if (this.busy) return;
    this.downP = p; this.moved = 0;
    if (!this.snapped) { this.tl.onDown(); this.playPick(); return; }
    const q = this.curT; if (!q) return;
    this.peeling = true; this.peelStart = p; this.org = this.origin(q);
    this.sac.pick(); vibrate(15);
  }
  drag(p, d) {
    if (this.busy) return;
    this.moved += Math.hypot(d[0], d[1]);
    if (!this.snapped) {
      this.tl.onDrag(d);
      // magnet: highlight the patch the tweezers are over
      const near = this.nearest(this.tl.pos());
      this.hot = near && near.d <= this.cfg.snapDistance ? near.q : null;
      return;
    }
    const q = this.curT; if (!q || !this.peeling) return;
    const o = this.org;
    let tp = [o[0] + p[0] - this.peelStart[0], o[1] + p[1] - this.peelStart[1]];
    if (q.bound) tp = S.closestPoint(q.bound, tp);
    this.peelTo(q, tp);
    const f = this.peelFrac(q); this.progress((this.count + f) / this.pl.length);
    this.hap = (this.hap || 0) + Math.hypot(d[0], d[1]); if (this.hap > 0.25) { this.hap = 0; vibrate(8); Audio2.play('Cloth_Pick', 0.35); }
  }
  peelTo(q, tp) {
    const o = this.org || this.origin(q);
    const mid = [(tp[0] + o[0]) / 2, (tp[1] + o[1]) / 2];
    const ang = Math.atan2(tp[1] - mid[1], tp[0] - mid[0]) * 180 / Math.PI * 2 + 180;
    S.setWpos(q.back, tp[0], tp[1]); S.setWorldRz(q.back, ang);
    if (q.mask) { S.setWpos(q.mask, mid[0], mid[1]); S.setWorldRz(q.mask, ang / 2); }
    // the tweezers hold the peeled edge
    const g = [tp[0] + this.toolOff[0], tp[1] + this.toolOff[1]];
    S.setWpos(this.tl.go, g[0], g[1]);
    this.tl.held = true; this.tl.tiltT = clamp((tp[0] - o[0]) * 12, -15, 15);
  }
  peelFrac(q) {
    const o = this.org || this.origin(q), f = this.finPoint(q), b = S.wpos(q.back);
    if (!f) return clamp(dist(b, o) / 1.5, 0, 1);
    return clamp(dist(b, o) / Math.max(0.3, dist(f, o)), 0, 1);
  }
  nearest(pt) {
    let best = null;
    for (const q of this.pl) { if (q.done || !q.target) continue; const d = dist(pt, this.grabPoint(q)); if (!best || d < best.d) best = { q, d }; }
    return best;
  }
  hitPatch(p) { return this.pl.find(q => !q.done && ((q.peel && S.distTo(q.peel, p) < 0.6) || (q.target && dist(p, this.grabPoint(q)) < 1.0))); }
  async snapTo(q) {
    this.busy = true; this.curT = q; this.hot = null;
    const a = S.wpos(this.tl.go), b = this.grabPoint(q);
    await tween(Math.max(0.15, this.cfg.snapDuration || 0), k => S.setWpos(this.tl.go, lerp(a[0], b[0], k), lerp(a[1], b[1], k)), E.outQuad);
    if (q.snapT) S.setWorldRz(this.tl.go, S.worldRz(q.snapT));
    vibrate(25); Audio2.play(this.pickAudio || 'Grap_Out', 0.8);
    const n = S.node(this.tl.go); tween(0.12, k => n.punch = 1 - 0.08 * Math.sin(k * Math.PI)).then(() => n.punch = 1);
    await Promise.race([this.sac.interact(q.id), wait(0.6)]);
    if (q.front) S.setActive(q.front, true);
    this.org = this.origin(q);
    this.toolOff = [b[0] - S.wpos(q.back)[0], b[1] - S.wpos(q.back)[1]];
    this.snapped = true; this.busy = false;
  }
  async up(p) {
    Audio2.stopLoop(); this.sac.stop();
    if (this.busy) return;
    if (!this.snapped) {
      const tapQ = this.moved < 0.25 ? this.hitPatch(p) : null;
      const near = this.nearest(this.tl.pos());
      const q = tapQ || (near && near.d <= this.cfg.snapDistance ? near.q : null);
      if (q) await this.snapTo(q); else this.tl.moveBack();
      return;
    }
    const q = this.curT; if (!q || !this.peeling) return; this.peeling = false; this.tl.held = false;
    const ok = (q.fin && S.pointIn(q.fin, S.wpos(q.back))) || this.peelFrac(q) >= 0.85;
    if (ok) {
      this.busy = true; q.done = true; this.snapped = false; this.curT = null;
      Audio2.play('Grap_Out', 0.9); vibrate([20, 30, 40]);
      const o = this.org, b0 = S.wpos(q.back), t0 = S.wpos(this.tl.go);
      const dir = [b0[0] - o[0], b0[1] - o[1]]; const L = Math.hypot(dir[0], dir[1]) || 1;
      const fly = [dir[0] / L * 2.5 + 1.5, dir[1] / L * 2.5 + 3];
      const r0 = S.getRz(q.back);
      if (q.frontGo) S.setActive(q.frontGo, false);
      { const sp = M.ap(R.viewM(), b0[0], b0[1]); Juice.burst(sp[0] / R.W, sp[1] / R.H, 12, false); }
      await tween(0.45, k => {
        S.setWpos(q.back, b0[0] + fly[0] * k, b0[1] + fly[1] * k); S.node(q.back).rz = r0 + 120 * k;
        S.setWpos(this.tl.go, t0[0] + fly[0] * k, t0[1] + fly[1] * k);
        S.setAlphaTree(q.back, 1 - k);
      }, E.inQuad);
      S.setActive(q.back, false);
      this.count++; this.progress(this.count / this.pl.length);
      const n = S.node(this.tl.go); n.rz = null; n.tilt = 0;
      if (this.count >= this.pl.length) { this.finished = true; this.busy = false; return; }
      await this.tl.moveIn(); this.busy = false;
    } else {
      // spring back, still holding the patch
      this.busy = true;
      const from = S.wpos(q.back), o = this.org;
      await tween(0.25, k => this.peelTo(q, [lerp(from[0], o[0], k), lerp(from[1], o[1], k)]), E.outBack);
      const reset = (go, oo) => { const n = S.node(go); n.px = oo[0]; n.py = oo[1]; n.rz = oo[2]; n.m0 = oo[3]; };
      reset(q.back, q.bo); if (q.mask) reset(q.mask, q.mo);
      this.peelTo(q, this.origin(q)); S.node(this.tl.go).tilt = 0;
      this.busy = false;
    }
  }
  async complete() { if (this.tl) await this.tl.moveOut(); }
}

class ScaleObjectStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.toolVisual);
    this.cfg = cfgOf(this.d.customConfig || this.d.scaleConfig, 'ScaleObjectConfigSO');
    this.cp = S.goOf(this.d.presetTrans || this.d.checkPoint);
    this.pl = (this.d.placements || this.d._scalePlacements || []).map(p => ({ id: p.id, col: S.colOf(p.validCollider), obj: S.goOf(p.scaleObject), t: 0, done: false }));
    for (const p of this.pl) if (p.obj) { const n = S.node(p.obj); p.sx = n.sx; p.sy = n.sy; n.sx = 0; n.sy = 0; }
    this.i = 0;
  }
  down() { this.tl.onDown(); this.playPick(); this.sac.pick(); }
  drag(p, d) { this.tl.onDrag(d); }
  hold(p) {
    const q = this.pl[this.i]; if (!q) { this.finished = true; return; }
    const cp = this.cp ? S.wpos(this.cp) : this.tl.pos();
    const over = (q.col && S.pointIn(q.col, cp)) || (q.obj && dist(cp, S.wpos(q.obj)) <= 1.5);
    if (over) {
      this.dragLoop(); q.t += G.dt; const k = clamp(q.t / (this.cfg.timeScale || 1), 0, 1);
      if (q.obj) { S.setActive(q.obj, true); const n = S.node(q.obj); n.sx = q.sx * k; n.sy = q.sy * k; }
      this.progress((this.i + k) / this.pl.length);
      if (k >= 1) { q.done = true; this.sac.interact(q.id); this.i++; if (this.i >= this.pl.length) this.finished = true; }
    } else Audio2.stopLoop();
  }
  up() { Audio2.stopLoop(); this.sac.stop(); if (!this.finished) this.tl.moveBack(); }
}

class FadeObjectStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.toolVisual);
    this.cfg = cfgOf(this.d.customConfig || this.d._config, 'FadeObjectConfigSO');
    this.mp = S.goOf(this.d.maskPoint);
    this.pl = (this.d.fadePlacements || this.d._fadePlacements || []).map(p => ({ ...p, col: S.colOf(p.validCollider), sr: S.comp(p.validSpriteRender), done: false }));
    for (const p of this.pl) if (p.sr) { p.sr.alpha = p.fromValue; p.a = p.fromValue; S.setActive(p.sr.go, false); }
  }
  down() { this.tl.onDown(); this.playPick(); this.sac.pick(); }
  drag(p, d) { this.tl.onDrag(d); }
  hold(p) {
    const tp = this.mp ? S.wpos(this.mp) : this.tl.ok ? this.tl.pos() : p;
    let any = false;
    for (const q of this.pl) {
      if (q.done || !q.sr) continue;
      if (q.col && S.pointIn(q.col, tp)) {
        any = true; S.setActive(q.sr.go, true);
        const rate = Math.abs(q.toValue - q.fromValue) / (this.cfg.fadeDuration || 1);
        const dd = q.toValue - q.a, st = rate * G.dt; q.a = Math.abs(dd) <= st ? q.toValue : q.a + Math.sign(dd) * st; if (Math.abs(q.a - q.toValue) < 0.005) { q.a = q.toValue; q.done = true; this.sac.interact(q.id); }
        q.sr.alpha = q.a;
      }
    }
    if (any) this.dragLoop(); else Audio2.stopLoop();
    this.progress(this.pl.filter(q => q.done).length / Math.max(1, this.pl.length));
  }
  up() { Audio2.stopLoop(); this.sac.stop(); if (this.pl.every(q => q.done)) this.finished = true; else this.tl.moveBack(); }
}

class ConnectTheDotsStep extends Step {
  constructor(mb) {
    super(mb);
    this.tl = this.tool(this.d.visual);
    this.bound = S.colOf(this.d.validBoundCollider);
    const bg = S.comp(this.d.bgSortingGroup);
    this.lines = (this.d.dotPlacements || []).map(p => ({ id: p.id, s: S.colOf(p.startCollider), e: S.colOf(p.endCollider), col: p.lineColor || { r: 1, g: 1, b: 1, a: 1 }, a: null, b: null, done: false }));
    const self = this;
    S.custom.push({ l: LAYER_GO, o: 9999, draw(ctx) { for (const L of self.lines) if (L.a && L.b) { ctx.lineCap = 'round'; ctx.lineWidth = 0.25; const c = L.col; ctx.strokeStyle = `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${c.a})`; ctx.beginPath(); ctx.moveTo(L.a[0], L.a[1]); ctx.lineTo(L.b[0], L.b[1]); ctx.stroke(); } } });
  }
  down(p) { this.tl.onDown(); this.cur = this.lines.find(L => !L.done && L.s && S.pointIn(L.s, p)); if (this.cur) { this.cur.a = S.colCenter(this.cur.s); this.cur.b = p; this.playPick(); } }
  drag(p, d) {
    this.tl.onDrag(d); const L = this.cur; if (!L) return;
    if (!this.bound || S.pointIn(this.bound, p)) L.b = p;
    if (L.e && S.pointIn(L.e, p)) this.finishLine(L);
  }
  finishLine(L) { L.b = S.colCenter(L.e); L.done = true; this.cur = null; vibrate(25); Audio2.play(this.dragAudio || 'Drop_1'); const n = this.lines.filter(x => x.done).length; this.progress(n / this.lines.length); if (n >= this.lines.length) this.finished = true; }
  up(p) { const L = this.cur; this.cur = null; if (L && !L.done) { if (L.e && S.pointIn(L.e, p)) this.finishLine(L); else { L.a = L.b = null; this.tl.moveBack(); } } }
}

class SpineStepBase extends Step {
  constructor(mb, toolRef) {
    super(mb);
    this.tl = this.tool(toolRef);
    this.pl = (this.d._spinePlacements || []).map(p => {
      const q = { ...p, col: S.colOf(p.validCollider), sp: spineOfRef(p.animation), done: false };
      if (q.sp) q.sp.pending = inst => { if (p.useInitAnimation) { inst.setSkin(p.initSkin); inst.play(p.initAnimation, p.loopInitAnim); } else { inst.setSkin(p.playSkin); inst.freeze(p.playAnimation); } };
      if (q.sp && q.sp.inst) q.sp.pending(q.sp.inst);
      return q;
    });
  }
  over(q, p) { return q.col ? S.pointIn(q.col, p) : (q.sp && dist(p, S.wpos(q.sp.go)) <= 1.5); }
  async prepare() { if (!this.pl.length) this.finished = true; }
  count() { return this.pl.filter(q => q.done).length; }
}
class ClickToPlaySpineStep extends SpineStepBase {
  constructor(mb) { super(mb, mb.d.toolvisual); }
  async up(p) {
    if (this.busy) return;
    const q = this.pl.find(q => !q.done && this.over(q, p)); if (!q) return;
    this.busy = true; q.done = true; vibrate(20); this.playPick();
    if (q.sp) { await waitUntil(() => q.sp.inst || q.sp.failed); if (q.sp.inst) { q.sp.inst.setSkin(q.playSkin); await q.sp.inst.play(q.playAnimation, false); } }
    await this.sac.interact(q.id);
    this.progress(this.count() / this.pl.length);
    if (this.count() >= this.pl.length) this.finished = true;
    this.busy = false;
  }
}
class DragToPlaySpineStep extends SpineStepBase {
  constructor(mb, toolVariant) {
    super(mb, mb.d.toolVisual || mb.d.toolvisual || mb.d.visual);
    this.toolVariant = toolVariant; this.mp = S.goOf(mb.d.maskPoint);
    this.th = mb.d.completeThreshold || 0.99;
  }
  down() { this.tl.onDown(); this.playPick(); this.sac.pick(); }
  drag(p, d) { this.tl.onDrag(d); }
  hold(p) {
    const tp = this.mp ? S.wpos(this.mp) : this.tl.ok ? this.tl.pos() : p;
    let any = false;
    for (const q of this.pl) {
      if (q.done || !q.sp || !q.sp.inst) continue;
      const inst = q.sp.inst; const e = inst.state.getCurrent(0);
      if (!q.started) { inst.setSkin(q.playSkin); const en = inst.state.setAnimation(0, q.playAnimation, false); en.timeScale = 0; q.started = true; }
      const en = inst.state.getCurrent(0); if (!en) continue;
      const isOver = this.over(q, tp);
      en.timeScale = isOver ? (q.timeScale || 1) : 0;
      if (isOver) any = true;
      if (inst.progress() >= (this.toolVariant ? (q.completeThreshold || this.th) : 0.999)) { q.done = true; en.timeScale = 0; this.sac.interact(q.id); vibrate(25); }
    }
    if (any) this.dragLoop(); else Audio2.stopLoop();
    const tot = this.pl.reduce((s, q) => s + (q.done ? 1 : q.sp && q.sp.inst && q.started ? q.sp.inst.progress() : 0), 0);
    this.progress(tot / Math.max(1, this.pl.length));
  }
  up() {
    Audio2.stopLoop(); this.sac.stop();
    for (const q of this.pl) if (q.sp && q.sp.inst) { const en = q.sp.inst.state.getCurrent(0); if (en && !q.done) en.timeScale = 0; }
    if (this.count() >= this.pl.length) this.finished = true; else this.tl.moveBack();
  }
}

const STEP_TYPES = {
  MaskStep, DragAndDropStep, ScrapeStep, BlowStep, ClickObjectStep, DragToolStep, SweepObjectStep, VacuumStep,
  PesticideStep, WaxToolStep, WaxStep: WaxToolStep, ScaleObjectStep, FadeObjectStep, ConnectTheDotsStep,
  ClickToPlaySpineStep, DragToPlaySpineStep: class extends DragToPlaySpineStep { constructor(mb) { super(mb, false); } },
  DragToolToPlaySpineStep: class extends DragToPlaySpineStep { constructor(mb) { super(mb, true); } },
};

// ---------- hint (replaces the original tutorial hand) ----------
function areaCenter(dr) {
  if (!dr) return null;
  const left = dr.pts ? dr.pts.filter(p => !p.f) : [];
  if (left.length) { const q = left[(left.length / 2) | 0]; return q.p; }
  return dr.areas[0] ? S.colCenter(dr.areas[0]) : null;
}
const HINT = {
  // returns [from, to|null] in world coords
  of(st) {
    const tp = st.tl && st.tl.ok ? st.tl.pos() : null;
    const n = st.constructor.name;
    if (st instanceof MaskStep) return [tp, areaCenter(st.dr)];
    if (st instanceof DragAndDropStep) { const q = st.pl.find(q => !q.done && S.activeIH(q.go)); return q ? [S.wpos(q.go), q.target ? S.wpos(q.target) : q.snap ? S.wpos(q.snap) : null] : null; }
    if (st instanceof ClickObjectStep) { const q = st.pl.find(q => !q.done); return q ? [S.wpos(q.go), null] : null; }
    if (st instanceof ClickToPlaySpineStep) { const q = st.pl.find(q => !q.done); return q ? [q.col ? S.colCenter(q.col) : S.wpos(q.sp.go), null] : null; }
    if (st instanceof DragToolStep) { const q = st.pl.find(q => !q.done); return q ? [tp, S.wpos(q.target || q.snap)] : null; }
    if (st instanceof SweepObjectStep) { const q = st.objs.find(o => !o.gone && S.activeIH(o.go)); if (!q) return null; const p = S.wpos(q.go); return [p, [p[0] + 3, p[1]]]; }
    if (st instanceof ScrapeStep) { const q = st.objs.find(o => !o.hit && S.activeIH(o.go)); return [tp, q ? S.wpos(q.go) : null]; }
    if (st instanceof BlowStep || st instanceof VacuumStep) { const q = st.objs.find(o => !o.on && S.activeIH(o.go)); return [tp, q ? S.wpos(q.go) : null]; }
    if (st instanceof PesticideStep) { const q = st.pests.find(o => !o.on && S.activeIH(o.go)); return [tp, q ? S.wpos(q.go) : null]; }
    if (st instanceof WaxToolStep) {
      if (!st.snapped) { const n = st.nearest(tp || [0, 0]); return n ? [tp, st.grabPoint(n.q)] : null; }
      const q = st.curT; if (!q || !q.back) return null; return [S.wpos(q.back), st.finPoint(q) || [S.wpos(q.back)[0], S.wpos(q.back)[1] - 1.5]];
    }
    if (st instanceof ScaleObjectStep) { const q = st.pl[st.i]; return q ? [tp, q.col ? S.colCenter(q.col) : q.obj ? S.wpos(q.obj) : null] : null; }
    if (st instanceof FadeObjectStep) { const q = st.pl.find(q => !q.done); return q && q.col ? [tp, S.colCenter(q.col)] : null; }
    if (st instanceof ConnectTheDotsStep) { const L = st.lines.find(l => !l.done); return L && L.s ? [S.colCenter(L.s), L.e ? S.colCenter(L.e) : null] : null; }
    if (st instanceof DragToPlaySpineStep) { const q = st.pl.find(q => !q.done); return q ? [tp, q.col ? S.colCenter(q.col) : S.wpos(q.sp.go)] : null; }
    return null;
  },
  draw(ctx, st, idle) {
    if (!st || idle < 2.5) return;
    let h; try { h = this.of(st); } catch (e) { return; }
    if (!h || !h[0]) return;
    const [a, b] = h; const t = (idle - 2.5) % 1.6 / 1.6;
    const p = b ? [lerp(a[0], b[0], E.inOutQuad(Math.min(1, t * 1.3))), lerp(a[1], b[1], E.inOutQuad(Math.min(1, t * 1.3)))] : a;
    const u = R.cam.size / 10;
    ctx.save();
    ctx.globalAlpha = 0.9 * (1 - Math.max(0, t - 0.8) * 5);
    ctx.lineWidth = 0.12 * u; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(p[0], p[1], (0.45 + 0.25 * Math.sin(t * Math.PI * 2)) * u, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(p[0], p[1], 0.22 * u, 0, Math.PI * 2); ctx.fill();
    if (b) { ctx.globalAlpha = 0.35; ctx.setLineDash([0.25 * u, 0.25 * u]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    ctx.restore();
  },
};

Tool.all = [];
