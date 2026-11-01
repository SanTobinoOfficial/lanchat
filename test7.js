// Testy własnych komend: komendy użytkownika (konto) i komendy pokoju (host, konsola).  node test7.js
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test7_' + Date.now()), B = 'http://localhost:7777';
const start = () => spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME } });
const stop = p => new Promise(r => { p.once('exit', r); p.kill(); setTimeout(r, 1500); });
let passed = 0; const ok = (c, msg, extra) => { assert(c, msg + (extra ? ' ' + JSON.stringify(extra) : '')); passed++; console.log('PASS ' + msg); };
const S1 = 'cmdtest1aaaaaaaaaaaaaaaa';
const join = (room, name, cid, extra) => new Promise(res => {
  const ws = new WebSocket('ws://localhost:7777/ws'), box = { ws, msgs: [], waiters: [] };
  ws.onmessage = e => { const m = JSON.parse(e.data); box.msgs.push(m); box.waiters = box.waiters.filter(w => !(m.t === w.t && (w.f(m), true))); };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name, cid, method: 'server', ...extra }));
  setTimeout(() => res(box), 450);
});
const next = (box, t) => new Promise(r => { box.waiters.push({ t, f: r }); });
const cmd = async (box, line) => { const p = next(box, 'console'); box.ws.send(JSON.stringify({ t: 'console', line })); const m = await Promise.race([p, sleep(1500).then(() => ({ lines: [{ t: 'TIMEOUT' }] }))]); await sleep(620); return m.lines.map(l => l.t).join('\n'); };
(async () => {
  let srv = start(); await sleep(1500);
  // --- własne komendy użytkownika: walidacja po stronie serwera ---
  const bad = [{ name: 'GG', text: 'Dobra gra' }, { name: 'roll', text: 'nadpisanie wbudowanej' }, { name: 'zła nazwa', text: 'x' }, { name: 'pusta', text: '   ' }, { name: 'gg', text: 'duplikat' }, { name: 'a'.repeat(40), text: 'za długa nazwa' }, { name: 'zasady', text: 'Szanujemy się' }];
  let r = await fetch(B + '/api/account', { method: 'PUT', headers: { 'x-account': S1 }, body: JSON.stringify({ name: 'Ala', color: '#ff0000', bio: '', rooms: [], cmds: bad }) });
  const got = (await (await fetch(B + '/api/account', { headers: { 'x-account': S1 } })).json()).profile;
  ok(r.status === 200 && JSON.stringify(got.cmds) === JSON.stringify([{ name: 'gg', text: 'Dobra gra' }, { name: 'zasady', text: 'Szanujemy się' }]), 'serwer zapisuje tylko poprawne własne komendy (małe litery, bez wbudowanych, bez duplikatów i pustych)', got.cmds);
  const many = Array.from({ length: 60 }, (_, i) => ({ name: 'k' + i, text: 'tekst ' + i }));
  await fetch(B + '/api/account', { method: 'PUT', headers: { 'x-account': S1 }, body: JSON.stringify({ name: 'Ala', cmds: many }) });
  ok((await (await fetch(B + '/api/account', { headers: { 'x-account': S1 } })).json()).profile.cmds.length === 30, 'limit 30 własnych komend na konto');
  // --- komendy pokoju ---
  const me = await (await fetch(B + '/api/me')).json(), room = await (await fetch(B + '/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Komendy' }) })).json();
  const host = await join(room.code, 'Host', 'hostcid_aaaaaaaaaaaaaaaa', { hostKey: room.hostKey }), mod = await join(room.code, 'Mod', 'modcid_bbbbbbbbbbbbbbbbb'), usr = await join(room.code, 'Gosc', 'usercid_cccccccccccccccc');
  ok(/brak własnych komend/.test(await cmd(host, 'cmd list')), 'cmd list: na początku pusto');
  ok(/Dodano \/zasady/.test(await cmd(host, 'cmd add zasady Szanujemy się nawzajem. Bez spamu.')), 'host dodaje komendę pokoju');
  await sleep(250);
  const room1 = usr.msgs.filter(m => m.t === 'room').pop().room;
  ok(room1.cmds && room1.cmds.zasady === 'Szanujemy się nawzajem. Bez spamu.', 'komenda trafia do wszystkich w pokoju (roomInfo.cmds)');
  const late = await join(room.code, 'Pozny', 'latecid_dddddddddddddddd');
  ok(late.msgs.find(m => m.t === 'joined').room.cmds.zasady, 'nowa osoba dostaje komendy pokoju przy dołączaniu');
  ok(/wbudowana/.test(await cmd(host, 'cmd add roll cokolwiek')) && /wbudowana/.test(await cmd(host, 'cmd add kick x')), 'nie można nadpisać komend wbudowanych');
  ok(/Nazwa: 1–20/.test(await cmd(host, 'cmd add "Zła Nazwa" x')) && /Podaj treść/.test(await cmd(host, 'cmd add pusta')), 'walidacja nazwy i treści');
  await cmd(host, 'cmd mod dodaj');   // nieznany podpolecenie nie psuje stanu
  await cmd(host, 'cmd add /powitanie Witaj {args}!');
  ok(/\/powitanie/.test(await cmd(host, 'cmd list')) && /\/zasady/.test(await cmd(host, 'cmd list')), 'ukośnik przed nazwą jest ignorowany, lista pokazuje obie komendy');
  await cmd(host, 'mod Mod'); await sleep(250);
  ok(/wymaga roli hosta/.test(await cmd(mod, 'cmd add x y')) && /wymaga roli hosta/.test(await cmd(mod, 'cmd del zasady')), 'moderator nie może dodawać ani usuwać komend pokoju');
  await host.ws.send(JSON.stringify({ t: 'room', act: 'cmdset', name: 'hak', value: 'x' })); usr.ws.send(JSON.stringify({ t: 'room', act: 'cmdset', name: 'hak', value: 'zwykly' })); await sleep(300);
  ok(/\/zasady/.test(await cmd(mod, 'cmd list')) && !/zwykly/.test(await cmd(mod, 'cmd list')), 'zwykły użytkownik nie obejdzie konsoli wiadomością room/cmdset');
  ok(/Usunięto \/powitanie/.test(await cmd(host, 'cmd del powitanie')), 'host usuwa komendę');
  await sleep(250); ok(!usr.msgs.filter(m => m.t === 'room').pop().room.cmds.powitanie, 'usunięcie komendy dociera do pokoju');
  // limit 25
  for (let i = 0; i < 26; i++) host.ws.send(JSON.stringify({ t: 'room', act: 'cmdset', name: 'x' + i, value: 'tekst' })); await sleep(500);
  const roomN = usr.msgs.filter(m => m.t === 'room').pop().room;
  ok(Object.keys(roomN.cmds).length === 25, 'limit 25 komend pokoju', Object.keys(roomN.cmds).length);
  // trwałość po restarcie
  await sleep(900); await stop(srv); await sleep(500); srv = start(); await sleep(1500);
  const again = await join(room.code, 'Pozny', 'latecid_dddddddddddddddd');
  ok(again.msgs.find(m => m.t === 'joined').room.cmds.zasady === 'Szanujemy się nawzajem. Bez spamu.', 'komendy pokoju przetrwały restart serwera');
  const acc = (await (await fetch(B + '/api/account', { headers: { 'x-account': S1 } })).json()).profile;
  ok(acc.cmds.length === 30, 'własne komendy użytkownika przetrwały restart serwera');
  console.log(`\nALL OK (${passed} sprawdzeń)`); await stop(srv); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
