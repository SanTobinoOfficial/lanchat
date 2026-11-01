'use strict';
// LanChat – zero-dependency LAN chat. HTTP + WebSocket (hand-rolled) + UDP discovery.
const http = require('http'), dgram = require('dgram'), crypto = require('crypto');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFile } = require('child_process');

let sea = null;
try { const s = require('node:sea'); if (s.isSea()) sea = s; } catch {}

const VERSION = '0.3.0';
const REPO = 'SanTobinoOfficial/lanchat';   // repozytorium z wydaniami (komendy instalacyjne na stronie „Hostuj własny”); podmienia je tools/set-repo.js
const DISC_PORT = 7778;
const DATA = path.join(os.homedir(), '.lanchat');
fs.mkdirSync(DATA, { recursive: true });
const SETTINGS_FILE = path.join(DATA, 'settings.json');

let username = 'Admin';
try { username = os.userInfo().username; } catch {}
const settings = Object.assign({
  port: 7777, hostName: username, allowLanHosting: true, maxRooms: 20,
  maxUsersPerRoom: 100, uploadLimitMB: 8, giphyKey: '', openBrowser: true, bannedIps: [], serveInstaller: true,
}, readJson(SETTINGS_FILE));
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
function saveSettings() { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch {} }

const ADMIN_TOKEN = crypto.randomBytes(24).toString('hex');
const rooms = new Map();      // code -> room
const media = new Map();      // id -> {room, type}  (bajty leżą na dysku w MEDIA_DIR)
const uploadKeys = new Map(); // key -> client
let listenPort = settings.port;

// ---------- persistence (konta, pokoje, obrazy) ----------
const MEDIA_DIR = path.join(DATA, 'media');
const ACC_FILE = path.join(DATA, 'accounts.json'), ROOMS_FILE = path.join(DATA, 'rooms.json');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
function writeAtomic(file, text) { try { fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file); } catch {} }
const accounts = readJson(ACC_FILE);   // sha256(kod konta) -> profil
let accTimer = null, roomsTimer = null;
function saveAccounts() { clearTimeout(accTimer); accTimer = setTimeout(() => writeAtomic(ACC_FILE, JSON.stringify(accounts)), 500); }
function saveRoomsNow() {
  clearTimeout(roomsTimer); roomsTimer = null;
  writeAtomic(ROOMS_FILE, JSON.stringify([...rooms.values()].map(r => ({
    code: r.code, name: r.name, password: r.password, isPublic: r.isPublic, hostKey: r.hostKey, created: r.created,
    history: r.history, bans: [...r.bans], muted: [...r.muted], mods: [...r.mods], stickers: r.stickers,
    mediaBytes: r.mediaBytes, topic: r.topic, slow: r.slow, mediaTypes: r.mediaTypes, hashes: r.hashes, icon: r.icon || '',
    members: [...r.members.values()], banNames: r.banNames, joinLock: !!r.joinLock, maxUsers: r.maxUsers || 0,
  }))));
}
function scheduleSave() { if (!roomsTimer) roomsTimer = setTimeout(saveRoomsNow, 500); }
function loadRooms() {
  let list = []; try { list = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')); } catch {}
  for (const j of Array.isArray(list) ? list : []) {
    if (!j || !/^[A-Z0-9]{4,12}$/.test(j.code)) continue;
    const r = Object.assign({ name: j.code, password: '', isPublic: false, created: Date.now(), history: [], stickers: [], mediaBytes: 0, topic: '', slow: 0, mediaTypes: {}, hashes: {}, banNames: {}, joinLock: false, maxUsers: 0 }, j,
      { clients: new Map(), bans: new Set(j.bans), muted: new Set(j.muted), mods: new Set(j.mods), members: new Map((Array.isArray(j.members) ? j.members : []).filter(x => x && x.id).map(x => [x.id, Object.assign({ name: 'Gość', color: '#5b8def', bio: '', status: 'online', avatar: '', seen: 0, host: false, adm: false }, x)])) });
    rooms.set(r.code, r);
    for (const [id, type] of Object.entries(r.mediaTypes || {})) if (fs.existsSync(path.join(MEDIA_DIR, id))) media.set(id, { room: r.code, type });
  }
}
const accId = secret => crypto.createHash('sha256').update('lc|' + secret).digest('hex').slice(0, 32);
const cleanAddr = a => clip(a, 80).replace(/[^\w.:\[\]-]/g, '');
// rejestr „kto, z jakiego IP i urządzenia” – tylko dla metod zapisu „u admina” i „w przeglądarce” (tryb base64 niczego tu nie zostawia)
const DEV_FILE = path.join(DATA, 'devices.json'), devices = readJson(DEV_FILE);
let devTimer = null; const saveDevices = () => { clearTimeout(devTimer); devTimer = setTimeout(() => writeAtomic(DEV_FILE, JSON.stringify(devices)), 600); };
function parseDevice(ua) {
  ua = String(ua || '');
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'nieznany system';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'przeglądarka';
  const type = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'telefon' : 'komputer';
  return { os, browser: br, type, label: os + ' · ' + br + ' · ' + type };
}
const deviceHdr = req => { try { const x = JSON.parse(String(req.headers['x-device'] || '{}')); return { w: Math.min(99999, +x.w | 0), h: Math.min(99999, +x.h | 0) }; } catch { return { w: 0, h: 0 }; } };
function noteSeen(secret, ip, ua, extra, name, method) {
  if (!secret || method === 'base64') return;
  const id = accId(secret), now = Date.now(), rec = devices[id] || (devices[id] = { first: now, ips: {}, devices: {} });
  rec.name = clip(name, 24) || rec.name || 'Gość'; rec.method = method === 'browser' ? 'browser' : method === 'password' ? 'password' : 'server'; rec.last = now; rec.ips[ip] = now;
  const k = crypto.createHash('sha1').update(String(ua)).digest('hex').slice(0, 8), d = rec.devices[k] || { first: now };
  rec.devices[k] = Object.assign(d, { label: parseDevice(ua).label, screen: extra && extra.w ? extra.w + '×' + extra.h : d.screen || '', last: now, ip });
  const ips = Object.entries(rec.ips); if (ips.length > 8) rec.ips = Object.fromEntries(ips.sort((x, y) => y[1] - x[1]).slice(0, 8));
  const dv = Object.entries(rec.devices); if (dv.length > 8) rec.devices = Object.fromEntries(dv.sort((x, y) => y[1].last - x[1].last).slice(0, 8));
  saveDevices();
}
// metoda „hasło”: nazwa konta + hasło (na dysku tylko skrót scrypt z solą), odzyskanie konta na dowolnym urządzeniu
const logins = new Map();   // nazwa konta -> accId
function indexLogins() { logins.clear(); for (const [id, a] of Object.entries(accounts)) if (a && a.auth && a.auth.login) logins.set(a.auth.login, id); }
indexLogins();
const DUMMY_SALT = crypto.randomBytes(16), hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32);
const acctMethod = id => accounts[id] && accounts[id].auth ? 'password' : 'server';
const fails = new Map();    // ip -> { n, t, until } – po 5 błędnych próbach blokada na 5 minut (ochrona przed zgadywaniem)
const LOCK_MS = +process.env.LANCHAT_LOCK_MS || 5 * 60 * 1000;
const throttled = ip => { const f = fails.get(ip); return !!f && f.n >= 5 && Date.now() < f.until; };
function failed(ip) { const f = fails.get(ip) || { n: 0, t: Date.now() }; if (Date.now() - f.t > 10 * 60000) { f.n = 0; f.t = Date.now(); } f.n++; if (f.n >= 5) f.until = Date.now() + LOCK_MS; fails.set(ip, f); }
function cleanAccount(b, old) {
  const o = Object.assign({}, old);
  if ('name' in b) o.name = clip(b.name, 24).trim() || old.name || 'Gość';
  if ('color' in b && /^#[0-9a-f]{6}$/i.test(b.color)) o.color = b.color;
  if ('bio' in b) o.bio = clip(b.bio, 190);
  if ('avatar' in b) o.avatar = typeof b.avatar === 'string' && b.avatar.length <= 80000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.avatar) ? b.avatar : '';
  if (['online', 'idle', 'dnd'].includes(b.status)) o.status = b.status;
  if (['dark', 'light'].includes(b.theme)) o.theme = b.theme;
  if ('compact' in b) o.compact = !!b.compact;
  if ('notify' in b) o.notify = !!b.notify;
  if ('fontScale' in b) o.fontScale = Math.max(85, Math.min(130, parseInt(b.fontScale, 10) || 100));
  if ('sound' in b) o.sound = !!b.sound;
  if (Array.isArray(b.rooms)) o.rooms = b.rooms.slice(0, 50).map(r => ({
    addr: cleanAddr(r && r.addr), code: normCode(r && r.code), name: clip(r && r.name, 40), password: clip(r && r.password, 64),
    hostKey: /^[0-9a-f]{32}$/.test((r && r.hostKey) || '') ? r.hostKey : undefined, muted: !!(r && r.muted),
  })).filter(r => r.addr && r.code);
  o.created = old.created || Date.now(); o.updated = Date.now();
  return o;
}

// ---------- helpers ----------
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 6; i++) c += ALPHA[crypto.randomInt(ALPHA.length)];
    if (!rooms.has(c)) return c;
  }
}
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const cleanIp = ip => String(ip || '').replace(/^::ffff:/, '');
const isLoopIp = ip => ['127.0.0.1', '::1'].includes(cleanIp(ip)) || cleanIp(ip) === '::1';
function hostHeaderOk(req) {
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return ['localhost', '127.0.0.1', '[::1]'].includes(h);
}
const isAdminReq = req => isLoopIp(req.socket.remoteAddress) && hostHeaderOk(req);
function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i);
  return out;
}
const ownIps = () => new Set(lanIps().map(i => i.address));

// ---------- WebSocket ----------
const MAXWS = 1 << 20;
function wsSend(sock, str) {
  if (sock.destroyed) return;
  const p = Buffer.from(str), len = p.length;
  let h;
  if (len < 126) h = Buffer.from([0x81, len]);
  else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(len, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
  sock.write(Buffer.concat([h, p]));
}
function attachWs(sock, onMsg, onClose) {
  let buf = Buffer.alloc(0), frag = [], fragLen = 0, fragOp = 0;
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1], fin = !!(b0 & 0x80), op = b0 & 0xf, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAXWS || !masked) return sock.destroy();
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (op === 8) { try { sock.end(Buffer.from([0x88, 0])); } catch {} return; }
      if (op === 9) { if (data.length <= 125) sock.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2) { frag = [data]; fragLen = data.length; fragOp = op; }
      else if (op === 0) { frag.push(data); fragLen += data.length; if (fragLen > MAXWS) return sock.destroy(); }
      if (fin) { const full = Buffer.concat(frag); frag = []; fragLen = 0; if (fragOp === 1) onMsg(full.toString('utf8')); }
    }
  });
  sock.on('close', onClose);
  sock.on('error', () => {});
}

// ---------- rooms ----------
// Poziomy uprawnień: admin (ukryty, incognito) > host (twórca) > moderator > użytkownik.
const LVL = { user: 0, mod: 1, host: 2, admin: 3 };
const AFK_MS = +process.env.LANCHAT_AFK_MS || 10 * 60 * 1000;   // po rozłączeniu najpierw „AFK”, po 10 minutach „Niedostępny” (członkostwo zostaje!)
function createRoom({ name, password, isPublic }) {
  const code = newCode();
  const r = {
    code, name: clip(name, 40) || 'Pokój ' + code, password: clip(password, 64), isPublic: !!isPublic,
    hostKey: rid(16), created: Date.now(), clients: new Map(), history: [], bans: new Set(), banNames: {},
    muted: new Set(), mods: new Set(), members: new Map(), stickers: [], mediaBytes: 0, topic: '', slow: 0,
    joinLock: false, maxUsers: 0, mediaTypes: {}, hashes: {},
  };
  rooms.set(code, r);
  scheduleSave();
  return r;
}
function closeRoom(r, reason) {
  broadcast(r, { t: 'closed', reason: reason || 'Pokój został zamknięty' });
  rooms.delete(r.code);
  for (const c of r.clients.values()) { try { c.sock.end(); } catch {} }
  for (const [id, m] of media) if (m.room === r.code) { media.delete(id); fs.unlink(path.join(MEDIA_DIR, id), () => {}); }
  scheduleSave();
}
// prawdziwa rola (do sprawdzania uprawnień)
function realRole(r, id) {
  const c = r.clients.get(id), m = r.members.get(id);
  if ((c && c.isAdmin) || (m && m.adm)) return 'admin';
  if ((c && c.isHost) || (m && m.host)) return 'host';
  return r.mods.has(id) ? 'mod' : 'user';
}
const lvl = (r, id) => LVL[realRole(r, id)];
const canMod = (r, c) => lvl(r, c.id) >= 1;
const canHost = (r, c) => lvl(r, c.id) >= 2;
// rola widoczna dla innych: admin jest incognito (zwykły użytkownik), chyba że jest też twórcą pokoju; sam admin widzi prawdę
function shownRole(r, id, viewerIsAdmin) {
  const rr = realRole(r, id); if (rr !== 'admin' || viewerIsAdmin) return rr;
  const c = r.clients.get(id), m = r.members.get(id);
  return (c && c.isHost) || (m && m.host) ? 'host' : r.mods.has(id) ? 'mod' : 'user';
}
// obecność: połączony → jego status; rozłączony → AFK, a potem Niedostępny
function presenceOf(r, mem) { const c = r.clients.get(mem.id); return c ? c.status : (Date.now() - mem.seen < AFK_MS ? 'afk' : 'offline'); }
function syncMember(r, c) {
  const mem = r.members.get(c.id); if (!mem) return;
  Object.assign(mem, { name: c.name, color: c.color, bio: c.bio, status: c.status, avatar: c.avatar, seen: Date.now() });
}
// role na listach są ZAWSZE publiczne (admin nie jest widoczny nawet dla siebie – zrzut ekranu go nie zdradzi); prawdziwą rolę (do uprawnień) dostaje tylko właściciel wpisu, w polu „real”
const memberView = (r, mem, viewer) => ({
  id: mem.id, name: mem.name, color: mem.color, role: shownRole(r, mem.id, false), real: viewer && viewer.id === mem.id ? realRole(r, mem.id) : undefined, muted: r.muted.has(mem.id),
  avatar: mem.avatar, bio: mem.bio, status: presenceOf(r, mem), online: r.clients.has(mem.id),
});
const usersFor = (r, viewer) => [...r.members.values()].map(m => memberView(r, m, viewer));
function broadcast(r, obj, except) {
  const s = JSON.stringify(obj);
  for (const c of r.clients.values()) if (c !== except) wsSend(c.sock, s);
}
function sendUsers(r) {
  r._sig = [...r.members.values()].map(m => m.id + presenceOf(r, m)).join();
  for (const c of r.clients.values()) wsSend(c.sock, JSON.stringify({ t: 'users', users: usersFor(r, c) }));
}
function sys(r, text) {
  const m = { id: rid(6), kind: 'sys', text, ts: Date.now() };
  r.history.push(m); if (r.history.length > 500) r.history.shift();
  broadcast(r, { t: 'msg', m });
  scheduleSave();
}
const roomInfo = r => ({ code: r.code, name: r.name, topic: r.topic, slow: r.slow, locked: !!r.password, stickers: r.stickers, icon: r.icon || '', joinLock: !!r.joinLock, maxUsers: r.maxUsers || 0, isPublic: !!r.isPublic });
const notice = (c, text) => wsSend(c.sock, JSON.stringify({ t: 'notice', text }));
// rozsyłaj zmiany obecności (AFK → Niedostępny) bez udziału klientów
setInterval(() => { for (const r of rooms.values()) { const sig = [...r.members.values()].map(m => m.id + presenceOf(r, m)).join(); if (sig !== r._sig && r.clients.size) sendUsers(r); } }, Math.min(20000, Math.max(300, AFK_MS / 3))).unref();

function onJoin(sock, ip, m, ua) {
  const err = code => { wsSend(sock, JSON.stringify({ t: 'error', code })); sock.end(); };
  const r = rooms.get(normCode(m.room));
  if (!r) return err('notfound');
  const cid = clip(m.cid, 64).replace(/[^\w-]/g, '') || rid(8);
  const id = crypto.createHash('sha1').update(cid + r.code).digest('hex').slice(0, 8);
  const isAdmin = !!m.adminToken && safeEq(m.adminToken, ADMIN_TOKEN);
  const isHost = !!m.hostKey && safeEq(m.hostKey, r.hostKey);
  if (!isAdmin && (r.bans.has(id) || settings.bannedIps.includes(cleanIp(ip)))) return err('banned');
  if (!isAdmin && !isHost && r.password && !safeEq(m.password || '', r.password)) return err('password');
  const mem = r.members.get(id);
  if (!mem && !isAdmin && !isHost && r.joinLock) return err('locked');          // blokada dołączania: wracają tylko dotychczasowi członkowie
  const old = r.clients.get(id);
  const cap = Math.min(settings.maxUsersPerRoom, r.maxUsers || Infinity);
  if (!old && r.clients.size >= cap && !isAdmin && !isHost) return err('full');
  if (!mem && r.members.size >= 500) return err('full');
  if (old) { wsSend(old.sock, JSON.stringify({ t: 'closed', reason: 'Połączono z innej karty' })); try { old.sock.end(); } catch {} }
  const c = {
    id, cid, sock, ip: cleanIp(ip), room: r, isAdmin, isHost, joined: Date.now(),
    name: clip(m.name, 24).trim() || 'Gość', color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#5b8def',
    uploadKey: rid(16), stamps: [], lastMsg: 0, avatar: mem ? mem.avatar : '', bio: clip(m.bio, 190), ua: ua || '', priv: m.method === 'base64',
    status: ['online', 'idle', 'dnd'].includes(m.status) ? m.status : 'online',
  };
  uploadKeys.set(c.uploadKey, c);
  r.clients.set(id, c);
  sock.client = c;
  r.members.set(id, Object.assign(mem || { id, joined: Date.now(), host: false, adm: false }, { host: !!(mem && mem.host) || isHost, adm: !!(mem && mem.adm) || isAdmin }));
  syncMember(r, c);
  if (!c.priv) noteSeen(cid, c.ip, ua, {}, c.name, m.method === 'browser' ? 'browser' : m.method === 'password' ? 'password' : 'server');   // tryb base64: żadnego śladu IP/urządzenia
  wsSend(sock, JSON.stringify({
    t: 'joined', you: memberView(r, r.members.get(id), c), uploadKey: c.uploadKey, room: roomInfo(r),
    users: usersFor(r, c), history: r.history,
  }));
  sendUsers(r);
  if (!mem) sys(r, `${c.name} dołączył(a)`);   // ogłaszamy tylko nowych członków – powrót po rozłączeniu nie jest „dołączeniem”
}
function onLeave(c) {   // rozłączenie ≠ opuszczenie pokoju: członek zostaje, zmienia się tylko obecność
  const r = c.room;
  uploadKeys.delete(c.uploadKey);
  if (r.clients.get(c.id) === c) {
    r.clients.delete(c.id);
    const mem = r.members.get(c.id); if (mem) { syncMember(r, c); mem.seen = Date.now(); }
    sendUsers(r);
    scheduleSave();
  }
}

const GIF_HOSTS = /^https:\/\/(nekos\.best|media\d*\.giphy\.com|i\.giphy\.com|upload\.wikimedia\.org|media\.tenor\.com|i\.imgur\.com)\//i;
const hostOk = u => GIF_HOSTS.test(u);
function validUrl(r, u) {
  u = clip(u, 600);
  if (/^\/media\/[0-9a-f]{32}$/.test(u)) { const m = media.get(u.slice(7)); return m && m.room === r.code ? u : null; }
  if (/^\/gifpack\/[a-z0-9-]{1,30}\.gif$/.test(u)) return gifPackHas(u.slice(9, -4)) ? u : null;
  return /^https?:\/\/[^\s<>"']{4,}$/i.test(u) ? u : null;
}
// zapis pliku w mediach pokoju (z deduplikacją po sumie kontrolnej)
async function storeMedia(r, buf, type) {
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  let id = r.hashes[hash];
  if (!id || !media.has(id)) {
    id = rid(16);
    await fs.promises.writeFile(path.join(MEDIA_DIR, id), buf);
    media.set(id, { room: r.code, type }); r.mediaTypes[id] = type; r.hashes[hash] = id; r.mediaBytes += buf.length;
    scheduleSave();
  }
  return id;
}
// pobranie GIF-a z zaufanego serwisu na serwer pokoju (każdy klient czyta go potem od hosta, a historia nie zależy od internetu)
async function importRemote(r, url) {
  try {
    let u = url;
    for (let hop = 0; hop < 3; hop++) {
      if (!hostOk(u)) return null;
      const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(9000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u).href; continue; }
      if (!res.ok) return null;
      const limit = Math.min(settings.uploadLimitMB, 12) * 1048576;
      if ((+res.headers.get('content-length') || 0) > limit) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const type = buf.length <= limit && sniff(buf);
      if (!type || r.mediaBytes + buf.length > 150 * 1048576) return null;
      return '/media/' + await storeMedia(r, buf, type);
    }
  } catch {}
  return null;
}
function post(c, m) {
  const r = c.room, now = Date.now();
  if (r.muted.has(c.id)) return notice(c, 'Jesteś wyciszony(-a).');
  c.stamps = c.stamps.filter(t => now - t < 5000);
  if (c.stamps.length >= 8 && lvl(r, c.id) < 2) return notice(c, 'Zwolnij – za dużo wiadomości.');
  if (r.slow && !canMod(r, c) && now - c.lastMsg < r.slow * 1000) return notice(c, `Tryb powolny: ${r.slow}s między wiadomościami.`);
  const msg = { id: rid(6), uid: c.id, name: c.name, color: c.color, avatar: c.avatar, role: shownRole(r, c.id, false), ts: now, kind: m.t === 'msg' ? 'text' : m.t };
  if (m.t === 'msg') {
    msg.text = clip(m.text, 4000).trim(); if (!msg.text) return;
    if (m.me) msg.me = true;
  } else if (m.t === 'gif' || m.t === 'img') {
    msg.url = validUrl(r, m.url); if (!msg.url) return;
    msg.text = clip(m.text, 200);
  } else if (m.t === 'sticker') {
    if (m.url) { msg.url = r.stickers.includes(m.url) ? m.url : null; if (!msg.url) return; }
    else { msg.text = clip(m.text, 16); if (!msg.text) return; msg.label = clip(m.label, 30); }
  } else return;
  if (m.reply) {
    const q = r.history.find(x => x.id === m.reply);
    if (q && q.kind !== 'sys') msg.reply = { id: q.id, name: q.name, text: clip(q.text || (q.kind === 'text' ? '' : '[' + q.kind + ']'), 90) };
  }
  c.stamps.push(now); c.lastMsg = now;
  msg.reactions = {};
  r.history.push(msg); if (r.history.length > 500) r.history.shift();
  broadcast(r, { t: 'msg', m: msg });
}

function handle(c, m) { handleMsg(c, m); if (m.t !== 'typing') scheduleSave(); }
function handleMsg(c, m) {
  const r = c.room;
  switch (m.t) {
    case 'gif': {
      const u = clip(m.url, 600);
      if (hostOk(u) && !c.importing) {   // GIF z zaufanego serwisu: pobierz do pokoju, potem wyślij już lokalny adres
        c.importing = true;
        importRemote(r, u).then(local => { c.importing = false; if (!c.sock.destroyed && r.clients.get(c.id) === c) { post(c, Object.assign({}, m, { url: local || u })); scheduleSave(); } });
        return;
      }
      return post(c, m);
    }
    case 'msg': case 'img': case 'sticker': return post(c, m);
    case 'typing': return broadcast(r, { t: 'typing', uid: c.id, name: c.name }, c);
    case 'profile': {
      if ('name' in m) c.name = clip(m.name, 24).trim() || c.name;
      if (/^#[0-9a-f]{6}$/i.test(m.color)) c.color = m.color;
      if ('bio' in m) c.bio = clip(m.bio, 190);
      if (['online', 'idle', 'dnd'].includes(m.status)) c.status = m.status;
      if (m.method === 'base64' || m.method === 'browser' || m.method === 'server' || m.method === 'password') { c.priv = m.method === 'base64'; if (!c.priv) noteSeen(c.cid, c.ip, c.ua, {}, c.name, m.method); }   // zmiana metody zapisu w trakcie sesji
      if ('avatar' in m) {
        const u = clip(m.avatar, 100), med = /^\/media\/[0-9a-f]{32}$/.test(u) && media.get(u.slice(7));
        if (u === '') c.avatar = ''; else if (med && med.room === r.code) c.avatar = u;
      }
      syncMember(r, c);
      return sendUsers(r);
    }
    case 'leave': {   // świadome opuszczenie pokoju – dopiero to jest „wyjściem”
      r.members.delete(c.id); r.mods.delete(c.id);
      sys(r, `${c.name} opuścił(a) pokój`);
      try { c.sock.end(); } catch {}
      return;
    }
    case 'react': {
      const msg = r.history.find(x => x.id === m.mid); const e = clip(m.emoji, 16);
      if (!msg || msg.kind === 'sys' || !e) return;
      const list = msg.reactions[e] || (msg.reactions[e] = []);
      const i = list.indexOf(c.id); if (i >= 0) list.splice(i, 1); else list.push(c.id);
      if (!list.length) delete msg.reactions[e];
      return broadcast(r, { t: 'reactions', mid: msg.id, reactions: msg.reactions });
    }
    case 'edit': {
      const msg = r.history.find(x => x.id === m.mid);
      const text = clip(m.text, 4000).trim();
      if (!msg || msg.uid !== c.id || msg.kind !== 'text' || !text) return;
      msg.text = text; msg.edited = true;
      return broadcast(r, { t: 'edit', mid: msg.id, text });
    }
    case 'del': {
      const i = r.history.findIndex(x => x.id === m.mid); if (i < 0) return;
      const msg = r.history[i];
      if (msg.kind === 'sys' || (msg.uid !== c.id && !canMod(r, c))) return;
      r.history.splice(i, 1);
      return broadcast(r, { t: 'del', mid: msg.id });
    }
    case 'mod': { // kick | ban | mute | unmute | promote | demote – działa też na osobach rozłączonych (AFK / niedostępnych)
      if (!canMod(r, c)) return;
      const tm = r.members.get(m.uid), t = r.clients.get(m.uid);
      // wyższy poziom wygrywa; odmowa jest zawsze taka sama, żeby nie zdradzić ukrytego admina
      if (!tm || m.uid === c.id || lvl(r, c.id) <= lvl(r, m.uid)) return notice(c, 'Nie można wykonać tej akcji.');
      const by = shownRole(r, c.id, false) === 'user' ? 'moderatora' : c.name;   // incognito: bez nazwiska ukrytego admina
      if (m.act === 'kick' || m.act === 'ban') {
        if (m.act === 'ban') { r.bans.add(m.uid); r.banNames[m.uid] = tm.name; }
        r.members.delete(m.uid); r.mods.delete(m.uid);
        if (t) { wsSend(t.sock, JSON.stringify({ t: 'closed', reason: m.act === 'ban' ? 'Zostałeś(-aś) zbanowany(-a)' : 'Zostałeś(-aś) wyrzucony(-a)' })); try { t.sock.end(); } catch {} }
        sendUsers(r);
        return sys(r, `${tm.name} ${m.act === 'ban' ? 'został(a) zbanowany(-a)' : 'został(a) wyrzucony(-a)'} przez ${by}`);
      }
      if (m.act === 'mute') r.muted.add(m.uid);
      else if (m.act === 'unmute') r.muted.delete(m.uid);
      else if (m.act === 'promote' && canHost(r, c)) r.mods.add(m.uid);
      else if (m.act === 'demote' && canHost(r, c)) r.mods.delete(m.uid);
      return sendUsers(r);
    }
    case 'room': {
      if (m.act === 'topic' && canMod(r, c)) { r.topic = clip(m.value, 140); broadcast(r, { t: 'room', room: roomInfo(r) }); return sys(r, `${shownRole(r, c.id, false) === 'user' ? 'Moderator' : c.name} ustawił(a) temat: ${r.topic || '(brak)'}`); }
      if (!canHost(r, c)) return;   // poniżej: uprawnienia hosta (twórcy) i admina
      const upd = () => broadcast(r, { t: 'room', room: roomInfo(r) });
      if (m.act === 'slow') { r.slow = Math.max(0, Math.min(300, parseInt(m.value, 10) || 0)); return upd(); }
      if (m.act === 'password') { r.password = clip(m.value, 64); return upd(); }
      if (m.act === 'rename') { const n = clip(m.value, 40).trim(); if (n) { r.name = n; upd(); } return; }
      if (m.act === 'lock') { r.joinLock = !!m.value; return upd(); }
      if (m.act === 'limit') { r.maxUsers = Math.max(0, Math.min(500, parseInt(m.value, 10) || 0)); return upd(); }
      if (m.act === 'public') { r.isPublic = !!m.value; return upd(); }
      if (m.act === 'clear') { r.history = []; broadcast(r, { t: 'cleared' }); return sys(r, 'Historia czatu została wyczyszczona'); }
      if (m.act === 'bans' || m.act === 'unban') {
        if (m.act === 'unban') { const k = clip(m.uid, 16); r.bans.delete(k); delete r.banNames[k]; }
        return wsSend(c.sock, JSON.stringify({ t: 'bans', list: [...r.bans].map(id => ({ id, name: r.banNames[id] || 'Użytkownik ' + id })) }));
      }
      if (m.act === 'close') return closeRoom(r);
      if (m.act === 'icon') { // ikona pokoju (jak ikona serwera): obraz z mediów tego pokoju albo '' = usuń
        const u = m.value === '' ? '' : validUrl(r, m.value);
        if (u === '' || (u && u.startsWith('/media/'))) { r.icon = u; upd(); }
        return;
      }
      if (m.act === 'sticker' ) { const u = validUrl(r, m.value); if (u && u.startsWith('/media/') && !r.stickers.includes(u) && r.stickers.length < 60) { r.stickers.push(u); upd(); } return; }
      return;
    }
  }
}

// ---------- GIF-y bez klucza: wbudowana paczka (własne animacje generowane programowo) + wyszukiwarka warstwowa ----------
// Warstwy: 1) paczka wbudowana – działa zawsze, także bez internetu; 2) nekos.best (darmowe reakcje, bez klucza);
// 3) Wikimedia Commons (dowolne hasło, bez klucza); 4) Giphy – tylko jeśli admin wpisał własny klucz.
const GIFW = 160, GIFH = 160;
const GPAL = []; const GC = {};   // paleta (64 kolory) i nazwy kolorów
(function () {
  const add = (n, hex) => { GC[n] = GPAL.length; GPAL.push([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))); };
  const mix = (hex, t, to) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + parseInt(to.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
  add('bg', '#1e1f22'); add('white', '#ffffff');
  const base = { blue: '#5865f2', pink: '#eb459e', green: '#23a55a', red: '#f23f43', orange: '#faa81a', cyan: '#00a8fc', purple: '#9b59b6', teal: '#1abc9c' };
  for (const k in base) add(k, base[k]);
  for (const k in base) add(k + 'D', mix(base[k], .6, '#000000'));
  for (const k in base) add(k + 'L', mix(base[k], .5, '#ffffff'));
  for (let i = 0; i < 12; i++) { const h = i * 30 / 360, f = n => { const k = (n + h * 12) % 12; return Math.round(255 * (.5 - .5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; add('r' + i, '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('')); }
  add('g1', '#2b2d31'); add('g2', '#3f4147'); add('g3', '#949ba4'); add('gold', '#ffd43b'); add('skin', '#f5c9a0');
  while (GPAL.length < 64) GPAL.push([0, 0, 0]);
})();
// czcionka pikselowa 5x7 (tylko litery potrzebne do haseł w paczce)
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'], E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'], J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'], S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'], U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'], X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'], '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
};
const GB = {   // proste narzędzia rysowania na buforze indeksów palety
  mk: c => new Uint8Array(GIFW * GIFH).fill(c),
  px(b, x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < GIFW && y < GIFH) b[y * GIFW + x] = c; },
  rect(b, x, y, w, h, c) { for (let j = Math.max(0, Math.round(y)); j < Math.min(GIFH, Math.round(y + h)); j++) for (let i = Math.max(0, Math.round(x)); i < Math.min(GIFW, Math.round(x + w)); i++) b[j * GIFW + i] = c; },
  disc(b, cx, cy, r, c) { for (let j = Math.floor(cy - r); j <= cy + r; j++) for (let i = Math.floor(cx - r); i <= cx + r; i++) if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) GB.px(b, i, j, c); },
  ring(b, cx, cy, r, t, c) { const o = (r + t / 2) ** 2, n = (r - t / 2) ** 2; for (let j = Math.floor(cy - r - t); j <= cy + r + t; j++) for (let i = Math.floor(cx - r - t); i <= cx + r + t; i++) { const d = (i - cx) ** 2 + (j - cy) ** 2; if (d <= o && d >= n) GB.px(b, i, j, c); } },
  line(b, x0, y0, x1, y1, t, c) { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let i = 0; i <= n; i++) GB.disc(b, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, t / 2, c); },
  text(b, word, cx, cy, sc, color, dy) {
    const w = (word.length * 6 - 1) * sc, x0 = Math.round(cx - w / 2), y0 = Math.round(cy - 3.5 * sc);
    for (let i = 0; i < word.length; i++) { const g = FONT[word[i]]; if (!g) continue; const oy = dy ? dy(i) : 0, col = typeof color === 'function' ? color(i) : color;
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r][c] === '#') { GB.rect(b, x0 + (i * 6 + c) * sc + sc * .55, y0 + r * sc + oy + sc * .55, sc, sc, GC.g2); GB.rect(b, x0 + (i * 6 + c) * sc, y0 + r * sc + oy, sc, sc, col); } }
  },
};
const rb = i => GC['r' + (((i % 12) + 12) % 12)];
const SN = Math.sin, PI2 = Math.PI * 2;
// każda animacja: [id, tytuł, słowa kluczowe, funkcja rysująca klatkę (t∈[0,1), i)]
const GANIMS = [
  ['gg', 'GG', 'gg dobra gra wygrana brawo gratulacje', (b, t) => { const y = 98 - Math.abs(SN(t * Math.PI * 2)) * 34; GB.text(b, 'GG', 80, y, 10, t < .5 ? GC.green : GC.white); for (let k = 0; k < 6; k++) GB.px(b, 20 + k * 24 + ((t * 8) | 0) % 5, 30 + (k * 37) % 60, GC.gold); }],
  ['lol', 'LOL', 'lol haha smiech xd rotfl', (b, t, i) => { GB.text(b, 'LOL', 80 + SN(t * PI2 * 3) * 8, 80 + SN(t * PI2 * 6) * 3, 8, i % 2 ? GC.gold : GC.orange); }],
  ['ok', 'OK', 'ok okej dobrze zgoda super', (b, t) => { GB.ring(b, 80, 80, 66 + SN(t * PI2) * 5, 6, GC.green); GB.text(b, 'OK', 80, 80, 9 + Math.round(SN(t * PI2)), GC.white); }],
  ['tak', 'TAK', 'tak yes zgoda pewnie jasne', (b, t, i) => { b.fill(i % 2 ? GC.greenD : GC.bg); GB.text(b, 'TAK', 80, 80 + SN(t * PI2) * 5, 8, i % 2 ? GC.white : GC.greenL); }],
  ['nie', 'NIE', 'nie no nope nigdy stop', (b, t, i) => { b.fill(i % 2 ? GC.redD : GC.bg); GB.text(b, 'NIE', 80 + (i % 2 ? 9 : -9), 80, 8, i % 2 ? GC.white : GC.redL); }],
  ['wow', 'WOW', 'wow ooo zdziwienie szok niesamowite', (b, t, i) => { for (let k = 0; k < 3; k++) GB.ring(b, 80, 80, ((t + k / 3) % 1) * 85, 5, rb(k * 4 + i)); GB.text(b, 'WOW', 80, 80, 8, k => rb(k * 3 + i)); }],
  ['hej', 'HEJ', 'hej czesc siema hello hi witaj', (b, t) => { GB.text(b, 'HEJ', 80, 82, 8, GC.cyanL, k => SN(t * PI2 + k * 1.4) * 14); }],
  ['xd', 'XD', 'xd smiech lol rotfl', (b, t) => { const s = 10 + Math.round(SN(t * PI2)); GB.text(b, 'XD', 80, 76, s, GC.gold); for (let k = 0; k < 3; k++) { const y = 112 + ((t + k / 3) % 1) * 40; GB.disc(b, 36 + k * 44, y, 4, GC.cyan); } }],
  ['brawo', 'BRAWO', 'brawo gratulacje gratki super party impreza konfetti', (b, t) => { for (let k = 0; k < 26; k++) { const x = (k * 37) % 160, y = ((k * 53) + t * 160 * (1 + (k % 3) * .5)) % 160; GB.rect(b, x, y, 5, 5, rb(k)); } GB.text(b, 'BRAWO', 80, 80, 5, GC.white, k => SN(t * PI2 + k) * 4); }],
  ['serce', 'Serce', 'serce milosc love kocham heart', (b, t) => { const s = 1 + .13 * SN(t * PI2), f = (px, py, k) => { const nx = (px - 80) / (46 * k), ny = -(py - 78) / (46 * k); return (nx * nx + ny * ny - 1) ** 3 - nx * nx * ny ** 3 <= 0; };
    for (let y = 0; y < GIFH; y++) for (let x = 0; x < GIFW; x++) if (f(x, y, s)) b[y * GIFW + x] = GC.red;
    GB.disc(b, 80 - 22 * s, 78 - 22 * s, 7, GC.pinkL); }],
  ['taniec', 'Taniec', 'taniec tanczy dance impreza disco', (b, t, i) => {
    const w = t * PI2, bob = Math.abs(SN(w)) * 6, hx = 80, hy = 52 - bob, sx = 80, sy = 70 - bob, hipY = 104 - bob;
    for (let k = 0; k < 5; k++) GB.disc(b, 16 + k * 32, 12, 8, i % 2 ? rb(k * 2) : rb(k * 2 + 6));
    GB.disc(b, hx, hy, 12, GC.skin); GB.line(b, sx, sy, sx, hipY, 6, GC.blueL);
    const arm = (a) => [sx + 30 * SN(a), sy - 30 * Math.cos(a)]; const a1 = -2.2 + .9 * SN(w), a2 = 2.2 - .9 * SN(w);
    let e = arm(a1); GB.line(b, sx, sy, e[0], e[1], 5, GC.skin); e = arm(a2); GB.line(b, sx, sy, e[0], e[1], 5, GC.skin);
    GB.line(b, sx, hipY, sx - 16 + 14 * SN(w), 142, 6, GC.blueL); GB.line(b, sx, hipY, sx + 16 + 14 * SN(w + Math.PI), 142, 6, GC.blueL); GB.rect(b, 0, 146, 160, 14, GC.g2); }],
  ['fajerwerki', 'Fajerwerki', 'fajerwerki sylwester swietowanie party noc', (b, t) => { const C = [[48, 62], [112, 48], [82, 100]]; C.forEach(([cx, cy], k) => { const p = (t + k / 3) % 1; for (let j = 0; j < 16; j++) { const a = j / 16 * PI2, r = p * 44; GB.disc(b, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.2 - p * 2, p < .65 ? rb(k * 4 + j) : GC.g3); } GB.disc(b, cx, cy + 40 * (1 - Math.min(1, p * 3)) , 2, GC.white); }); }],
  ['super', 'SUPER', 'super swietnie rewelacja cool', (b, t, i) => { b.fill(i % 2 ? GC.g1 : GC.bg); GB.text(b, 'SUPER', 80, 80, 5, i % 3 === 0 ? GC.white : i % 3 === 1 ? GC.cyan : GC.cyanL); for (let k = 0; k < 7; k++) GB.px(b, (k * 53 + i * 11) % 160, (k * 29 + i * 7) % 160, GC.gold); }],
  ['omg', 'OMG', 'omg o boze szok niemozliwe', (b, t, i) => { b.fill(GC.purpleD); GB.text(b, 'OMG', 80 + (i % 2 ? 4 : -4), 80, 8 + Math.round(SN(t * PI2) * 1.2), i % 2 ? GC.white : GC.pinkL); }],
  ['pytanie', '?!', 'pytanie co jak dlaczego huh nie rozumiem', (b, t) => { GB.text(b, '?!', 80, 98 - Math.abs(SN(t * PI2)) * 26, 12, GC.orange); }],
];
function gifLzw(minCode, idx) {   // kompresja LZW zgodna z GIF (wariant jak w omggif)
  const clear = 1 << minCode, eoi = clear + 1; let size = minCode + 1, next = eoi + 1, cur = 0, curBits = 0; const out = [], table = new Map();
  const emit = code => { cur |= code << curBits; curBits += size; while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; } };
  emit(clear); let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (prefix << 8) | k, hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); table.clear(); next = eoi + 1; size = minCode + 1; }
    else { if (next >= (1 << size)) size++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix); emit(eoi); if (curBits > 0) out.push(cur & 255);
  return out;
}
function gifEncode(frames, delayCs) {
  const bits = 6, parts = [Buffer.from('GIF89a'), Buffer.from([GIFW & 255, GIFW >> 8, GIFH & 255, GIFH >> 8, 0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0]), Buffer.from(GPAL.flat()),
    Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0, 0, 0])];
  for (const f of frames) {
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x04, delayCs & 255, delayCs >> 8, 0, 0, 0x2c, 0, 0, 0, 0, GIFW & 255, GIFW >> 8, GIFH & 255, GIFH >> 8, 0, bits]));
    const data = gifLzw(bits, f);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); parts.push(Buffer.from([n]), Buffer.from(data.slice(i, i + n))); }
    parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}
let GP_CACHE = null;
function gifPack() {   // generowane przy pierwszym użyciu (ok. sekundy), potem z pamięci
  if (GP_CACHE) return GP_CACHE;
  GP_CACHE = new Map();
  for (const [id, title, tags, draw] of GANIMS) {
    const N = 14, frames = []; for (let i = 0; i < N; i++) { const b = GB.mk(GC.bg); draw(b, i / N, i); frames.push(b); }
    GP_CACHE.set(id, { id, title, tags, buf: gifEncode(frames, 7) });
  }
  return GP_CACHE;
}
const gifPackHas = id => GANIMS.some(a => a[0] === id);
const noDiac = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');

// kategorie nekos.best (59 GIF-ów reakcji, darmowe, bez klucza) i polskie/angielskie słowa kluczowe
const NEKO = {
  hug: 'przytul przytulas hug', cuddle: 'przytul tul cuddle', pat: 'poglaszcz glaszcz pat', dance: 'taniec tanczy dance', laugh: 'smiech smieje haha lol laugh',
  happy: 'szczesliwy radosc cieszy happy', smile: 'usmiech smile', wave: 'czesc hej siema machanie wave hello hi', thumbsup: 'ok kciuk dobrze thumbsup like',
  facepalm: 'facepalm porazka', cry: 'placz smutek smutny cry', clap: 'brawo oklaski klaskanie clap', shrug: 'wzruszenie shrug', nope: 'nie nope nigdy', nod: 'tak nod kiwa zgoda',
  highfive: 'piatka highfive', handshake: 'uscisk handshake zgoda', slap: 'policzek slap', bonk: 'bonk', angry: 'zly zlosc angry wsciekly', pout: 'foch pout dasa',
  blush: 'rumieniec blush wstyd', wink: 'mrugniecie wink', shocked: 'szok shocked zdziwienie wow', confused: 'zdezorientowany confused', think: 'mysli hmm think',
  sleep: 'spi sleep spanie', yawn: 'ziewanie yawn', bored: 'nuda bored', salute: 'salut salute', blowkiss: 'buziak calus blowkiss', kiss: 'calus kiss', run: 'bieg biegnie run',
  spin: 'obrot spin', tableflip: 'tableflip', yeet: 'yeet rzut', stare: 'patrzy stare', smug: 'smug zadowolony', teehee: 'teehee chichot', bleh: 'bleh jezyk', sip: 'sip herbata',
  nom: 'nom je', bite: 'bite gryzie', poke: 'poke szturchniecie', tickle: 'tickle lechtanie', feed: 'feed karmi', kick: 'kick kopniecie', punch: 'punch', shoot: 'shoot strzal',
  lurk: 'lurk podglada', handhold: 'handhold', baka: 'baka glupek', nya: 'nya kot',
};
const NEKO_DEFAULT = ['hug', 'pat', 'dance', 'laugh', 'happy', 'wave', 'thumbsup', 'facepalm', 'cry', 'clap', 'highfive', 'shocked'];
const gifCache = new Map();
async function jget(url) { const r = await fetch(url, { headers: { 'user-agent': 'LanChat/' + VERSION }, signal: AbortSignal.timeout(5500) }); if (!r.ok) throw new Error(r.status); return r.json(); }
async function gifSearch(q) {
  const nq = noDiac(q).trim(), key = nq, hit = gifCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60000) return hit.res;
  const tokens = nq.split(/[^a-z0-9?!]+/).filter(Boolean);
  const results = [];
  for (const g of gifPack().values()) if (!tokens.length || tokens.some(t => noDiac(g.tags + ' ' + g.title).split(' ').some(w => w === t || (t.length >= 3 && w.startsWith(t))))) results.push({ url: `/gifpack/${g.id}.gif`, thumb: `/gifpack/${g.id}.gif`, title: g.title, src: 'local' });
  const cats = tokens.length ? Object.keys(NEKO).filter(k => tokens.some(t => t === k || NEKO[k].split(' ').some(w => w === t || (t.length >= 4 && w.startsWith(t))))).slice(0, 4) : NEKO_DEFAULT;
  const jobs = cats.map(c => jget(`https://nekos.best/api/v2/${c}?amount=${tokens.length ? (cats.length > 1 ? 8 : 20) : 3}`).then(j => j.results.map(x => ({ url: x.url, thumb: x.url, title: x.anime_name || c, src: 'nekos' }))));
  if (tokens.length && !cats.length) jobs.push(jget(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap mime:image/gif')}&gsrnamespace=6&gsrlimit=16&prop=imageinfo&iiprop=url&iiurlwidth=320&format=json`)
    .then(j => Object.values((j.query && j.query.pages) || {}).map(p => p.imageinfo && p.imageinfo[0]).filter(i => i && /^https:\/\/upload\.wikimedia\.org\//.test(i.thumburl || '')).map(i => ({ url: i.thumburl, thumb: i.thumburl, title: q, src: 'wiki' }))));
  if (settings.giphyKey) jobs.unshift(jget(`https://api.giphy.com/v1/gifs/${tokens.length ? 'search' : 'trending'}?api_key=${encodeURIComponent(settings.giphyKey)}&limit=24&rating=pg-13${tokens.length ? '&q=' + encodeURIComponent(q) : ''}`)
    .then(j => (j.data || []).map(g => ({ url: g.images.fixed_height.url, thumb: (g.images.fixed_height_small || g.images.fixed_height).url, title: g.title, src: 'giphy' }))));
  const settled = await Promise.allSettled(jobs), online = settled.filter(s => s.status === 'fulfilled').flatMap(s => s.value);
  const seen = new Set(), res = { results: [...(settings.giphyKey ? online.filter(o => o.src === 'giphy') : []), ...results, ...online.filter(o => o.src !== 'giphy')].filter(x => !seen.has(x.url) && seen.add(x.url)),
    offline: !!jobs.length && settled.every(s => s.status === 'rejected'), sources: [...new Set(online.map(o => o.src))] };
  if (!res.results.length && tokens.length) { const d = await gifSearch(''); return Object.assign({}, d, { fallback: true }); }   // zawsze coś pokaż
  if (!res.offline) { if (gifCache.size > 100) gifCache.delete(gifCache.keys().next().value); gifCache.set(key, { t: Date.now(), res }); }
  return res;
}

// ---------- discovery (UDP) ----------
function announce(r) { return { a: 'here', code: r.code, name: r.name, port: listenPort, locked: !!r.password, users: r.clients.size, host: settings.hostName, icon: r.icon || '' }; }
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
udp.on('error', () => {});
udp.on('message', (msg, rinfo) => {
  let m; try { m = JSON.parse(msg); } catch { return; }
  const reply = o => udp.send(Buffer.from(JSON.stringify(Object.assign({ n: m.n }, o))), rinfo.port, rinfo.address);
  if (m.q === 'find') { const r = rooms.get(normCode(m.code)); if (r) reply(announce(r)); }
  else if (m.q === 'list') for (const r of rooms.values()) if (r.isPublic) reply(announce(r));
});
function bcastTargets() {
  const t = new Set(['255.255.255.255', '127.0.0.1']);
  for (const i of lanIps()) {
    const ip = i.address.split('.').map(Number), mk = i.netmask.split('.').map(Number);
    t.add(ip.map((b, k) => (b | (~mk[k] & 255))).join('.'));
  }
  return [...t];
}
function discover(query, wantFirst, ms = 1200) {
  return new Promise(res => {
    const s = dgram.createSocket('udp4'), n = rid(4), found = [];
    let done = false;
    const fin = () => { if (done) return; done = true; try { s.close(); } catch {} res(found); };
    s.on('error', fin);
    s.on('message', (msg, rinfo) => {
      let m; try { m = JSON.parse(msg); } catch { return; }
      if (m.n !== n || m.a !== 'here') return;
      found.push({ ip: cleanIp(rinfo.address), port: m.port, code: m.code, name: m.name, locked: m.locked, users: m.users, host: m.host, icon: m.icon });
      if (wantFirst) fin();
    });
    s.bind(0, () => {
      try { s.setBroadcast(true); } catch {}
      const buf = Buffer.from(JSON.stringify(Object.assign({ n }, query)));
      for (const a of bcastTargets()) s.send(buf, DISC_PORT, a, () => {});
      setTimeout(fin, ms);
    });
  });
}

// ---------- HTTP ----------
function indexHtml() {
  if (sea) return sea.getAsset('index.html', 'utf8');
  return fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
}
const sendJson = (res, code, obj, extra) => { res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extra)); res.end(JSON.stringify(obj)); };
function readBody(req, limit) {
  return new Promise((ok, bad) => {
    const chunks = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > limit) { bad(new Error('too large')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', bad);
  });
}
const readJsonBody = async req => { try { return JSON.parse((await readBody(req, 65536)).toString('utf8') || '{}'); } catch { return {}; } };
function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'x-key, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
      return res.end(indexHtml());
    }
    if (p.startsWith('/media/')) {
      const mid = p.slice(7), m = /^[0-9a-f]{32}$/.test(mid) && media.get(mid);
      const buf = m ? await fs.promises.readFile(path.join(MEDIA_DIR, mid)).catch(() => null) : null;
      if (!buf) { res.writeHead(404, CORS); return res.end(); }
      res.writeHead(200, Object.assign({ 'content-type': m.type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'cross-origin' }, CORS));
      return res.end(buf);
    }
    if (p === '/api/account/password') {   // ustaw / zmień / usuń hasło (konto jest tworzone w tym samym kroku, jeśli jeszcze go nie ma)
      const secret = String(req.headers['x-account'] || '');
      if (!/^[\w-]{16,64}$/.test(secret)) return sendJson(res, 400, { error: 'id' });
      const id = accId(secret), ip = cleanIp(req.socket.remoteAddress), ua = req.headers['user-agent'] || '';
      if (req.method === 'DELETE') { if (accounts[id]) { delete accounts[id].auth; indexLogins(); saveAccounts(); } return sendJson(res, 200, { ok: true }); }
      if (req.method === 'POST') {
        const b = await readJsonBody(req), cur = accounts[id] && accounts[id].auth, login = String(b.login || (cur && cur.login) || '').toLowerCase().trim(), pw = String(b.password || '');
        if (!/^[a-z0-9_.-]{3,24}$/.test(login)) return sendJson(res, 400, { error: 'Nazwa konta: 3–24 znaki (małe litery, cyfry, kropka, myślnik, podkreślenie).' });
        if (pw.length < 6 || pw.length > 128) return sendJson(res, 400, { error: 'Hasło musi mieć od 6 do 128 znaków.' });
        const owner = logins.get(login); if (owner && owner !== id) return sendJson(res, 409, { error: 'Ta nazwa konta jest zajęta.' });
        if (!accounts[id]) {
          if (!b.profile || typeof b.profile !== 'object') return sendJson(res, 404, { error: 'Najpierw zapisz profil na serwerze.' });
          if (Object.keys(accounts).length >= 2000) return sendJson(res, 429, { error: 'Za dużo kont na tej instancji.' });
          accounts[id] = cleanAccount(b.profile, {}); accounts[id].secret = secret;
        }
        const salt = crypto.randomBytes(16); accounts[id].auth = { login, salt: salt.toString('hex'), hash: hashPw(pw, salt).toString('hex') };
        indexLogins(); noteSeen(secret, ip, ua, deviceHdr(req), accounts[id].name, 'password'); saveAccounts();
        return sendJson(res, 200, { ok: true, login });
      }
    }
    if (p === '/api/account/login' && req.method === 'POST') {   // logowanie nazwą konta i hasłem na dowolnym urządzeniu → zwraca tożsamość konta
      const b = await readJsonBody(req), ip = cleanIp(req.socket.remoteAddress), ua = req.headers['user-agent'] || '';
      if (throttled(ip)) return sendJson(res, 429, { error: 'Za dużo błędnych prób. Spróbuj za kilka minut.' });
      const login = String(b.login || '').toLowerCase().trim(), id = logins.get(login), a = id && accounts[id] && accounts[id].auth ? accounts[id] : null;
      const h = hashPw(String(b.password || '').slice(0, 128), a ? Buffer.from(a.auth.salt, 'hex') : DUMMY_SALT);   // ten sam koszt czasowy dla nieistniejącej nazwy
      if (!a || !crypto.timingSafeEqual(h, Buffer.from(a.auth.hash, 'hex'))) { failed(ip); return sendJson(res, 401, { error: 'Nieprawidłowa nazwa konta lub hasło.' }); }
      fails.delete(ip); noteSeen(a.secret, ip, ua, deviceHdr(req), a.name, 'password');
      return sendJson(res, 200, { secret: a.secret });
    }
    if (p === '/api/account/recognize' && req.method === 'GET') {   // konta „u admina”, które serwer kojarzy z IP odwiedzającego (zastępuje kody konta)
      const ip = cleanIp(req.socket.remoteAddress);
      const found = Object.entries(devices).filter(([id, rec]) => rec.method === 'server' && rec.ips[ip] && accounts[id] && accounts[id].secret)
        .sort((x, y) => y[1].last - x[1].last).slice(0, 5).map(([id, rec]) => ({ id, name: rec.name, device: (Object.values(rec.devices).sort((x, y) => y.last - x.last)[0] || {}).label || '', last: rec.last }));
      return sendJson(res, 200, { ip, found });
    }
    if (p === '/api/account/adopt' && req.method === 'POST') {      // „to ja”: wymaga zgodnego IP i potwierdzenia przez użytkownika
      const b = await readJsonBody(req), ip = cleanIp(req.socket.remoteAddress), id = clip(b.id, 40);
      if (!devices[id] || !devices[id].ips[ip] || !accounts[id] || !accounts[id].secret) return sendJson(res, 404, { error: 'Serwer nie kojarzy tego konta z Twoim IP.' });
      return sendJson(res, 200, { secret: accounts[id].secret });
    }
    if (p === '/api/seen') {   // tryb „w przeglądarce”: profil jest u użytkownika, serwer zapisuje tylko IP i urządzenie
      const secret = String(req.headers['x-account'] || '');
      if (!/^[\w-]{16,64}$/.test(secret)) return sendJson(res, 400, { error: 'id' });
      const ip = cleanIp(req.socket.remoteAddress), ua = req.headers['user-agent'] || '';
      if (req.method === 'POST') { const b = await readJsonBody(req); noteSeen(secret, ip, ua, deviceHdr(req), b.name, b.method === 'browser' ? 'browser' : b.method === 'base64' ? 'base64' : b.method === 'password' ? 'password' : 'server'); }
      const rec = devices[accId(secret)];   // przejrzystość: pokazujemy użytkownikowi dokładnie to, co zapisaliśmy
      return sendJson(res, 200, { ip, device: parseDevice(ua).label, record: rec ? { method: rec.method, first: rec.first, last: rec.last, ips: Object.entries(rec.ips).map(([k, t]) => ({ ip: k, last: t })), devices: Object.values(rec.devices) } : null });
    }
    if (p === '/api/account') {
      const secret = String(req.headers['x-account'] || '');
      if (!/^[\w-]{16,64}$/.test(secret)) return sendJson(res, 400, { error: 'id' });
      const id = accId(secret), ip = cleanIp(req.socket.remoteAddress), ua = req.headers['user-agent'] || '';
      if (req.method === 'GET') { if (accounts[id]) noteSeen(secret, ip, ua, deviceHdr(req), accounts[id].name, acctMethod(id)); const prof = accounts[id] ? Object.assign({}, accounts[id]) : null; if (prof) { delete prof.secret; prof.login = prof.auth && prof.auth.login; prof.hasPassword = !!prof.auth; delete prof.auth; } return sendJson(res, 200, { exists: !!accounts[id], profile: prof }); }
      if (req.method === 'DELETE') {   // usunięcie profilu z serwera; ?keepLog=1 zostawia tylko wpis IP/urządzenie (przejście na metodę „w przeglądarce”)
        delete accounts[id]; if (!u.searchParams.get('keepLog')) { delete devices[id]; saveDevices(); } saveAccounts();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const raw = await readBody(req, 170000).catch(() => null);
        if (!raw) return sendJson(res, 413, { error: 'too large' });
        let b = {}; try { b = JSON.parse(raw.toString('utf8')); } catch {}
        if (!accounts[id] && Object.keys(accounts).length >= 2000) return sendJson(res, 429, { error: 'Za dużo kont na tej instancji.' });
        accounts[id] = cleanAccount(b && typeof b === 'object' ? b : {}, accounts[id] || {});
        accounts[id].secret = secret;   // potrzebne do „to ja” (rozpoznanie po IP); plik leży tylko na dysku admina
        noteSeen(secret, ip, ua, deviceHdr(req), accounts[id].name, acctMethod(id));
        saveAccounts();
        return sendJson(res, 200, { ok: true });
      }
    }
    if (p === '/upload' && req.method === 'POST') {
      const c = uploadKeys.get(String(req.headers['x-key'] || ''));
      if (!c) return sendJson(res, 403, { error: 'key' }, CORS);
      const r = c.room, limit = settings.uploadLimitMB * 1048576;
      const buf = await readBody(req, limit).catch(() => null);
      if (!buf) return sendJson(res, 413, { error: 'too large' }, CORS);
      const type = sniff(buf);
      if (!type) return sendJson(res, 415, { error: 'type' }, CORS);
      if (r.mediaBytes + buf.length > 150 * 1048576) return sendJson(res, 507, { error: 'room full' }, CORS);
      const id = await storeMedia(r, buf, type);   // identyczny plik (np. awatar przy ponownym wejściu) nie jest zapisywany drugi raz
      return sendJson(res, 200, { url: '/media/' + id, type }, CORS);
    }
    if (p === '/download' || p === '/install.ps1' || p === '/install.sh') {
      const plat = sea && settings.serveInstaller ? process.platform : null;
      const hostH = String(req.headers.host || '');
      if (!plat || !/^[\w.:\[\]-]+$/.test(hostH)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Instalator niedostepny na tej instancji (uruchom spakowana wersje).'); }
      if (p === '/download') {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': fs.statSync(process.execPath).size, 'content-disposition': 'attachment; filename="lanchat' + (plat === 'win32' ? '.exe' : '') + '"' });
        return fs.createReadStream(process.execPath).pipe(res);
      }
      const url = 'http://' + hostH + '/download';
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      if (p === '/install.ps1') {
        if (plat !== 'win32') return res.end('Write-Host "Ten host dziala na innym systemie - uzyj install.sh"\r\n');
        return res.end([
          "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'",
          "$dir=Join-Path $env:LOCALAPPDATA 'LanChat'; New-Item -ItemType Directory -Force $dir | Out-Null",
          "$exe=Join-Path $dir 'lanchat.exe'",
          "Get-Process lanchat -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Milliseconds 300",
          "Write-Host 'Pobieram LanChat...'; Invoke-WebRequest '" + url + "' -OutFile $exe -UseBasicParsing",
          "try { $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\LanChat.lnk'); $s.TargetPath=$exe; $s.WorkingDirectory=$dir; $s.Save() } catch {}",
          "Start-Process $exe", ''].join('\r\n'));
      }
      if (plat === 'win32') return res.end('echo "Ten host dziala na Windows - uzyj w PowerShell: irm http://' + hostH + '/install.ps1 | iex"\n');
      const uname = plat === 'darwin' ? 'Darwin' : 'Linux';
      return res.end(['#!/bin/sh', 'set -e',
        '[ "$(uname -s)" = ' + uname + ' ] || { echo "Ten host dziala na innym systemie"; exit 1; }',
        'dir="$HOME/.local/bin"; mkdir -p "$dir"', 'curl -fsSL ' + url + ' -o "$dir/lanchat"', 'chmod +x "$dir/lanchat"',
        '[ "$(uname -s)" = Darwin ] && xattr -d com.apple.quarantine "$dir/lanchat" 2>/dev/null || true',
        'exec "$dir/lanchat"', ''].join('\n'));
    }
    if (p === '/api/me') {
      const admin = isAdminReq(req);
      return sendJson(res, 200, {
        version: VERSION, isAdmin: admin, adminToken: admin ? ADMIN_TOKEN : undefined,
        hostName: settings.hostName, canHost: admin || settings.allowLanHosting, giphy: !!settings.giphyKey,
        urls: lanIps().map(i => `http://${i.address}:${listenPort}`), uploadLimitMB: settings.uploadLimitMB, repo: REPO, ip: cleanIp(req.socket.remoteAddress), device: parseDevice(req.headers['user-agent']).label,
        serve: sea && settings.serveInstaller ? process.platform : null,
      });
    }
    if (p === '/api/online') { // wszyscy aktualnie połączeni z tym systemem (we wszystkich pokojach), bez duplikatów
      const secret = String(req.headers['x-account'] || ''), seen = new Map();
      for (const r of rooms.values()) for (const c of r.clients.values()) {   // admin jest incognito: żadnego znacznika roli, nawet przy sobie
        const prev = seen.get(c.cid);
        if (!prev) seen.set(c.cid, { name: c.name, color: c.color, avatar: c.avatar, bio: c.bio, status: c.status, self: !!secret && c.cid === secret });
        else if (!prev.avatar && c.avatar) prev.avatar = c.avatar;
      }
      const people = [...seen.values()].sort((a, b) => (b.self - a.self) || a.name.localeCompare(b.name, 'pl'));
      return sendJson(res, 200, { people });
    }
    if (p === '/api/resolve') {
      const code = normCode(u.searchParams.get('code'));
      const local = rooms.get(code);
      const hostName = String(req.headers.host || '').replace(/:\d+$/, '');
      if (local) return sendJson(res, 200, { ip: hostName, port: listenPort, name: local.name, locked: !!local.password });
      const found = await discover({ q: 'find', code }, true);
      if (!found.length) return sendJson(res, 404, { error: 'notfound' });
      const f = found[0], mine = isLoopIp(f.ip) || ownIps().has(f.ip);
      return sendJson(res, 200, { ip: mine ? hostName : f.ip, port: f.port, name: f.name, locked: f.locked });
    }
    if (p === '/api/nearby') {
      const found = await discover({ q: 'list' }, false, 1200);
      const hostName = String(req.headers.host || '').replace(/:\d+$/, ''), own = ownIps();
      // zapytanie idzie na kilka adresów rozgłoszeniowych naraz, więc ten sam pokój odpowiada wielokrotnie – zostaw jedną kopię
      const uniq = new Map();
      for (const f of found) { const k = f.code + ':' + f.port; if (!uniq.has(k)) uniq.set(k, Object.assign(f, { ip: isLoopIp(f.ip) || own.has(f.ip) ? hostName : f.ip })); }
      return sendJson(res, 200, [...uniq.values()]);
    }
    if (p === '/api/rooms' && req.method === 'POST') {
      const admin = isAdminReq(req);
      if (!admin && !settings.allowLanHosting) return sendJson(res, 403, { error: 'Admin wyłączył tworzenie pokoi dla gości.' });
      if (rooms.size >= settings.maxRooms) return sendJson(res, 429, { error: 'Limit pokoi osiągnięty.' });
      const b = await readJsonBody(req);
      const r = createRoom(b);
      return sendJson(res, 200, { code: r.code, hostKey: r.hostKey, name: r.name });
    }
    if (p === '/api/gif') return sendJson(res, 200, await gifSearch(u.searchParams.get('q') || ''));
    if (p.startsWith('/gifpack/')) {
      const g = gifPack().get(p.slice(9).replace(/.gif$/, ''));
      if (!g) { res.writeHead(404, CORS); return res.end(); }
      res.writeHead(200, Object.assign({ 'content-type': 'image/gif', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' }, CORS)); return res.end(g.buf);
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdminReq(req) || !safeEq(req.headers['x-admin'] || '', ADMIN_TOKEN)) return sendJson(res, 403, { error: 'forbidden' });
      const b = req.method === 'POST' ? await readJsonBody(req) : {};
      if (p === '/api/admin/state') {
        return sendJson(res, 200, {
          settings: { ...settings, giphyKey: settings.giphyKey ? '••••' + settings.giphyKey.slice(-4) : '' }, listenPort,
          autostart: { supported: autostartSupported(), on: autostartSupported() && fs.existsSync(STARTUP_LNK) },
          rooms: [...rooms.values()].map(r => ({ code: r.code, name: r.name, locked: !!r.password, isPublic: r.isPublic, created: r.created, mediaMB: +(r.mediaBytes / 1048576).toFixed(1),
            users: [...r.clients.values()].map(c => ({ id: c.id, name: c.name, ip: c.priv ? null : c.ip, priv: !!c.priv, role: realRole(r, c.id) })) })),
          people: Object.values(devices).sort((x, y) => y.last - x.last).slice(0, 100).map(d => ({ name: d.name, method: d.method, last: d.last, ips: Object.keys(d.ips), devices: Object.values(d.devices).map(v => v.label + (v.screen ? ' · ' + v.screen : '')) })),
        });
      }
      if (p === '/api/admin/settings') {
        for (const k of ['hostName', 'allowLanHosting', 'serveInstaller', 'maxRooms', 'maxUsersPerRoom', 'uploadLimitMB', 'openBrowser']) if (k in b) settings[k] = typeof settings[k] === 'number' ? Math.max(1, +b[k] || settings[k]) : typeof settings[k] === 'boolean' ? !!b[k] : clip(b[k], 40);
        if ('giphyKey' in b && !String(b.giphyKey).startsWith('••')) settings.giphyKey = clip(b.giphyKey, 80).trim();
        saveSettings(); return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/admin/autostart') { const ok = await setAutostart(!!b.on); return sendJson(res, 200, { ok, on: autostartSupported() && fs.existsSync(STARTUP_LNK) }); }
      if (p === '/api/admin/close') { const r = rooms.get(normCode(b.code)); if (r) closeRoom(r, 'Pokój zamknięty przez admina'); return sendJson(res, 200, { ok: true }); }
      if (p === '/api/admin/ban') {
        const ip = cleanIp(b.ip); if (ip && !isLoopIp(ip) && !settings.bannedIps.includes(ip)) settings.bannedIps.push(ip);
        for (const r of rooms.values()) for (const c of r.clients.values()) if (c.ip === ip) { wsSend(c.sock, JSON.stringify({ t: 'closed', reason: 'Zbanowany(-a) przez admina' })); try { c.sock.end(); } catch {} }
        saveSettings(); return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/admin/unban') { settings.bannedIps = settings.bannedIps.filter(x => x !== b.ip); saveSettings(); return sendJson(res, 200, { ok: true }); }
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    try { sendJson(res, 500, { error: 'server' }); } catch {}
  }
});

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || new URL(req.url, 'http://x').pathname !== '/ws') return sock.destroy();
  const ip = req.socket.remoteAddress, ua = String(req.headers['user-agent'] || '').slice(0, 300);
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  sock.setNoDelay(true);
  let alive = Date.now();
  const joinTimer = setTimeout(() => { if (!sock.client) sock.destroy(); }, 10000);
  const ping = setInterval(() => { if (Date.now() - alive > 75000) return sock.destroy(); if (!sock.destroyed) sock.write(Buffer.from([0x89, 0])); }, 25000);
  attachWs(sock, txt => {
    alive = Date.now();
    let m; try { m = JSON.parse(txt); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (!sock.client) { if (m.t === 'join') onJoin(sock, ip, m, ua); return; }
    handle(sock.client, m);
  }, () => { clearTimeout(joinTimer); clearInterval(ping); if (sock.client) onLeave(sock.client); });
  sock.on('data', () => { alive = Date.now(); });
});

// pokoje są trwałe – znikają tylko po zamknięciu przez hosta/admina
loadRooms();
const flush = () => { saveRoomsNow(); clearTimeout(accTimer); writeAtomic(ACC_FILE, JSON.stringify(accounts)); clearTimeout(devTimer); writeAtomic(DEV_FILE, JSON.stringify(devices)); };
process.on('exit', flush);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGHUP', () => process.exit(0)); // zamknięcie okna konsoli

// ---------- autostart (skrót w folderze Autostart użytkownika – bez UAC, tylko spakowany exe na Windows) ----------
const STARTUP_LNK = process.platform === 'win32' && process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'LanChat.lnk') : '';
const autostartSupported = () => !!(sea && STARTUP_LNK);
function setAutostart(on) {
  return new Promise(res => {
    if (!autostartSupported()) return res(false);
    if (!on) return fs.unlink(STARTUP_LNK, () => res(true));
    const q = s => "'" + s.replace(/'/g, "''") + "'";
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(STARTUP_LNK)});$s.TargetPath=${q(process.execPath)};$s.Arguments='--no-open';$s.WorkingDirectory=${q(path.dirname(process.execPath))};$s.WindowStyle=7;$s.Save()`;
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, err => res(!err));
  });
}

// ---------- start ----------
function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch {}
}
function start(port, tries) {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && tries < 20) start(port + 1, tries + 1);
    else { console.error('Nie można uruchomić serwera:', e.message); process.exit(1); }
  });
  server.listen(port, '0.0.0.0', () => {
    listenPort = port;
    udp.bind(DISC_PORT, '0.0.0.0', () => { try { udp.setBroadcast(true); } catch {} });
    console.log(`\n  LanChat ${VERSION}\n  Admin (to urządzenie):  http://localhost:${port}`);
    for (const i of lanIps()) console.log(`  Goście w LAN:           http://${i.address}:${port}`);
    console.log('\n  Dane: ' + DATA + '   |   Ctrl+C aby zakończyć\n');
    if (settings.openBrowser && !process.argv.includes('--no-open')) openBrowser(`http://localhost:${port}`);
  });
}
module.exports = { _rooms: rooms };
start(settings.port, 0);
process.on('uncaughtException', e => console.error('Błąd:', e.message));
