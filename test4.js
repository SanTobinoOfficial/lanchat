// Testy metody „hasło” (nazwa konta + hasło, skrót scrypt, blokada prób):  node test4.js
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path'), fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test4_' + Date.now()), B = 'http://localhost:7777';
const start = () => spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME } });
const stop = p => new Promise(r => { p.once('exit', r); p.kill(); setTimeout(r, 1500); });
const UA = { win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
let passed = 0; const ok = (c, msg) => { assert(c, msg); passed++; console.log('PASS ' + msg); };
const S1 = 'pwd1aaaaaaaaaaaaaaaaaaaa', S2 = 'pwd2bbbbbbbbbbbbbbbbbbbb';
const api = (p, o = {}) => fetch(B + p, { ...o, headers: { 'user-agent': UA.win, 'x-device': JSON.stringify({ w: 1366, h: 768 }), ...(o.headers || {}) } });
const post = (p, body, headers) => api(p, { method: 'POST', headers, body: JSON.stringify(body) });
const prof = { name: 'Ala', color: '#ff0000', bio: 'x', rooms: [] };
(async () => {
  let srv = start(); await sleep(1400);
  // --- ustawienie hasła tworzy konto atomowo ---
  let r = await post('/api/account/password', { login: 'Ala_01', password: 'tajne123', profile: prof }, { 'x-account': S1 });
  ok(r.status === 200 && (await r.json()).login === 'ala_01', 'ustawienie hasła tworzy konto i normalizuje nazwę konta (małe litery)');
  const got = await (await api('/api/account', { headers: { 'x-account': S1 } })).json(), raw = JSON.stringify(got);
  ok(got.exists && got.profile.login === 'ala_01' && got.profile.hasPassword === true && !/hash|salt|secret|tajne123/.test(raw), 'GET konta pokazuje nazwę konta, ale nigdy skrótu, soli ani sekretu');
  const seen = await (await api('/api/seen', { headers: { 'x-account': S1 } })).json();
  ok(seen.record && seen.record.method === 'password' && seen.record.devices[0].label === 'Windows · Chrome · komputer' && seen.record.ips.length, 'metoda hasło też zapisuje IP i urządzenie');
  ok((await (await api('/api/account/recognize')).json()).found.length === 0, 'konto z hasłem nie jest „odgadywane” po IP (wymaga hasła)');
  // --- logowanie z innego urządzenia ---
  r = await post('/api/account/login', { login: 'ALA_01', password: 'tajne123' }, { 'user-agent': UA.iphone });
  ok(r.status === 200 && (await r.json()).secret === S1, 'logowanie hasłem na innym urządzeniu zwraca tożsamość konta (nazwa konta nie rozróżnia wielkości liter)');
  const seen2 = await (await api('/api/seen', { headers: { 'x-account': S1 } })).json();
  ok(seen2.record.devices.some(d => d.label === 'iOS · Safari · telefon'), 'logowanie z telefonu dopisuje urządzenie do rejestru');
  // --- błędy: jednakowe komunikaty, walidacja, unikalność ---
  const bad1 = await post('/api/account/login', { login: 'ala_01', password: 'zle' }), bad2 = await post('/api/account/login', { login: 'nie_ma_takiej', password: 'zle' });
  ok(bad1.status === 401 && bad2.status === 401 && (await bad1.text()) === (await bad2.text()), 'zła nazwa i złe hasło dają identyczną odpowiedź (brak wycieku, które konta istnieją)');
  ok((await post('/api/account/password', { login: 'ala_01', password: '123' }, { 'x-account': S1 })).status === 400, 'zbyt krótkie hasło jest odrzucane');
  ok((await post('/api/account/password', { login: 'a b!', password: 'tajne123', profile: prof }, { 'x-account': S2 })).status === 400, 'niepoprawna nazwa konta jest odrzucana');
  ok((await post('/api/account/password', { login: 'ALA_01', password: 'inne12345', profile: { name: 'Bartek' } }, { 'x-account': S2 })).status === 409, 'nazwa konta jest unikalna (zajęta → 409)');
  ok((await (await api('/api/account', { headers: { 'x-account': S2 } })).json()).exists === false, 'nieudane ustawienie hasła nie tworzy konta (brak skutków ubocznych)');
  // --- zmiana hasła ---
  ok((await post('/api/account/password', { password: 'nowehaslo9' }, { 'x-account': S1 })).status === 200, 'zmiana hasła (bez podawania nazwy konta)');
  ok((await post('/api/account/login', { login: 'ala_01', password: 'tajne123' })).status === 401 && (await post('/api/account/login', { login: 'ala_01', password: 'nowehaslo9' })).status === 200, 'stare hasło przestaje działać, nowe działa');
  // --- na dysku jest tylko skrót ---
  await sleep(900); const disk = fs.readFileSync(path.join(HOME, '.lanchat', 'accounts.json'), 'utf8');
  ok(/"hash":"[0-9a-f]{64}"/.test(disk) && !/tajne123|nowehaslo9/.test(disk), 'na dysku admina leży tylko skrót scrypt (64 hex), nie hasło');
  // --- połączenie z pokojem metodą hasło zapisuje IP (nie jest trybem prywatnym) ---
  const me = await (await api('/api/me')).json(), room = await (await post('/api/rooms', { name: 'H', isPublic: false })).json();
  const w = await new Promise(res => { const s = new WebSocket('ws://localhost:7777/ws'); s.onopen = () => s.send(JSON.stringify({ t: 'join', room: room.code, name: 'Ala', cid: S1, method: 'password' })); setTimeout(() => res(s), 400); });
  const st = await (await api('/api/admin/state', { headers: { 'x-admin': me.adminToken } })).json();
  ok(st.rooms[0].users[0].ip && st.rooms[0].users[0].priv === false && st.people.some(p => p.name === 'Ala' && p.method === 'password'), 'panel admina widzi IP i metodę „hasło”'); w.close();
  // --- usunięcie hasła ---
  ok((await api('/api/account/password', { method: 'DELETE', headers: { 'x-account': S1 } })).status === 200 && (await post('/api/account/login', { login: 'ala_01', password: 'nowehaslo9' })).status === 401 && (await (await api('/api/account', { headers: { 'x-account': S1 } })).json()).exists, 'usunięcie hasła wyłącza logowanie, ale zostawia konto');
  // --- trwałość po restarcie ---
  await post('/api/account/password', { login: 'ala_01', password: 'trwale-haslo' }, { 'x-account': S1 }); await sleep(900); await stop(srv); await sleep(500); srv = start(); await sleep(1400);
  r = await post('/api/account/login', { login: 'ala_01', password: 'trwale-haslo' });
  ok(r.status === 200 && (await r.json()).secret === S1, 'hasło i indeks nazw kont przetrwały restart serwera');
  // --- blokada po błędnych próbach (na końcu, bo blokuje cały IP) ---
  const codes = []; for (let i = 0; i < 5; i++) codes.push((await post('/api/account/login', { login: 'ala_01', password: 'zgaduje' + i })).status);
  ok(codes.every(c => c === 401), '5 pierwszych błędnych prób dostaje 401');
  const lock = await post('/api/account/login', { login: 'ala_01', password: 'trwale-haslo' });
  ok(lock.status === 429, 'po 5 błędnych próbach IP jest blokowane – nawet poprawne hasło dostaje 429 (ochrona przed zgadywaniem)');
  console.log(`\nALL OK (${passed} sprawdzeń)`); await stop(srv); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
