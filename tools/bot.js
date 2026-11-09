// Test bot: plays every step type for real (not skipping). Paste/inject into the page console.
// Usage: runBot(fromIdx, toIdx) then inspect window.__bot
window.sleep = ms => new Promise(r => setTimeout(r, ms));
window.ready = async () => { for (let i = 0; i < 150; i++) { if (Input.enabled && Game.running) return true; await sleep(200); } return false; };
window.scr = w => { const s = R.ppu() / R.dpr; const W = R.W / R.dpr, H = R.H / R.dpr; return [(w[0] - R.cam.x) * s + W / 2, -(w[1] - R.cam.y) * s + H / 2]; };
window.ev = (t, x, y) => { const cv = document.getElementById('cv'); const r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent(t, { clientX: r.left + x, clientY: r.top + y, pointerId: 1, bubbles: true, isPrimary: true })); };
window.BOT = {
  fp: [0, 0],
  down(w) { this.fp = w; const p = scr(w); ev('pointerdown', p[0], p[1]); },
  async move(w, n = 8, ms = 18) { const a = this.fp; for (let i = 1; i <= n; i++) { const q = [a[0] + (w[0] - a[0]) * i / n, a[1] + (w[1] - a[1]) * i / n]; const p = scr(q); ev('pointermove', p[0], p[1]); await sleep(ms); } this.fp = w; },
  up() { const p = scr(this.fp); ev('pointerup', p[0], p[1]); },
  async pointTo(getPt, target, n = 8) { const c = getPt(); await this.move([this.fp[0] + target[0] - c[0], this.fp[1] + target[1] - c[1]], n); },
  async hold(s) { const t0 = performance.now(); while (performance.now() - t0 < s * 1000) { const p = scr(this.fp); ev('pointermove', p[0] + (Math.random() - .5) * 2, p[1]); await sleep(30); } },
  async tap(w) { this.down(w); await sleep(40); this.up(); await sleep(250); },
  async play(st) {
    const tp = () => st.tl && st.tl.ok ? st.tl.pos() : this.fp;
    if (st instanceof MaskStep) {
      const mp = () => st.dr.maskPoint ? S.wpos(st.dr.maskPoint) : this.fp; this.down(tp());
      const P = st.dr.pts.map(p => p.p); if (P.length) {
        const x0 = Math.min(...P.map(p => p[0])), x1 = Math.max(...P.map(p => p[0])), y0 = Math.min(...P.map(p => p[1])), y1 = Math.max(...P.map(p => p[1]));
        const dy = Math.max(0.3, st.dr.fr * 1.4); let row = 0;
        for (let y = y1; y >= y0 && !st.finished; y -= dy, row++) { const xs = row % 2 ? [x1, x0] : [x0, x1]; await this.pointTo(mp, [xs[0], y], 3); await this.pointTo(mp, [xs[1], y], Math.max(3, Math.ceil((x1 - x0) / (st.dr.fr * 0.8)))); }
      }
      for (let k = 0; k < 400 && !st.finished; k++) { const left = st.dr.pts.filter(p => !p.f); if (!left.length) break; await this.pointTo(mp, left[0].p, 4); } this.up(); return; }
    if (st instanceof ScrapeStep) { const mp = () => st.mp ? S.wpos(st.mp) : tp(); this.down(tp()); for (let k = 0; k < 400 && !st.finished; k++) { const o = st.objs.find(o => !o.hit && S.activeIH(o.go)); if (!o) break; await this.pointTo(mp, S.wpos(o.go), 4); } this.up(); return; }
    if (st instanceof BlowStep) { const mp = () => st.mp ? S.wpos(st.mp) : tp(); this.down(tp()); for (let k = 0; k < 200; k++) { const o = st.objs.find(o => !o.on && S.activeIH(o.go)); if (!o) break; await this.pointTo(mp, S.wpos(o.go), 5); await sleep(80); } await sleep(300); this.up(); await sleep(1800); return; }
    if (st instanceof VacuumStep) { const mp = () => st.vp ? S.wpos(st.vp) : tp(); this.down(tp()); for (let k = 0; k < 300 && !st.finished; k++) { const o = st.objs.find(o => !o.on && S.activeIH(o.go)); if (!o) break; await this.pointTo(mp, S.wpos(o.go), 4); } this.up(); return; }
    if (st instanceof PesticideStep) { const mp = () => st.mp ? S.wpos(st.mp) : tp(); this.down(tp()); for (let k = 0; k < 300; k++) { const o = st.pests.find(o => !o.on && S.activeIH(o.go)); if (!o) break; await this.pointTo(mp, S.wpos(o.go), 3); } this.up(); return; }
    if (st instanceof ScaleObjectStep) { const cp = () => st.cp ? S.wpos(st.cp) : tp(); this.down(tp()); for (let k = 0; k < st.pl.length * 3 && !st.finished; k++) { const q = st.pl[st.i]; if (!q) break; await this.pointTo(cp, q.col ? S.colCenter(q.col) : S.wpos(q.obj), 6); await this.hold((st.cfg.timeScale || 1) + 0.5); } this.up(); return; }
    if (st instanceof FadeObjectStep) { const mp = () => st.mp ? S.wpos(st.mp) : tp(); this.down(tp()); for (const q of st.pl) { if (!q.col) continue; await this.pointTo(mp, S.colCenter(q.col), 6); await this.hold((st.cfg.fadeDuration || 1) + 0.6); } this.up(); return; }
    if (st instanceof DragToPlaySpineStep) { const mp = () => st.toolVariant ? (st.mp ? S.wpos(st.mp) : tp()) : this.fp; this.down(tp()); for (const q of st.pl) { const c = q.col ? S.colCenter(q.col) : S.wpos(q.sp.go); await this.pointTo(mp, c, 6); for (let t = 0; t < 200 && !q.done; t++) await this.hold(0.1); } this.up(); return; }
    if (st instanceof ClickToPlaySpineStep) { for (const q of st.pl) { await waitUntil(() => !st.busy); await this.tap(q.col ? S.colCenter(q.col) : S.wpos(q.sp.go)); } await waitUntil(() => !st.busy); return; }
    if (st instanceof ClickObjectStep) { for (const q of st.pl) await this.tap(S.wpos(q.go)); return; }
    if (st instanceof DragAndDropStep) { for (const q of st.pl) { await waitUntil(() => !st.busy); if (q.done) continue; this.down(S.wpos(q.go)); await this.move(S.wpos(q.target || q.snap), 12); this.up(); await sleep(500); } return; }
    if (st instanceof DragToolStep) { for (let k = 0; k < st.pl.length * 2 && !st.finished; k++) { await waitUntil(() => !st.busy); const q = st.pl.find(q => !q.done); if (!q) break; const t = S.wpos(q.target || q.snap); this.down(tp()); await this.pointTo(tp, t, 10); this.up(); await sleep(400); await waitUntil(() => !st.busy); } return; }
    if (st instanceof SweepObjectStep) { for (const o of st.objs) { if (o.gone) continue; const p = S.wpos(o.go); this.down(p); await this.move([p[0] + 4, p[1]], 10); this.up(); await sleep(900); } return; }
    if (st instanceof WaxToolStep) {
      for (const q of st.pl) {
        if (q.done) continue; await waitUntil(() => !st.busy);
        this.down(tp()); await this.pointTo(tp, st.grabPoint(q), 10); this.up(); await sleep(200); await waitUntil(() => !st.busy);
        const b = S.wpos(q.back), f = st.finPoint(q) || [b[0], b[1] - 2];
        this.down([0, 0]); await this.move([f[0] - b[0], f[1] - b[1]], 14); this.up(); await sleep(300); await waitUntil(() => !st.busy);
      }
      return;
    }
    if (st instanceof ConnectTheDotsStep) { for (const L of st.lines) { this.down(S.colCenter(L.s)); await this.move(S.colCenter(L.e), 12); this.up(); await sleep(200); } return; }
    dbgSkip();
  },
};
window.__bot = [];
window.runBot = async (list) => {
  for (const i of list) {
    startLevel(i); await sleep(400); const log = []; const t0 = performance.now();
    while (!document.getElementById('win').classList.contains('show')) {
      if (performance.now() - t0 > 180000) { log.push('TIMEOUT@' + (Game.curPl && Game.curPl.stepId)); break; }
      if (!(await ready())) { if (document.getElementById('win').classList.contains('show')) break; continue; }
      const st = Game.curPl.inst; const sid = Game.curPl.stepId;
      try { await BOT.play(st); } catch (e) { log.push('ERR ' + st.constructor.name + ':' + e.message); }
      for (let w = 0; w < 40 && Game.curPl.stepId === sid && Input.enabled; w++) await sleep(100);
      if (Game.curPl.stepId === sid && Input.enabled) { log.push('FAIL ' + sid + ':' + st.constructor.name); dbgSkip(); }
    }
    __bot.push({ i: i + 1, lv: Game.order[i], log, sec: ((performance.now() - t0) / 1000) | 0 });
  }
  __bot.done = true;
};
