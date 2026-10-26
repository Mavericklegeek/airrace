// AIR RACE — client : UI, réseau, boucle de jeu, caméras
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as G from '/shared/game.js';
import { World, QUALITY } from './world.js';
import { buildPlane, Trail, skinCss } from './planes.js';
import { Cockpit } from './cockpit.js';
import { Input, FUNCS } from './input.js';
import { Sound } from './audio.js';
import { TouchControls } from './touch.js';

const $ = (s) => document.querySelector(s);
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('airrace.' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('airrace.' + k, JSON.stringify(v)); } catch { /* */ } } };
const fmt = (ms) => { if (ms == null) return '—'; const t = Math.round(ms / 10); return `${Math.floor(t / 6000)}:${String(Math.floor(t / 100) % 60).padStart(2, '0')}.${String(t % 100).padStart(2, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let toastT; const toast = (m, ms = 2600) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); };

// ------------------------------------------------------------ rendu
const detectPhone = () => matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 900;
let platform = store.get('platform', null) || (detectPhone() ? 'phone' : 'pc');
const isPhone = () => platform === 'phone';
const qualityKey = store.get('quality', isPhone() ? 'low' : 'high'), Q = QUALITY[qualityKey];
document.body.classList.toggle('phone', isPhone());
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), antialias: !Q.bloom, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = Q.shadow > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.08, 70000); scene.add(camera);
let composer = null, bloom = null;
function resize() {
  const w = innerWidth, h = innerHeight, pr = Math.min(devicePixelRatio || 1, Q.pr);
  renderer.setPixelRatio(pr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(pr); composer.setSize(w, h); }
}
if (Q.bloom) {
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
  composer = new EffectComposer(renderer, rt); composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.55, 0.92); composer.addPass(bloom); composer.addPass(new OutputPass());
}
addEventListener('resize', resize); resize();
const world = new World(renderer, scene, qualityKey);
const input = new Input(); const sound = new Sound();
const touch = new TouchControls(input, {
  camera: () => input.fire('camera'), assist: () => input.fire('assist'), pause: () => input.fire('pause'),
});

// ------------------------------------------------------------ état
let ws, myId = 0, profile = null, tracks = [], room = null, mode = 'boot', prevScreen = 'menu', pendingLobby = false;
let tr = null, camMode = store.get('cam', isPhone() ? 1 : 0), paused = false;
const P = { s: null, spec: null, plane: null, cockpit: null, trails: [], ring: 0, frozen: true, crashT: 0, fin: null, flicker: 0, lastY: 0, vsi: 0, restoreCam: null, outT: 0 };
const remotes = new Map(), members = new Map();
let raceT0 = 0, rankIds = [], tags = $('#tags'), explosions = [], crashCam = null, lastSend = 0, hudT = 0, msgT = 0;
const look = { yaw: 0, pitch: 0, drag: false };
let showcase = null, showKey = '';
const screens = ['menu', 'lobby', 'hangar', 'lb', 'ctl', 'results', 'pause', 'loading'];
const show = (id) => { for (const s of screens) $('#' + s).classList.toggle('hide', s !== id); };
const hideAll = () => screens.forEach(s => $('#' + s).classList.add('hide'));

// ------------------------------------------------------------ réseau
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => send({ t: 'hello', token: store.get('token'), name: store.get('name') });
  ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { toast('Connexion perdue — reconnexion…', 3000); if (mode !== 'boot') backToMenu(); setTimeout(connect, 2000); };
}
function onMsg(m) {
  switch (m.t) {
    case 'welcome': store.set('token', m.token); profile = m.profile; tracks = m.tracks; $('#online').textContent = `${m.online} pilote(s) en ligne`; if (mode === 'boot') { mode = 'menu'; refreshProfile(); ensureShowcase(); show('menu'); const c = new URLSearchParams(location.search).get('room'); if (c) { history.replaceState(null, '', location.pathname); send({ t: 'join', code: c }); } } else refreshProfile(); break;
    case 'profile': profile = m.profile; refreshProfile(); if (!$('#hangar').classList.contains('hide')) renderHangar(); break;
    case 'joined': myId = m.id; break;
    case 'room': onRoom(m); break;
    case 'err': toast(m.msg); break;
    case 'start': initRace(m); break;
    case 'cd': { if (mode !== 'race') break; const el = $('#cd'); el.textContent = m.n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); sound.count(m.n); break; }
    case 'go': { if (mode !== 'race') break; P.frozen = false; P.s.v = P.spec.vmax * 0.55; P.s.thr = 1; input.thr = 1; raceT0 = performance.now(); const el = $('#cd'); el.textContent = 'GO!'; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); sound.count(0); break; }
    case 'snap': onSnap(m); break;
    case 'ring': P.ring = Math.max(P.ring, m.i); break;
    case 'fin': P.fin = m.time; flash(`ARRIVÉE ! ${fmt(m.time)} — ${m.pos === 1 ? '1er' : m.pos + 'e'}`, 4000); if (camMode === 0 || camMode === 3) setCam(2); break;
    case 'results': onResults(m); break;
    case 'lb': renderLb(m); break;
  }
}

// ------------------------------------------------------------ profil / menu
function refreshProfile() {
  if (!profile) return; $('#name').value = profile.name;
  const lv = profile.level, a = G.xpForLevel(lv), b = G.xpForLevel(lv + 1), p = Math.round((profile.xp - a) / (b - a) * 100);
  $('#prof').innerHTML = `<div class="lvl" style="--p:${p}%"><b>${lv}</b></div><div style="flex:1"><div><b>${esc(profile.name)}</b></div><div class="help" style="margin:0">${profile.xp} XP · ${profile.wins} victoire(s) · ${profile.races} course(s)</div></div>`;
  $('#hgLvl').textContent = `Niveau ${lv} · ${profile.xp} XP (prochain niveau : ${b} XP)`;
  ensureShowcase();
}
$('#name').addEventListener('change', (e) => { const n = e.target.value.trim(); if (n) { store.set('name', n); send({ t: 'profile', name: n }); } });
const unlockAudio = () => sound.start();
addEventListener('pointerdown', unlockAudio, { once: true });
$('#bQuick').onclick = () => { sound.start(); send({ t: 'quick' }); };
let soloPending = false;
$('#bSolo').onclick = () => { sound.start(); soloPending = true; send({ t: 'create', track: tracks[Math.floor(Math.random() * tracks.length)].id }); };
$('#bCreate').onclick = () => { sound.start(); send({ t: 'create', track: 'archipel' }); };
$('#bJoin').onclick = () => { const c = $('#joinCode').value.trim(); if (c.length >= 4) send({ t: 'join', code: c }); else toast('Entre le code à 5 lettres de ton ami.'); };
$('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#bJoin').click(); });
$('#bHangar').onclick = $('#bHangar2').onclick = () => { prevScreen = room ? 'lobby' : 'menu'; renderHangar(); show('hangar'); };
$('#bLb').onclick = () => { prevScreen = 'menu'; show('lb'); renderLbTabs(); send({ t: 'lb', track: lbTrack }); };
$('#bCtl').onclick = () => { prevScreen = 'menu'; openCtl(); };
$('#pCtl').onclick = () => { prevScreen = 'pause'; openCtl(); };
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { stopPadTimer(); show(prevScreen); });
$('#bLeave').onclick = () => { send({ t: 'leave' }); room = null; mode = 'menu'; show('menu'); };

// ------------------------------------------------------------ version PC / téléphone
function renderPlatform() {
  document.querySelectorAll('[data-plat]').forEach(b => b.classList.toggle('on', b.dataset.plat === platform));
  $('#platHelp').textContent = isPhone() ? 'Vue extérieure, joystick et manette des gaz tactiles (pas de cockpit cliquable). Paysage recommandé.' : 'Cockpit 3D cliquable, clavier, manette ou joystick.';
  document.body.classList.toggle('phone', isPhone());
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-plat]'); if (!b || b.dataset.plat === platform) return;
  platform = b.dataset.plat; store.set('platform', platform); if (isPhone()) { input.opts.assist = true; input.saveOpts(); }
  if (isPhone() && camMode === 0) { camMode = 1; store.set('cam', 1); }
  if (!store.get('qualityUser', false)) { store.set('quality', isPhone() ? 'low' : 'high'); toast('Qualité graphique adaptée — rechargement…'); setTimeout(() => location.reload(), 700); return; }
  renderPlatform(); toast(isPhone() ? 'Version téléphone activée' : 'Version ordinateur activée');
});
$('#bFull').onclick = async () => { try { await document.documentElement.requestFullscreen(); await screen.orientation?.lock?.('landscape'); } catch { toast('Plein écran indisponible sur cet appareil.'); } };
renderPlatform();

// ------------------------------------------------------------ salon
function onRoom(m) {
  const first = !room; room = m;
  if (soloPending && m.private && m.host === myId) { soloPending = false; send({ t: 'start' }); return; }
  if (mode === 'race') return;
  if (mode === 'results') { pendingLobby = m.state === 'lobby'; return; }
  mode = 'lobby';
  if (first) show('lobby');
  renderLobby();
  if (world.trackId !== m.track) world.load(m.track);
}
let lobbyTick;
function renderLobby() {
  const m = room, mine = m.players.find(p => p.id === myId), isHost = m.private && m.host === myId;
  $('#lbTitle').textContent = m.private ? 'Course privée' : 'Course rapide';
  const t = tracks.find(x => x.id === m.track); $('#lbTrack').innerHTML = t ? `<b>${esc(t.name)}</b><div class="help" style="margin:0">${esc(t.sub)}</div>` : '';
  $('#lbCodeBox').innerHTML = m.private ? `<div class="help" style="margin:0">CODE AMI</div><b style="font-size:26px;letter-spacing:.2em">${m.code}</b><br><button class="sm" id="bCopy">Copier le lien</button>` : '';
  const cp = $('#bCopy'); if (cp) cp.onclick = () => { const u = `${location.origin}/?room=${m.code}`; (navigator.clipboard?.writeText(u) || Promise.reject()).then(() => toast('Lien copié !')).catch(() => toast(u, 6000)); };
  $('#lbPlayers').innerHTML = `<table><tr><th>Pilote</th><th>Niv.</th><th>Avion</th><th></th></tr>${m.players.map(p => `<tr class="${p.id === myId ? 'me' : ''}"><td>${esc(p.name)} ${p.id === myId ? '<span class="pill me">toi</span>' : ''} ${m.host === p.id ? '<span class="pill host">hôte</span>' : ''}</td><td class="n">${p.lvl}</td><td>${G.PLANES[p.plane]?.name || ''}</td><td>${p.ready ? '<span class="pill ok">prêt</span>' : ''}</td></tr>`).join('')}</table>`;
  $('#lbHostRow').classList.toggle('hide', !isHost);
  if (isHost) { const sel = $('#lbSel'); if (!sel.options.length) tracks.forEach(x => sel.add(new Option(x.name, x.id))); sel.value = m.track; $('#lbBots').checked = m.bots; }
  $('#bStart').classList.toggle('hide', !isHost); $('#bReady').classList.toggle('hide', m.private); $('#bReady').textContent = mine?.ready ? 'Pas prêt' : 'Prêt';
  const free = 8 - m.players.length, botTxt = free > 0 && m.bots ? ` ${free} place(s) libre(s) seront remplies par des bots.` : '';
  $('#lbHelp').textContent = m.private
    ? (isHost ? 'Partage le code ou le lien avec tes amis, puis lance la course.' + botTxt : 'En attente du lancement par l\'hôte…' + botTxt)
    : 'Pas assez de pilotes ? Des bots complètent la grille. Appuie sur « Prêt » pour partir tout de suite.' + botTxt;
  clearInterval(lobbyTick); const t0 = performance.now(), li = m.lobbyIn;
  const upd = () => { $('#lbTimer').textContent = li != null && !m.private ? `Départ dans ${Math.max(0, Math.ceil((li - (performance.now() - t0)) / 1000))} s · ${m.players.length}/8 pilotes` : (m.private ? `${m.players.length}/8 pilotes` : ''); };
  upd(); lobbyTick = setInterval(upd, 250);
}
$('#bReady').onclick = () => send({ t: 'ready' });
$('#bStart').onclick = () => send({ t: 'start' });
$('#lbSel').onchange = (e) => send({ t: 'settings', track: e.target.value, bots: $('#lbBots').checked });
$('#lbBots').onchange = (e) => send({ t: 'settings', track: $('#lbSel').value, bots: e.target.checked });

// ------------------------------------------------------------ hangar
const bar = (v) => `<div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div>`;
function renderHangar() {
  const pl = Object.values(G.PLANES);
  $('#hgPlanes').innerHTML = pl.map(a => { const ok = profile.planes.includes(a.id), sel = profile.plane === a.id;
    return `<div class="tile plane ${sel ? 'sel' : ''} ${ok ? '' : 'lock'}" data-plane="${a.id}"><div class="nm">${a.kind === 'jet' ? '🛩' : '✈'} ${a.name} ${ok ? '' : `<span class="pill">🔒 niveau ${a.level}</span>`}</div><div class="ds">${a.desc}</div>
      <div class="stat"><span>Vitesse</span>${bar((a.vmax - 80) / 90)}</div><div class="stat"><span>Agilité</span>${bar((a.roll + a.pitch * 1.5 - 3) / 6)}</div><div class="stat"><span>Accélération</span>${bar((a.accel - 15) / 30)}</div></div>`; }).join('');
  $('#hgSkins').innerHTML = G.SKINS.map(s => { const ok = profile.skins.includes(s.id), sel = profile.skin === s.id;
    return `<div class="tile ${sel ? 'sel' : ''} ${ok ? '' : 'lock'}" data-skin="${s.id}"><div class="sw" style="background:${skinCss(s.id)}"></div><div style="font-size:13px;font-weight:600">${s.name}</div><div class="help" style="margin:0">${ok ? (sel ? 'équipée' : 'débloquée') : '🔒 ' + G.reqText(s.req)}</div></div>`; }).join('');
}
$('#hangar').addEventListener('click', (e) => {
  const p = e.target.closest('[data-plane]'), s = e.target.closest('[data-skin]');
  if (p) { if (p.classList.contains('lock')) return toast('Avion verrouillé — gagne de l\'XP !'); profile.plane = p.dataset.plane; send({ t: 'profile', plane: p.dataset.plane }); renderHangar(); ensureShowcase(); }
  if (s) { if (s.classList.contains('lock')) return toast('Peinture verrouillée : ' + s.querySelector('.help').textContent.replace('🔒 ', '')); profile.skin = s.dataset.skin; send({ t: 'profile', skin: s.dataset.skin }); renderHangar(); ensureShowcase(); }
});

// ------------------------------------------------------------ classements
let lbTrack = 'neon';
function renderLbTabs() { $('#lbTabs').innerHTML = tracks.map(t => `<button class="${t.id === lbTrack ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</button>`).join('') + `<button class="${lbTrack === 'xp' ? 'on' : ''}" data-t="xp">Pilotes (XP)</button>`; }
$('#lbTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; lbTrack = b.dataset.t; renderLbTabs(); send({ t: 'lb', track: lbTrack === 'xp' ? 'neon' : lbTrack }); });
function renderLb(m) {
  if (lbTrack === 'xp') $('#lbBody').innerHTML = `<table><tr><th>#</th><th>Pilote</th><th>Niv.</th><th>XP</th><th>Victoires</th></tr>${m.xp.map((r, i) => `<tr class="${profile && r.name === profile.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.level}</td><td class="n">${r.xp}</td><td>${r.wins}</td></tr>`).join('') || '<tr><td colspan=5>Aucun pilote.</td></tr>'}</table>`;
  else $('#lbBody').innerHTML = `<table><tr><th>#</th><th>Pilote</th><th>Avion</th><th>Temps</th></tr>${m.rows.map((r, i) => `<tr class="${profile && r.name === profile.name ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${G.PLANES[r.plane]?.name || ''}</td><td class="n">${fmt(r.time)}</td></tr>`).join('') || '<tr><td colspan=4>Pas encore de temps — sois le premier !</td></tr>'}</table>`;
}

// ------------------------------------------------------------ réglages / manette
let padTimer = null, padId = '';
function openCtl() {
  show('ctl'); $('#oInv').checked = input.opts.invertY; $('#oAssist').checked = input.opts.assist; $('#oDead').value = input.opts.dead; $('#oVol').value = sound.vol; $('#oQual').value = qualityKey;
  padId = ''; renderPad(); padTimer = setInterval(renderPad, 120);
}
function stopPadTimer() { clearInterval(padTimer); input.cancelDetect(); }
$('#oInv').onchange = (e) => { input.opts.invertY = e.target.checked; input.saveOpts(); };
$('#oAssist').onchange = (e) => { input.opts.assist = e.target.checked; input.saveOpts(); if (P.cockpit) P.cockpit.ui.assist = e.target.checked; };
$('#oDead').oninput = (e) => { input.opts.dead = +e.target.value; input.saveOpts(); };
$('#oVol').oninput = (e) => sound.setVolume(+e.target.value);
$('#oQual').onchange = (e) => { store.set('quality', e.target.value); store.set('qualityUser', true); toast('Qualité modifiée — rechargement…'); setTimeout(() => location.reload(), 600); };
$('#padReset').onclick = () => { const gp = input.getPad(); if (gp) { input.resetMap(gp); padId = ''; renderPad(); } };
function renderPad() {
  const gp = input.getPad();
  if (!gp) { $('#padStatus').textContent = 'Aucune manette détectée. Branche-la puis appuie sur un bouton (le navigateur ne la voit qu\'après une action).'; $('#padAxes').innerHTML = ''; $('#padMap').innerHTML = ''; padId = ''; return; }
  $('#padStatus').innerHTML = `✅ <b>${esc(gp.id)}</b> — ${gp.axes.length} axes, ${gp.buttons.length} boutons (${gp.mapping === 'standard' ? 'mappage standard' : 'joystick / HOTAS : vérifie l\'association ci-dessous'}).`;
  const ax = gp.axes;
  if (padId !== gp.id) {
    padId = gp.id; $('#padAxes').innerHTML = ax.map((_, i) => `<div class="ax">Axe ${i}<div class="bar"><i id="pa${i}"></i></div></div>`).join('');
    const m = input.mapFor(gp);
    $('#padMap').innerHTML = FUNCS.map(f => { const c = m[f.id] || {}; const cur = f.axis ? (c.a >= 0 && c.a != null ? 'Axe ' + c.a : '—') : (c.b >= 0 && c.b != null ? 'Bouton ' + c.b : '—');
      return `<span>${f.label}${f.id === 'thr' ? `<br><select data-mode style="padding:3px;width:auto;font-size:12px"><option value="abs" ${c.mode === 'abs' ? 'selected' : ''}>curseur absolu (joystick)</option><option value="inc" ${c.mode !== 'abs' ? 'selected' : ''}>incrémental (stick / gâchettes)</option></select>` : ''}</span><span><code id="pm_${f.id}">${cur}</code>${f.axis ? ` <label style="display:inline"><input type="checkbox" data-inv="${f.id}" ${c.inv ? 'checked' : ''}> inv.</label>` : ''}</span><button class="sm" data-det="${f.id}">Détecter</button>`; }).join('');
  }
  ax.forEach((v, i) => { const el = $('#pa' + i); if (el) el.style.width = ((v + 1) / 2 * 100).toFixed(0) + '%'; });
}
$('#padMap').addEventListener('click', (e) => {
  const b = e.target.closest('[data-det]'); if (!b) return; const gp = input.getPad(); if (!gp) return; const f = FUNCS.find(x => x.id === b.dataset.det);
  b.textContent = f.axis ? 'Bouge l\'axe…' : 'Appuie…';
  input.detect(f.axis ? 'axis' : 'button', (i) => { input.setMap(gp, f.id, f.axis ? { a: i } : { b: i }); b.textContent = 'Détecter'; padId = ''; renderPad(); });
});
$('#padMap').addEventListener('change', (e) => {
  const gp = input.getPad(); if (!gp) return;
  if (e.target.dataset.inv) input.setMap(gp, e.target.dataset.inv, { inv: e.target.checked });
  if (e.target.matches('[data-mode]')) input.setMap(gp, 'thr', { mode: e.target.value });
});

// ------------------------------------------------------------ vitrine 3D (menus)
function ensureShowcase() {
  if (!profile) return; const key = profile.plane + profile.skin + (mode === 'race' ? 'r' : '');
  if (key === showKey && showcase) return; showKey = key;
  if (showcase) { scene.remove(showcase.group); showcase = null; }
  if (mode === 'race') return;
  showcase = buildPlane(profile.plane, profile.skin); scene.add(showcase.group);
}
let orbit = 0;
function menuFrame(dt) {
  if (!showcase) ensureShowcase();
  const t = world.tr; if (!t || !showcase) { world.update(dt, camera.position, new THREE.Vector3(), 0); return; }
  orbit += dt * 0.18;
  const c = new THREE.Vector3(t.start.x, t.start.y + 8, t.start.z), side = $('#hangar').classList.contains('hide') ? 0 : 1;
  showcase.group.position.copy(c); showcase.group.quaternion.setFromEuler(new THREE.Euler(0, 0.7, 0)); showcase.update(dt, 0.55, false);
  const R = showcase.len * 1.7 + 7;
  camera.position.set(c.x + Math.cos(orbit) * R, c.y + 3 + Math.sin(orbit * 0.7) * 2, c.z + Math.sin(orbit) * R);
  camera.up.set(0, 1, 0); camera.lookAt(c.x + (side ? 0 : 0), c.y, c.z); camera.fov = 50; camera.updateProjectionMatrix();
  if (side) { camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.18, 0, innerWidth, innerHeight); } else camera.clearViewOffset();
  world.update(dt, camera.position, c, 0);
  sound.update(false);
}

// ------------------------------------------------------------ course
function makeRemote(mem, slot) {
  const obj = buildPlane(mem.plane, mem.skin); scene.add(obj.group);
  const sl = G.startSlot(tr, slot); obj.group.position.set(sl.x, sl.y, sl.z); obj.group.quaternion.set(...sl.q);
  const r = { id: mem.id, name: mem.name, bot: mem.bot, obj, p: obj.group.position.clone(), q: obj.group.quaternion.clone(), v: 0, thr: 0.8, boost: false, crashed: false, ring: 0, fin: false, t: performance.now(), trails: [new Trail(scene, 40), new Trail(scene, 40)], tag: document.createElement('div') };
  r.tag.textContent = mem.name; tags.appendChild(r.tag); remotes.set(mem.id, r); return r;
}
function clearRace() {
  for (const r of remotes.values()) { scene.remove(r.obj.group); r.trails.forEach(t => t.dispose(scene)); r.tag.remove(); } remotes.clear();
  if (P.plane) { scene.remove(P.plane.group); P.plane = null; } P.trails.forEach(t => t.dispose(scene)); P.trails = []; P.cockpit = null;
  explosions.forEach(e => scene.remove(e.pts)); explosions = []; tags.innerHTML = '';
  camera.parent !== scene && scene.add(camera); camera.position.set(0, 0, 0); camera.quaternion.identity();
}
async function initRace(m) {
  try { await initRaceInner(m); } catch (e) { console.error('initRace', e); toast('Erreur de chargement du circuit — retour au menu.', 4000); send({ t: 'leave' }); backToMenu(); }
}
async function initRaceInner(m) {
  mode = 'race'; paused = false; hideAll(); show('loading'); $('#loadTxt').textContent = 'Préparation du circuit…';
  clearInterval(lobbyTick); clearRace(); if (showcase) { scene.remove(showcase.group); showcase = null; showKey = ''; }
  await world.load(m.track); tr = world.tr;
  members.clear(); m.members.forEach(x => members.set(x.id, x));
  const me = members.get(myId) || { plane: profile.plane, skin: profile.skin, name: profile.name };
  P.spec = G.PLANES[me.plane]; P.plane = buildPlane(me.plane, me.skin); scene.add(P.plane.group);
  P.cockpit = new Cockpit(P.spec, me.skin); P.cockpit.group.position.copy(P.plane.eyePos); P.plane.group.add(P.cockpit.group);
  P.cockpit.ui.assist = input.opts.assist; P.trails = [new Trail(scene, 56), new Trail(scene, 56)];
  const mySlot = m.slots.find(s => s.id === myId)?.slot ?? 0;
  P.s = G.newFlightState(G.startSlot(tr, mySlot), 0); P.s.thr = 0.6; P.ring = 0; P.frozen = true; P.crashT = 0; P.fin = null; P.flicker = 0; P.lastY = P.s.y; P.restoreCam = null; rankIds = []; input.thr = 1;
  m.slots.forEach(s => { if (s.id !== myId) makeRemote(members.get(s.id), s.slot); });
  setCam(camMode); camera.clearViewOffset(); input.enabled = true; touch.show(isPhone()); $('#hud').classList.remove('hide'); hideAll();
  $('#cd').textContent = m.cd; $('#cd').classList.remove('pop'); void $('#cd').offsetWidth; $('#cd').classList.add('pop'); sound.start();
  flash('Prépare-toi !', 2500);
}
function onSnap(m) {
  if (mode !== 'race') return; const now = performance.now();
  for (const a of m.p) {
    const [id, x, y, z, qx, qy, qz, qw, v, thr, fl, ring, fin] = a;
    if (id === myId) { P.ring = Math.max(P.ring, ring); continue; }
    const r = remotes.get(id); if (!r) continue;
    r.p.set(x, y, z); r.q.set(qx, qy, qz, qw); r.v = v; r.thr = thr; r.boost = !!(fl & 1); r.ring = ring; r.fin = !!fin; r.t = now;
    const cr = !!(fl & 2); if (cr && !r.crashed) boom(r.obj.group.position.clone(), 0.6); r.crashed = cr; r.obj.group.visible = !cr;
    if (!r.seen) { r.seen = true; r.obj.group.position.copy(r.p); r.obj.group.quaternion.copy(r.q); }
  }
  rankIds = m.rk;
}
const flash = (txt, ms = 1800) => { const e = $('#msg'); e.textContent = txt; e.classList.add('on'); clearTimeout(msgT); msgT = setTimeout(() => e.classList.remove('on'), ms); };

// caméra
function setCam(mc) {
  if (isPhone() && mc === 0) mc = 1;
  camMode = mc; store.set('cam', mc); if (!P.plane) return;
  const cp = mc === 0 ? P.cockpit.group : mc === 3 ? P.plane.group : scene;
  cp.add(camera); camera.quaternion.identity(); camera.position.set(0, 0, 0);
  if (mc === 3) camera.position.set(0, P.plane.eyePos.y + 0.3, P.plane.noseZ - 0.6);
  P.cockpit.group.visible = mc === 0; P.plane.setCockpit(mc === 0 || mc === 3);
  $('#hudL').classList.toggle('hide', mc === 0);
}
const camQ = new THREE.Quaternion(), camPos = new THREE.Vector3(), tq = new THREE.Quaternion(), tmp = new THREE.Vector3(), up3 = new THREE.Vector3();
function updateCamera(dt, inp) {
  const s = P.s, kmh = s.v * 3.6, fovT = (camMode === 0 ? 76 : 68) + Math.min(14, kmh / (P.spec.vmax * 3.6) * 12) + (s.boosting ? 7 : 0);
  if (Math.abs(camera.fov - fovT) > 0.05) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  const crashing = P.crashT > 0 && crashCam;
  if (crashing) { camera.position.copy(crashCam.pos); camera.lookAt(crashCam.look); return; }
  if (camMode === 1 || camMode === 2) {
    tq.set(...s.q); if (!camQ.lengthSq()) camQ.copy(tq); camQ.slerp(tq, 1 - Math.exp(-dt * (camMode === 1 ? 6 : 3.5)));
    const off = camMode === 1 ? [0, 3.2, 13] : [0, 7, 34]; tmp.set(off[0], off[1], off[2]).applyQuaternion(camQ);
    camera.position.set(s.x, s.y, s.z).add(tmp); camera.quaternion.copy(camQ); camera.rotateX(-0.07);
    if (s.boosting) camera.position.add(up3.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, 0).applyQuaternion(camQ));
  } else if (camMode === 0) {
    look.yaw *= look.drag ? 1 : Math.exp(-dt * 5); look.pitch *= look.drag ? 1 : Math.exp(-dt * 5);
    camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
    camera.position.set((Math.random() - 0.5) * (s.boosting ? 0.004 : 0), -Math.min(0.03, (s.g - 1) * 0.004), 0);
  }
}

// explosion
function boom(pos, scale = 1) {
  const n = 70, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), vel = [];
  for (let i = 0; i < n; i++) { p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z; vel.push(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar((15 + Math.random() * 50) * scale)); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(3, 1.2, 0.3), size: 14 * scale, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })); pts.frustumCulled = false;
  scene.add(pts); explosions.push({ pts, vel, t: 0 }); if (scale >= 1) sound.crash();
}
function updateBooms(dt) {
  for (let k = explosions.length - 1; k >= 0; k--) { const e = explosions[k]; e.t += dt; const a = e.pts.geometry.attributes.position; for (let i = 0; i < e.vel.length; i++) { a.setXYZ(i, a.getX(i) + e.vel[i].x * dt, a.getY(i) + e.vel[i].y * dt - 12 * dt * e.t, a.getZ(i) + e.vel[i].z * dt); } a.needsUpdate = true; e.pts.material.opacity = Math.max(0, 1 - e.t / 2); if (e.t > 2) { scene.remove(e.pts); e.pts.geometry.dispose(); explosions.splice(k, 1); } }
}
function crash() {
  P.crashT = 2.6; boom(new THREE.Vector3(P.s.x, P.s.y, P.s.z)); send({ t: 'crash' }); P.plane.group.visible = false; flash('CRASH !', 1500);
  const f = new THREE.Vector3(...G.qrot(P.s.q, [0, 0, -1]));
  crashCam = { pos: new THREE.Vector3(P.s.x, P.s.y, P.s.z).addScaledVector(f, -60).add(new THREE.Vector3(0, 25, 0)), look: new THREE.Vector3(P.s.x, P.s.y, P.s.z) };
  P.restoreCam = camMode; if (camMode === 0 || camMode === 3) setCam(1);
}
function respawn() {
  const rings = tr.rings, i = P.ring, prev = rings[i - 1], R = rings[Math.min(i, rings.length - 1)];
  const base = prev || { x: tr.start.x, y: tr.start.y, z: tr.start.z, nx: tr.start.dir[0], nz: tr.start.dir[2] };
  const y = Math.max(base.y, G.groundHeight(tr.world, base.x, base.z) + 50);
  P.s = G.newFlightState({ x: base.x - base.nx * 30, y, z: base.z - base.nz * 30, q: G.qLook([R.x - base.x, (R.y - base.y) * 0.4, R.z - base.z]) }, P.spec.vmax * 0.5);
  P.s.thr = 1; P.flicker = 2; P.plane.group.visible = true; crashCam = null; camQ.set(0, 0, 0, 0); P.trails.forEach(t => t.reset());
  if (P.restoreCam != null) { setCam(P.restoreCam); P.restoreCam = null; }
}

// HUD
const HUDF = { tm: $('#tm'), rg: $('#rg'), spd: $('#spd'), alt: $('#alt'), thr: $('#thrBar'), en: $('#enBar'), rank: $('#rank'), wp: $('#wp'), arrow: $('#arrow') };
const v3 = new THREE.Vector3(), camWorld = new THREE.Vector3();
function updateHud(dt, now) {
  const s = P.s, M = tr.rings.length, elapsed = P.fin != null ? P.fin : (P.frozen ? 0 : now - raceT0);
  const myIdx = rankIds.indexOf(myId), pos = myIdx >= 0 ? myIdx + 1 : 1, total = rankIds.length || members.size || 8;
  const R = tr.rings[Math.min(P.ring, M - 1)], dist = Math.round(Math.hypot(R.x - s.x, R.y - s.y, R.z - s.z));
  hudT += dt; if (hudT > 0.08) {
    hudT = 0;
    HUDF.tm.textContent = fmt(elapsed); HUDF.rg.textContent = `ANNEAU ${Math.min(P.ring, M)}/${M}  ·  ${pos}/${total}`;
    HUDF.spd.textContent = Math.round(s.v * 3.6); HUDF.alt.textContent = `ALT ${Math.round(s.y)} m`; HUDF.thr.style.width = (s.thr * 100) + '%'; HUDF.en.style.width = (s.energy * 100) + '%';
    if (P.cockpit?.ui.hud !== false) HUDF.rank.innerHTML = rankIds.map((id, i) => { const mem = members.get(id), r = remotes.get(id), rg = id === myId ? P.ring : (r?.ring || 0); return `<div class="${id === myId ? 'me' : ''}"><b>${i + 1}</b><span>${esc(mem?.name || '?')}</span><i>${(id === myId ? P.fin : r?.fin) != null && (id === myId ? P.fin !== null : r.fin) ? '🏁' : rg + '/' + M}</i></div>`; }).join(''); else HUDF.rank.innerHTML = '';
  }
  // marqueur du prochain anneau
  v3.set(R.x, R.y, R.z); const cam = v3.clone().applyMatrix4(camera.matrixWorldInverse), p = v3.clone().project(camera);
  const W = innerWidth, H = innerHeight, front = cam.z < 0;
  if (front && Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.9) { HUDF.wp.classList.remove('hide'); HUDF.arrow.classList.add('hide'); HUDF.wp.style.left = ((p.x + 1) / 2 * W) + 'px'; HUDF.wp.style.top = ((1 - p.y) / 2 * H) + 'px'; HUDF.wp.textContent = dist + ' m'; }
  else { HUDF.wp.classList.add('hide'); HUDF.arrow.classList.remove('hide'); let ax = cam.x, ay = cam.y; if (!front) { ax = -ax; ay = -ay; } const ang = Math.atan2(ay, ax), ex = W * 0.42, ey = H * 0.38; HUDF.arrow.style.left = (W / 2 + Math.cos(ang) * ex) + 'px'; HUDF.arrow.style.top = (H / 2 - Math.sin(ang) * ey) + 'px'; HUDF.arrow.style.transform = `rotate(${(Math.PI / 2 - ang) * 180 / Math.PI}deg)`; }
  // étiquettes pilotes
  for (const r of remotes.values()) {
    const d = r.obj.group.position.distanceTo(camWorld); v3.copy(r.obj.group.position).project(camera);
    const ok = v3.z < 1 && v3.z > -1 && d < 2600 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05 && r.obj.group.visible;
    r.tag.style.display = ok ? 'block' : 'none'; if (ok) { r.tag.style.left = ((v3.x + 1) / 2 * W) + 'px'; r.tag.style.top = ((1 - v3.y) / 2 * H - 14) + 'px'; r.tag.style.opacity = Math.max(0.35, 1 - d / 2600); r.tag.style.color = rankIds.indexOf(r.id) < myIdx ? '#ff9aa8' : '#bff'; }
  }
}

// frame de course
const inpDef = { pitch: 0, roll: 0, yaw: 0, thr: 0.8, boost: false, assist: true };
function raceFrame(dt, inp, now) {
  const s = P.s, ctl = { pitch: inp.pitch, roll: inp.roll, yaw: inp.yaw, thr: inp.thr, boost: inp.boost, assist: inp.assist };
  P.cockpit.ui.assist = inp.assist; touch.sync();
  if (P.crashT > 0) { P.crashT -= dt; if (P.crashT <= 0) respawn(); }
  else if (!P.frozen) {
    const n = Math.max(1, Math.ceil(dt / (1 / 60))), h = dt / n;
    for (let i = 0; i < n; i++) {
      const p0 = [s.x, s.y, s.z]; G.stepFlight(s, ctl, P.spec, h);
      const R = tr.rings[P.ring];
      if (R && G.crossesRing(R, p0, [s.x, s.y, s.z])) { world.flashRing(P.ring); P.ring++; sound.ring(); if (P.ring < tr.rings.length) flash(`ANNEAU ${P.ring}/${tr.rings.length}`, 900); }
      if (s.y < G.groundHeight(tr.world, s.x, s.z) + 2.5) { crash(); break; }
    }
    const far = Math.hypot(s.x, s.z); if (far > 15000) { P.outT += dt; flash('Retourne sur le circuit !', 500); if (P.outT > 6) { P.outT = 0; crash(); } } else P.outT = 0;
  } else { s.thr += (ctl.thr - s.thr) * Math.min(1, dt * 3); }
  // état vers le serveur (20 Hz)
  if (now - lastSend > 50) { lastSend = now; send({ t: 's', x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1), q: s.q.map(v => +v.toFixed(4)), v: +s.v.toFixed(1), thr: +s.thr.toFixed(2), f: (s.boosting ? 1 : 0) | (P.crashT > 0 ? 2 : 0) }); }
  // avion du joueur
  const g = P.plane.group; g.position.set(s.x, s.y, s.z); g.quaternion.set(...s.q);
  if (P.flicker > 0) { P.flicker -= dt; g.visible = Math.floor(P.flicker * 12) % 2 === 0; if (P.flicker <= 0) g.visible = true; }
  P.plane.update(dt, s.thr, s.boosting);
  g.updateMatrixWorld(true);
  // traînées
  const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
  const a = (P.cockpit.ui.smoke ? 0.25 + (s.boosting ? 0.55 : 0) + Math.min(0.4, (s.g - 1) * 0.12) : 0) * (P.crashT > 0 ? 0 : 1);
  P.plane.wingtips.forEach((w, i) => P.trails[i].push(g.localToWorld(w.clone()), upv, a, dt));
  // cockpit
  const att = G.attitude(s.q); P.vsi += (((s.y - P.lastY) / Math.max(dt, 1e-3)) - P.vsi) * Math.min(1, dt * 6); P.lastY = s.y;
  if (camMode === 0) {
    P.cockpit.animate(dt, ctl, s.thr, s.boosting);
    const M = tr.rings.length, myIdx = rankIds.indexOf(myId);
    P.cockpit.draw(dt, { kmh: s.v * 3.6, alt: s.y, vsi: P.vsi, att, g: s.g, thr: s.thr, energy: s.energy, px: s.x, pz: s.z, hdgRad: att.heading * Math.PI / 180,
      rings: tr.rings.slice(P.ring, P.ring + 3), others: [...remotes.values()].map(r => ({ x: r.obj.group.position.x, z: r.obj.group.position.z, ahead: rankIds.indexOf(r.id) < myIdx })),
      rank: myIdx >= 0 ? myIdx + 1 : 1, n: rankIds.length || 8, ring: Math.min(P.ring, M), rings_total: M, time: fmt(P.fin != null ? P.fin : (P.frozen ? 0 : now - raceT0)),
      dist: Math.round(Math.hypot(tr.rings[Math.min(P.ring, M - 1)].x - s.x, tr.rings[Math.min(P.ring, M - 1)].y - s.y, tr.rings[Math.min(P.ring, M - 1)].z - s.z)), msg: P.fin != null ? 'COURSE TERMINÉE' : P.frozen ? 'DÉPART IMMINENT' : '' });
  }
  // autres pilotes
  for (const r of remotes.values()) {
    const age = Math.min(0.25, (now - r.t) / 1000), f = tmp.set(0, 0, -1).applyQuaternion(r.q), k = 1 - Math.exp(-dt * 14);
    const tp = r.p.clone().addScaledVector(f, r.v * age); r.obj.group.position.lerp(tp, k); r.obj.group.quaternion.slerp(r.q, k);
    r.obj.update(dt, r.thr, r.boost); r.obj.group.updateMatrixWorld(true);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(r.obj.group.quaternion), al = r.crashed ? 0 : 0.2 + (r.boost ? 0.5 : 0);
    r.obj.wingtips.forEach((w, i) => r.trails[i].push(r.obj.group.localToWorld(w.clone()), u, al, dt));
  }
  updateBooms(dt); updateCamera(dt, inp); camera.updateMatrixWorld(true); camera.matrixWorldInverse.copy(camera.matrixWorld).invert(); camera.getWorldPosition(camWorld);
  world.update(dt, camWorld, g.position, Math.min(P.ring, tr.rings.length - 1));
  updateHud(dt, now);
  sound.update(!paused, P.spec.kind, s.thr, s.v, s.boosting);
}

// ------------------------------------------------------------ résultats
function onResults(m) {
  if (mode !== 'race' && mode !== 'results') return;
  mode = 'results'; input.enabled = false; touch.show(false); $('#hud').classList.add('hide'); $('#cd').style.opacity = 0; sound.update(false);
  const t = tracks.find(x => x.id === m.track); $('#rsTitle').textContent = `Résultats — ${t ? t.name : ''}`;
  $('#rsBody').innerHTML = `<table><tr><th>#</th><th>Pilote</th><th>Avion</th><th>Temps</th></tr>${m.results.map(r => `<tr class="${r.id === m.you ? 'me' : ''}"><td>${r.pos}</td><td>${esc(r.name)} ${r.bot ? '<span class="pill bot">bot</span>' : ''}</td><td>${G.PLANES[r.plane]?.name || ''}</td><td class="n">${r.time != null ? fmt(r.time) : `NT · ${r.rings}/${r.total}`}</td></tr>`).join('')}</table>`;
  let x = m.gain ? `<div class="unl" style="background:rgba(25,224,255,.12);border-color:rgba(25,224,255,.4)">+${m.gain} XP · niveau ${m.level}${m.levelUp ? ' 🎉 NIVEAU SUPÉRIEUR !' : ''}</div>` : '';
  (m.newPlanes || []).forEach(id => x += `<div class="unl">✈ Nouvel avion débloqué : <b>${G.PLANES[id].name}</b></div>`);
  (m.newSkins || []).forEach(id => x += `<div class="unl">🎨 Nouvelle peinture : <b>${G.SKINS.find(s => s.id === id).name}</b></div>`);
  $('#rsXp').innerHTML = x; profile = m.profile; refreshProfile(); show('results');
}
$('#rsGo').onclick = () => { clearRace(); mode = 'lobby'; ensureShowcase(); if (room && (room.state === 'lobby' || pendingLobby)) { pendingLobby = false; renderLobby(); show('lobby'); if (world.trackId !== room.track) world.load(room.track); } else { show('lobby'); if (room) renderLobby(); } };
function backToMenu() {
  clearInterval(lobbyTick); clearRace(); mode = 'menu'; room = null; input.enabled = false; touch.show(false); paused = false; $('#hud').classList.add('hide'); sound.update(false);
  if (profile) { ensureShowcase(); show('menu'); }
}

// ------------------------------------------------------------ pause / actions
$('#pResume').onclick = () => { paused = false; hideAll(); input.enabled = true; touch.show(isPhone()); };
$('#pQuit').onclick = () => { send({ t: 'leave' }); backToMenu(); };
input.onAction = (a) => {
  if (mode === 'race') {
    if (a === 'pause') { paused = !paused; if (paused) { show('pause'); input.enabled = false; touch.show(false); } else { hideAll(); input.enabled = true; touch.show(isPhone()); } }
    else if (a === 'camera' && P.plane) { setCam(isPhone() ? (camMode % 3) + 1 : (camMode + 1) % 4); }
    else if (a === 'assist') { input.opts.assist = !input.opts.assist; input.saveOpts(); flash('Stabilisation ' + (input.opts.assist ? 'ON' : 'OFF'), 900); }
    else if (a === 'lights' && P.cockpit) { P.cockpit.ui.nav = !P.cockpit.ui.nav; applyUi(); }
    else if (a === 'hud' && P.cockpit) { P.cockpit.ui.hud = !P.cockpit.ui.hud; applyUi(); }
  } else if (a === 'pause' && mode === 'menu') { /* rien */ }
  if (a === 'mute') sound.setVolume(sound.vol > 0 ? 0 : 0.6);
};
function applyUi() { const u = P.cockpit.ui; P.plane.setLights(u.nav); document.querySelectorAll('#hudL,#rank').forEach(e => e.style.visibility = u.hud ? '' : 'hidden'); }

// ------------------------------------------------------------ souris (cockpit cliquable)
const cv = $('#gl'); let drag = null;
const ndcOf = (e) => ({ x: e.clientX / innerWidth * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 });
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  if (isPhone() || mode !== 'race' || camMode !== 0 || !P.cockpit || paused) return;
  cv.setPointerCapture(e.pointerId);
  if (e.button === 2) { look.drag = true; drag = { type: 'look' }; return; }
  const id = P.cockpit.rayPick(camera, ndcOf(e)); if (!id) return;
  sound.click();
  if (id === 'stick') drag = { type: 'stick', x: e.clientX, y: e.clientY };
  else if (id === 'throttle') drag = { type: 'thr', y: e.clientY, v: input.thr };
  else if (id === 'boost') { input.mouse.boost = true; drag = { type: 'boost' }; }
  else if (id.startsWith('sw_')) { const k = id.slice(3); P.cockpit.ui[k] = !P.cockpit.ui[k]; if (k === 'assist') { input.opts.assist = P.cockpit.ui.assist; input.saveOpts(); } applyUi(); }
});
cv.addEventListener('pointermove', (e) => {
  if (mode !== 'race' || camMode !== 0 || !P.cockpit) { cv.style.cursor = ''; return; }
  if (!drag) { cv.style.cursor = P.cockpit.rayPick(camera, ndcOf(e)) ? 'pointer' : ''; return; }
  if (drag.type === 'stick') { input.mouse.roll = Math.max(-1, Math.min(1, (e.clientX - drag.x) / 130)); input.mouse.pitch = Math.max(-1, Math.min(1, (e.clientY - drag.y) / 130)); }
  else if (drag.type === 'thr') input.thr = Math.max(0, Math.min(1, drag.v - (e.clientY - drag.y) / 170));
  else if (drag.type === 'look') { look.yaw = Math.max(-2, Math.min(2, look.yaw - e.movementX * 0.005)); look.pitch = Math.max(-0.9, Math.min(0.9, look.pitch - e.movementY * 0.005)); }
});
const endDrag = () => { drag = null; look.drag = false; input.mouse.roll = input.mouse.pitch = 0; input.mouse.boost = false; };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

// ------------------------------------------------------------ boucle
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const inp = input.poll(dt);
  try { if (mode === 'race' && tr && P.s) raceFrame(dt, inp, now); else menuFrame(dt); } catch (e) { console.error(e); }
  if (composer) composer.render(dt); else renderer.render(scene, camera);
}

// ------------------------------------------------------------ démarrage
(async () => {
  try {
    $('#loadTxt').textContent = 'Génération du monde…';
    await world.load('archipel');
    connect(); requestAnimationFrame(frame);
    show('loading'); $('#loadTxt').textContent = 'Connexion au serveur…';
    setTimeout(() => { if (mode === 'boot') toast('Serveur injoignable — nouvel essai…', 4000); }, 6000);
  } catch (e) { console.error(e); $('#loadTxt').textContent = 'Erreur de chargement : ' + e.message + ' (WebGL2 requis, connexion internet pour Three.js)'; }
})();
window.__airrace = { P, world, input, get mode() { return mode; } };
