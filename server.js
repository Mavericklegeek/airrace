// ============================================================================
//  AIR RACE — serveur (zéro dépendance : HTTP + WebSocket natifs Node ≥ 18)
// ============================================================================
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as G from '../shared/game.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DT = 1 / G.TICK_HZ;

// ------------------------------------------------------------ base de données
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { players: {}, records: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { /* première exécution */ }
let saveTimer = null;
const saveDb = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); } catch (e) { console.error('save', e.message); } }, 1500); };
const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16) || 'Pilote' + Math.floor(Math.random() * 900 + 100);

function getProfile(token, name) {
  if (!token || !/^[a-f0-9]{32}$/.test(token)) token = crypto.randomBytes(16).toString('hex');
  let p = db.players[token];
  if (!p) p = db.players[token] = { name: cleanName(name), xp: 0, wins: 0, races: 0, plane: 'sparrow', skin: 'classic', created: Date.now(), best: {} };
  else if (name) p.name = cleanName(name);
  return { token, p };
}
const publicProfile = (p) => ({ name: p.name, xp: p.xp, level: G.levelOf(p.xp), wins: p.wins, races: p.races, plane: p.plane, skin: p.skin, planes: G.unlockedPlanes(p), skins: G.unlockedSkins(p), best: p.best || {} });

function leaderboard(track) {
  const rows = (db.records[track] || []).slice(0, 25).map(r => ({ name: r.name, time: r.time, plane: r.plane }));
  const xp = Object.values(db.players).sort((a, b) => b.xp - a.xp).slice(0, 25).map(p => ({ name: p.name, xp: p.xp, level: G.levelOf(p.xp), wins: p.wins }));
  return { track, rows, xp };
}
function addRecord(track, token, p, time, plane) {
  const list = db.records[track] || (db.records[track] = []);
  const ex = list.find(r => r.token === token);
  if (ex) { if (time >= ex.time) return; ex.time = time; ex.plane = plane; ex.name = p.name; ex.date = Date.now(); }
  else list.push({ token, name: p.name, time, plane, date: Date.now() });
  list.sort((a, b) => a.time - b.time); if (list.length > 100) list.length = 100;
  p.best = p.best || {}; if (!p.best[track] || time < p.best[track]) p.best[track] = time;
}

// ------------------------------------------------------------------ HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/api/leaderboard') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify(leaderboard(url.searchParams.get('track') || 'neon'))); }
  if (p === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, online: clients.size, rooms: rooms.size })); }
  let file;
  if (p.startsWith('/shared/')) file = path.join(ROOT, 'shared', p.slice(8));
  else file = path.join(ROOT, 'public', p === '/' ? 'index.html' : p);
  const base = p.startsWith('/shared/') ? path.join(ROOT, 'shared') : path.join(ROOT, 'public');
  if (!path.resolve(file).startsWith(base)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
});

// ------------------------------------------------------- WebSocket minimal
class Sock {
  constructor(socket) { this.s = socket; this.buf = Buffer.alloc(0); this.frag = []; this.open = true; this.onmessage = null; this.onclose = null;
    socket.on('data', d => this._data(d)); socket.on('close', () => this._close()); socket.on('error', () => this._close()); socket.setNoDelay(true); }
  _close() { if (!this.open) return; this.open = false; this.onclose && this.onclose(); }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > 1 << 20) return this.s.destroy();
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 15, masked = !!(b[1] & 0x80); let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 65536) return this.s.destroy();
      if (b.length < off + (masked ? 4 : 0) + len) return;
      let payload;
      if (masked) { const m = b.subarray(off, off + 4); payload = Buffer.from(b.subarray(off + 4, off + 4 + len)); for (let i = 0; i < len; i++) payload[i] ^= m[i & 3]; off += 4; }
      else payload = Buffer.from(b.subarray(off, off + len));
      this.buf = b.subarray(off + len);
      if (op === 8) { this.s.end(); return; }
      if (op === 9) { this._frame(10, payload); continue; }
      if (op === 10) continue;
      this.frag.push(payload);
      if (fin) { const full = Buffer.concat(this.frag); this.frag = []; if (op === 1 || op === 0) this.onmessage && this.onmessage(full.toString('utf8')); }
    }
  }
  _frame(op, payload) {
    if (!this.open) return;
    const n = payload.length; let h;
    if (n < 126) h = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    try { this.s.write(Buffer.concat([h, payload])); } catch { /* socket fermée */ }
  }
  send(str) { if (this.s.writableLength > 2 << 20) return; this._frame(1, Buffer.from(str)); }
  ping() { this._frame(9, Buffer.alloc(0)); }
  close() { this.open && this.s.end(); }
}
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  onConnect(new Sock(socket));
});

// -------------------------------------------------------------- état global
const clients = new Set();
const rooms = new Map();
let nextId = 1;
const BOT_NAMES = ['Maverick', 'Iceman', 'Goose', 'Viper', 'Jester', 'Phoenix', 'Hollywood', 'Cougar', 'Merlin', 'Slider', 'Stinger', 'Wolfman', 'Sundown', 'Chipper', 'Rooster', 'Hangman', 'Payback', 'Fanboy', 'Bob', 'Coyote', 'Zéphyr', 'Aigle', 'Colibri', 'Mistral', 'Tonnerre', 'Corsaire'];
const send = (c, o) => c.ws.send(JSON.stringify(o));
const sendRoom = (room, o, exceptId) => { const s = JSON.stringify(o); for (const m of room.members.values()) if (m.c && m.id !== exceptId) m.c.ws.send(s); };
const humans = (room) => [...room.members.values()].filter(m => !m.bot);

function newCode() { const A = 'BCDFGHJKLMNPQRSTVWXZ'; for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)]; if (!rooms.has(c)) return c; } }

function createRoom(isPrivate, track) {
  const room = { code: newCode(), private: isPrivate, track, members: new Map(), state: 'lobby', host: null, botsOn: true, lobbyEnd: 0, t0: 0, cdEnd: 0, endAt: 0, results: null, tmr: null };
  rooms.set(room.code, room);
  room.tmr = setInterval(() => tickRoom(room), 1000 / G.TICK_HZ);
  return room;
}
function roomInfo(room) {
  return { t: 'room', code: room.code, private: room.private, track: room.track, state: room.state, host: room.host, bots: room.botsOn,
    lobbyIn: room.state === 'lobby' && room.lobbyEnd ? Math.max(0, room.lobbyEnd - Date.now()) : null,
    players: [...room.members.values()].map(m => ({ id: m.id, name: m.name, plane: m.plane, skin: m.skin, bot: m.bot, ready: m.ready, lvl: m.lvl })) };
}
const pushRoom = (room) => sendRoom(room, roomInfo(room));

function joinRoom(c, room) {
  leaveRoom(c);
  if (room.state !== 'lobby' && room.state !== 'results') return send(c, { t: 'err', msg: 'Course en cours — réessaie dans un instant.' });
  if (room.members.size >= G.MAX_PLAYERS) { const bot = [...room.members.values()].find(m => m.bot); if (bot) room.members.delete(bot.id); else return send(c, { t: 'err', msg: 'Salon complet.' }); }
  const m = { id: nextId++, c, bot: false, name: c.p.name, plane: c.p.plane, skin: c.p.skin, lvl: G.levelOf(c.p.xp), ready: false, token: c.token };
  c.m = m; c.room = room; room.members.set(m.id, m);
  if (!room.host && room.private) room.host = m.id;
  if (!room.lobbyEnd && !room.private && room.state === 'lobby') room.lobbyEnd = Date.now() + 12000;
  send(c, { t: 'joined', id: m.id });
  pushRoom(room);
}
function leaveRoom(c) {
  const room = c.room; if (!room) return;
  room.members.delete(c.m.id); c.room = null; c.m = null;
  if (!humans(room).length) { clearInterval(room.tmr); rooms.delete(room.code); return; }
  if (room.host === undefined || !room.members.has(room.host)) room.host = room.private ? humans(room)[0].id : null;
  pushRoom(room);
}

// ---------------------------------------------------------------- course
function addBots(room) {
  const used = new Set([...room.members.values()].map(m => m.name));
  const planeIds = Object.keys(G.PLANES);
  const hum = humans(room), avgLvl = hum.length ? hum.reduce((a, m) => a + m.lvl, 0) / hum.length : 3;
  while (room.members.size < G.MAX_PLAYERS) {
    let name; do { name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]; } while (used.has(name)); used.add(name);
    const avail = planeIds.filter(p => G.PLANES[p].level <= Math.max(3, avgLvl + 2));
    const plane = avail[Math.floor(Math.random() * avail.length)];
    const sk = G.SKINS[Math.floor(Math.random() * G.SKINS.length)];
    const m = { id: nextId++, c: null, bot: true, name, plane, skin: sk.id, ready: true, lvl: 1, skill: 0.72 + Math.random() * 0.28, noise: Math.random() * 10, boostT: 0 };
    room.members.set(m.id, m);
  }
}
function startRace(room) {
  if (room.state !== 'lobby') return;
  room.state = 'countdown';
  room.members.forEach((m, id) => { if (m.bot) room.members.delete(id); });
  if (room.botsOn) addBots(room);
  const tr = G.getTrack(room.track);
  const order = [...room.members.values()].sort(() => Math.random() - 0.5);
  order.forEach((m, i) => {
    m.slot = i; m.ring = 0; m.fin = null; m.crashes = 0; m.lastP = null; m.pen = 0; m.dnf = false;
    m.spec = G.PLANES[m.plane]; m.s = G.newFlightState(G.startSlot(tr, i), 0); m.crashT = 0;
  });
  room.cdEnd = Date.now() + 5200; room.lobbyEnd = 0; room.endAt = 0;
  const slots = order.map(m => ({ id: m.id, slot: m.slot }));
  sendRoom(room, { t: 'start', track: room.track, slots, cd: 5, members: roomInfo(room).players });
  pushRoom(room);
}
function finishMember(room, m) {
  if (m.fin !== null) return;
  m.fin = Date.now() - room.t0 + m.pen;
  const pos = [...room.members.values()].filter(x => x.fin !== null).length;
  if (m.c) { send(m.c, { t: 'fin', time: m.fin, pos }); if (!room.endAt) room.endAt = Date.now() + 35000; }
}
function rankList(room) {
  const tr = G.getTrack(room.track), M = tr.rings.length;
  const key = (m) => { if (m.fin !== null) return [0, m.fin]; const r = tr.rings[Math.min(m.ring, M - 1)]; return [1, -m.ring * 1e6 + Math.hypot(m.s.x - r.x, m.s.y - r.y, m.s.z - r.z)]; };
  return [...room.members.values()].sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
}

function botControl(m, tr, t) {
  const s = m.s, spec = m.spec, M = tr.rings.length, R = tr.rings[Math.min(m.ring, M - 1)];
  const jx = Math.sin(t * 0.7 + m.noise) * 14 * (1.2 - m.skill), jy = Math.cos(t * 0.5 + m.noise * 2) * 10 * (1.2 - m.skill);
  const d = [R.x + jx - s.x, R.y + jy - s.y, R.z - s.z], l = G.qinvrot(s.q, d), n = Math.hypot(l[0], l[1], l[2]) || 1;
  const fwd = -l[2] / n, ang = Math.atan2(Math.hypot(l[0], l[1]), -l[2]);
  let re = Math.atan2(l[0], l[1]), sign = 1;
  if (Math.abs(re) > Math.PI / 2) { re = re > 0 ? re - Math.PI : re + Math.PI; sign = -1; }
  const k = 0.7 + 0.3 * m.skill;
  let roll = G.clamp(re * 1.6, -1, 1) * k, pitch = sign * G.clamp(ang * 2.2, 0, 1) * Math.max(0.15, Math.cos(re)) * k;
  const f = G.qrot(s.q, [0, 0, -1]);
  // évitement du relief
  for (const sec of [1, 2, 3.2]) {
    const px = s.x + f[0] * s.v * sec, pz = s.z + f[2] * s.v * sec, py = s.y + f[1] * s.v * sec;
    if (G.groundHeight(tr.world, px, pz) + 30 > py) { pitch = 1; roll = G.clamp(G.qrot(s.q, [1, 0, 0])[1] * 3, -1, 1); break; }
  }
  if (s.y < 30) pitch = Math.max(pitch, 0.8);
  m.boostT -= DT;
  const boost = m.boostT > 0 || (s.energy > 0.6 && ang < 0.3 && Math.random() < 0.01 * m.skill && (m.boostT = 2.5 + Math.random() * 2));
  return { pitch, roll, yaw: G.clamp(l[0] / n * 1.2, -1, 1) * 0.25, thr: 0.93 + 0.07 * m.skill, boost: !!boost && m.boostT > 0, assist: false };
}
function respawn(m, tr) {
  const prev = tr.rings[m.ring - 1], R = tr.rings[m.ring];
  const base = prev || { x: tr.start.x, y: tr.start.y, z: tr.start.z, nx: tr.start.dir[0], ny: 0, nz: tr.start.dir[2] };
  const spec = m.spec;
  m.s = G.newFlightState({ x: base.x - base.nx * 30, y: Math.max(base.y, G.groundHeight(tr.world, base.x, base.z) + 50), z: base.z - base.nz * 30, q: G.qLook([R.x - base.x, (R.y - base.y) * 0.4, R.z - base.z]) }, spec.vmax * 0.5);
  m.lastP = null;
}
function ringCheck(room, m, tr, p1) {
  if (m.fin !== null || !m.lastP) { m.lastP = p1; return; }
  const p0 = m.lastP; m.lastP = p1;
  if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) > 900) return;
  const R = tr.rings[m.ring];
  if (R && G.crossesRing(R, p0, p1)) {
    m.ring++;
    if (m.c) send(m.c, { t: 'ring', i: m.ring });
    if (m.ring >= tr.rings.length) finishMember(room, m);
  }
}

function tickRoom(room) {
  const now = Date.now();
  if (room.state === 'lobby') {
    const hs = humans(room);
    if (!room.private && hs.length) {
      if (!room.lobbyEnd) room.lobbyEnd = now + 12000;
      if (hs.length >= G.MAX_PLAYERS && room.lobbyEnd - now > 3000) room.lobbyEnd = now + 3000;
      if (hs.every(m => m.ready) && room.lobbyEnd - now > 3000) room.lobbyEnd = now + 3000;
      if (now >= room.lobbyEnd) startRace(room);
    }
    if (now % 1000 < 50 && room.lobbyEnd) pushRoom(room);   // tic de compte à rebours
    return;
  }
  if (room.state === 'results') { if (now >= room.resultsEnd) { room.state = 'lobby'; room.members.forEach((m, id) => { if (m.bot) room.members.delete(id); else m.ready = false; }); room.lobbyEnd = room.private ? 0 : now + 15000; if (!room.private) room.track = G.TRACK_IDS[(G.TRACK_IDS.indexOf(room.track) + 1) % G.TRACK_IDS.length]; pushRoom(room); } return; }
  const tr = G.getTrack(room.track);
  if (room.state === 'countdown') {
    if (now >= room.cdEnd) {
      room.state = 'racing'; room.t0 = now;
      room.members.forEach(m => { m.s.v = m.spec.vmax * 0.55; m.s.thr = 1; m.lastP = [m.s.x, m.s.y, m.s.z]; });
      sendRoom(room, { t: 'go' });
    } else if (now % 1000 < 50) sendRoom(room, { t: 'cd', n: Math.ceil((room.cdEnd - now) / 1000) });
    broadcastSnap(room, tr, 0);
    return;
  }
  // ----- course
  const T = (now - room.t0) / 1000;
  for (const m of room.members.values()) {
    if (!m.bot) continue;
    if (m.fin !== null) { m.s.v = Math.max(m.s.v, 40); G.stepFlight(m.s, { pitch: 0.1, roll: 0.1, yaw: 0, thr: 0.5 }, m.spec, DT); continue; }
    if (m.crashT > 0) { m.crashT -= DT; continue; }
    const inp = botControl(m, tr, T);
    G.stepFlight(m.s, inp, m.spec, DT / 2); G.stepFlight(m.s, inp, m.spec, DT / 2);
    if (m.s.y < G.groundHeight(tr.world, m.s.x, m.s.z) + 2.5) { m.crashT = 2.2; m.pen += 0; respawn(m, tr); }
    else ringCheck(room, m, tr, [m.s.x, m.s.y, m.s.z]);
  }
  broadcastSnap(room, tr, T);
  const hs = humans(room);
  const allDone = hs.length && hs.every(m => m.fin !== null);
  if (allDone || (room.endAt && now > room.endAt) || T > 400 || !hs.length) endRace(room, tr);
}
function broadcastSnap(room, tr, T) {
  const rk = rankList(room);
  const p = [...room.members.values()].map(m => { const s = m.s; return [m.id, +s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1), ...s.q.map(v => +v.toFixed(4)), +s.v.toFixed(1), +s.thr.toFixed(2), (s.boosting ? 1 : 0) | ((m.crashT > 0 || m.crashedFlag) ? 2 : 0), m.ring, m.fin !== null ? 1 : 0]; });
  sendRoom(room, { t: 'snap', T: +T.toFixed(2), p, rk: rk.map(m => m.id) });
}
function endRace(room, tr) {
  if (room.state !== 'racing') return;
  room.state = 'results'; room.resultsEnd = Date.now() + 16000;
  const rk = rankList(room), N = rk.length, M = tr.rings.length;
  const results = rk.map((m, i) => ({ id: m.id, name: m.name, plane: m.plane, bot: m.bot, pos: i + 1, time: m.fin, rings: m.ring, total: M }));
  rk.forEach((m, i) => {
    if (m.bot || !m.c) return;
    const p = m.c.p, before = G.levelOf(p.xp), pb = G.unlockedPlanes(p), sb = G.unlockedSkins(p);
    const gain = 30 + Math.round(m.ring / M * 60) + Math.max(0, N - 1 - i) * 18 + (i === 0 && m.fin !== null ? 80 : 0) + (m.fin !== null ? 40 : 0);
    p.xp += gain; p.races++; if (i === 0 && m.fin !== null) p.wins++;
    if (m.fin !== null) addRecord(room.track, m.token, p, m.fin, m.plane);
    const after = G.levelOf(p.xp);
    m.c.xpGain = { gain, level: after, levelUp: after > before, newPlanes: G.unlockedPlanes(p).filter(x => !pb.includes(x)), newSkins: G.unlockedSkins(p).filter(x => !sb.includes(x)) };
    m.lvl = after;
  });
  saveDb();
  for (const m of room.members.values()) if (m.c) send(m.c, { t: 'results', track: room.track, results, you: m.id, ...(m.c.xpGain || {}), profile: publicProfile(m.c.p) });
  room.members.forEach(m => { if (m.c) m.c.xpGain = null; });
  pushRoom(room);
}

// ----------------------------------------------------------------- clients
function onConnect(ws) {
  const c = { ws, id: 0, token: null, p: null, room: null, m: null, msgs: 0, win: Date.now(), alive: true };
  clients.add(c);
  ws.onclose = () => { clients.delete(c); leaveRoom(c); };
  ws.onmessage = (txt) => {
    const now = Date.now(); if (now - c.win > 1000) { c.win = now; c.msgs = 0; }
    if (++c.msgs > 80) return;
    let m; try { m = JSON.parse(txt); } catch { return; }
    try { handle(c, m); } catch (e) { console.error('handle', e); }
  };
  ws.s.on('data', () => { c.alive = true; });
}
const num = (v, lim = 1e6) => (Number.isFinite(v) && Math.abs(v) < lim ? v : null);
function handle(c, m) {
  if (m.t === 'hello') {
    const { token, p } = getProfile(m.token, m.name); c.token = token; c.p = p; saveDb();
    return send(c, { t: 'welcome', token, profile: publicProfile(p), tracks: G.trackList(), online: clients.size });
  }
  if (!c.p) return;
  switch (m.t) {
    case 's': {                                       // état de vol du joueur
      const room = c.room, me = c.m; if (!room || !me || (room.state !== 'racing' && room.state !== 'countdown')) return;
      const x = num(m.x), y = num(m.y), z = num(m.z), v = num(m.v, 600); if (x === null || y === null || z === null || v === null || !Array.isArray(m.q) || m.q.length !== 4 || !m.q.every(n => Number.isFinite(n))) return;
      const s = me.s; s.x = x; s.y = y; s.z = z; s.q = G.qnorm(m.q); s.v = v; s.thr = G.clamp(+m.thr || 0, 0, 1); s.boosting = !!(m.f & 1); me.crashedFlag = !!(m.f & 2);
      if (room.state === 'racing') ringCheck(room, me, G.getTrack(room.track), [x, y, z]);
      return;
    }
    case 'crash': { const me = c.m; if (me && c.room && c.room.state === 'racing') { me.crashes++; me.lastP = null; me.pen += 0; } return; }
    case 'profile': {
      const p = c.p;
      if (m.name) p.name = cleanName(m.name);
      if (m.plane && G.unlockedPlanes(p).includes(m.plane)) p.plane = m.plane;
      if (m.skin && G.unlockedSkins(p).includes(m.skin)) p.skin = m.skin;
      if (c.m && c.room && c.room.state === 'lobby') { c.m.name = p.name; c.m.plane = p.plane; c.m.skin = p.skin; pushRoom(c.room); }
      saveDb(); return send(c, { t: 'profile', profile: publicProfile(p) });
    }
    case 'quick': {
      let room = [...rooms.values()].find(r => !r.private && r.state === 'lobby' && humans(r).length < G.MAX_PLAYERS && (!r.lobbyEnd || r.lobbyEnd - Date.now() > 3500));
      if (!room) room = createRoom(false, G.TRACK_IDS.includes(m.track) ? m.track : G.TRACK_IDS[Math.floor(Math.random() * G.TRACK_IDS.length)]);
      return joinRoom(c, room);
    }
    case 'create': { const room = createRoom(true, G.TRACK_IDS.includes(m.track) ? m.track : 'neon'); return joinRoom(c, room); }
    case 'join': {
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(c, { t: 'err', msg: 'Code introuvable.' });
      return joinRoom(c, room);
    }
    case 'leave': return leaveRoom(c);
    case 'ready': { if (c.m && c.room?.state === 'lobby') { c.m.ready = !c.m.ready; pushRoom(c.room); } return; }
    case 'settings': {
      const room = c.room; if (!room || !room.private || room.host !== c.m.id || room.state !== 'lobby') return;
      if (G.TRACK_IDS.includes(m.track)) room.track = m.track;
      if (typeof m.bots === 'boolean') room.botsOn = m.bots;
      return pushRoom(room);
    }
    case 'start': { const room = c.room; if (room && room.private && room.host === c.m.id) startRace(room); return; }
    case 'lb': return send(c, { t: 'lb', ...leaderboard(G.TRACK_IDS.includes(m.track) ? m.track : 'neon') });
  }
}
setInterval(() => { for (const c of clients) c.ws.ping(); }, 25000);

server.listen(PORT, () => console.log(`✈  AIR RACE sur http://localhost:${PORT}`));
process.on('SIGTERM', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch {} process.exit(0); });
