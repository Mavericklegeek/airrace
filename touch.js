// Commandes tactiles (version téléphone) : manche virtuel + manette des gaz + boutons
// API utilisée par main.js : new TouchControls(input, { camera, assist, pause }), .show(bool), .sync()
export class TouchControls {
  constructor(input, cb = {}) {
    this.input = input; this.on = false; this.R = 62;
    const r = this.root = document.createElement('div'); r.id = 'touch'; r.className = 'hide';
    r.innerHTML = `
      <div class="t-stick"><div class="t-base"><div class="t-knob"></div></div><span>MANCHE</span></div>
      <div class="t-thr"><div class="t-track"><div class="t-fill"></div><div class="t-tknob"></div></div><span>GAZ</span></div>
      <button class="t-btn t-boost">BOOST</button>
      <div class="t-top"><button class="t-btn sm" data-a="camera">VUE</button><button class="t-btn sm" data-a="assist">STAB</button><button class="t-btn sm" data-a="pause">☰</button></div>`;
    document.body.appendChild(r);
    const q = (s) => r.querySelector(s);
    this.stick = q('.t-stick'); this.knob = q('.t-knob'); this.track = q('.t-track'); this.fill = q('.t-fill'); this.tknob = q('.t-tknob'); this.assistBtn = q('[data-a="assist"]');
    const t = input.touch, curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.25);
    // --- manche : le centre de la base sert d'origine
    let sid = null;
    const moveStick = (e) => {
      const b = this.stick.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      let dx = (e.clientX - cx) / this.R, dy = (e.clientY - cy) / this.R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      t.roll = curve(dx); t.pitch = curve(dy);               // vers le bas = cabrer
      this.knob.style.transform = `translate(${dx * this.R}px, ${dy * this.R}px)`;
    };
    this.stick.addEventListener('pointerdown', (e) => { if (sid !== null) return; sid = e.pointerId; this.stick.setPointerCapture(sid); this.knob.style.transition = 'none'; moveStick(e); });
    this.stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) moveStick(e); });
    const endStick = (e) => { if (e.pointerId !== sid) return; sid = null; t.roll = t.pitch = 0; this.knob.style.transition = 'transform .12s'; this.knob.style.transform = 'translate(0,0)'; };
    this.stick.addEventListener('pointerup', endStick); this.stick.addEventListener('pointercancel', endStick);
    // --- manette des gaz
    let tid = null;
    const setThr = (e) => { const b = this.track.getBoundingClientRect(); input.thr = Math.max(0, Math.min(1, 1 - (e.clientY - b.top - 18) / (b.height - 36))); };
    const thrZone = q('.t-thr');
    thrZone.addEventListener('pointerdown', (e) => { tid = e.pointerId; thrZone.setPointerCapture(tid); setThr(e); });
    thrZone.addEventListener('pointermove', (e) => { if (e.pointerId === tid) setThr(e); });
    const endThr = (e) => { if (e.pointerId === tid) tid = null; };
    thrZone.addEventListener('pointerup', endThr); thrZone.addEventListener('pointercancel', endThr);
    // --- boutons
    const bb = q('.t-boost');
    bb.addEventListener('pointerdown', (e) => { bb.setPointerCapture(e.pointerId); t.boost = true; bb.classList.add('on'); });
    const endB = () => { t.boost = false; bb.classList.remove('on'); };
    bb.addEventListener('pointerup', endB); bb.addEventListener('pointercancel', endB);
    r.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => cb[b.dataset.a] && cb[b.dataset.a]()));
    r.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  show(on) {
    this.on = !!on; this.root.classList.toggle('hide', !on);
    if (!on) { const t = this.input.touch; t.roll = t.pitch = 0; t.boost = false; this.knob.style.transform = 'translate(0,0)'; }
    else this.sync();
  }
  sync() {                                                   // les gaz affichés suivent la valeur réelle (clavier / manette incluses)
    if (!this.on) return; const thr = this.input.thr, h = this.track.clientHeight || 200;
    this.tknob.style.top = ((1 - thr) * (h - 36)) + 'px'; this.fill.style.height = (thr * 100) + '%';
    this.assistBtn.classList.toggle('on', !!this.input.opts.assist);
  }
}
