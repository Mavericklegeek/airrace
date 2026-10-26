// Entrées : clavier + manettes / joysticks (Gamepad API) avec calibration
const K = 'airrace.input.';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(K + k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch { /* */ } };

export const FUNCS = [
  { id: 'roll',  label: 'Roulis (gauche/droite)', axis: true },
  { id: 'pitch', label: 'Tangage (cabrer/piquer)', axis: true },
  { id: 'yaw',   label: 'Lacet (palonnier)', axis: true },
  { id: 'thr',   label: 'Gaz (manette des gaz)', axis: true },
  { id: 'boost',  label: 'Postcombustion / Boost', button: true },
  { id: 'camera', label: 'Changer de vue', button: true },
  { id: 'assist', label: 'Aide à la stabilisation', button: true },
  { id: 'pause',  label: 'Pause / menu', button: true },
];

export class Input {
  constructor() {
    this.keys = new Set(); this.thr = 0.8; this.enabled = false; this.onAction = null;
    this.opts = Object.assign({ invertY: false, assist: true, dead: 0.08, sens: 1 }, load('opts', {}));
    this.maps = load('maps', {});
    this.mouse = { roll: 0, pitch: 0, boost: false }; this.touch = { roll: 0, pitch: 0, boost: false };
    this.prevBtn = {}; this.detecting = null; this.pad = null; this.axes = []; this.btns = [];
    this.kb = { pitch: 0, roll: 0, yaw: 0 };
    const tap = { KeyC: 'camera', KeyT: 'assist', KeyL: 'lights', KeyH: 'hud', Escape: 'pause', KeyM: 'mute' };
    addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (this.enabled && /^(Arrow|Space|Tab)/.test(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.enabled) {
        if (tap[e.code]) this.fire(tap[e.code]);
        if (e.code === 'KeyZ') this.thr = 1;
        if (e.code === 'KeyX') this.thr = 0;
      } else if (e.code === 'Escape') this.fire('pause');
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  fire(a) { this.onAction && this.onAction(a); }
  saveOpts() { save('opts', this.opts); }
  getPad() {
    const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
    let best = null;
    for (const p of pads) if (p && p.connected && (!best || p.axes.length > best.axes.length)) best = p;
    return best;
  }
  defaultMap(gp) {
    if (gp.mapping === 'standard') return { roll: { a: 2 }, pitch: { a: 3 }, yaw: { a: 0 }, thr: { a: 1, mode: 'inc' }, boost: { b: 0 }, camera: { b: 3 }, assist: { b: 2 }, pause: { b: 9 } };
    const n = gp.axes.length;
    return { roll: { a: 0 }, pitch: { a: 1 }, yaw: { a: n > 5 ? 5 : 2 }, thr: { a: 3 < n ? 3 : -1, mode: 'abs', inv: true }, boost: { b: 0 }, camera: { b: 1 }, assist: { b: 2 }, pause: { b: 9 } };
  }
  mapFor(gp) { return this.maps[gp.id] || (this.maps[gp.id] = this.defaultMap(gp)); }
  setMap(gp, fn, patch) { const m = this.mapFor(gp); m[fn] = Object.assign(m[fn] || {}, patch); save('maps', this.maps); }
  resetMap(gp) { delete this.maps[gp.id]; save('maps', this.maps); }
  // Détection d'un axe / bouton : l'utilisateur bouge la commande à associer
  detect(type, cb) { const gp = this.getPad(); if (!gp) return false; this.detecting = { type, cb, base: [...gp.axes] }; return true; }
  cancelDetect() { this.detecting = null; }

  dz(v) { const d = this.opts.dead; return Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d); }

  poll(dt) {
    const k = this.keys, o = { pitch: 0, roll: 0, yaw: 0, boost: false, pad: false };
    const down = (a, b) => (k.has(a) || k.has(b)) ? 1 : 0;
    // clavier
    o.roll = down('KeyD', 'ArrowRight') - down('KeyA', 'ArrowLeft');
    o.pitch = down('KeyS', 'ArrowDown') - down('KeyW', 'ArrowUp');
    o.yaw = down('KeyE', 'KeyE') - down('KeyQ', 'KeyQ');
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyR')) this.thr = Math.min(1, this.thr + dt * 0.7);
    if (k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyF')) this.thr = Math.max(0, this.thr - dt * 0.7);
    o.boost = k.has('Space');
    // lissage clavier (pas de tout-ou-rien brutal)
    const kb = this.kb, ks = Math.min(1, dt * 9);
    kb.roll += (o.roll - kb.roll) * ks; kb.pitch += (o.pitch - kb.pitch) * ks; kb.yaw += (o.yaw - kb.yaw) * ks;
    o.roll = kb.roll; o.pitch = kb.pitch; o.yaw = kb.yaw;
    // manette / joystick
    const gp = this.getPad(); this.pad = gp;
    if (gp) {
      const m = this.mapFor(gp); this.axes = [...gp.axes]; this.btns = gp.buttons.map(b => b.value);
      if (this.detecting) {
        const d = this.detecting;
        if (d.type === 'axis') { gp.axes.forEach((v, i) => { if (this.detecting && Math.abs(v - d.base[i]) > 0.6) { const cb = d.cb; this.detecting = null; cb(i); } }); }
        else gp.buttons.forEach((b, i) => { if (this.detecting && b.pressed) { const cb = d.cb; this.detecting = null; cb(i); } });
      } else {
        const ax = (f) => { const c = m[f]; if (!c || c.a == null || c.a < 0 || c.a >= gp.axes.length) return 0; let v = gp.axes[c.a]; return this.dz(c.inv ? -v : v); };
        const r = ax('roll'), p = ax('pitch'), y = ax('yaw');
        if (r) o.roll = r; if (p) o.pitch = p; if (y) o.yaw = y; if (r || p || y) o.pad = true;
        const t = m.thr;
        if (t && t.a >= 0 && t.a < gp.axes.length) {
          const v = gp.axes[t.a];
          if (t.mode === 'abs') { const raw = (t.inv ? -v : v); this.thr = Math.max(0, Math.min(1, (raw + 1) / 2)); }
          else { const dv = this.dz(t.inv ? v : -v); if (dv) this.thr = Math.max(0, Math.min(1, this.thr + dv * dt * 0.7)); }
        }
        if (gp.mapping === 'standard') { const tr = (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0); if (Math.abs(tr) > 0.05) this.thr = Math.max(0, Math.min(1, this.thr + tr * dt * 0.8)); }
        const bt = (f) => { const c = m[f]; return !!(c && c.b != null && c.b >= 0 && gp.buttons[c.b] && gp.buttons[c.b].pressed); };
        if (bt('boost')) o.boost = true;
        for (const f of ['camera', 'assist', 'pause']) { const now = bt(f); if (now && !this.prevBtn[f] && (this.enabled || f === 'pause')) this.fire(f); this.prevBtn[f] = now; }
        if (gp.mapping === 'standard') { const lb = gp.buttons[4]?.pressed, rb = gp.buttons[5]?.pressed; if (lb || rb) o.yaw = (rb ? 1 : 0) - (lb ? 1 : 0); }
      }
    } else this.axes = [];
    // souris (manche cliquable du cockpit)
    o.roll = Math.max(-1, Math.min(1, o.roll + this.mouse.roll + this.touch.roll));
    o.pitch = Math.max(-1, Math.min(1, o.pitch + this.mouse.pitch + this.touch.pitch));
    o.boost = o.boost || this.mouse.boost || this.touch.boost;
    if (this.opts.invertY) o.pitch = -o.pitch;
    o.thr = this.thr; o.assist = this.opts.assist;
    return o;
  }
}
