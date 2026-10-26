// Cockpit 3D interactif : instruments (canvas), manche, manette des gaz, interrupteurs cliquables
import * as THREE from 'three';
import { skinTexture } from './planes.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

export class Cockpit {
  constructor(planeSpec, skinId) {
    this.spec = planeSpec; this.group = new THREE.Group(); this.pick = []; this.ui = { assist: true, nav: true, light: false, smoke: true, hud: true };
    this.sw = {}; this.hoverItem = null; this.acc = 0;
    const g = this.group, dark = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.75, metalness: 0.3 });
    const panelM = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.6, metalness: 0.4 });
    const add = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };

    // planche de bord
    add(new THREE.BoxGeometry(1.8, 0.36, 0.5), dark, 0, -0.43, -0.78);
    const shield = add(new THREE.BoxGeometry(1.9, 0.07, 0.4), dark, 0, -0.245, -1.0); shield.rotation.x = 0.12;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.46), panelM); face.rotation.x = -0.5; face.position.set(0, -0.34, -0.8); g.add(face);
    this.face = face;
    // capot moteur / nez (teinte de la peinture)
    const hoodM = new THREE.MeshPhysicalMaterial({ map: skinTexture(skinId), metalness: 0.3, roughness: 0.4, clearcoat: 1 });
    const jet = planeSpec.kind === 'jet';
    const hood = add(new THREE.CapsuleGeometry(jet ? 0.3 : 0.36, jet ? 4 : 2.2, 6, 16), hoodM, 0, jet ? -0.5 : -0.52, jet ? -3.2 : -2.0);
    hood.rotation.x = Math.PI / 2; hood.scale.set(1.25, 1, jet ? 0.8 : 0.75);
    // montants de verrière
    const rail = new THREE.CylinderGeometry(0.018, 0.018, 3, 8);
    for (const sx of [-1, 1]) { const r = add(rail, dark, sx * 0.78, 0.12, -0.7); r.rotation.x = Math.PI / 2; }
    add(new THREE.TorusGeometry(0.8, 0.02, 8, 32, Math.PI), dark, 0, -0.05, -1.35);
    add(new THREE.TorusGeometry(0.78, 0.016, 8, 32, Math.PI), dark, 0, -0.05, 0.25);
    // ------- instruments (repère local de la planche)
    const R = 0.085;
    this.inst = {};
    const gauge = (name, x, w = 256, h = 256, sx = R * 2, sy = R * 2) => {
      const c = mk(w, h), t = tex(c), m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
      const o = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), m); o.position.set(x, 0.03, 0.004); face.add(o);
      const bezel = new THREE.Mesh(new THREE.RingGeometry(sx / 2, sx / 2 + 0.01, 40), new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.8, roughness: 0.3 })); bezel.position.set(x, 0.03, 0.005); if (name === 'mfd') bezel.visible = false; face.add(bezel);
      this.inst[name] = { c, ctx: c.getContext('2d'), t };
    };
    gauge('asi', -0.62); gauge('att', -0.44); gauge('alt', -0.26); gauge('hdg', -0.08);
    gauge('mfd', 0.22, 384, 288, 0.32, 0.24);
    // ------- manche
    this.stick = new THREE.Group(); this.stick.position.set(0, -0.62, -0.5); g.add(this.stick);
    add(new THREE.CylinderGeometry(0.012, 0.014, 0.34, 10), metalM(), 0, 0.17, 0, this.stick);
    const grip = add(new THREE.CapsuleGeometry(0.03, 0.09, 4, 10), new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.5 }), 0, 0.37, 0, this.stick);
    add(new THREE.SphereGeometry(0.014, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0x551010 }), 0, 0.42, -0.02, this.stick);
    this.regPick(grip, 'stick'); this.regPick(this.stick.children[0], 'stick');
    add(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 16), dark, 0, -0.64, -0.5);
    // ------- manette des gaz : levier à pivot sur le côté gauche de la planche
    const quad = add(new THREE.BoxGeometry(0.1, 0.34, 0.03), dark, -0.78, -0.02, 0.012, face);
    add(new THREE.CylinderGeometry(0.022, 0.026, 0.03, 14), metalM(), -0.78, -0.17, 0.03, face).rotation.x = Math.PI / 2;
    this.thrLever = new THREE.Group(); this.thrLever.position.set(-0.78, -0.17, 0.035); face.add(this.thrLever);
    add(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8), metalM(), 0, 0.15, 0, this.thrLever);
    const knob = add(new THREE.SphereGeometry(0.032, 14, 12), new THREE.MeshStandardMaterial({ color: 0xc41a1a, roughness: 0.4 }), 0, 0.31, 0, this.thrLever);
    this.regPick(knob, 'throttle'); this.regPick(this.thrLever.children[0], 'throttle');
    const tl = makeLabel('GAZ', 0.08, 0.03); tl.position.set(-0.78, 0.17, 0.02); face.add(tl);
    // ------- interrupteurs sur la planche
    const sdef = [['assist', 'STAB'], ['nav', 'NAV'], ['light', 'PHARE'], ['smoke', 'FUMÉE'], ['hud', 'HUD']];
    sdef.forEach(([id, label], i) => {
      const x = 0.46 + i * 0.075;
      add(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 10), metalM(), x, -0.1, 0.008, face).rotation.x = Math.PI / 2;
      const lever = new THREE.Group(); lever.position.set(x, -0.1, 0.012); face.add(lever);
      const lv = add(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 8), metalM(), 0, 0, 0.035, lever); lv.rotation.x = Math.PI / 2;
      const tip = add(new THREE.SphereGeometry(0.024, 8, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }), 0, 0, 0.072, lever);
      const led = add(new THREE.SphereGeometry(0.008, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ff66 }), x, -0.035, 0.01, face);
      const lab = makeLabel(label, 0.07, 0.026); lab.position.set(x, -0.165, 0.004); face.add(lab);
      this.regPick(tip, 'sw_' + id); this.regPick(lv, 'sw_' + id);
      this.sw[id] = { lever, led };
    });
    // bouton BOOST
    const bb = add(new THREE.CylinderGeometry(0.036, 0.04, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0xd01010, emissive: 0x500000, roughness: 0.35 }), 0.7, 0.1, 0.02, face);
    bb.rotation.x = Math.PI / 2; this.boostBtn = bb; this.regPick(bb, 'boost');
    const bl = makeLabel('BOOST', 0.1, 0.03); bl.position.set(0.7, 0.18, 0.004); face.add(bl);
    // ------- éclairage cockpit
    const lamp = new THREE.PointLight(0xfff0dd, 0.6, 3); lamp.position.set(0, 0.3, -0.2); g.add(lamp);
    this.light = lamp;
    this.stickRoll = 0; this.stickPitch = 0; this.thrV = 0.8;
    this.syncSwitches();
  }
  regPick(mesh, id) { mesh.userData.id = id; this.pick.push(mesh); }
  syncSwitches() { for (const id in this.sw) { const on = this.ui[id]; this.sw[id].lever.rotation.x = on ? -0.6 : 0.6; this.sw[id].led.material.color.set(on ? 0x00ff66 : 0x331111); } }
  // clic : retourne l'identifiant de l'objet visé
  rayPick(camera, ndc) {
    this._rc = this._rc || new THREE.Raycaster(); this._rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hit = this._rc.intersectObjects(this.pick, false)[0]; return hit ? hit.object.userData.id : null;
  }
  // animation des commandes
  animate(dt, input, thr, boosting) {
    const k = Math.min(1, dt * 14);
    this.stickRoll += (input.roll - this.stickRoll) * k; this.stickPitch += (input.pitch - this.stickPitch) * k;
    this.stick.rotation.z = -this.stickRoll * 0.4; this.stick.rotation.x = this.stickPitch * 0.4;
    this.thrV += (thr - this.thrV) * k; this.thrLever.rotation.x = 0.05 + (1 - this.thrV) * 1.05;
    this.boostBtn.position.z = boosting ? 0.008 : 0.02; this.boostBtn.material.emissive.setHex(boosting ? 0xff2200 : 0x500000);
    this.syncSwitches();
  }
  // données → instruments (≈30 Hz)
  draw(dt, d) {
    this.acc += dt; if (this.acc < 1 / 30) return; this.acc = 0;
    const I = this.inst;
    drawASI(I.asi.ctx, d.kmh, this.spec.vmax * 3.6 * 1.45); I.asi.t.needsUpdate = true;
    drawAH(I.att.ctx, d.att.pitch, d.att.roll, d.g); I.att.t.needsUpdate = true;
    drawALT(I.alt.ctx, d.alt, d.vsi); I.alt.t.needsUpdate = true;
    drawHDG(I.hdg.ctx, d.att.heading, d.thr, d.energy); I.hdg.t.needsUpdate = true;
    drawMFD(I.mfd.ctx, d); I.mfd.t.needsUpdate = true;
  }
}
function metalM() { return new THREE.MeshStandardMaterial({ color: 0xa6abb3, metalness: 0.9, roughness: 0.28 }); }
function makeLabel(text, w, h) {
  const c = mk(256, Math.round(256 * h / w) || 64), g = c.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#e8e8e8'; g.font = `bold ${c.height * 0.7}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex(c), transparent: true })); return m;
}

// ------------------------------------------------------------ dessins
function dial(g, size) { g.clearRect(0, 0, size, size); g.fillStyle = '#0a0c10'; g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, 7); g.fill(); }
function drawASI(g, kmh, vmax) {
  const S = 256, C = 128; dial(g, S);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const step = vmax > 500 ? 100 : 50, a0 = Math.PI * 0.75, span = Math.PI * 1.5;
  for (let v = 0; v <= vmax; v += step / 5) {
    const a = a0 + v / vmax * span, major = Math.round(v) % step === 0, r1 = major ? 98 : 108;
    g.lineWidth = major ? 3 : 1.5; g.beginPath(); g.moveTo(C + Math.cos(a) * 118, C + Math.sin(a) * 118); g.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1); g.stroke();
    if (major) g.fillText(String(Math.round(v)), C + Math.cos(a) * 80, C + Math.sin(a) * 80);
  }
  g.fillStyle = '#9aa'; g.font = 'bold 14px sans-serif'; g.fillText('KM/H', C, C + 38);
  g.fillStyle = '#fff'; g.font = 'bold 26px monospace'; g.fillText(String(Math.round(kmh)), C, C + 64);
  const a = a0 + Math.min(kmh, vmax) / vmax * span; needle(g, C, a, 100, '#ffb000');
}
function needle(g, C, a, len, col) {
  g.save(); g.translate(C, C); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(-14, -3); g.lineTo(len, -2); g.lineTo(len + 6, 0); g.lineTo(len, 2); g.lineTo(-14, 3); g.fill(); g.restore();
  g.fillStyle = '#222'; g.beginPath(); g.arc(C, C, 9, 0, 7); g.fill();
}
function drawAH(g, pitch, roll, gl) {
  const S = 256, C = 128; dial(g, S);
  g.save(); g.beginPath(); g.arc(C, C, 120, 0, 7); g.clip(); g.translate(C, C); g.rotate(-roll);
  const py = pitch * 180 / Math.PI * 4.2;
  g.fillStyle = '#3a8fd8'; g.fillRect(-300, -300 + py, 600, 300); g.fillStyle = '#7a5230'; g.fillRect(-300, py, 600, 300);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-300, py); g.lineTo(300, py); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 2;
  for (let p = -30; p <= 30; p += 10) { if (!p) continue; const y = py - p * 4.2, w = p % 20 ? 20 : 36; g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke(); if (!(p % 20)) { g.fillText(String(Math.abs(p)), -w - 14, y); g.fillText(String(Math.abs(p)), w + 14, y); } }
  g.restore();
  g.strokeStyle = '#ffcc00'; g.lineWidth = 5; g.beginPath(); g.moveTo(C - 70, C); g.lineTo(C - 22, C); g.lineTo(C - 22, C + 10); g.moveTo(C + 70, C); g.lineTo(C + 22, C); g.lineTo(C + 22, C + 10); g.stroke();
  g.fillStyle = '#ffcc00'; g.beginPath(); g.arc(C, C, 4, 0, 7); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 2; for (let a = -60; a <= 60; a += 15) { const r = a * Math.PI / 180 - Math.PI / 2; g.beginPath(); g.moveTo(C + Math.cos(r) * 120, C + Math.sin(r) * 120); g.lineTo(C + Math.cos(r) * 108, C + Math.sin(r) * 108); g.stroke(); }
  g.save(); g.translate(C, C); g.rotate(-roll); g.fillStyle = '#ffcc00'; g.beginPath(); g.moveTo(0, -118); g.lineTo(-8, -102); g.lineTo(8, -102); g.fill(); g.restore();
  g.fillStyle = '#0f0'; g.font = 'bold 14px monospace'; g.textAlign = 'center'; g.fillText(gl.toFixed(1) + ' G', C, 232);
}
function drawALT(g, alt, vsi) {
  const S = 256, C = 128; dial(g, S);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 50; i++) { const a = -Math.PI / 2 + i / 50 * Math.PI * 2, maj = i % 5 === 0; g.lineWidth = maj ? 3 : 1.5; g.beginPath(); g.moveTo(C + Math.cos(a) * 118, C + Math.sin(a) * 118); g.lineTo(C + Math.cos(a) * (maj ? 100 : 108), C + Math.sin(a) * (maj ? 100 : 108)); g.stroke(); if (maj) g.fillText(String(i / 5), C + Math.cos(a) * 82, C + Math.sin(a) * 82); }
  g.fillStyle = '#9aa'; g.font = 'bold 14px sans-serif'; g.fillText('ALT  ×100 m', C, C - 40);
  g.fillStyle = '#fff'; g.font = 'bold 26px monospace'; g.fillText(Math.round(alt) + ' m', C, C + 52);
  g.fillStyle = vsi > 2 ? '#4f4' : vsi < -2 ? '#f66' : '#aaa'; g.font = 'bold 15px monospace'; g.fillText((vsi > 0 ? '▲ ' : vsi < 0 ? '▼ ' : '') + Math.round(Math.abs(vsi)) + ' m/s', C, C + 80);
  needle(g, C, -Math.PI / 2 + ((alt / 1000) % 1) * Math.PI * 2, 66, '#8cf');
  needle(g, C, -Math.PI / 2 + ((alt / 100) % 1) * Math.PI * 2, 100, '#ffb000');
}
function drawHDG(g, hdg, thr, energy) {
  const S = 256, C = 128; dial(g, S);
  g.save(); g.translate(C, C); g.rotate(-hdg * Math.PI / 180);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let a = 0; a < 360; a += 10) { const r = a * Math.PI / 180 - Math.PI / 2, maj = a % 30 === 0; g.lineWidth = maj ? 3 : 1.5; g.beginPath(); g.moveTo(Math.cos(r) * 118, Math.sin(r) * 118); g.lineTo(Math.cos(r) * (maj ? 100 : 108), Math.sin(r) * (maj ? 100 : 108)); g.stroke();
    if (maj) { const t = { 0: 'N', 90: 'E', 180: 'S', 270: 'O' }[a] || String(a / 10); g.save(); g.translate(Math.cos(r) * 82, Math.sin(r) * 82); g.rotate(hdg * Math.PI / 180); g.fillStyle = a % 90 === 0 ? '#ff7a00' : '#fff'; g.fillText(t, 0, 0); g.restore(); } }
  g.restore();
  g.fillStyle = '#ffcc00'; g.beginPath(); g.moveTo(C, 14); g.lineTo(C - 9, 36); g.lineTo(C + 9, 36); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 26px monospace'; g.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', C, C - 6);
  // barres gaz + énergie boost
  g.fillStyle = '#222'; g.fillRect(70, 148, 116, 12); g.fillRect(70, 168, 116, 12);
  g.fillStyle = '#4af'; g.fillRect(70, 148, 116 * thr, 12); g.fillStyle = energy > 0.25 ? '#ff7a00' : '#f33'; g.fillRect(70, 168, 116 * energy, 12);
  g.fillStyle = '#9aa'; g.font = 'bold 11px sans-serif'; g.textAlign = 'right'; g.fillText('GAZ', 64, 154); g.fillText('BOOST', 64, 174);
}
function drawMFD(g, d) {
  const W = 384, H = 288; g.fillStyle = '#04100c'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#0c3'; g.lineWidth = 1; g.globalAlpha = 0.35;
  const cx = 130, cy = 160; for (const r of [40, 80, 120]) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); } g.beginPath(); g.moveTo(cx, cy - 130); g.lineTo(cx, cy + 130); g.moveTo(cx - 130, cy); g.lineTo(cx + 130, cy); g.stroke(); g.globalAlpha = 1;
  const range = 3500, sc = 120 / range, ch = Math.cos(d.hdgRad), sh = Math.sin(d.hdgRad);
  const toScr = (x, z) => { const dx = x - d.px, dz = z - d.pz; const fw = dx * sh - dz * ch, rt = dx * ch + dz * sh; return [cx + rt * sc, cy - fw * sc]; };
  // anneaux
  d.rings.forEach((r, i) => { let [x, y] = toScr(r.x, r.z); const dd = Math.hypot(x - cx, y - cy); if (dd > 128) { x = cx + (x - cx) / dd * 128; y = cy + (y - cy) / dd * 128; }
    g.strokeStyle = i === 0 ? '#0ff' : '#3a6'; g.lineWidth = i === 0 ? 3 : 2; g.beginPath(); g.arc(x, y, i === 0 ? 7 : 5, 0, 7); g.stroke(); if (i > 0) { const p = d.rings[i - 1], [px, py] = toScr(p.x, p.z); g.globalAlpha = 0.4; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); g.globalAlpha = 1; } });
  d.others.forEach(o => { const [x, y] = toScr(o.x, o.z); if (Math.hypot(x - cx, y - cy) > 130) return; g.fillStyle = o.ahead ? '#f55' : '#fc3'; g.fillRect(x - 3, y - 3, 6, 6); });
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx - 6, cy + 7); g.lineTo(cx + 6, cy + 7); g.fill();
  // panneau droit
  g.fillStyle = '#0c3'; g.textAlign = 'left'; g.font = 'bold 14px monospace'; g.fillText('RACE', 275, 28);
  g.fillStyle = '#fff'; g.font = 'bold 40px monospace'; g.fillText(d.rank + '/' + d.n, 272, 72);
  g.font = 'bold 15px monospace'; g.fillStyle = '#0ff'; g.fillText('ANNEAU', 275, 102); g.fillStyle = '#fff'; g.font = 'bold 28px monospace'; g.fillText(d.ring + '/' + d.rings_total, 272, 132);
  g.fillStyle = '#0c3'; g.font = 'bold 14px monospace'; g.fillText('TEMPS', 275, 164); g.fillStyle = '#fff'; g.font = 'bold 24px monospace'; g.fillText(d.time, 272, 190);
  g.fillStyle = '#0c3'; g.font = 'bold 14px monospace'; g.fillText('PROCHAIN', 275, 220); g.fillStyle = '#fff'; g.font = 'bold 22px monospace'; g.fillText(d.dist + ' m', 272, 246);
  g.fillStyle = '#0c3'; g.font = '11px monospace'; g.fillText(d.msg || '', 12, 276);
}
