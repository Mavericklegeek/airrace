// Monde 3D : ciel, océan (shader), îles, ville, nuages, anneaux, lumière
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTrack, terrainRaw, buildingInfo, RING_R, hash, fbm, smooth } from '/shared/game.js';

export const QUALITY = {
  low:  { pr: 1,   shadow: 0,    bloom: false, seg: 64,  trees: 150,  clouds: 25, msaa: 0 },
  med:  { pr: 1.5, shadow: 1024, bloom: true,  seg: 100, trees: 500,  clouds: 55, msaa: 2 },
  high: { pr: 2,   shadow: 2048, bloom: true,  seg: 140, trees: 1100, clouds: 90, msaa: 4 },
};
const PRESET = {
  day:  { zen: '#2a6fc2', hor: '#bcd6ee', sun: '#fff3d6', ground: '#0b3550', deep: '#06304d', shal: '#1fc4c0', fog: 0.000034, cloud: 0.85, sunI: 3.4, hemi: 0.55, emis: 0 },
  dusk: { zen: '#14244f', hor: '#f0a27a', sun: '#ffb070', ground: '#0a1828', deep: '#0a1d33', shal: '#1b5f7a', fog: 0.000042, cloud: 0.8,  sunI: 2.4, hemi: 0.45, emis: 1.5 },
  dawn: { zen: '#2a4c8a', hor: '#f6c08a', sun: '#ffd09a', ground: '#0c2438', deep: '#0b2b45', shal: '#2a8f94', fog: 0.00004,  cloud: 0.7,  sunI: 2.6, hemi: 0.5,  emis: 0.8 },
};

const SKY_V = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const SKY_F = `
uniform vec3 uSun,uZen,uHor,uSunCol,uGround; uniform float uTime,uCloud; varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec3 d=normalize(vDir); float h=d.y;
  vec3 col=mix(uHor,uZen,pow(clamp(h,0.,1.),0.42));
  float sd=max(dot(d,uSun),0.);
  col+=uSunCol*(pow(sd,6.)*0.25+pow(sd,64.)*0.35);
  col+=uSunCol*exp(-abs(h)*7.)*pow(sd,2.)*0.5;
  col+=uSunCol*smoothstep(0.9993,0.9998,sd)*18.;
  if(h>0.0){
    vec2 uv=d.xz/(h+0.14)*0.9+vec2(uTime*0.004,0.);
    float n=fbm(uv*1.3); float c=smoothstep(0.5,0.8,n)*uCloud*smoothstep(0.0,0.2,h);
    vec3 cc=(mix(uHor,vec3(1.),0.55)*(0.7+0.5*pow(sd,2.)))+uSunCol*pow(sd,4.)*0.45;
    cc*=mix(0.7,1.0,smoothstep(0.8,0.5,n)); col=mix(col,cc,c);
  } else col=mix(uHor,uGround,clamp(-h*5.,0.,1.));
  gl_FragColor=vec4(col,1.);
}`;

const SEA_V = `varying vec3 vW; void main(){ vec4 wp=modelMatrix*vec4(position,1.); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`;
const SEA_F = `
uniform float uTime,uFogD,uHalf; uniform vec3 uSun,uSunCol,uDeep,uShal,uHor,uZen,uFog,uCam; uniform sampler2D uMask; varying vec3 vW;
vec3 waveN(vec2 p,float dist){
  vec2 g=vec2(0.);
  for(int i=0;i<7;i++){
    float fi=float(i); float ang=fi*2.399+0.5; vec2 dir=vec2(cos(ang),sin(ang));
    float fr=0.032*pow(1.62,fi); float sp=sqrt(9.8*fr)*0.85;
    float ph=dot(dir,p)*fr+uTime*sp; float a=0.34/pow(1.45,fi);
    a*=1.0/(1.0+dist*0.00025*(fi+1.0)*(fi+1.0));
    g+=dir*cos(ph)*a;
  }
  return normalize(vec3(-g.x,1.0,-g.y));
}
void main(){
  vec3 V=normalize(uCam-vW); float dist=length(uCam-vW);
  vec3 N=waveN(vW.xz,dist);
  float ndv=max(dot(N,V),0.); float fres=0.02+0.98*pow(1.-ndv,5.);
  vec3 R=reflect(-V,N); R.y=abs(R.y);
  vec3 sky=mix(uHor,uZen,pow(clamp(R.y,0.,1.),0.42)); float sd=max(dot(R,uSun),0.);
  sky+=uSunCol*(pow(sd,6.)*0.25+pow(sd,64.)*0.35);
  vec2 muv=vW.xz/(2.*uHalf)+0.5; float m=(muv.x<0.||muv.x>1.||muv.y<0.||muv.y>1.)?0.:texture2D(uMask,muv).r;
  float shallow=smoothstep(0.3,0.97,m);
  vec3 water=mix(uDeep,uShal,shallow);
  float crest=clamp((N.x*0.0+1.0-N.y)*6.,0.,1.); water+=uShal*0.25*crest*(0.3+shallow);
  vec3 col=mix(water,sky,fres);
  col+=uSunCol*(pow(sd,700.)*45.+pow(sd,120.)*0.6);
  float foam=smoothstep(0.90,0.985,m)*(0.6+0.4*sin(uTime*1.3+m*70.+vW.x*0.02+vW.z*0.017));
  col=mix(col,vec3(0.95),clamp(foam,0.,1.)*0.85);
  float f=1.-exp(-pow(dist*uFogD,2.)); col=mix(col,uFog,clamp(f,0.,1.));
  gl_FragColor=vec4(col,1.);
}`;

function windowTextures() {
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 256; return c; };
  const a = mk(), b = mk(), ga = a.getContext('2d'), gb = b.getContext('2d');
  ga.fillStyle = '#d8d8dc'; ga.fillRect(0, 0, 256, 256); gb.fillStyle = '#000'; gb.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const px = x * 64 + 9, py = y * 64 + 11, w = 46, h = 40;
    const gr = ga.createLinearGradient(0, py, 0, py + h); gr.addColorStop(0, '#32465e'); gr.addColorStop(1, '#16202e'); ga.fillStyle = gr; ga.fillRect(px, py, w, h);
    ga.fillStyle = 'rgba(255,255,255,0.25)'; ga.fillRect(px, py, w, 3);
    if (Math.random() < 0.42) { gb.fillStyle = Math.random() < 0.7 ? '#ffd9a0' : '#bfe3ff'; gb.fillRect(px + 2, py + 2, w - 4, h - 4); }
  }
  const t = (c) => { const x = new THREE.CanvasTexture(c); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.colorSpace = THREE.SRGBColorSpace; x.anisotropy = 8; return x; };
  return [t(a), t(b)];
}
function roadTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#5b5e63'; g.fillRect(0, 0, 256, 256);           // îlot (trottoir/béton)
  g.fillStyle = '#26282c'; g.fillRect(0, 0, 256, 38); g.fillRect(0, 218, 256, 38); g.fillRect(0, 0, 38, 256); g.fillRect(218, 0, 38, 256);
  g.fillStyle = '#d9d2a0'; for (let i = 0; i < 256; i += 32) { g.fillRect(i, 125, 16, 5); g.fillRect(125, i, 5, 16); }
  g.fillStyle = '#6a6d73'; g.fillRect(40, 40, 176, 176);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function cloudTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) { const x = 64 + (Math.random() - 0.5) * 60, y = 64 + (Math.random() - 0.5) * 36, r = 14 + Math.random() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class World {
  constructor(renderer, scene, quality = 'high') {
    this.r = renderer; this.scene = scene; this.q = QUALITY[quality]; this.trackId = null; this.dyn = new THREE.Group(); scene.add(this.dyn);
    this.time = 0; this.uTime = { value: 0 };
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.castShadow = false; scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd6ee, 0x203040, 0.5); scene.add(this.hemi);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.ringObjs = []; this.flashes = [];
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { uSun: { value: new THREE.Vector3() }, uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uTime: this.uTime, uCloud: { value: 0.8 } } });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat); this.sky.scale.setScalar(50000); this.sky.renderOrder = -10; this.sky.frustumCulled = false; scene.add(this.sky);
    this.cloudTex = cloudTexture();
  }
  setQuality(q) { this.q = QUALITY[q]; }

  async load(trackId) {
    if (this.trackId === trackId) return;
    this.trackId = trackId;
    // nettoyage
    for (const o of [...this.dyn.children]) { this.dyn.remove(o); o.traverse(n => { n.geometry && n.geometry.dispose(); if (n.material) { [].concat(n.material).forEach(m => { m.map && m.map.dispose && m.map.dispose(); m.dispose(); }); } }); }
    this.ringObjs = []; this.flashes = [];
    const tr = this.tr = getTrack(trackId), def = tr.def, P = PRESET[def.env];
    this.preset = P;
    const el = def.sunEl * Math.PI / 180, az = def.sunAz * Math.PI / 180;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    const U = this.skyMat.uniforms;
    U.uSun.value.copy(this.sunDir); U.uZen.value.set(P.zen); U.uHor.value.set(P.hor); U.uSunCol.value.set(P.sun); U.uGround.value.set(P.ground); U.uCloud.value = P.cloud;
    this.scene.fog = new THREE.FogExp2(new THREE.Color(P.hor), P.fog);
    this.sun.color.set(P.sun); this.sun.intensity = P.sunI; this.hemi.color.set(P.hor); this.hemi.groundColor.set(P.ground); this.hemi.intensity = P.hemi;
    this.sun.castShadow = this.q.shadow > 0;
    if (this.q.shadow) { const s = this.sun.shadow; s.mapSize.set(this.q.shadow, this.q.shadow); const c = s.camera; c.left = c.bottom = -260; c.right = c.top = 260; c.near = 10; c.far = 1400; s.bias = -0.0004; s.normalBias = 0.6; s.camera.updateProjectionMatrix(); if (s.map) { s.map.dispose(); s.map = null; } }
    // environnement (réflexions) depuis le ciel
    const envScene = new THREE.Scene(), envSky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.skyMat); envSky.scale.setScalar(50); envScene.add(envSky);
    if (this.envRT) this.envRT.dispose(); this.envRT = this.pmrem.fromScene(envScene, 0.02); this.scene.environment = this.envRT.texture;
    await new Promise(r => setTimeout(r, 0));
    this.buildOcean(tr, P); await new Promise(r => setTimeout(r, 0));
    this.buildIslands(tr, P); await new Promise(r => setTimeout(r, 0));
    if (tr.world.city) this.buildCity(tr, P);
    this.buildClouds(); this.buildRings(tr);
  }

  buildOcean(tr, P) {
    const N = 512, HALF = 9000, data = new Uint8Array(N * N), city = tr.world.city;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N * 2 * HALF - HALF, z = (j + 0.5) / N * 2 * HALF - HALF;
      let v = terrainRaw(tr.world, x, z);
      if (city) { const dx = Math.abs(x - city.cx) - city.n * city.cell / 2, dz = Math.abs(z - city.cz) - city.n * city.cell / 2; const d = Math.max(dx, dz); if (d < 60) v = Math.max(v, 4 - Math.max(0, d) * 0.1); }
      data[j * N + i] = Math.max(0, Math.min(255, Math.round((v + 14) / 14 * 255)));
    }
    const mask = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType); mask.magFilter = mask.minFilter = THREE.LinearFilter; mask.needsUpdate = true;
    this.seaMat = new THREE.ShaderMaterial({ vertexShader: SEA_V, fragmentShader: SEA_F, uniforms: {
      uTime: this.uTime, uFogD: { value: P.fog }, uHalf: { value: HALF }, uSun: { value: this.sunDir }, uSunCol: { value: new THREE.Color(P.sun) },
      uDeep: { value: new THREE.Color(P.deep) }, uShal: { value: new THREE.Color(P.shal) }, uHor: { value: new THREE.Color(P.hor) }, uZen: { value: new THREE.Color(P.zen) },
      uFog: { value: new THREE.Color(P.hor) }, uCam: { value: new THREE.Vector3() }, uMask: { value: mask } } });
    const g = new THREE.PlaneGeometry(80000, 80000, 1, 1); g.rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(g, this.seaMat); this.sea.frustumCulled = false; this.dyn.add(this.sea);
  }

  buildIslands(tr, P) {
    const seg = this.q.seg, sand = new THREE.Color('#d9c58f'), grass1 = new THREE.Color('#3f7a35'), grass2 = new THREE.Color('#6d8f3c'), rock = new THREE.Color('#7b756c'), dark = new THREE.Color('#4c463f'), snow = new THREE.Color('#e8ecef');
    const treePts = [];
    for (const isl of tr.world.islands) {
      const size = isl.r * 3.4, g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) + isl.x, z = pos.getZ(i) + isl.z; pos.setY(i, Math.max(-14, terrainRaw(tr.world, x, z))); pos.setX(i, x); pos.setZ(i, z); }
      g.computeVertexNormals(); const nor = g.attributes.normal; const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), ny = nor.getY(i), x = pos.getX(i), z = pos.getZ(i), n = fbm(x * 0.02, z * 0.02, 5, 3);
        if (y < 4) c.copy(sand).multiplyScalar(0.85 + n * 0.3);
        else { c.copy(grass1).lerp(grass2, n); if (y > 55 + n * 40) c.lerp(rock, smooth(55, 120, y)); if (y > 330) c.lerp(snow, smooth(330, 380, y)); if (ny < 0.72) c.lerp(y > 25 ? dark : rock, smooth(0.8, 0.55, ny)); c.lerp(sand, smooth(9, 3.5, y)); }
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        // arbres
        if (y > 6 && y < 90 && ny > 0.85 && hash(Math.round(x * 0.5), Math.round(z * 0.5), 91) < 0.07) treePts.push([x, y, z, hash(Math.round(x), Math.round(z), 3)]);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 }));
      m.receiveShadow = true; m.castShadow = this.q.shadow > 0; this.dyn.add(m);
    }
    const maxT = this.q.trees, pts = treePts.sort(() => Math.random() - 0.5).slice(0, maxT);
    if (pts.length) {
      const fol = new THREE.InstancedMesh(new THREE.ConeGeometry(3, 9, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, envMapIntensity: 0.3 }), pts.length);
      const trk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 5), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), pts.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
      pts.forEach(([x, y, z, r], i) => { const s = 0.7 + r * 1.1; sc.set(s, s * (0.9 + r * 0.5), s); m4.compose(new THREE.Vector3(x, y + 5.5 * s, z), q, sc); fol.setMatrixAt(i, m4); c.setHSL(0.25 + r * 0.08, 0.5, 0.2 + r * 0.1); fol.setColorAt(i, c); m4.compose(new THREE.Vector3(x, y + 1.2 * s, z), q, new THREE.Vector3(s, s, s)); trk.setMatrixAt(i, m4); });
      fol.castShadow = this.q.shadow > 0; this.dyn.add(fol, trk);
    }
  }

  buildCity(tr, P) {
    const city = tr.world.city, geos = [], T = 16, tint = new THREE.Color();
    const palette = ['#c9ccd2', '#aeb4bd', '#d8cfc0', '#9fb0c4', '#8e98a6', '#e1d6c8', '#b7c3cf', '#7f8b99'];
    for (let j = 0; j < city.n; j++) for (let i = 0; i < city.n; i++) {
      const b = buildingInfo(city, i, j); if (!b) continue;
      const g = new THREE.BoxGeometry(b.sx, b.h, b.sz); g.translate(b.x, b.h / 2, b.z);
      const uv = g.attributes.uv, ox = hash(i, j, 3), oy = hash(j, i, 4);
      for (let k = 0; k < 24; k++) {
        const face = k >> 2; let u = uv.getX(k), v = uv.getY(k);
        if (face === 0 || face === 1) { u = u * b.sz / T + ox; v = v * b.h / T + oy; }
        else if (face === 4 || face === 5) { u = u * b.sx / T + ox; v = v * b.h / T + oy; }
        else { u = 0.02; v = 0.02; }
        uv.setXY(k, u, v);
      }
      tint.set(palette[Math.floor(b.r * 977) % palette.length]); const cols = new Float32Array(24 * 3); for (let k = 0; k < 24; k++) { cols[k * 3] = tint.r; cols[k * 3 + 1] = tint.g; cols[k * 3 + 2] = tint.b; }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geos.push(g);
    }
    const [wt, we] = windowTextures();
    const em = P.emis;
    const mat = new THREE.MeshStandardMaterial({ map: wt, vertexColors: true, roughness: 0.5, metalness: 0.3, emissiveMap: we, emissive: new THREE.Color(0xffffff), emissiveIntensity: em, envMapIntensity: 0.6 });
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat); mesh.castShadow = this.q.shadow > 0; mesh.receiveShadow = true; this.dyn.add(mesh);
    geos.forEach(g => g.dispose());
    // sol : rues + îlots
    const size = city.n * city.cell, rt = roadTexture();
    rt.repeat.set((size + 120) / city.cell, (size + 120) / city.cell); rt.offset.set(-60 / city.cell, -60 / city.cell);   // rues alignées sur la grille
    const gp = new THREE.PlaneGeometry(size + 120, size + 120); gp.rotateX(-Math.PI / 2);
    const rtm = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.9, envMapIntensity: 0.3 });
    const gr = new THREE.Mesh(gp, rtm); gr.position.set(city.cx, 1.5, city.cz); gr.receiveShadow = true; this.dyn.add(gr);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(size + 120, 14, size + 120), new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.9 })); quay.position.set(city.cx, -5.5, city.cz); this.dyn.add(quay);
    // balises rouges sur les tours
    const tops = []; for (let j = 0; j < city.n; j++) for (let i = 0; i < city.n; i++) { const b = buildingInfo(city, i, j); if (b && b.h > 130) tops.push(b); }
    if (tops.length) { const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(1.6, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1) }), tops.length); const m4 = new THREE.Matrix4(); tops.forEach((b, k) => { m4.setPosition(b.x, b.h + 3, b.z); bm.setMatrixAt(k, m4); }); this.dyn.add(bm); }
  }

  buildClouds() {
    this.clouds = []; const n = this.q.clouds, P = this.preset;
    const col = new THREE.Color(P.hor).lerp(new THREE.Color(1, 1, 1), 0.65);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloudTex, color: col, transparent: true, opacity: 0.5 + Math.random() * 0.35, depthWrite: false, fog: false }));
      const sz = 500 + Math.random() * 1100; s.scale.set(sz, sz * 0.45, 1);
      s.position.set((Math.random() - 0.5) * 14000, 420 + Math.random() * 700, (Math.random() - 0.5) * 14000); this.dyn.add(s); this.clouds.push(s);
    }
  }

  buildRings(tr) {
    this.ringObjs = [];
    const torus = new THREE.TorusGeometry(RING_R, 1.7, 14, 72), glowT = new THREE.TorusGeometry(RING_R, 4.2, 10, 72), disc = new THREE.CircleGeometry(RING_R, 40);
    const up = new THREE.Vector3(0, 0, 1);
    tr.rings.forEach((r, i) => {
      const g = new THREE.Group(); g.position.set(r.x, r.y, r.z); g.quaternion.setFromUnitVectors(up, new THREE.Vector3(r.nx, r.ny, r.nz).normalize());
      const core = new THREE.Mesh(torus, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      const glow = new THREE.Mesh(glowT, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      const film = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      g.add(core, glow, film); this.dyn.add(g); this.ringObjs.push({ g, core, glow, film, last: i === tr.rings.length - 1 });
    });
  }
  flashRing(i) { const o = this.ringObjs[i]; if (!o) return; this.flashes.push({ i, t: 0 }); }

  // cur = index du prochain anneau pour le joueur
  update(dt, camPos, target, cur) {
    this.time += dt; this.uTime.value = this.time;
    this.sky.position.copy(camPos);
    if (this.sea) { this.sea.position.set(camPos.x, 0, camPos.z); this.seaMat.uniforms.uCam.value.copy(camPos); }
    // soleil + ombres autour de la cible
    this.sun.position.copy(target).addScaledVector(this.sunDir, 700); this.sun.target.position.copy(target);
    // nuages : repliement autour de la caméra
    if (this.clouds) for (const c of this.clouds) { c.position.x += dt * 6; const dx = c.position.x - camPos.x, dz = c.position.z - camPos.z; if (dx > 7000) c.position.x -= 14000; if (dx < -7000) c.position.x += 14000; if (dz > 7000) c.position.z -= 14000; if (dz < -7000) c.position.z += 14000; }
    // anneaux
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 6);
    this.ringObjs.forEach((o, i) => {
      const rel = i - cur, vis = rel >= 0 && rel < 6; o.g.visible = vis; if (!vis) return;
      const k = rel === 0 ? pulse : 1; let c;
      if (o.last) c = [3.5, 2.6, 0.4]; else if (rel === 0) c = [0.4, 3.2, 3.2]; else if (rel === 1) c = [0.5, 1.4, 2.2]; else c = [0.25, 0.55, 1.0];
      o.core.material.color.setRGB(c[0] * k, c[1] * k, c[2] * k); o.glow.material.color.setRGB(c[0], c[1], c[2]); o.glow.material.opacity = rel === 0 ? 0.28 * pulse : 0.12; o.film.material.color.setRGB(c[0], c[1], c[2]); o.film.material.opacity = rel === 0 ? 0.09 : 0.03;
      const s = rel === 0 ? 1 + 0.02 * Math.sin(this.time * 6) : 1; o.g.scale.setScalar(s);
    });
    for (let k = this.flashes.length - 1; k >= 0; k--) { const f = this.flashes[k]; f.t += dt; const o = this.ringObjs[f.i]; if (!o) continue; if (f.t > 0.6) { this.flashes.splice(k, 1); continue; } o.g.visible = true; o.g.scale.setScalar(1 + f.t * 1.4); o.core.material.color.setRGB(3, 3, 3); o.glow.material.opacity = 0.5 * (1 - f.t / 0.6); o.film.material.opacity = 0.2 * (1 - f.t / 0.6); }
  }
}
