'use strict';
// LanChat – zero-dependency LAN chat. HTTP + WebSocket (hand-rolled) + UDP discovery.
const http = require('http'), dgram = require('dgram'), crypto = require('crypto');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFile } = require('child_process');

let sea = null;
try { const s = require('node:sea'); if (s.isSea()) sea = s; } catch {}

const VERSION = '0.2.0';
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
  }))));
}
function scheduleSave() { if (!roomsTimer) roomsTimer = setTimeout(saveRoomsNow, 500); }
function loadRooms() {
  let list = []; try { list = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')); } catch {}
  for (const j of Array.isArray(list) ? list : []) {
    if (!j || !/^[A-Z0-9]{4,12}$/.test(j.code)) continue;
    const r = Object.assign({ name: j.code, password: '', isPublic: false, created: Date.now(), history: [], stickers: [], mediaBytes: 0, topic: '', slow: 0, mediaTypes: {}, hashes: {} }, j,
      { clients: new Map(), bans: new Set(j.bans), muted: new Set(j.muted), mods: new Set(j.mods) });
    rooms.set(r.code, r);
    for (const [id, type] of Object.entries(r.mediaTypes || {})) if (fs.existsSync(path.join(MEDIA_DIR, id))) media.set(id, { room: r.code, type });
  }
}
const accId = secret => crypto.createHash('sha256').update('lc|' + secret).digest('hex').slice(0, 32);
const cleanAddr = a => clip(a, 80).replace(/[^\w.:\[\]-]/g, '');
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
function createRoom({ name, password, isPublic }) {
  const code = newCode();
  const r = {
    code, name: clip(name, 40) || 'Pokój ' + code, password: clip(password, 64), isPublic: !!isPublic,
    hostKey: rid(16), created: Date.now(), clients: new Map(), history: [], bans: new Set(),
    muted: new Set(), mods: new Set(), stickers: [], mediaBytes: 0, topic: '', slow: 0, mediaTypes: {}, hashes: {},
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
const roleOf = (r, c) => c.isAdmin ? 'admin' : c.isHost ? 'host' : r.mods.has(c.id) ? 'mod' : 'user';
const canMod = (r, c) => ['admin', 'host', 'mod'].includes(roleOf(r, c));
const canHost = (r, c) => c.isAdmin || c.isHost;
const publicUser = (r, c) => ({ id: c.id, name: c.name, color: c.color, role: roleOf(r, c), muted: r.muted.has(c.id), avatar: c.avatar, bio: c.bio, status: c.status });
function broadcast(r, obj, except) {
  const s = JSON.stringify(obj);
  for (const c of r.clients.values()) if (c !== except) wsSend(c.sock, s);
}
const sendUsers = r => broadcast(r, { t: 'users', users: [...r.clients.values()].map(c => publicUser(r, c)) });
function sys(r, text) {
  const m = { id: rid(6), kind: 'sys', text, ts: Date.now() };
  r.history.push(m); if (r.history.length > 500) r.history.shift();
  broadcast(r, { t: 'msg', m });
  scheduleSave();
}
const roomInfo = r => ({ code: r.code, name: r.name, topic: r.topic, slow: r.slow, locked: !!r.password, stickers: r.stickers, icon: r.icon || '' });

function onJoin(sock, ip, m) {
  const err = code => { wsSend(sock, JSON.stringify({ t: 'error', code })); sock.end(); };
  const r = rooms.get(normCode(m.room));
  if (!r) return err('notfound');
  const cid = clip(m.cid, 64).replace(/[^\w-]/g, '') || rid(8);
  const id = crypto.createHash('sha1').update(cid + r.code).digest('hex').slice(0, 8);
  const isAdmin = !!m.adminToken && safeEq(m.adminToken, ADMIN_TOKEN);
  const isHost = !!m.hostKey && safeEq(m.hostKey, r.hostKey);
  if (!isAdmin && (r.bans.has(id) || settings.bannedIps.includes(cleanIp(ip)))) return err('banned');
  if (!isAdmin && !isHost && r.password && !safeEq(m.password || '', r.password)) return err('password');
  const old = r.clients.get(id);
  if (!old && r.clients.size >= settings.maxUsersPerRoom && !isAdmin) return err('full');
  if (old) { wsSend(old.sock, JSON.stringify({ t: 'closed', reason: 'Połączono z innej karty' })); try { old.sock.end(); } catch {} }
  const c = {
    id, cid, sock, ip: cleanIp(ip), room: r, isAdmin, isHost, joined: Date.now(),
    name: clip(m.name, 24).trim() || 'Gość', color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#5b8def',
    uploadKey: rid(16), stamps: [], lastMsg: 0, avatar: '', bio: clip(m.bio, 190),
    status: ['online', 'idle', 'dnd'].includes(m.status) ? m.status : 'online',
  };
  uploadKeys.set(c.uploadKey, c);
  r.clients.set(id, c);
  sock.client = c;
  wsSend(sock, JSON.stringify({
    t: 'joined', you: publicUser(r, c), uploadKey: c.uploadKey, room: roomInfo(r),
    users: [...r.clients.values()].map(x => publicUser(r, x)), history: r.history,
  }));
  sendUsers(r);
  if (!old) sys(r, `${c.name} dołączył(a)`);
}
function onLeave(c) {
  const r = c.room;
  uploadKeys.delete(c.uploadKey);
  if (r.clients.get(c.id) === c) {
    r.clients.delete(c.id);
    sendUsers(r);
    sys(r, `${c.name} wyszedł(-ła)`);
  }
}

function validUrl(r, u) {
  u = clip(u, 600);
  if (/^\/media\/[0-9a-f]{32}$/.test(u)) { const m = media.get(u.slice(7)); return m && m.room === r.code ? u : null; }
  return /^https?:\/\/[^\s<>"']{4,}$/i.test(u) ? u : null;
}
function post(c, m) {
  const r = c.room, now = Date.now();
  if (r.muted.has(c.id)) return wsSend(c.sock, JSON.stringify({ t: 'notice', text: 'Jesteś wyciszony(-a).' }));
  c.stamps = c.stamps.filter(t => now - t < 5000);
  if (c.stamps.length >= 8) return wsSend(c.sock, JSON.stringify({ t: 'notice', text: 'Zwolnij – za dużo wiadomości.' }));
  if (r.slow && !canMod(r, c) && now - c.lastMsg < r.slow * 1000)
    return wsSend(c.sock, JSON.stringify({ t: 'notice', text: `Tryb powolny: ${r.slow}s między wiadomościami.` }));
  const msg = { id: rid(6), uid: c.id, name: c.name, color: c.color, avatar: c.avatar, role: roleOf(r, c), ts: now, kind: m.t === 'msg' ? 'text' : m.t };
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
    case 'msg': case 'gif': case 'img': case 'sticker': return post(c, m);
    case 'typing': return broadcast(r, { t: 'typing', uid: c.id, name: c.name }, c);
    case 'profile': {
      if ('name' in m) c.name = clip(m.name, 24).trim() || c.name;
      if (/^#[0-9a-f]{6}$/i.test(m.color)) c.color = m.color;
      if ('bio' in m) c.bio = clip(m.bio, 190);
      if (['online', 'idle', 'dnd'].includes(m.status)) c.status = m.status;
      if ('avatar' in m) {
        const u = clip(m.avatar, 100), med = /^\/media\/[0-9a-f]{32}$/.test(u) && media.get(u.slice(7));
        if (u === '') c.avatar = ''; else if (med && med.room === r.code) c.avatar = u;
      }
      return sendUsers(r);
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
    case 'mod': { // kick | ban | mute | unmute | promote | demote
      if (!canMod(r, c)) return;
      const t = r.clients.get(m.uid); if (!t || t === c) return;
      const tr = roleOf(r, t);
      if (tr === 'admin' || tr === 'host') return;
      if (tr === 'mod' && !canHost(r, c)) return;
      if (m.act === 'kick' || m.act === 'ban') {
        if (m.act === 'ban') r.bans.add(t.id);
        wsSend(t.sock, JSON.stringify({ t: 'closed', reason: m.act === 'ban' ? 'Zostałeś(-aś) zbanowany(-a)' : 'Zostałeś(-aś) wyrzucony(-a)' }));
        try { t.sock.end(); } catch {}
        return sys(r, `${t.name} ${m.act === 'ban' ? 'został(a) zbanowany(-a)' : 'został(a) wyrzucony(-a)'} przez ${c.name}`);
      }
      if (m.act === 'mute') r.muted.add(t.id);
      else if (m.act === 'unmute') r.muted.delete(t.id);
      else if (m.act === 'promote' && canHost(r, c)) r.mods.add(t.id);
      else if (m.act === 'demote' && canHost(r, c)) r.mods.delete(t.id);
      return sendUsers(r);
    }
    case 'room': {
      if (m.act === 'topic' && canMod(r, c)) { r.topic = clip(m.value, 140); broadcast(r, { t: 'room', room: roomInfo(r) }); return sys(r, `${c.name} ustawił(a) temat: ${r.topic || '(brak)'}`); }
      if (!canHost(r, c)) return;
      if (m.act === 'slow') { r.slow = Math.max(0, Math.min(300, parseInt(m.value, 10) || 0)); return broadcast(r, { t: 'room', room: roomInfo(r) }); }
      if (m.act === 'password') { r.password = clip(m.value, 64); return broadcast(r, { t: 'room', room: roomInfo(r) }); }
      if (m.act === 'close') return closeRoom(r);
      if (m.act === 'icon') { // ikona pokoju (jak ikona serwera): obraz z mediów tego pokoju albo '' = usuń
        const u = m.value === '' ? '' : validUrl(r, m.value);
        if (u === '' || (u && u.startsWith('/media/'))) { r.icon = u; broadcast(r, { t: 'room', room: roomInfo(r) }); }
        return;
      }
      if (m.act === 'sticker' ) { const u = validUrl(r, m.value); if (u && u.startsWith('/media/') && !r.stickers.includes(u) && r.stickers.length < 60) { r.stickers.push(u); broadcast(r, { t: 'room', room: roomInfo(r) }); } return; }
      return;
    }
  }
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
    if (p === '/api/account') {
      const secret = String(req.headers['x-account'] || '');
      if (!/^[\w-]{16,64}$/.test(secret)) return sendJson(res, 400, { error: 'id' });
      const id = accId(secret);
      if (req.method === 'GET') return sendJson(res, 200, { exists: !!accounts[id], profile: accounts[id] || null });
      if (req.method === 'PUT' || req.method === 'POST') {
        const raw = await readBody(req, 170000).catch(() => null);
        if (!raw) return sendJson(res, 413, { error: 'too large' });
        let b = {}; try { b = JSON.parse(raw.toString('utf8')); } catch {}
        if (!accounts[id] && Object.keys(accounts).length >= 2000) return sendJson(res, 429, { error: 'Za dużo kont na tej instancji.' });
        accounts[id] = cleanAccount(b && typeof b === 'object' ? b : {}, accounts[id] || {});
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
      const hash = crypto.createHash('sha1').update(buf).digest('hex');
      let id = r.hashes[hash];
      if (!id || !media.has(id)) { // identyczny plik (np. awatar przy ponownym wejściu) nie jest zapisywany drugi raz
        id = rid(16);
        await fs.promises.writeFile(path.join(MEDIA_DIR, id), buf);
        media.set(id, { room: r.code, type }); r.mediaTypes[id] = type; r.hashes[hash] = id; r.mediaBytes += buf.length;
        scheduleSave();
      }
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
        urls: lanIps().map(i => `http://${i.address}:${listenPort}`), uploadLimitMB: settings.uploadLimitMB,
        serve: sea && settings.serveInstaller ? process.platform : null,
      });
    }
    if (p === '/api/online') { // wszyscy aktualnie połączeni z tym systemem (we wszystkich pokojach), bez duplikatów
      const secret = String(req.headers['x-account'] || ''), seen = new Map();
      for (const r of rooms.values()) for (const c of r.clients.values()) {
        const prev = seen.get(c.cid);
        if (!prev) seen.set(c.cid, { name: c.name, color: c.color, avatar: c.avatar, bio: c.bio, status: c.status, admin: c.isAdmin, self: !!secret && c.cid === secret });
        else { if (!prev.avatar && c.avatar) prev.avatar = c.avatar; if (c.isAdmin) prev.admin = true; }
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
    if (p === '/api/gif') {
      if (!settings.giphyKey) return sendJson(res, 200, { results: [], nokey: true });
      const q = u.searchParams.get('q');
      const url = `https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?api_key=${encodeURIComponent(settings.giphyKey)}&limit=24&rating=pg-13${q ? '&q=' + encodeURIComponent(q) : ''}`;
      try {
        const j = await (await fetch(url, { signal: AbortSignal.timeout(6000) })).json();
        return sendJson(res, 200, { results: (j.data || []).map(g => ({ url: g.images.fixed_height.url, thumb: g.images.fixed_height_small ? g.images.fixed_height_small.url : g.images.fixed_height.url, title: g.title })) });
      } catch { return sendJson(res, 200, { results: [], offline: true }); }
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdminReq(req) || !safeEq(req.headers['x-admin'] || '', ADMIN_TOKEN)) return sendJson(res, 403, { error: 'forbidden' });
      const b = req.method === 'POST' ? await readJsonBody(req) : {};
      if (p === '/api/admin/state') {
        return sendJson(res, 200, {
          settings: { ...settings, giphyKey: settings.giphyKey ? '••••' + settings.giphyKey.slice(-4) : '' }, listenPort,
          autostart: { supported: autostartSupported(), on: autostartSupported() && fs.existsSync(STARTUP_LNK) },
          rooms: [...rooms.values()].map(r => ({ code: r.code, name: r.name, locked: !!r.password, isPublic: r.isPublic, created: r.created, mediaMB: +(r.mediaBytes / 1048576).toFixed(1),
            users: [...r.clients.values()].map(c => ({ id: c.id, name: c.name, ip: c.ip, role: roleOf(r, c) })) })),
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
  const ip = req.socket.remoteAddress;
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
    if (!sock.client) { if (m.t === 'join') onJoin(sock, ip, m); return; }
    handle(sock.client, m);
  }, () => { clearTimeout(joinTimer); clearInterval(ping); if (sock.client) onLeave(sock.client); });
  sock.on('data', () => { alive = Date.now(); });
});

// pokoje są trwałe – znikają tylko po zamknięciu przez hosta/admina
loadRooms();
const flush = () => { saveRoomsNow(); clearTimeout(accTimer); writeAtomic(ACC_FILE, JSON.stringify(accounts)); };
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
