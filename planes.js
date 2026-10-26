// Modèles 3D procéduraux des avions (hélice / réacteurs) + peintures + traînées
import * as THREE from 'three';
import { SKINS, PLANES } from '/shared/game.js';

// ---------------------------------------------------------------- peintures
const skinCache = {};
export function skinTexture(id) {
  if (skinCache[id]) return skinCache[id];
  const sk = SKINS.find(s => s.id === id) || SKINS[0], [a, b, c] = sk.c;
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d'); g.fillStyle = a; g.fillRect(0, 0, 512, 512);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  switch (sk.pattern) {
    case 'stripe': g.fillStyle = b; g.fillRect(0, 150, 512, 74); g.fillStyle = c; g.fillRect(0, 234, 512, 22); break;
    case 'solid': g.fillStyle = c; g.fillRect(0, 200, 512, 14); break;
    case 'checker': { const n = 16, s = 512 / n; g.fillStyle = b; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + y) & 1) g.fillRect(x * s, y * s, s, s); g.fillStyle = c; g.fillRect(0, 232, 512, 24); break; }
    case 'camo': for (let i = 0; i < 160; i++) { g.fillStyle = rnd() < 0.5 ? b : c; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(rnd() * 512, rnd() * 512, 20 + rnd() * 60, 12 + rnd() * 34, rnd() * 3, 0, 7); g.fill(); } g.globalAlpha = 1; break;
    case 'flames': for (let i = 0; i < 16; i++) { const x = i * 34 + rnd() * 10; for (const [col, h] of [[b, 230], [c, 140]]) { g.fillStyle = col; g.beginPath(); g.moveTo(x - 24, 512); g.bezierCurveTo(x - 20, 512 - h * 0.5, x + 18, 512 - h * 0.6, x + 4, 512 - h - rnd() * 60); g.bezierCurveTo(x + 30, 512 - h * 0.5, x + 34, 512 - h * 0.2, x + 30, 512); g.fill(); } } break;
    case 'fade': { const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 512, 512); g.fillStyle = c; g.fillRect(0, 236, 512, 16); break; }
    case 'carbon': { for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { g.fillStyle = (x + y) & 1 ? a : b; g.fillRect(x * 8, y * 8, 8, 8); } g.fillStyle = c; g.fillRect(0, 238, 512, 8); break; }
    case 'tricolor': g.fillStyle = a; g.fillRect(0, 0, 512, 171); g.fillStyle = b; g.fillRect(0, 171, 512, 171); g.fillStyle = c; g.fillRect(0, 342, 512, 170); break;
    case 'gold': { const gr = g.createLinearGradient(0, 0, 512, 512); gr.addColorStop(0, c); gr.addColorStop(0.35, b); gr.addColorStop(0.55, a); gr.addColorStop(1, c); g.fillStyle = gr; g.fillRect(0, 0, 512, 512); break; }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return (skinCache[id] = t);
}
export const skinCss = (id) => { const s = SKINS.find(x => x.id === id) || SKINS[0]; return `linear-gradient(135deg, ${s.c[0]} 0 45%, ${s.c[1]} 45% 75%, ${s.c[2]} 75%)`; };

// ----------------------------------------------------------- définitions
const DEF = {
  sparrow: { len: 7.4, fr: 0.56, span: 9.6, rc: 1.9, tc: 1.1, sw: 0.15, wz: -1.2, wy: -0.1, tail: { span: 3.4, rc: 1.3, tc: 0.7, sw: 0.3 }, fin: 1.7, tz: 3.0, prop: { r: 1.1, n: 2 }, cz: -0.15, eye: [0, 0.82, -0.7], mass: 1 },
  edge:    { len: 6.6, fr: 0.5,  span: 7.4, rc: 2.1, tc: 1.6, sw: 0.0,  wz: -1.1, wy: 0.0,  tail: { span: 3.0, rc: 1.2, tc: 0.8, sw: 0.2 }, fin: 1.5, tz: 2.7, prop: { r: 0.98, n: 3 }, cz: -0.1, eye: [0, 0.75, -0.55], mass: 1 },
  mustang: { len: 9.6, fr: 0.68, span: 11,  rc: 3.0, tc: 1.3, sw: 0.7,  wz: -1.7, wy: -0.15, tail: { span: 4.2, rc: 1.7, tc: 0.9, sw: 0.5 }, fin: 2.2, tz: 4.1, prop: { r: 1.45, n: 4 }, cz: -0.3, eye: [0, 0.98, -0.95], mass: 1.3 },
  viper:   { len: 13.5, fr: 0.62, span: 8.6, rc: 5.2, tc: 1.3, sw: 3.8, wz: -1.0, wy: -0.1, tail: { span: 4.8, rc: 2.8, tc: 1.1, sw: 1.6 }, fin: 3.0, tz: 5.3, jet: 1, cz: -2.0, eye: [0, 0.95, -2.3], mass: 1.5 },
  falcon:  { len: 15.5, fr: 0.62, span: 11.6, rc: 6.0, tc: 1.6, sw: 4.6, wz: -1.4, wy: -0.1, tail: { span: 5.4, rc: 3.0, tc: 1.2, sw: 1.8 }, fin: 2.8, tz: 6.2, jet: 2, twinFin: 1, cz: -2.4, eye: [0, 1.0, -2.7], mass: 1.8 },
};
export const eyeOf = (id) => DEF[id].eye;

function wingGeo(span, rc, tc, sweep, zLE, th) {      // plan-forme symétrique extrudée (épaisseur en Y)
  const s = span / 2, zlt = zLE + sweep, pts = [[-s, zlt], [0, zLE], [s, zlt], [s, zlt + tc], [0, zLE + rc], [-s, zlt + tc]];
  const sh = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? sh.lineTo(x, -z) : sh.moveTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: true, bevelThickness: th * 0.3, bevelSize: th * 0.3, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, -th / 2, 0); return g;
}
function finGeo(h, cb, ct, sweep) {                   // dérive : plan en (z,y) extrudé en X fin
  const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(cb, 0); sh.lineTo(sweep + ct, h); sh.lineTo(sweep, h); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false }); g.translate(0, 0, -0.06); g.rotateY(-Math.PI / 2); return g;
}

export function buildPlane(planeId, skinId) {
  const d = DEF[planeId] || DEF.sparrow, spec = PLANES[planeId] || PLANES.sparrow;
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const tex = skinTexture(skinId);
  const wtex = tex.clone(); wtex.needsUpdate = true; wtex.repeat.set(1 / 14, 1 / 14);
  const mat = (map) => new THREE.MeshPhysicalMaterial({ map, metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.9 });
  const mBody = mat(tex), mWing = mat(wtex);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6, metalness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c9199, roughness: 0.3, metalness: 0.9 });
  const add = (geo, m, p, parent = group) => { const o = new THREE.Mesh(geo, m); if (p) o.position.set(...p); o.castShadow = true; parent.add(o); return o; };

  // fuselage
  const prof = d.jet ? [[0.04, 0], [0.3, 0.1], [0.5, 0.3], [0.55, 0.5], [0.5, 0.7], [0.34, 0.86], [0.14, 0.96], [0, 1]]
                     : [[0.05, 0], [0.18, 0.12], [0.42, 0.3], [0.55, 0.45], [0.55, 0.62], [0.5, 0.78], [0.42, 0.9], [0.34, 0.97], [0, 0.97]];
  const lg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * d.fr / 0.55, y * d.len)), 28);
  lg.translate(0, -d.len * 0.45, 0); lg.rotateX(-Math.PI / 2);
  add(lg, mBody, null, body);
  const noseZ = -d.len * (d.jet ? 0.55 : 0.52);
  // verrière + pilote
  const can = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x0b1620, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 1.6 }));
  can.scale.set(d.fr * 0.72, d.fr * 0.65, d.len * (d.jet ? 0.13 : 0.1)); can.position.set(0, d.fr * 0.6, d.cz); body.add(can);
  const pil = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe9e9ef, roughness: 0.4 })); pil.position.set(0, d.fr * 0.62, d.cz + 0.1); body.add(pil);
  // ailes, empennage
  const wy = d.wy; add(wingGeo(d.span, d.rc, d.tc, d.sw, d.wz, 0.16), mWing, [0, wy, 0], body);
  add(wingGeo(d.tail.span, d.tail.rc, d.tail.tc, d.tail.sw, d.tz, 0.1), mWing, [0, 0.05, 0], body);
  if (d.twinFin) for (const sx of [-1, 1]) { const f = add(finGeo(d.fin, 2.6, 1.0, 1.5), mBody, [sx * 1.1, d.fr * 0.4, d.tz - 0.1], body); f.rotation.z = -sx * 0.22; }
  else add(finGeo(d.fin, 2.0, 0.9, 0.9), mBody, [0, d.fr * 0.45, d.tz - 0.2], body);
  // feux de navigation
  const led = (c, x, y, z) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(3) }); const o = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), m); o.position.set(x, y, z); group.add(o); return m; };
  const tipZ = d.wz + d.sw + d.tc * 0.5;
  const navL = led(0xff2020, -d.span / 2, wy, tipZ), navR = led(0x20ff40, d.span / 2, wy, tipZ), strobe = led(0xffffff, 0, d.fr + d.fin * 0.8, d.tz + 1);
  const wingtips = [new THREE.Vector3(-d.span / 2, wy, tipZ + d.tc * 0.5), new THREE.Vector3(d.span / 2, wy, tipZ + d.tc * 0.5)];

  let prop = null, blades = null, disc = null, flames = [], flameInner = [], glows = [];
  if (!d.jet) {                                       // hélice
    prop = new THREE.Group(); prop.position.set(0, 0, noseZ - 0.08); group.add(prop);
    const spin = new THREE.Mesh(new THREE.ConeGeometry(d.fr * 0.34, d.fr * 0.9, 20), mBody); spin.rotation.x = -Math.PI / 2; spin.position.z = -d.fr * 0.4; group.add(spin); spin.position.add(prop.position);
    blades = new THREE.Group(); prop.add(blades);
    for (let i = 0; i < d.prop.n; i++) {
      const arm = new THREE.Group(); arm.rotation.z = i / d.prop.n * Math.PI * 2;
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.16, d.prop.r, 0.025), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 })); bl.position.y = d.prop.r / 2 + 0.1; bl.rotation.y = 0.35; bl.castShadow = true;
      arm.add(bl); blades.add(arm);
    }
    disc = new THREE.Mesh(new THREE.CircleGeometry(d.prop.r + 0.1, 32), new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
    prop.add(disc);
  } else {                                            // réacteurs
    const n = d.jet, xs = n === 1 ? [0] : [-0.8, 0.8];
    xs.forEach(x => {
      const tz = d.len * 0.45 + 0.1;
      add(new THREE.CylinderGeometry(0.46, 0.38, 1.3, 20, 1, true), metal, [x, n === 1 ? 0 : -0.05, tz - 0.5], group).rotation.x = Math.PI / 2;
      const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.45, 0.1).multiplyScalar(2.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.4, 4, 16, 1, true), fm); fl.geometry.rotateX(Math.PI / 2); fl.geometry.translate(0, 0, 2.1); fl.position.set(x, n === 1 ? 0 : -0.05, tz); group.add(fl); flames.push(fl);
      const im = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.8, 1.0).multiplyScalar(4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const fi = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.2, 12, 1, true), im); fi.geometry.rotateX(Math.PI / 2); fi.geometry.translate(0, 0, 1.2); fi.position.copy(fl.position); group.add(fi); flameInner.push(fi);
      const gm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.5, 0.15).multiplyScalar(3) });
      const gl = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16), gm); gl.position.set(x, fl.position.y, tz + 0.02); group.add(gl); glows.push(gm);
      if (n === 2) { const it = add(new THREE.CylinderGeometry(0.4, 0.46, 1.4, 16, 1, true), dark, [x * 1.05, -0.05, d.wz + 0.6], group); it.rotation.x = Math.PI / 2; }
    });
    if (n === 1) { const it = add(new THREE.CylinderGeometry(0.3, 0.38, 1.0, 16, 1, true), dark, [0, -0.35, d.wz + 1.2], group); it.rotation.x = Math.PI / 2; }
  }
  group.traverse(o => { if (o.isMesh) o.frustumCulled = true; });

  let t = 0;
  return {
    group, body, spec, wingtips, eyePos: new THREE.Vector3(...d.eye), span: d.span, len: d.len, noseZ,
    update(dt, thr, boost) {
      t += dt;
      if (blades) { const rpm = 25 + thr * 150 + (boost ? 25 : 0); blades.rotation.z += rpm * dt; disc.material.opacity = 0.05 + 0.2 * Math.min(1, rpm / 120); blades.children.forEach(a => a.children[0].material.opacity = 1); }
      if (flames.length) {
        const l = 0.35 + thr * 1.0 + (boost ? 1.4 : 0), w = 0.7 + thr * 0.35;
        flames.forEach((f, i) => { const flick = 0.92 + 0.08 * Math.sin(t * 60 + i * 2); f.scale.set(w * flick, w * flick, l * flick); f.material.opacity = 0.25 + 0.6 * thr; f.material.color.setRGB(boost ? 0.35 : 1, boost ? 0.55 : 0.45, boost ? 1.0 : 0.1).multiplyScalar(2.5); });
        flameInner.forEach(f => { f.scale.set(w, w, l * 0.8); f.material.opacity = 0.2 + 0.7 * thr; });
        glows.forEach(g => g.color.setRGB(1, 0.35 + 0.3 * thr, 0.1).multiplyScalar(1 + thr * 3));
      }
      navL.color.setRGB(3, 0.2, 0.2); navR.color.setRGB(0.2, 3, 0.4);
      const on = (t % 1.1) < 0.09 ? 5 : 0.05; strobe.color.setRGB(on, on, on);
    },
    setCockpit(on) { body.visible = !on; },
    setLights(on) { navL.visible = navR.visible = strobe.visible = on; },
  };
}

// ---------------------------------------------------------------- traînées
export class Trail {
  constructor(scene, n = 48, color = 0xffffff) {
    this.n = n; this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 8); this.init = false;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; scene.add(this.mesh); this.alpha = 0; this.acc = 0;
  }
  push(p, up, alpha, dt) {
    this.acc += dt; if (this.acc < 1 / 45 && this.init) return; this.acc = 0;
    const n = this.n, P = this.pos;
    P.copyWithin(6, 0, (n - 1) * 6);
    P[0] = p.x + up.x * 0.35; P[1] = p.y + up.y * 0.35; P[2] = p.z + up.z * 0.35; P[3] = p.x - up.x * 0.35; P[4] = p.y - up.y * 0.35; P[5] = p.z - up.z * 0.35;
    if (!this.init) { for (let i = 1; i < n; i++) P.copyWithin(i * 6, 0, 6); this.init = true; }
    this.alpha += (alpha - this.alpha) * 0.2;
    for (let i = 0; i < n; i++) { const a = this.alpha * Math.pow(1 - i / (n - 1), 1.6) * 0.8; for (let k = 0; k < 2; k++) { const o = (i * 2 + k) * 4; this.col[o] = this.col[o + 1] = this.col[o + 2] = 1; this.col[o + 3] = a; } }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true;
  }
  reset() { this.init = false; this.alpha = 0; }
  dispose(scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
