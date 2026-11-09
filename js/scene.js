// ===== Scene graph, rendering, colliders, spine =====
'use strict';
const LAYER_TOOL = 3, LAYER_GO = 2;

class Scene {
  constructor(data) {
    this.d = data;
    this.gos = data.gos; this.comps = data.comps;
    this.nodes = new Map();
    this.custom = []; // extra renderables {l,o,draw(ctx)}
    this.drawers = new Map(); // SR comp id -> {drawer, mode:'mask'|'unmask'}
    for (const [id, g] of Object.entries(this.gos)) {
      const t = g.t || [0, 0, 0, 0, 0, 0, 1, 1, 1, 1];
      const [x, y, z, w] = [t[3], t[4], t[5], t[6]];
      const m0 = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z)];
      this.nodes.set(id, {
        id, name: g.n, active: !!g.a, parent: g.p || null, children: (g.c || []).filter(Boolean),
        px: t[0], py: t[1], pz: t[2], m0, rz: null, sx: t[7], sy: t[8], comps: g.k || [], wm: [1, 0, 0, 1, 0, 0], ah: false,
      });
    }
    // runtime state per comp
    for (const [id, c] of Object.entries(this.comps)) {
      c.id = id;
      if (c.k === 'SR' || c.k === 'SG' || c.k === 'MR') { c.l0 = c.l; c.o0 = c.o; }
      if (c.k === 'SR') c.alpha = c.col ? c.col[3] : 1;
      if (c.k === 'SPINE') c.alpha = 1;
    }
    this.root = data.root;
    this.updateWorld();
  }
  node(id) { return this.nodes.get(String(id)); }
  // ---- references ----
  rid(ref) { if (!ref) return null; const f = typeof ref === 'object' ? ref.fileID : ref; return f && f !== 0 ? String(f) : null; }
  comp(ref) { const i = this.rid(ref); return i ? this.comps[i] : null; }
  goOf(ref) {
    const i = this.rid(ref); if (!i) return null;
    if (this.comps[i]) return this.comps[i].go;
    if (this.gos[i]) return i;
    return null;
  }
  compsOf(go, k) { const n = this.node(go); return n ? n.comps.map(c => this.comps[c]).filter(c => c && (!k || c.k === k)) : []; }
  mbOf(go, s) { return this.compsOf(go, 'MB').find(c => c.s === s); }
  descendants(go, out = []) { const n = this.node(go); if (!n) return out; out.push(go); for (const c of n.children) this.descendants(c, out); return out; }
  findMBs(script, under) {
    const ids = under ? new Set(this.descendants(under)) : null;
    return Object.values(this.comps).filter(c => c.k === 'MB' && (Array.isArray(script) ? script.includes(c.s) : c.s === script) && (!ids || ids.has(c.go)));
  }
  isUnder(go, anc) { let n = this.node(go), k = 0; while (n && k++ < 500) { if (n.id === anc) return true; n = this.node(n.parent); } return false; }
  // ---- active ----
  setActive(go, a) { const n = this.node(go); if (n) n.active = !!a; }
  activeIH(go) { let n = this.node(go), k = 0; while (n && k++ < 500) { if (!n.active) return false; n = this.node(n.parent); } return true; }
  // ---- transforms ----
  localM(n) {
    let a, b, c, d;
    if (n.rz != null) { const r = n.rz * Math.PI / 180; a = Math.cos(r); b = Math.sin(r); c = -b; d = a; }
    else[a, b, c, d] = n.m0;
    return [a * n.sx, b * n.sx, c * n.sy, d * n.sy, n.px, n.py];
  }
  updateWorld() {
    const rec = (id, pm, pa) => {
      const n = this.nodes.get(id); if (!n) return;
      n.wm = pm ? M.mul(pm, this.localM(n)) : this.localM(n);
      n.ah = pa && n.active;
      for (const c of n.children) rec(c, n.wm, n.ah);
    };
    for (const [id, n] of this.nodes) if (!n.parent) rec(id, null, true);
  }
  wm(go) { const n = this.node(go); if (!n) return [1, 0, 0, 1, 0, 0]; this.updateNodeWorld(n); return n.wm; }
  updateNodeWorld(n) {
    const chain = []; let p = n; while (p && chain.length < 500) { chain.unshift(p); p = this.node(p.parent); }
    let m = null; for (const q of chain) { m = m ? M.mul(m, this.localM(q)) : this.localM(q); q.wm = m; }
  }
  wpos(go) { const m = this.wm(go); return [m[4], m[5]]; }
  setWpos(go, x, y) {
    const n = this.node(go); if (!n) return;
    if (n.parent) { const pm = this.wm(n.parent); const l = M.ap(M.inv(pm), x, y); n.px = l[0]; n.py = l[1]; }
    else { n.px = x; n.py = y; }
  }
  getRz(go) { const n = this.node(go); if (n.rz != null) return n.rz; return Math.atan2(n.m0[1], n.m0[0]) * 180 / Math.PI; }
  worldRz(go) { const m = this.wm(go); return Math.atan2(m[1], m[0]) * 180 / Math.PI; }
  setWorldRz(go, deg) {
    const n = this.node(go); const p = n.parent ? this.worldRz(n.parent) : 0; n.rz = deg - p;
  }
  reparent(go, newParent) {
    const n = this.node(go); if (!n) return;
    if (newParent && (newParent === go || this.isUnder(newParent, go))) { console.warn('reparent cycle blocked', n.name); return; }
    const W = this.wm(go);
    if (n.parent) { const op = this.node(n.parent); if (op) op.children = op.children.filter(c => c !== go); }
    n.parent = newParent || null;
    let L = W;
    if (newParent) { const np = this.node(newParent); np.children.push(go); L = M.mul(M.inv(this.wm(newParent)), W); }
    n.px = L[4]; n.py = L[5];
    const det = L[0] * L[3] - L[1] * L[2];
    const sx = Math.hypot(L[0], L[1]), sy = Math.hypot(L[2], L[3]) * (det < 0 ? -1 : 1);
    n.sx = sx; n.sy = sy; n.rz = null;
    n.m0 = [L[0] / (sx || 1), L[1] / (sx || 1), L[2] / (sy || 1), L[3] / (sy || 1)];
  }
  // ---- renderers ----
  srOf(go) { return this.compsOf(go, 'SR')[0]; }
  srsUnder(go, includeInactive = true) { return this.descendants(go).flatMap(g => (includeInactive || this.activeIH(g)) ? this.compsOf(g, 'SR') : []); }
  setAlphaTree(go, a) { for (const sr of this.srsUnder(go)) sr.alpha = a; for (const sp of this.descendants(go).flatMap(g => this.compsOf(g, 'SPINE'))) sp.alpha = a; }
  spriteBounds(sr) { // world AABB
    const s = G.sprites[sr.sp]; if (!s) { const p = this.wpos(sr.go); return { x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; }
    const m = this.wm(sr.go);
    let w = s.w / s.ppu, h = s.h / s.ppu;
    if (sr.dm) { w = sr.sz[0]; h = sr.sz[1]; }
    const lx = -s.px * w, ly = -s.py * h;
    const pts = [[lx, ly], [lx + w, ly], [lx, ly + h], [lx + w, ly + h]].map(p => M.ap(m, p[0], p[1]));
    return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) };
  }
  // ---- colliders ----
  colliderPoly(c) {
    const m = this.wm(c.go);
    if (c.k === 'POLY') return c.pts.map(path => path.map(p => M.ap(m, p[0] + c.off[0], p[1] + c.off[1])));
    if (c.k === 'BOX') {
      const hx = c.sz[0] / 2, hy = c.sz[1] / 2, ox = c.off[0], oy = c.off[1];
      return [[[ox - hx, oy - hy], [ox + hx, oy - hy], [ox + hx, oy + hy], [ox - hx, oy + hy]].map(p => M.ap(m, p[0], p[1]))];
    }
    return null;
  }
  colliders(go) { return this.compsOf(go).filter(c => c.k === 'POLY' || c.k === 'BOX' || c.k === 'CIRC'); }
  colOf(ref) { const c = this.comp(ref); if (c && (c.k === 'POLY' || c.k === 'BOX' || c.k === 'CIRC')) return c; const go = this.goOf(ref); return go ? this.colliders(go)[0] : null; }
  pointIn(c, p) {
    if (!c) return false;
    if (c.k === 'CIRC') {
      const m = this.wm(c.go); const ctr = M.ap(m, c.off[0], c.off[1]);
      const sc = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
      return dist(p, ctr) <= c.r * sc;
    }
    const polys = this.colliderPoly(c); if (!polys) return false;
    let inside = false;
    for (const pts of polys) {
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if ((pts[i][1] > p[1]) !== (pts[j][1] > p[1]) && p[0] < (pts[j][0] - pts[i][0]) * (p[1] - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
      }
    }
    return inside;
  }
  closestPoint(c, p) {
    if (!c || this.pointIn(c, p)) return p;
    if (c.k === 'CIRC') {
      const m = this.wm(c.go); const ctr = M.ap(m, c.off[0], c.off[1]); const r = c.r * Math.hypot(m[0], m[1]);
      const d = dist(p, ctr) || 1; return [ctr[0] + (p[0] - ctr[0]) / d * r, ctr[1] + (p[1] - ctr[1]) / d * r];
    }
    let best = p, bd = 1e9;
    for (const pts of this.colliderPoly(c)) for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy || 1e-9;
      const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1);
      const q = [a[0] + dx * t, a[1] + dy * t]; const d = dist(p, q);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  distTo(c, p) { return this.pointIn(c, p) ? 0 : dist(p, this.closestPoint(c, p)); }
  colBounds(c) {
    if (c.k === 'CIRC') { const m = this.wm(c.go); const ctr = M.ap(m, c.off[0], c.off[1]); const r = c.r * Math.hypot(m[0], m[1]); return { x0: ctr[0] - r, x1: ctr[0] + r, y0: ctr[1] - r, y1: ctr[1] + r }; }
    const pts = this.colliderPoly(c).flat();
    return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) };
  }
  colCenter(c) { const b = this.colBounds(c); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }

  // ---- render list ----
  buildList() {
    this.updateWorld();
    let idx = 0;
    const rootCtx = { items: [], masks: [], parent: null };
    const rec = (id, ctx) => {
      const n = this.nodes.get(id); if (!n || !n.ah) return;
      const sg = n.comps.map(c => this.comps[c]).find(c => c && c.k === 'SG' && c.en);
      let cx = ctx;
      if (sg) { cx = { items: [], masks: [], parent: ctx, sg }; ctx.items.push({ l: sg.l, o: sg.o, i: idx++, g: cx }); }
      for (const cid of n.comps) {
        const c = this.comps[cid]; if (!c || !c.en) continue;
        if (c.k === 'SR' && c.sp && c.alpha > 0.001) cx.items.push({ l: c.l, o: c.o, i: idx++, r: c, ctx: cx });
        else if (c.k === 'SPINE' && c.inst) {
          const mr = n.comps.map(x => this.comps[x]).find(x => x && x.k === 'MR');
          cx.items.push({ l: mr ? mr.l : 1, o: mr ? mr.o : 0, i: idx++, sp: c, ctx: cx });
        } else if (c.k === 'SM' && c.sp) cx.masks.push(c);
      }
      for (const ch of n.children) rec(ch, cx);
    };
    for (const [id, n] of this.nodes) if (!n.parent) rec(id, rootCtx);
    for (const cu of this.custom) rootCtx.items.push({ l: cu.l, o: cu.o, i: 1e6 + idx++, cu });
    const out = [];
    const flat = ctx => {
      ctx.items.sort((a, b) => a.l - b.l || a.o - b.o || a.i - b.i);
      for (const it of ctx.items) { if (it.g) flat(it.g); else out.push(it); }
    };
    flat(rootCtx);
    return out;
  }
}

// ---------- renderer ----------
const R = {
  cv: null, ctx: null, W: 0, H: 0, dpr: 1, tmp: null, tctx: null, mk: null, mctx: null,
  cam: { x: 0, y: 0, size: 10 }, aspect: 9 / 16,
  init(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.tmp = document.createElement('canvas'); this.tctx = this.tmp.getContext('2d');
    this.mk = document.createElement('canvas'); this.mctx = this.mk.getContext('2d');
  },
  resize(w, h) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = Math.round(w * this.dpr); this.H = Math.round(h * this.dpr);
    for (const c of [this.cv, this.tmp, this.mk]) { c.width = this.W; c.height = this.H; }
    this.aspect = w / h;
  },
  ppu() { return this.H / (2 * this.cam.size); },
  viewM() { const s = this.ppu(); return [s, 0, 0, -s, this.W / 2 - this.cam.x * s, this.H / 2 + this.cam.y * s]; },
  toWorld(sx, sy) { // css px
    const s = this.ppu(); const x = sx * this.dpr, y = sy * this.dpr;
    return [(x - this.W / 2) / s + this.cam.x, -(y - this.H / 2) / s + this.cam.y];
  },
  halfW() { return this.cam.size * this.aspect; },
  setT(ctx, m) { ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]); },
  drawSR(ctx, sc, sr, alphaMul = 1) {
    const s = G.sprites[sr.sp]; const im = spriteImg.get(sr.sp); if (!s || !im) return;
    const m = M.mul(this.viewM(), sc.wm(sr.go));
    this.setT(ctx, m);
    let w = s.w / s.ppu, h = s.h / s.ppu;
    if (sr.dm) { w = sr.sz[0]; h = sr.sz[1]; }
    ctx.globalAlpha = clamp(sr.alpha * alphaMul, 0, 1);
    ctx.scale(sr.fx ? -1 : 1, sr.fy ? 1 : -1);
    ctx.drawImage(tinted(sr, im), -s.px * w, -(1 - s.py) * h, w, h);
  },
  drawMasks(ctx, sc, masks) {
    for (const m of masks) {
      const s = G.sprites[m.sp]; const im = spriteImg.get(m.sp); if (!s || !im) continue;
      this.setT(ctx, M.mul(this.viewM(), sc.wm(m.go)));
      ctx.globalAlpha = 1; ctx.scale(1, -1);
      const w = s.w / s.ppu, h = s.h / s.ppu;
      ctx.drawImage(im, -s.px * w, -(1 - s.py) * h, w, h);
    }
  },
  findMasks(it) {
    let c = it.ctx;
    while (c) {
      const ms = c.masks.filter(m => !m.cr || (it.l >= m.bl && it.l <= m.fl && it.o > m.bo && it.o <= m.fo) || true);
      if (ms.length) return ms;
      c = c.parent;
    }
    return [];
  },
  render(sc, fade) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#cfe6f5'; ctx.fillRect(0, 0, this.W, this.H);
    const list = sc.buildList();
    for (const it of list) {
      if (it.cu) { ctx.save(); this.setT(ctx, this.viewM()); it.cu.draw(ctx); ctx.restore(); continue; }
      const sr = it.r;
      const dr = sr ? sc.drawers.get(sr.id) : null;
      const mi = sr ? sr.mi : 0;
      if (dr && dr.drawer.state !== 'finished' && dr.drawer.state !== 'none') {
        // custom stencil masking for mask steps
        const t = this.tctx; t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, this.W, this.H);
        this.drawSR(t, sc, sr);
        t.globalCompositeOperation = dr.mode === 'unmask' ? 'destination-in' : 'destination-out';
        dr.drawer.drawStroke(t);
        t.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(this.tmp, 0, 0);
        continue;
      }
      if (mi && sr) {
        const masks = this.findMasks(it);
        if (masks.length) {
          const t = this.tctx; t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, this.W, this.H);
          this.drawSR(t, sc, sr);
          const mk = this.mctx; mk.setTransform(1, 0, 0, 1, 0, 0); mk.clearRect(0, 0, this.W, this.H);
          this.drawMasks(mk, sc, masks);
          t.setTransform(1, 0, 0, 1, 0, 0); t.globalAlpha = 1;
          t.globalCompositeOperation = mi === 1 ? 'destination-in' : 'destination-out';
          t.drawImage(this.mk, 0, 0); t.globalCompositeOperation = 'source-over';
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(this.tmp, 0, 0);
          continue;
        }
        if (mi === 1) continue; // visible inside mask, no mask -> hidden
      }
      if (sr) this.drawSR(ctx, sc, sr);
      else if (it.sp) drawSpine(ctx, sc, it.sp);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    if (fade && fade.a > 0) { ctx.globalAlpha = fade.a; ctx.fillStyle = fade.color; ctx.fillRect(0, 0, this.W, this.H); ctx.globalAlpha = 1; }
  },
};
const tintCache = new WeakMap();
function tinted(sr, im) {
  const c = sr.col; if (!c || (c[0] > 0.99 && c[1] > 0.99 && c[2] > 0.99)) return im;
  let m = tintCache.get(im); if (!m) { m = new Map(); tintCache.set(im, m); }
  const key = c.slice(0, 3).map(v => (v * 255) | 0).join(',');
  if (m.has(key)) return m.get(key);
  const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
  const x = cv.getContext('2d'); x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'multiply'; x.fillStyle = `rgb(${key})`; x.fillRect(0, 0, cv.width, cv.height);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(im, 0, 0);
  m.set(key, cv); return cv;
}

// ---------- spine ----------
const spineData = new Map();
async function loadSpineData(g) {
  if (spineData.has(g)) return spineData.get(g);
  const p = (async () => {
    const info = G.spines[g]; if (!info || !window.spine) return null;
    const base = A + 'spine/' + info.d + '/';
    const [atlasTxt, js] = await Promise.all([fetch(base + 'skel.atlas').then(r => r.text()), fetch(base + 'skel.json').then(r => r.text())]);
    try {
      const atlas = new spine.TextureAtlas(atlasTxt);
      await Promise.all(atlas.pages.map(async pg => {
        const im = await loadImg(base + pg.name);
        if (im) pg.setTexture(new spine.CanvasTexture(im));
      }));
      const sj = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
      sj.scale = 1;
      const data = sj.readSkeletonData(js);
      return { data, scale: info.scale || 0.01 };
    } catch (e) { console.warn('spine fail', info.d, e); return null; }
  })();
  spineData.set(g, p);
  return p;
}
class SpineInst {
  constructor(sd, comp) {
    this.sd = sd; this.skel = new spine.Skeleton(sd.data);
    this.state = new spine.AnimationState(new spine.AnimationStateData(sd.data));
    this.state.data.defaultMix = 0.1;
    this.comp = comp; this.ts = comp.ts || 1;
    if (comp.skin) this.setSkin(comp.skin);
    this.skel.setToSetupPose();
    if (comp.anim && this.has(comp.anim)) this.state.setAnimation(0, comp.anim, !!comp.loop);
    this.update(0);
  }
  has(n) { return !!this.sd.data.findAnimation(n); }
  setSkin(n) { if (n && this.sd.data.findSkin(n)) { this.skel.setSkinByName(n); this.skel.setSlotsToSetupPose(); } }
  play(name, loop) {
    if (!name || !this.has(name)) return Promise.resolve();
    const e = this.state.setAnimation(0, name, !!loop); e.timeScale = 1;
    this.entry = e;
    return new Promise(res => { if (loop) return res(); e.listener = { complete: () => res(), interrupt: () => res(), end: () => res() }; setTimeout(res, (e.animationEnd / this.ts + 1) * 1000 + 200); });
  }
  freeze(name) { if (!name || !this.has(name)) return; const e = this.state.setAnimation(0, name, false); e.timeScale = 0; this.entry = e; this.update(0); }
  progress() { const e = this.state.getCurrent(0); if (!e) return 1; return e.animationEnd > 0 ? Math.min(1, e.trackTime / e.animationEnd) : 1; }
  update(dt) { this.state.update(dt * this.ts); this.state.apply(this.skel); this.skel.updateWorldTransform(); }
}
let spineRenderer = null;
function drawSpine(ctx, sc, comp) {
  const inst = comp.inst; if (!inst) return;
  if (!spineRenderer) { spineRenderer = new spine.SkeletonRenderer(ctx); spineRenderer.triangleRendering = true; }
  spineRenderer.ctx = ctx;
  const m = M.mul(R.viewM(), sc.wm(comp.go));
  R.setT(ctx, m);
  ctx.scale(inst.sd.scale * (comp.fx ? -1 : 1), inst.sd.scale * (comp.fy ? -1 : 1));
  inst.skel.color.a = clamp(comp.alpha, 0, 1);
  ctx.globalAlpha = 1;
  try { spineRenderer.draw(inst.skel); } catch (e) { }
}
