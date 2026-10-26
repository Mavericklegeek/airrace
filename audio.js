// Sons synthétisés (aucun fichier) : moteur à hélice / réacteur, vent, bips
export class Sound {
  constructor() { this.ctx = null; this.vol = parseFloat(localStorage.getItem('airrace.vol') ?? '0.6'); this.kind = 'prop'; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(ctx.destination);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
    // hélice : dents de scie + carré filtrés
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 600;
    this.gProp = ctx.createGain(); this.gProp.gain.value = 0;
    this.o1.connect(this.lp); this.o2.connect(this.lp); this.lp.connect(this.gProp); this.gProp.connect(this.master);
    this.o1.start(); this.o2.start();
    // réacteur : bruit passe-bande + grondement
    this.nj = noise(); this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.Q.value = 0.7; this.bp.frequency.value = 900;
    this.gJet = ctx.createGain(); this.gJet.gain.value = 0; this.nj.connect(this.bp); this.bp.connect(this.gJet); this.gJet.connect(this.master);
    this.rum = ctx.createOscillator(); this.rum.type = 'triangle'; this.rum.frequency.value = 55; this.gRum = ctx.createGain(); this.gRum.gain.value = 0;
    this.rum.connect(this.gRum); this.gRum.connect(this.master); this.rum.start();
    // vent
    this.nw = noise(); this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 500;
    this.gWind = ctx.createGain(); this.gWind.gain.value = 0; this.nw.connect(this.hp); this.hp.connect(this.gWind); this.gWind.connect(this.master);
  }
  setVolume(v) { this.vol = v; localStorage.setItem('airrace.vol', v); if (this.master) this.master.gain.value = v; }
  update(on, kind = 'prop', thr = 0, v = 0, boost = false) {
    if (!this.ctx) return; const t = this.ctx.currentTime; thr = Number.isFinite(thr) ? thr : 0; v = Number.isFinite(v) ? v : 0;
    const prop = on && kind === 'prop', jet = on && kind === 'jet';
    const f = 38 + thr * 52 + (boost ? 8 : 0);
    this.o1.frequency.setTargetAtTime(f, t, 0.08); this.o2.frequency.setTargetAtTime(f * 2.01, t, 0.08);
    this.lp.frequency.setTargetAtTime(350 + thr * 900, t, 0.1);
    this.gProp.gain.setTargetAtTime(prop ? 0.10 + thr * 0.10 : 0, t, 0.1);
    this.bp.frequency.setTargetAtTime(500 + thr * 1500 + (boost ? 900 : 0), t, 0.1);
    this.gJet.gain.setTargetAtTime(jet ? 0.12 + thr * 0.35 + (boost ? 0.2 : 0) : 0, t, 0.1);
    this.rum.frequency.setTargetAtTime(45 + thr * 30, t, 0.1); this.gRum.gain.setTargetAtTime(jet ? 0.25 + thr * 0.2 : 0, t, 0.1);
    this.hp.frequency.setTargetAtTime(300 + v * 6, t, 0.2);
    this.gWind.gain.setTargetAtTime(on ? Math.min(0.28, v / 600) : 0, t, 0.2);
  }
  beep(freq, dur = 0.15, type = 'sine', vol = 0.25, delay = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  ring() { this.beep(880, 0.12, 'sine', 0.3); this.beep(1320, 0.2, 'sine', 0.3, 0.07); }
  count(n) { this.beep(n > 0 ? 520 : 1040, n > 0 ? 0.18 : 0.5, 'square', 0.18); }
  crash() { if (!this.ctx) return; const t = this.ctx.currentTime, s = this.ctx.createBufferSource(); const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2); s.buffer = b; const g = this.ctx.createGain(); g.gain.value = 0.7; const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; s.connect(f); f.connect(g); g.connect(this.master); s.start(t); }
  click() { this.beep(1800, 0.03, 'square', 0.08); }
}
