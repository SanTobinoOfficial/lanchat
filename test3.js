// Testy metod zapisu profilu (u admina / w przeglądarce / base64), rejestru IP i urządzeń:  node test3.js
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test3_' + Date.now()), B = 'http://localhost:7777';
const srv = spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME } });
const UA = { win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  tablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', ff: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0' };
let passed = 0; const ok = (c, msg) => { assert(c, msg); passed++; console.log('PASS ' + msg); };
const S1 = 'srv1aaaaaaaaaaaaaaaaaaaa', S2 = 'brw2bbbbbbbbbbbbbbbbbbbb', S3 = 'b643cccccccccccccccccccc', S4 = 'srv4dddddddddddddddddddd';
const api = (p, o = {}) => fetch(B + p, { ...o, headers: { 'user-agent': UA.win, 'x-device': JSON.stringify({ w: 1920, h: 1080 }), ...(o.headers || {}) } });
const j = async r => r.json();
(async () => {
  await sleep(1400);
  // --- metoda „u admina”: profil + IP + urządzenie ---
  await api('/api/account', { method: 'PUT', headers: { 'x-account': S1 }, body: JSON.stringify({ name: 'Ala', color: '#ff0000', bio: 'x', rooms: [] }) });
  const seen1 = await j(await api('/api/seen', { headers: { 'x-account': S1 } }));
  ok(seen1.record && seen1.record.method === 'server' && seen1.record.ips.length >= 1 && /^(127\.0\.0\.1|::1)$/.test(seen1.record.ips[0].ip), 'metoda „u admina”: serwer zapisuje IP');
  ok(seen1.record.devices[0].label === 'Windows · Edge · komputer' && seen1.record.devices[0].screen === '1920×1080', 'metoda „u admina”: serwer zapisuje rodzaj urządzenia (system, przeglądarka, typ, ekran)');
  await api('/api/account', { headers: { 'x-account': S1, 'user-agent': UA.iphone } });
  const seen1b = await j(await api('/api/seen', { headers: { 'x-account': S1 } }));
  ok(seen1b.record.devices.length === 2 && seen1b.record.devices.some(d => d.label === 'iOS · Safari · telefon'), 'kolejne urządzenie jest dopisywane do rejestru');
  const prof = (await j(await api('/api/account', { headers: { 'x-account': S1 } }))).profile;
  ok(prof.name === 'Ala' && prof.secret === undefined, 'GET konta nie ujawnia sekretu');
  // --- rozpoznawanie po IP (zastępuje kody konta) ---
  const rec = await j(await api('/api/account/recognize'));
  ok(rec.found.length === 1 && rec.found[0].name === 'Ala' && /Windows|iOS/.test(rec.found[0].device) && JSON.stringify(rec).indexOf(S1) < 0, 'rozpoznanie po IP: serwer wskazuje konto z tego IP bez ujawniania sekretu');
  const ad = await api('/api/account/adopt', { method: 'POST', body: JSON.stringify({ id: rec.found[0].id }) });
  ok((await j(ad)).secret === S1, '„To ja”: po potwierdzeniu przeglądarka odzyskuje swoją tożsamość');
  ok((await api('/api/account/adopt', { method: 'POST', body: JSON.stringify({ id: 'nieistnieje' }) })).status === 404, 'adopcja nieznanego konta jest odrzucana');
  // --- metoda „w przeglądarce”: profil u użytkownika, serwer zna tylko IP + urządzenie ---
  await api('/api/seen', { method: 'POST', headers: { 'x-account': S2, 'user-agent': UA.tablet }, body: JSON.stringify({ name: 'Bartek', method: 'browser' }) });
  const seen2 = await j(await api('/api/seen', { headers: { 'x-account': S2 } }));
  ok(seen2.record && seen2.record.method === 'browser' && seen2.record.devices[0].label === 'Android · Chrome · tablet', 'metoda „w przeglądarce”: serwer zapisuje IP i urządzenie, ale nie profil');
  ok((await j(await api('/api/account', { headers: { 'x-account': S2 } }))).exists === false, 'metoda „w przeglądarce”: na serwerze nie ma profilu');
  ok(!(await j(await api('/api/account/recognize'))).found.some(f => f.name === 'Bartek'), 'konta z przeglądarki nie są „odzyskiwalne” z serwera (nie ma czego)');
  // --- metoda base64: żadnego śladu ---
  await api('/api/seen', { method: 'POST', headers: { 'x-account': S3 }, body: JSON.stringify({ name: 'Celina', method: 'base64' }) });
  ok((await j(await api('/api/seen', { headers: { 'x-account': S3 } }))).record === null, 'metoda base64: serwer nie zapisuje ani IP, ani urządzenia');
  // --- WebSocket: pokój, wejście różnymi metodami, widok admina ---
  const me = await j(await api('/api/me'));
  ok(typeof me.ip === 'string' && me.device === 'Windows · Edge · komputer', '/api/me pokazuje, co serwer widzi u odwiedzającego (IP i urządzenie)');
  const room = await j(await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'IP', isPublic: false }) }));
  const join = o => new Promise(res => { const w = new WebSocket('ws://localhost:7777/ws'); w.msgs = []; w.onopen = () => w.send(JSON.stringify({ t: 'join', room: room.code, ...o })); w.onmessage = e => w.msgs.push(JSON.parse(e.data)); setTimeout(() => res(w), 400); });
  const wA = await join({ name: 'Ala', cid: S1, method: 'server' }), wC = await join({ name: 'Celina', cid: S3, method: 'base64' }), wD = await join({ name: 'Darek', cid: S4, method: 'browser' });
  const st = await j(await api('/api/admin/state', { headers: { 'x-admin': me.adminToken } }));
  const users = st.rooms[0].users, byName = n => users.find(u => u.name === n);
  ok(byName('Ala').ip && byName('Darek').ip && !byName('Ala').priv, 'panel admina widzi IP osób z metodą „u admina” i „w przeglądarce”');
  ok(byName('Celina').ip === null && byName('Celina').priv === true, 'panel admina NIE widzi IP osoby w trybie base64');
  const seen4 = await j(await api('/api/seen', { headers: { 'x-account': S4 } }));
  ok(seen4.record && seen4.record.method === 'browser', 'wejście do pokoju zapisuje IP/urządzenie dla metody „w przeglądarce”');
  ok((await j(await api('/api/seen', { headers: { 'x-account': S3 } }))).record === null, 'wejście do pokoju w trybie base64 nie zostawia śladu w rejestrze');
  ok(st.people.some(p => p.name === 'Ala' && p.ips.length && p.devices.length) && !st.people.some(p => p.name === 'Celina'), 'lista osób w panelu admina: IP i urządzenia, bez osób z base64');
  // zmiana metody w trakcie sesji
  wA.send(JSON.stringify({ t: 'profile', method: 'base64' })); await sleep(250);
  const st2 = await j(await api('/api/admin/state', { headers: { 'x-admin': me.adminToken } }));
  ok(st2.rooms[0].users.find(u => u.name === 'Ala').ip === null, 'zmiana na base64 w trakcie sesji od razu ukrywa IP przed adminem');
  // --- usuwanie ---
  await api('/api/account', { method: 'DELETE', headers: { 'x-account': S1 } });
  ok((await j(await api('/api/account', { headers: { 'x-account': S1 } }))).exists === false && (await j(await api('/api/seen', { headers: { 'x-account': S1 } }))).record === null, 'DELETE usuwa profil i rejestr IP/urządzeń');
  await api('/api/account', { method: 'PUT', headers: { 'x-account': S1 }, body: JSON.stringify({ name: 'Ala' }) });
  await api('/api/account?keepLog=1', { method: 'DELETE', headers: { 'x-account': S1 } });
  ok((await j(await api('/api/account', { headers: { 'x-account': S1 } }))).exists === false && (await j(await api('/api/seen', { headers: { 'x-account': S1 } }))).record !== null, 'DELETE ?keepLog=1 usuwa profil, ale zostawia wpis IP/urządzenie (przejście na „w przeglądarce”)');
  console.log(`\nALL OK (${passed} sprawdzeń)`); srv.kill(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); srv.kill(); process.exit(1); });
