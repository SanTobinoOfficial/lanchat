// Testy: jedna osoba = jeden pokój oraz konsola pokoju (host/moderator).  node test6.js
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path'), http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test6_' + Date.now());
const start = () => spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME } });
const stop = p => new Promise(r => { p.once('exit', r); p.kill(); setTimeout(r, 1500); });
let passed = 0; const ok = (c, msg, extra) => { assert(c, msg + (extra ? ' ' + JSON.stringify(extra) : '')); passed++; console.log('PASS ' + msg); };
const SA = 'aaaaaaaaaaaaaaaaaaaaaaaa', SB = 'bbbbbbbbbbbbbbbbbbbbbbbb', SC = 'cccccccccccccccccccccccc';
// żądanie „z sieci” (nie z localhost): inny nagłówek Host ⇒ serwer nie traktuje go jak admina
const req = (method, p, body, headers) => new Promise(res => {
  const r = http.request({ host: '127.0.0.1', port: 7777, path: p, method, headers: { host: 'lan.test:7777', 'content-type': 'application/json', ...headers } }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { let j = {}; try { j = JSON.parse(d); } catch {} res({ status: resp.statusCode, json: j }); }); });
  r.on('error', () => res({ status: 0, json: {} })); if (body) r.write(JSON.stringify(body)); r.end();
});
const adminPost = (p, b) => fetch('http://localhost:7777' + p, { method: 'POST', body: JSON.stringify(b) }).then(async r => ({ status: r.status, json: await r.json() }));
const join = (room, name, cid, extra) => new Promise(res => {
  const ws = new WebSocket('ws://localhost:7777/ws'), box = { ws, msgs: [], waiters: [] };
  ws.onmessage = e => { const m = JSON.parse(e.data); box.msgs.push(m); box.waiters = box.waiters.filter(w => !(m.t === w.t && (w.f(m), true))); };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name, cid, method: 'server', ...extra }));
  setTimeout(() => res(box), 450);
});
const next = (box, t) => new Promise(r => { box.waiters.push({ t, f: r }); });
const cmd = async (box, line) => {
  const p = next(box, 'console'); box.ws.send(JSON.stringify({ t: 'console', line }));
  const m = await Promise.race([p, sleep(1500).then(() => ({ lines: [{ k: 'err', t: 'TIMEOUT' }] }))]);
  await sleep(620);   // przerwa: serwer ogranicza konsolę do 10 komend / 5 s na osobę
  return m.lines.map(l => l.t).join('\n');
};
(async () => {
  let srv = start(); await sleep(1500);
  // --- jedna osoba = jeden pokój ---
  let r = await req('POST', '/api/rooms', { name: 'A1', isPublic: true }, { 'x-account': SA });
  ok(r.status === 200 && r.json.code, 'osoba z sieci zakłada pierwszy pokój');
  const A1 = r.json;
  r = await req('POST', '/api/rooms', { name: 'A2' }, { 'x-account': SA });
  ok(r.status === 409 && r.json.code === A1.code && /tylko jeden/.test(r.json.error), 'drugi pokój tej samej osoby jest odrzucony (409) i wskazuje jej pokój');
  r = await req('POST', '/api/rooms', { name: 'B1' }, { 'x-account': SB }); const B1 = r.json;
  ok(r.status === 200, 'inna osoba może założyć swój pokój');
  ok((await req('POST', '/api/rooms', { name: 'X' })).status === 400, 'bez tożsamości (x-account) nie można założyć pokoju');
  ok((await adminPost('/api/rooms', { name: 'adm1' })).status === 200 && (await adminPost('/api/rooms', { name: 'adm2' })).status === 200, 'admin (localhost) nie ma limitu pokoi');
  // --- konsola: uprawnienia ---
  const host = await join(A1.code, 'Ala', SA, { hostKey: A1.hostKey });
  const bob = await join(A1.code, 'Bob', SB), cat = await join(A1.code, 'Cezary', SC);
  ok((await cmd(cat, 'kick bob')).includes('dostępna dla hosta i moderatorów'), 'zwykły użytkownik nie ma konsoli');
  const help = await cmd(host, 'help');
  ok(/kick/.test(help) && /ban/.test(help) && /password/.test(help) && !/banip|settings|autostart/.test(help), 'help hosta: komendy pokoju, bez komend serwera');
  ok(/Kod\s+/.test(await cmd(host, 'info')), 'info pokazuje dane pokoju');
  const users = await cmd(host, 'users'), all = [await cmd(host, 'help'), await cmd(host, 'info'), users, await cmd(host, 'members'), await cmd(host, 'bans'), await cmd(host, 'history 5')].join('\n');
  ok(/Bob/.test(users) && !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(all), 'users/members/info nie pokazują żadnych adresów IP');
  ok(/Nieznana komenda/.test(await cmd(host, 'banip 1.2.3.4')) && /Nieznana komenda/.test(await cmd(host, 'set maxRooms 99')), 'komendy serwera (banip, set) nie istnieją w konsoli pokoju');
  // --- komendy hosta ---
  await cmd(host, 'topic Nowy temat'); await sleep(200);
  ok(bob.msgs.some(m => m.t === 'room' && m.room.topic === 'Nowy temat'), 'topic zmienia temat i powiadamia pokój');
  await cmd(host, 'slow 7'); await cmd(host, 'lock on'); await cmd(host, 'limit 5'); await cmd(host, 'password sekret'); await cmd(host, 'public off'); await sleep(250);
  const last = bob.msgs.filter(m => m.t === 'room').pop().room;
  ok(last.slow === 7 && last.joinLock && last.maxUsers === 5 && last.locked && last.isPublic === false, 'slow/lock/limit/password/public ustawiają pokój');
  await cmd(host, 'say Za chwilę zaczynamy'); await sleep(200);
  ok(bob.msgs.some(m => m.t === 'msg' && m.m.kind === 'sys' && /Za chwilę zaczynamy/.test(m.m.text)), 'say wysyła ogłoszenie');
  ok(/wyciszon|mute/.test(await cmd(host, 'mute bob')), 'mute działa'); bob.ws.send(JSON.stringify({ t: 'msg', text: 'x' })); await sleep(250);
  ok(bob.msgs.some(m => m.t === 'notice' && /wyciszon/i.test(m.text)), 'wyciszona osoba dostaje powiadomienie'); await cmd(host, 'unmute bob');
  // moderator ma mniej uprawnień
  await cmd(host, 'mod cezary'); await sleep(250);
  ok(/Ta komenda wymaga roli hosta/.test(await cmd(cat, 'ban bob')) && /Ta komenda wymaga roli hosta/.test(await cmd(cat, 'password x')) && /Ta komenda wymaga roli hosta/.test(await cmd(cat, 'close')), 'moderator nie może: ban, password, close');
  ok(/Nie można wykonać tej akcji/.test(await cmd(cat, 'kick ala')), 'moderator nie może wyrzucić hosta (wyższy poziom wygrywa)');
  ok(/kick: Bob/.test(await cmd(cat, 'kick bob')), 'moderator może wyrzucić zwykłą osobę'); await sleep(250);
  ok(bob.msgs.some(m => m.t === 'closed' && /wyrzucon/.test(m.reason)), 'wyrzucona osoba dostaje komunikat');
  // ban / unban
  const bob2 = await join(A1.code, 'Bob', SB, { hostKey: undefined }); // wpuści? pokój zablokowany + hasło
  ok(bob2.msgs.some(m => m.t === 'error'), 'blokada dołączania i hasło działają po komendach');
  await cmd(host, 'lock off'); await cmd(host, 'password none');
  const bob3 = await join(A1.code, 'Bob', SB); ok(bob3.msgs.some(m => m.t === 'joined'), 'po lock off i password none osoba wchodzi');
  ok(/ban: Bob/.test(await cmd(host, 'ban bob')) && /Bob/.test(await cmd(host, 'bans')), 'ban dodaje wpis do listy banów');
  ok(/Odbanowano/.test(await cmd(host, 'unban bob')) && /brak banów/.test(await cmd(host, 'bans')), 'unban zdejmuje bana');
  // admin incognito
  const adm = await join(A1.code, 'Szef', 'admincid_xxxxxxxxxxxxxxxx', { adminToken: (await (await fetch('http://localhost:7777/api/me')).json()).adminToken });
  ok(/Szef\s+\S+\s+user/.test(await cmd(host, 'members')), 'admin jest na liście jako zwykły użytkownik (incognito)');
  ok(/Nie można wykonać tej akcji/.test(await cmd(host, 'kick szef')) && /Nie można wykonać tej akcji/.test(await cmd(host, 'ban szef')), 'host nie może ruszyć admina, a odpowiedź jest taka sama jak dla wyższej roli');
  // potwierdzenia
  ok(/Wpisz „tak”/.test(await cmd(host, 'clear')) && /Anulowano/.test(await cmd(host, 'nie')), 'clear prosi o potwierdzenie i można anulować');
  await cmd(host, 'clear'); await cmd(host, 'tak'); await sleep(250);
  ok(cat.msgs.some(m => m.t === 'cleared'), 'po „tak” historia jest wyczyszczona');
  // zamknięcie pokoju zwalnia limit; konto właściciela przetrwa restart
  await cmd(host, 'close'); const closing = next(host, 'closed'); await cmd(host, 'tak'); await Promise.race([closing, sleep(800)]); await sleep(300);
  r = await req('POST', '/api/rooms', { name: 'A-nowy' }, { 'x-account': SA });
  ok(r.status === 200, 'po zamknięciu pokoju osoba może założyć nowy');
  await sleep(900); await stop(srv); await sleep(500); srv = start(); await sleep(1500);
  r = await req('POST', '/api/rooms', { name: 'A-jeszcze' }, { 'x-account': SA });
  ok(r.status === 409, 'limit jednego pokoju przetrwał restart serwera (właściciel zapisany na dysku)');
  console.log(`\nALL OK (${passed} sprawdzeń)`); await stop(srv); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
