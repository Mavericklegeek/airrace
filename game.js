// ============================================================================
//  AIR RACE — noyau partagé (client + serveur) : maths, monde, circuits,
//  avions, peintures, modèle de vol.  Aucune dépendance.
// ============================================================================
export const MAX_PLAYERS = 8;
export const RING_R = 42;           // rayon des anneaux (m)
export const TICK_HZ = 20;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- quaternions
// q = [x,y,z,w]. Repère avion : avant = -Z, droite = +X, haut = +Y.
export function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
          aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
export function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
export function qrot(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
export const qinvrot = (q, v) => qrot([-q[0], -q[1], -q[2], q[3]], v);
export function qFromRotVec(wx, wy, wz) {           // rotation (rad) autour d'un axe local
  const a = Math.hypot(wx, wy, wz);
  if (a < 1e-9) return [0, 0, 0, 1];
  const s = Math.sin(a / 2) / a;
  return [wx * s, wy * s, wz * s, Math.cos(a / 2)];
}
export function qLook(f) {                          // avant = f, haut ~ +Y
  const l = Math.hypot(f[0], f[1], f[2]) || 1; f = [f[0] / l, f[1] / l, f[2] / l];
  // r = cross(f, up) avec up=(0,1,0)
  let r = [-f[2], 0, f[0]];
  let rl = Math.hypot(r[0], r[1], r[2]);
  if (rl < 1e-4) { r = [1, 0, 0]; rl = 1; }
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const X = r, Y = u, Z = [-f[0], -f[1], -f[2]];
  const m00 = X[0], m01 = Y[0], m02 = Z[0], m10 = X[1], m11 = Y[1], m12 = Z[1], m20 = X[2], m21 = Y[2], m22 = Z[2];
  const tr = m00 + m11 + m22; let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  return qnorm([x, y, z, w]);
}

// -------------------------------------------------------------------- bruit
function hash(i, j, seed = 0) {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967295;
}
export { hash };
function vnoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, seed), b = hash(xi + 1, zi, seed), c = hash(xi, zi + 1, seed), d = hash(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, seed = 0, oct = 4) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f, seed + i * 17); f *= 2; a *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}

// ------------------------------------------------------------------- avions
export const PLANES = {
  sparrow: { id: 'sparrow', name: 'Sparrow S1',  kind: 'prop', level: 1,  vmax: 92,  accel: 20, pitch: 1.5,  roll: 3.2, yaw: 0.50, stall: 24, boost: 1.22, desc: 'Monoplan léger et docile. Parfait pour débuter.' },
  edge:    { id: 'edge',    name: 'Edge 540X',   kind: 'prop', level: 3,  vmax: 95,  accel: 24, pitch: 2.0,  roll: 4.6, yaw: 0.60, stall: 22, boost: 1.20, desc: 'Voltige pure : roulis fulgurant, vitesse modeste.' },
  mustang: { id: 'mustang', name: 'Mustang R-51', kind: 'prop', level: 5, vmax: 115, accel: 24, pitch: 1.25, roll: 2.6, yaw: 0.40, stall: 34, boost: 1.25, desc: 'Racer à hélice, redoutable en ligne droite.' },
  viper:   { id: 'viper',   name: 'Viper F-9',   kind: 'jet',  level: 8,  vmax: 140, accel: 36, pitch: 1.0,  roll: 2.5, yaw: 0.32, stall: 46, boost: 1.30, desc: 'Monoréacteur. Postcombustion foudroyante.' },
  falcon:  { id: 'falcon',  name: 'Falcon TX-2', kind: 'jet',  level: 12, vmax: 158, accel: 42, pitch: 0.85, roll: 2.1, yaw: 0.28, stall: 54, boost: 1.30, desc: 'Biréacteur ultime. Rapide, exigeant.' },
};

// --------------------------------------------------------------- peintures
export const SKINS = [
  { id: 'classic',  name: 'Classique',     c: ['#f2f4f7', '#1c4fa3', '#e63946'], pattern: 'stripe',  req: {} },
  { id: 'redbaron', name: 'Baron rouge',   c: ['#c4161c', '#1b1b1b', '#f4f4f4'], pattern: 'solid',   req: {} },
  { id: 'sunny',    name: 'Citron',        c: ['#ffd43b', '#1d1d1d', '#ffffff'], pattern: 'stripe',  req: { level: 2 } },
  { id: 'forest',   name: 'Camouflage',    c: ['#4b5d3a', '#2f3b25', '#7a8a5a'], pattern: 'camo',    req: { level: 3 } },
  { id: 'checker',  name: 'Damier',        c: ['#f5f5f5', '#141414', '#e63946'], pattern: 'checker', req: { level: 4 } },
  { id: 'flames',   name: 'Flammes',       c: ['#1a1a22', '#ff6a00', '#ffd000'], pattern: 'flames',  req: { level: 5 } },
  { id: 'arctic',   name: 'Glace',         c: ['#dff3ff', '#4aa8e8', '#ffffff'], pattern: 'fade',    req: { level: 6 } },
  { id: 'sunset',   name: 'Crépuscule',    c: ['#ff7a3d', '#7b2cbf', '#ffd6a5'], pattern: 'fade',    req: { level: 7 } },
  { id: 'carbon',   name: 'Carbone',       c: ['#202226', '#3a3d44', '#00e5ff'], pattern: 'carbon',  req: { level: 8 } },
  { id: 'tricolor', name: 'Tricolore',     c: ['#f5f5f5', '#1f3fae', '#e11d2e'], pattern: 'tricolor', req: { races: 5 } },
  { id: 'neon',     name: 'Néon',          c: ['#0b0b1a', '#00f0ff', '#ff2bd6'], pattern: 'stripe',  req: { level: 10 } },
  { id: 'sakura',   name: 'Sakura',        c: ['#ffd6e7', '#ff7aa8', '#ffffff'], pattern: 'fade',    req: { level: 12 } },
  { id: 'gold',     name: 'Or du champion', c: ['#d4a017', '#fff1a8', '#6b4a00'], pattern: 'gold',   req: { wins: 3 } },
  { id: 'phantom',  name: 'Fantôme',       c: ['#0c0c0e', '#17171b', '#7c3aed'], pattern: 'stripe',  req: { wins: 10 } },
];
export const levelOf = (xp) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 120));
export const xpForLevel = (l) => 120 * (l - 1) * (l - 1);
export function isUnlocked(req, p) {
  const lv = levelOf(p.xp || 0);
  return (!req.level || lv >= req.level) && (!req.races || (p.races || 0) >= req.races) && (!req.wins || (p.wins || 0) >= req.wins);
}
export const reqText = (r) => r.level ? `Niveau ${r.level}` : r.races ? `${r.races} courses` : r.wins ? `${r.wins} victoires` : 'Disponible';
export const unlockedPlanes = (p) => Object.values(PLANES).filter(a => (p.xp ? levelOf(p.xp) : 1) >= a.level).map(a => a.id);
export const unlockedSkins = (p) => SKINS.filter(s => isUnlocked(s.req, p)).map(s => s.id);

// ------------------------------------------------------------------ monde
// Chaque circuit a : un océan, des îles (relief), une ville sur plate-forme (option).
const TRACK_DEFS = {
  neon: {
    id: 'neon', name: 'Néon City', sub: 'Mégapole en bord de mer, au crépuscule', env: 'dusk', sunEl: 6, sunAz: 235, lights: true,
    city: { cx: 0, cz: 0, n: 30, cell: 110, seed: 11 }, islands: [],
    pts: [[2900, 150], [1500, 120], [600, 95], [1750, 190], [2900, 210], [1100, 105], [350, 85], [1500, 160], [3000, 230], [2000, 150], [750, 100], [1900, 170]],
    scale: 1.0, rot: 0.2,
  },
  archipel: {
    id: 'archipel', name: 'Archipel Pacifique', sub: 'Îles volcaniques et lagons turquoise', env: 'day', sunEl: 38, sunAz: 150, lights: false,
    city: null, islandGen: { seed: 7, count: 13, rmin: 1700, rmax: 3900, hmin: 70, hmax: 190, big: { x: 0, z: 0, r: 1300, h: 420 } },
    pts: [[3000, 60], [2300, 40], [3400, 90], [2700, 55], [2000, 110], [3200, 45], [2500, 80], [3600, 60], [2800, 100], [2100, 50], [3300, 70], [2600, 45]],
    scale: 1.0, rot: 0.1,
  },
  baie: {
    id: 'baie', name: 'Baie des Anges', sub: 'Port moderne, falaises et île sauvage — aube dorée', env: 'dawn', sunEl: 3, sunAz: 80, lights: true,
    city: { cx: 2100, cz: 0, n: 22, cell: 110, seed: 23 }, islandGen: { seed: 31, count: 9, rmin: 2600, rmax: 5200, hmin: 60, hmax: 160, big: { x: -2300, z: 600, r: 1500, h: 300 }, avoid: { x: 2100, z: 0, r: 1900 } },
    pts: [[3000, 140], [2400, 90], [3300, 60], [2700, 180], [1900, 120], [3100, 70], [2500, 150], [3500, 110], [2800, 70], [2100, 160], [3400, 90], [2600, 120]],
    scale: 1.0, rot: 0.5, ox: 450, oz: 0,
  },
};
export const TRACK_IDS = Object.keys(TRACK_DEFS);
export const trackList = () => TRACK_IDS.map(id => ({ id, name: TRACK_DEFS[id].name, sub: TRACK_DEFS[id].sub }));

function rngFor(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function genIslands(g) {
  const rnd = rngFor(g.seed), out = [];
  if (g.big) out.push({ x: g.big.x, z: g.big.z, r: g.big.r, h: g.big.h, s: 1 });
  let tries = 0;
  while (out.length < g.count + (g.big ? 1 : 0) && tries++ < 400) {
    const a = rnd() * Math.PI * 2, d = g.rmin + rnd() * (g.rmax - g.rmin);
    const isl = { x: Math.cos(a) * d, z: Math.sin(a) * d, r: 350 + rnd() * 600, h: g.hmin + rnd() * (g.hmax - g.hmin), s: 2 + out.length };
    if (g.avoid && Math.hypot(isl.x - g.avoid.x, isl.z - g.avoid.z) < g.avoid.r + isl.r) continue;
    if (out.every(o => Math.hypot(o.x - isl.x, o.z - isl.z) > (o.r + isl.r) * 0.9)) out.push(isl);
  }
  return out;
}

// bâtiments --------------------------------------------------------------
export function buildingInfo(city, i, j) {
  if (i < 0 || j < 0 || i >= city.n || j >= city.n) return null;
  const sd = city.seed;
  const r1 = hash(i, j, sd), r2 = hash(i + 99, j - 17, sd), r3 = hash(i - 45, j + 71, sd), r4 = hash(i + 7, j + 3, sd + 5);
  if (r1 < 0.09) return null;                               // parc / place
  const x0 = city.cx - city.n * city.cell / 2, z0 = city.cz - city.n * city.cell / 2;
  const sx = city.cell * (0.42 + 0.28 * r2), sz = city.cell * (0.42 + 0.28 * r3);
  const x = x0 + (i + 0.5) * city.cell + (r4 - 0.5) * (city.cell - sx) * 0.5;
  const z = z0 + (j + 0.5) * city.cell + (r2 - 0.5) * (city.cell - sz) * 0.5;
  const d = Math.hypot(i + 0.5 - city.n / 2, j + 0.5 - city.n / 2) / (city.n / 2);
  let h = (16 + r1 * 46) * (0.5 + Math.max(0, 1 - d) * 1.9);
  if (r2 > 0.92 && d < 0.75) h += 70 + r3 * 120;
  return { x, z, sx, sz, h: Math.min(260, h), r: r1, i, j };
}
export function cityHeightAt(city, x, z) {
  if (!city) return 0;
  const x0 = city.cx - city.n * city.cell / 2, z0 = city.cz - city.n * city.cell / 2;
  const i = Math.floor((x - x0) / city.cell), j = Math.floor((z - z0) / city.cell);
  if (i < 0 || j < 0 || i >= city.n || j >= city.n) return 0;
  const b = buildingInfo(city, i, j);
  if (!b) return 0;
  return (Math.abs(x - b.x) < b.sx / 2 + 3 && Math.abs(z - b.z) < b.sz / 2 + 3) ? b.h : 0;
}
export const onPlatform = (city, x, z) => !!city && Math.abs(x - city.cx) < city.n * city.cell / 2 + 60 && Math.abs(z - city.cz) < city.n * city.cell / 2 + 60;

// relief ------------------------------------------------------------------
export function terrainRaw(world, x, z) {         // peut être négatif (fonds marins proches des îles)
  let best = -14;
  for (const isl of world.islands) {
    const dx = x - isl.x, dz = z - isl.z, lim = isl.r * 1.6;
    if (dx * dx + dz * dz > lim * lim) continue;
    const d = Math.sqrt(dx * dx + dz * dz) / isl.r;
    const n = fbm(x * 0.0022 + isl.s * 3.1, z * 0.0022 - isl.s, isl.s, 3);
    const dd = d + (n - 0.5) * 0.7;
    const s = smooth(1.25, 0.35, dd);
    const detail = fbm(x * 0.007 + isl.s * 9, z * 0.007, isl.s + 3, 4);
    const rid = 1 - Math.abs(fbm(x * 0.004 - isl.s, z * 0.004 + isl.s * 2, isl.s + 8, 3) * 2 - 1);
    const peak = isl.h * (0.5 + 0.55 * detail + 0.35 * rid * rid);
    const hgt = -14 + s * (peak + 14);
    if (hgt > best) best = hgt;
  }
  return best;
}
export function groundHeight(world, x, z) {
  const t = terrainRaw(world, x, z);
  const c = cityHeightAt(world.city, x, z);
  const p = onPlatform(world.city, x, z) ? 1.5 : 0;
  return Math.max(0, t, c, p);
}

// --------------------------------------------------------------- circuits
const cache = {};
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t, o = [0, 0, 0];
  for (let k = 0; k < 3; k++) o[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  return o;
}
export function getTrack(id) {
  if (cache[id]) return cache[id];
  const def = TRACK_DEFS[id];
  const world = { city: def.city, islands: def.islands ? def.islands : def.islandGen ? genIslands(def.islandGen) : [] };
  const N = def.pts.length, ctrl = [];
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2 + (def.rot || 0), r = def.pts[k][0] * (def.scale || 1);
    ctrl.push([Math.cos(a) * r + (def.ox || 0), def.pts[k][1], Math.sin(a) * r + (def.oz || 0)]);
  }
  const dense = [], S = 40;
  for (let k = 0; k < N; k++) for (let s = 0; s < S; s++) dense.push(catmull(ctrl[(k - 1 + N) % N], ctrl[k], ctrl[(k + 1) % N], ctrl[(k + 2) % N], s / S));
  dense.push(dense[0]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1], dense[i][2] - dense[i - 1][2]));
  const total = cum[cum.length - 1], M = Math.max(16, Math.round(total / 560));
  const at = (dist) => {                               // position + tangente à distance donnée
    dist = ((dist % total) + total) % total;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= dist) lo = m; else hi = m; }
    const t = (dist - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]), a = dense[lo], b = dense[hi];
    const tg = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...tg) || 1;
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], t: [tg[0] / l, tg[1] / l, tg[2] / l] };
  };
  const rings = [];
  for (let i = 0; i < M; i++) {
    const { p, t } = at((i + 1) * total / M);
    let y = Math.max(p[1], 30);
    // dégagement : relief / bâtiments dans un rayon et vers l'anneau précédent
    let need = 0;
    const probe = (x, z) => { need = Math.max(need, groundHeight(world, x, z) + 42); };
    probe(p[0], p[2]);
    for (let a = 0; a < 6; a++) probe(p[0] + Math.cos(a) * 60, p[2] + Math.sin(a) * 60);
    const prev = i ? rings[i - 1] : null;
    if (prev) for (let k = 1; k < 14; k++) { const f = k / 14; probe(prev.x + (p[0] - prev.x) * f, prev.z + (p[2] - prev.z) * f); }
    y = Math.max(y, need);
    rings.push({ x: p[0], y, z: p[2], nx: t[0], ny: t[1], nz: t[2] });
  }
  // lissage vertical (évite les murs de bâtiments entre 2 anneaux)
  for (let it = 0; it < 2; it++) for (let i = 1; i < M - 1; i++) rings[i].y = Math.max(rings[i].y, (rings[i - 1].y + rings[i + 1].y) / 2 - 10);
  for (let i = 0; i < M; i++) { const r = rings[i], nx = rings[(i + 1) % M]; const dx = nx.x - r.x, dy = nx.y - r.y, dz = nx.z - r.z, l = Math.hypot(dx, dy, dz) || 1; r.nx = dx / l; r.ny = dy / l; r.nz = dz / l; }
  // le dernier anneau (arrivée) regarde dans la direction de la ligne de départ
  const s0 = at(0), sd = [s0.t[0], s0.t[1] * 0.3, s0.t[2]];
  rings[M - 1].nx = sd[0]; rings[M - 1].ny = sd[1]; rings[M - 1].nz = sd[2];
  const start = { x: s0.p[0], y: Math.max(s0.p[1], groundHeight(world, s0.p[0], s0.p[2]) + 60), z: s0.p[2], dir: s0.t };
  const tr = { id, def, world, rings, start, length: total };
  cache[id] = tr;
  return tr;
}

export function startSlot(tr, idx) {                  // grille 2 colonnes
  const f = tr.start.dir, fl = Math.hypot(f[0], f[2]) || 1, fx = f[0] / fl, fz = f[2] / fl;
  const row = idx >> 1, side = idx & 1 ? 1 : -1;
  const rx = -fz, rz = fx;                            // droite horizontale
  const x = tr.start.x - fx * (40 + row * 38) + rx * side * 32;
  const z = tr.start.z - fz * (40 + row * 38) + rz * side * 32;
  const y = tr.start.y + 2 + (row % 2) * 2;
  return { x, y, z, q: qLook([f[0], f[1] * 0.3, f[2]]) };
}

// Passage d'un anneau : le segment p0→p1 traverse le disque de l'anneau dans le sens avant
export function crossesRing(ring, p0, p1, tol = 1.08) {
  const d0 = (p0[0] - ring.x) * ring.nx + (p0[1] - ring.y) * ring.ny + (p0[2] - ring.z) * ring.nz;
  const d1 = (p1[0] - ring.x) * ring.nx + (p1[1] - ring.y) * ring.ny + (p1[2] - ring.z) * ring.nz;
  if (!(d0 < 0 && d1 >= 0)) return false;
  const t = d0 / (d0 - d1);
  const x = p0[0] + (p1[0] - p0[0]) * t - ring.x, y = p0[1] + (p1[1] - p0[1]) * t - ring.y, z = p0[2] + (p1[2] - p0[2]) * t - ring.z;
  return Math.hypot(x, y, z) <= RING_R * tol;
}

// ------------------------------------------------------------ modèle de vol
export function newFlightState(slot, v = 0) {
  return { x: slot.x, y: slot.y, z: slot.z, q: slot.q.slice(), v, thr: 0.8, wx: 0, wy: 0, wz: 0, energy: 1, boosting: false, g: 1 };
}
// inp : {pitch,roll,yaw ∈[-1,1] (pitch>0 = cabrer, roll>0 = droite), thr ∈[0,1], boost:boolean, assist:boolean}
export function stepFlight(s, inp, spec, dt) {
  s.thr += clamp(inp.thr - s.thr, -dt * 1.1, dt * 1.1);
  const wantBoost = !!inp.boost && s.energy > 0.02;
  s.energy = wantBoost ? Math.max(0, s.energy - dt / 6) : Math.min(1, s.energy + dt / 20);
  s.boosting = wantBoost;
  const vmaxE = spec.vmax * (wantBoost ? spec.boost : 1);
  const f = qrot(s.q, [0, 0, -1]);
  const auth = clamp((s.v - spec.stall * 0.45) / (spec.stall * 1.3), 0.12, 1);
  let roll = inp.roll;
  if (inp.assist && Math.abs(inp.roll) < 0.05) {      // mise à plat automatique
    const r = qrot(s.q, [1, 0, 0]), u = qrot(s.q, [0, 1, 0]);
    if (u[1] > 0.1) roll = clamp(r[1] * 3, -1, 1) * 0.85;
  }
  const k = Math.min(1, dt * 7);
  s.wx += (inp.pitch * spec.pitch * auth - s.wx) * k;
  s.wz += (-roll * spec.roll * auth - s.wz) * k;
  s.wy += (-inp.yaw * spec.yaw * auth - s.wy) * k;
  const stallDrop = s.v < spec.stall ? (1 - s.v / spec.stall) * 0.9 : 0;
  s.q = qnorm(qmul(s.q, qFromRotVec((s.wx - stallDrop) * dt, s.wy * dt, s.wz * dt)));
  const thrust = s.thr * (wantBoost ? 1.35 : 1) - Math.pow(s.v / vmaxE, 2);
  let dv = spec.accel * thrust - 9.81 * 0.7 * f[1] - (Math.abs(s.wx) + Math.abs(s.wy) * 0.5) * s.v * 0.09;
  s.v = Math.max(8, s.v + dv * dt);
  const f2 = qrot(s.q, [0, 0, -1]);
  const lift = clamp(s.v / spec.stall, 0, 1);
  s.x += f2[0] * s.v * dt; s.y += f2[1] * s.v * dt - (1 - lift) * 25 * dt; s.z += f2[2] * s.v * dt;
  s.g = 1 + Math.abs(s.wx) * s.v / 9.81;
  return s;
}
export const attitude = (q) => {                      // pitch, roll (rad), cap (deg)
  const f = qrot(q, [0, 0, -1]), r = qrot(q, [1, 0, 0]), u = qrot(q, [0, 1, 0]);
  return { pitch: Math.asin(clamp(f[1], -1, 1)), roll: Math.atan2(-r[1], u[1]), heading: ((Math.atan2(f[0], -f[2]) * 180 / Math.PI) + 360) % 360, f };
};
