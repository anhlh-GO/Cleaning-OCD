// ===== Level controller, viewport, main loop, UI =====
'use strict';
const Game = {
  order: [], idx: 0, steps: [], placements: [], vp: null, fade: { a: 0, color: '#fff' }, origin: null,
  running: false, levelId: null, stepNo: 0, stepTotal: 0,
};

function camBoundsOfSR(sr) { return S.spriteBounds(sr); }

async function loadLevel(levelId) {
  G.gen++; G.tweens = []; G.frameWaiters = []; Tool.all = []; Juice.bits = [];
  Input.handler = null; Input.enabled = false; Input.down = false;
  Audio2.stopLoop();
  Game.running = false; Game.levelId = levelId;
  UI.showLoading(true); UI.hideWin();
  const myGen = G.gen;
  const data = await getJSON(A + 'levels/' + levelId + '.json');
  if (myGen !== G.gen) return;
  S = new Scene(data);
  initParticles(S);
  const fxs = Object.values(S.comps).filter(c => c.k === 'PS' && c.ps && c.ps.r && c.ps.r.tex).map(c => loadFxTex(c.ps.r.tex.f));
  // preload sprites
  const sps = new Set();
  for (const c of Object.values(S.comps)) if ((c.k === 'SR' || c.k === 'SM') && c.sp) sps.add(c.sp);
  let n = 0; const total = sps.size;
  await Promise.all([...sps].map(g => loadSprite(g).then(() => UI.loadProgress(++n / total))));
  // spine
  const spComps = Object.values(S.comps).filter(c => c.k === 'SPINE' && c.skel);
  await Promise.all(spComps.map(async c => {
    const sd = await loadSpineData(c.skel);
    if (sd) { try { c.inst = new SpineInst(sd, c); } catch (e) { console.warn(e); c.failed = true; } } else c.failed = true;
  }));
  await Promise.all(fxs);
  if (myGen !== G.gen) return;
  setupLevel();
  // spine pending init (from step/anim init)
  for (const c of spComps) if (c.inst && c.pending) c.pending(c.inst);
  UI.showLoading(false);
  Game.running = true;
  runLevel(myGen);
}

function setupLevel() {
  const lc = Object.values(S.comps).find(c => c.k === 'MB' && c.s === 'LevelController');
  const vpMb = Object.values(S.comps).find(c => c.k === 'MB' && c.s === 'LevelViewPort');
  Game.lc = lc ? lc.d : { listStepPlacements: [], listStepLayers: [] };
  Game.vp = vpMb ? vpMb.d : null;
  // render layers
  let order = 0;
  for (const ref of Game.lc.listStepLayers || []) {
    const rl = S.comp(ref); if (!rl) continue;
    let sgs = (rl.d.listSortingGroups || []).map(r => S.comp(r)).filter(Boolean);
    if (!sgs.length) sgs = S.descendants(rl.go).flatMap(g => S.compsOf(g, 'SG'));
    let o = order;
    for (const sg of sgs) { sg.l = LAYER_GO; sg.o = o; sg.l0 = sg.l; sg.o0 = sg.o; o += 3; }
    order += 30;
  }
  // camera
  const bgs = Game.vp ? (Game.vp.bgRenderers || []).map(r => S.comp(r)).filter(Boolean) : [];
  Game.bgs = bgs;
  bgs.forEach((b, i) => S.setActive(b.go, i === 0));
  const fr = Game.vp ? S.comp(Game.vp.fadeRenderer) : null;
  Game.fade = { a: 0, color: fr && fr.col ? `rgb(${fr.col[0] * 255 | 0},${fr.col[1] * 255 | 0},${fr.col[2] * 255 | 0})` : '#000' };
  if (fr) S.setActive(fr.go, false);
  S.updateWorld();
  let b = bgs[0] ? S.spriteBounds(bgs[0]) : { x0: -5.6, x1: 5.6, y0: -10, y1: 10 };
  const hw = (b.x1 - b.x0) / 2, hh = (b.y1 - b.y0) / 2;
  const fit = Game.vp ? Game.vp.cameraFitMode : 2;
  let size = hh;
  if (fit === 0) size = hw / R.aspect; else if (fit === 2) size = Math.min(hw / R.aspect, hh);
  R.cam.size = size; R.cam.x = (b.x0 + b.x1) / 2; R.cam.y = (b.y0 + b.y1) / 2;
  Game.origin = { ...R.cam };
  // steps
  Game.placements = (Game.lc.listStepPlacements || []).map(p => ({ ...p, stepGo: S.goOf(p.step), layerGo: S.goOf(p.stepLayer), objs: (p.activeObjects || []).map(r => S.goOf(r)).filter(Boolean) }));
  Game.placements.forEach((p, i) => setActiveStep(p, i === 0));
  for (const p of Game.placements) {
    if (p.isFinish || !p.stepGo) continue;
    const mb = S.comp(p.step);
    const Cls = mb && STEP_TYPES[mb.s];
    if (Cls) { try { p.inst = new Cls(mb); } catch (e) { console.warn('step init fail', mb.s, e); } }
    else console.warn('unknown step', mb && mb.s);
  }
  Game.stepTotal = Game.placements.filter(p => !p.isFinish && p.inst).length;
  Game.stepNo = 0;
  UI.setLevel(Game.idx + 1, Game.stepTotal);
}
function setActiveStep(p, a) {
  if (p.stepGo) S.setActive(p.stepGo, a);
  if (p.layerGo) S.setActive(p.layerGo, a);
  for (const o of p.objs) S.setActive(o, a);
}
async function fadeInStep(p) {
  setActiveStep(p, true);
  if (p.layerGo) for (const sr of S.srsUnder(p.layerGo)) sr.alpha = 1;
  const srs = p.objs.flatMap(o => S.srsUnder(o));
  if (srs.length) { srs.forEach(s => s.alpha = 0); await tween(0.3, k => srs.forEach(s => s.alpha = k)); }
}
const getPl = id => Game.placements.find(p => p.stepId === id);

async function runLevel(gen) {
  let cur = 1;
  const alive = () => gen === G.gen;
  while (alive()) {
    const pl = getPl(cur);
    if (!pl || pl.isFinish) {
      if (pl) { if (pl.layerGo && !S.node(pl.layerGo).active) await fadeInStep(pl); await playViewport(cur, 'end'); }
      if (alive()) onLevelComplete();
      return;
    }
    if (getPl(cur - 1) || cur === 1) await playViewport(cur, 'start');
    if (!pl.inst) { // unsupported: skip
      const next = getPl(cur + 1); setActiveStep(pl, false); if (next) setActiveStep(next, true); cur++; continue;
    }
    if (pl.stepGo && !S.node(pl.stepGo).active) await fadeInStep(pl);
    Game.stepNo = Game.placements.filter(p => p.inst && p.stepId < cur).length + 1;
    UI.setStep(Game.stepNo, Game.stepTotal, pl.inst);
    HUD.setProgress(0);
    Game.curPl = pl;
    await pl.inst.run();
    if (!alive()) return;
    Audio2.play('step_completed', 0.6);
    UI.stepDone(Game.stepNo);
    Juice.burst(); vibrate(35); Praise.show();
    if (pl.stepGo) stopParticlesUnder(pl.stepGo);
    pl.isFinish = true;
    const next = getPl(cur + 1);
    let switched = false;
    const sw = () => { if (switched) return; switched = true; setActiveStep(pl, false); if (next) setActiveStep(next, true); };
    Game.midSwitch = sw;
    await playViewport(cur, 'end');
    sw(); Game.midSwitch = null;
    cur++;
  }
}

async function playViewport(stepId, which) {
  if (!Game.vp) return;
  const e = (Game.vp.stepViewPortEffects || []).find(x => x.stepId === stepId);
  if (!e) return;
  const use = which === 'start' ? e.useStartEffect : e.useEndEffect;
  const ph = which === 'start' ? e.startPhase : e.endPhase;
  if (!use || !ph) return;
  if (ph.delay > 0) await wait(ph.delay);
  const anims = ph.animations || [];
  if (ph.playParallel) await Promise.all(anims.map(vpAnim));
  else for (const a of anims) await vpAnim(a);
}
async function camTo(x, y, size, dur) {
  const c0 = { ...R.cam };
  await tween(dur, k => { R.cam.x = lerp(c0.x, x, k); R.cam.y = lerp(c0.y, y, k); R.cam.size = lerp(c0.size, size, k); }, E.inOutQuad);
}
async function vpAnim(a) {
  const sr = S.comp(a.targetSprite);
  const fadeTo = (to, d) => { const f0 = Game.fade.a; return tween(d, k => Game.fade.a = lerp(f0, to, k)); };
  switch (a.effect) {
    case 1: {
      if (!sr || !sr.sp) return;
      const b = S.spriteBounds(sr);
      const hw = (b.x1 - b.x0 + (a.padding ? a.padding.x : 0)) / 2, hh = (b.y1 - b.y0 + (a.padding ? a.padding.y : 0)) / 2;
      let size = Math.max(hw / R.aspect, hh); size = Math.min(size, Game.origin.size);
      await camTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, size, a.zoomDuration || 0.5);
      break;
    }
    case 2: await camTo(Game.origin.x, Game.origin.y, Game.origin.size, a.zoomDuration || 0.4); break;
    case 3: Game.fade.a = 1; await fadeTo(0, a.zoomDuration || 0.5); break; // scene fades in from black
    case 4: await fadeTo(0, a.zoomDuration || 0.5); break;
    case 5: {
      await fadeTo(1, a.zoomDuration || 0.5);
      if (Game.midSwitch) Game.midSwitch();
      Game.bgs.forEach((bg, i) => S.setActive(bg.go, i === a.toBG));
      await fadeTo(0, a.zoomDuration || 0.5);
      break;
    }
    case 6: if (sr) { const a0 = sr.alpha; await tween(a.zoomDuration || 0.5, k => sr.alpha = a0 * (1 - k)); } break;
    case 7: { const d = a.deltaPos || { x: 0, y: 0 }; await camTo(R.cam.x + d.x, R.cam.y + d.y, R.cam.size, a.moveDuration || 0.5); break; }
    case 8: if (sr) { S.setActive(sr.go, true); sr.alpha = a.fromAlpha; await tween(a.zoomDuration || 0.5, k => sr.alpha = lerp(a.fromAlpha, a.toAlpha, k)); } break;
  }
}

function onLevelComplete() {
  Game.running = false;
  const done = JSON.parse(localStorage.getItem('cl_done') || '[]');
  if (!done.includes(Game.idx)) { done.push(Game.idx); try { localStorage.setItem('cl_done', JSON.stringify(done)); } catch (e) { } }
  try { localStorage.setItem('cl_cur', String(Math.min(Game.idx + 1, Game.order.length - 1))); } catch (e) { }
  Audio2.play('level_win', 0.8);
  vibrate([60, 40, 60]);
  Juice.confetti();
  setTimeout(() => UI.showWin(), 900);
  prefetchLevel(Game.order[(Game.idx + 1) % Game.order.length]);
}

// ---------- main loop ----------
let lastT = 0;
let lastReal = 0;
function loop(t) {
  requestAnimationFrame(loop);
  lastReal = performance.now();
  stepFrame(t);
}
setInterval(() => { const n = performance.now(); if (n - lastReal > 250) stepFrame(n); }, 33);
function stepFrame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0) * (G.speed || 1); lastT = t;
  G.dt = dt; G.time += dt;
  if (S) {
    tickTweens(dt);
    const h = Input.handler;
    if (h && Input.enabled && Input.down && h.hold) h.hold(Input.pos);
    for (const p of Game.placements || []) if (p.inst && p.inst.tick && S.activeIH(p.inst.go)) p.inst.tick(dt);
    S.updateWorld();
    tickParticles(S, dt);
    for (const t of Tool.all) t.tick(dt);
    if (!S.spList) S.spList = Object.values(S.comps).filter(c => c.k === 'SPINE');
    for (const c of S.spList) if (c.inst && S.node(c.go).ah) c.inst.update(dt);
    Perf.tick();
    R.render(S, Game.fade);
    FX.draw(dt);
    Juice.draw(R.ctx, R.W, R.H, dt);
    if (Input.down || !Input.enabled) Game.idle = 0; else Game.idle = (Game.idle || 0) + dt;
    if (Input.enabled && Input.handler) { const c = R.ctx; R.setT(c, R.viewM()); HINT.draw(c, Input.handler, Game.idle); c.setTransform(1, 0, 0, 1, 0, 0); }
  }
}

// ---------- input ----------
function setupInput(cv) {
  const pos = e => { const r = cv.getBoundingClientRect(); return R.toWorld(e.clientX - r.left, e.clientY - r.top); };
  cv.addEventListener('pointerdown', e => {
    Audio2.init(); Audio2.startBgm();
    cv.setPointerCapture(e.pointerId);
    if (Input.down) return;
    Input.down = true; Input.pid = e.pointerId;
    const p = pos(e); Input.pos = p; Input.downPos = p;
    if (Input.enabled && Input.handler) Input.handler.down(p);
    FX.touch(e, cv);
  });
  cv.addEventListener('pointermove', e => {
    if (!Input.down || e.pointerId !== Input.pid) return;
    const p = pos(e); const d = [p[0] - Input.pos[0], p[1] - Input.pos[1]]; Input.pos = p;
    if (d[0] * d[0] + d[1] * d[1] < 0.0001) return;
    if (Input.enabled && Input.handler) { S.updateWorld(); Input.handler.drag(p, d); }
    FX.move(e, cv);
  });
  const up = e => {
    if (!Input.down || e.pointerId !== Input.pid) return;
    Input.down = false; const p = pos(e);
    const h = Input.handler; if (h && h.tl && h.tl.onUp) h.tl.onUp();
    if (Input.enabled && h) h.up(p);
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}

// ---------- light FX (sparkles while cleaning) ----------
const FX = {
  parts: [], cv: null, x: null,
  init(cv) { this.cv = cv; this.x = cv.getContext('2d'); },
  touch() { }, move(e, cv) {
    if (!Input.enabled || !Input.handler || Math.random() > 0.35) return;
    const h = Input.handler; let wp = null;
    if (h._hasPS === undefined) h._hasPS = S.descendants(h.go).some(g => S.compsOf(g, "PS").length);
    if (h._hasPS) return; // the tool has its own Unity particles
    if (h.dr && h.dr.maskPoint) wp = S.wpos(h.dr.maskPoint); else if (h.tl && h.tl.ok) wp = h.tl.pos();
    if (!wp) return;
    this.parts.push({ wx: wp[0] + rnd(-.3, .3), wy: wp[1] + rnd(-.3, .3), vx: rnd(-1, 1), vy: rnd(0.5, 2), t: 0, life: rnd(.4, .8), s: rnd(.06, .16) });
  },
  draw(dt) {
    if (!this.parts.length) return;
    const ctx = R.ctx; R.setT(ctx, R.viewM());
    for (const p of this.parts) {
      p.t += dt; p.wx += p.vx * dt; p.wy += p.vy * dt;
      const k = p.t / p.life; ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.wx, p.wy, p.s * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.parts = this.parts.filter(p => p.t < p.life);
  },
};

// ---------- UI ----------
const UI = {
  el: id => document.getElementById(id),
  showLoading(v) { this.el('loading').classList.toggle('show', v); if (v) this.loadProgress(0); },
  loadProgress(p) { this.el('loadbar').style.width = (p * 100).toFixed(0) + '%'; },
  setLevel(n, total) {
    this.el('lvl').textContent = 'Level ' + n;
    const dots = this.el('dots'); dots.innerHTML = ''; dots.classList.toggle('many', total > 12);
    for (let i = 0; i < total; i++) { const d = document.createElement('i'); dots.appendChild(d); }
  },
  setStep(n, total) {
    [...this.el('dots').children].forEach((d, i) => { d.classList.toggle('on', i === n - 1); });
  },
  stepDone(n) { const d = this.el('dots').children[n - 1]; if (d) { d.classList.remove('on'); d.classList.add('done'); } },
  showWin() { this.el('win').classList.add('show'); this.el('winlvl').textContent = 'Level ' + (Game.idx + 1); },
  hideWin() { this.el('win').classList.remove('show'); },
  buildLevels() {
    const g = this.el('grid'); g.innerHTML = '';
    const done = JSON.parse(localStorage.getItem('cl_done') || '[]');
    Game.order.forEach((id, i) => {
      const b = document.createElement('button');
      b.className = 'lv' + (done.includes(i) ? ' done' : '') + (i === Game.idx ? ' cur' : '');
      b.innerHTML = `<span>${i + 1}</span>`;
      b.onclick = () => { Audio2.play('ButtonClick'); this.el('levels').classList.remove('show'); startLevel(i); };
      g.appendChild(b);
    });
  },
};
window.onProgress = p => { UI.el('pbar').style.width = (clamp(p, 0, 1) * 100).toFixed(1) + '%'; };

function startLevel(i) {
  Game.idx = (i + Game.order.length) % Game.order.length;
  try { localStorage.setItem('cl_cur', String(Game.idx)); } catch (e) { }
  loadLevel(Game.order[Game.idx]);
}

function layout() {
  const wrap = UI.el('stage');
  const vw = window.innerWidth, vh = window.innerHeight;
  // portrait: width/height between 9/21 and 9/16
  let h = vh, w = Math.min(vw, h * 9 / 16);
  if (w / h < 9 / 21) h = w * 21 / 9;
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  R.resize(w, h);
  if (S && Game.origin && Game.vp) { // refit camera on resize
    const bg = Game.bgs[0]; if (bg) {
      const b = S.spriteBounds(bg); const hw = (b.x1 - b.x0) / 2, hh = (b.y1 - b.y0) / 2;
      const ns = Game.vp.cameraFitMode === 0 ? hw / R.aspect : Game.vp.cameraFitMode === 1 ? hh : Math.min(hw / R.aspect, hh);
      const k = ns / Game.origin.size; Game.origin.size = ns; R.cam.size *= k;
    }
  }
}

async function boot() {
  const cv = UI.el('cv'); R.init(cv); FX.init(cv);
  layout(); window.addEventListener('resize', layout);
  setupInput(cv);
  [G.sprites, G.spines, G.so, G.audioMap] = await Promise.all([getJSON(A + 'sprites.json'), getJSON(A + 'spines.json'), getJSON(A + 'so.json'), getJSON(A + 'audio.json')]);
  Game.order = (G.so.order || []).map(String);
  const q = new URLSearchParams(location.search);
  let start = parseInt(localStorage.getItem('cl_cur') || '0', 10) || 0;
  if (q.get('lv')) start = Math.max(0, parseInt(q.get('lv'), 10) - 1);
  UI.el('btnHome').onclick = () => { Audio2.init(); Audio2.play('ButtonClick'); UI.buildLevels(); UI.el('levels').classList.add('show'); };
  UI.el('btnClose').onclick = () => UI.el('levels').classList.remove('show');
  UI.el('btnRestart').onclick = () => { Audio2.play('ButtonClick'); startLevel(Game.idx); };
  UI.el('btnNext').onclick = () => { Audio2.play('ButtonClick'); startLevel(Game.idx + 1); };
  UI.el('btnReplay').onclick = () => { Audio2.play('ButtonClick'); startLevel(Game.idx); };
  UI.el('btnSound').onclick = () => { Audio2.init(); Audio2.setMuted(!G.muted); UI.el('btnSound').classList.toggle('off', G.muted); };
  UI.el('tapstart').onclick = () => { Audio2.init(); Audio2.startBgm(); UI.el('tapstart').classList.remove('show'); };
  requestAnimationFrame(loop);
  startLevel(start);
}
boot();
// debug helper: skip current step
window.dbgSkip = () => { const p = Game.curPl; if (p && p.inst) p.inst.finished = true; };

// adaptive resolution: drop the canvas pixel ratio if frames are consistently slow
const Perf = {
  last: 0, acc: 0, n: 0, cool: 0,
  tick() {
    const now = performance.now(); const d = now - (this.last || now); this.last = now;
    if (d <= 0 || d > 200 || document.hidden) return;
    this.acc += d; this.n++;
    if (this.n >= 90) {
      const avg = this.acc / this.n; this.acc = 0; this.n = 0;
      if (avg > 24 && R.maxDpr > 1 && Math.min(window.devicePixelRatio || 1, R.maxDpr) > 1) { R.maxDpr = Math.max(1, Math.min(window.devicePixelRatio || 1, R.maxDpr) - 0.5); layout(); }
    }
  },
};
// warm the cache for the next level while the win popup is up
const prefetched = new Set();
async function prefetchLevel(id) {
  if (!id || prefetched.has(id)) return; prefetched.add(id);
  try {
    const d = await getJSON(A + 'levels/' + id + '.json');
    const sps = new Set(); for (const c of Object.values(d.comps)) if ((c.k === 'SR' || c.k === 'SM') && c.sp) sps.add(c.sp);
    for (const g of sps) await loadSprite(g);
  } catch (e) { }
}
