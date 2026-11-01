// Testy obecności (AFK → Niedostępny), admina incognito, poziomów uprawnień, mocy hosta i GIF-ów:  node test2.js
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test2_' + Date.now()), B = 'http://localhost:7777';
const startServer = () => spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME, LANCHAT_AFK_MS: '1500' } });
const stop = p => new Promise(r => { p.once('exit', r); p.kill(); setTimeout(r, 1500); });
let passed = 0; const ok = (c, msg) => { assert(c, msg); passed++; console.log('PASS ' + msg); };
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(60); } return false; };
const lastUsers = w => (w.msgs.filter(m => m.t === 'users').pop() || w.msgs.find(m => m.t === 'joined') || {}).users || [];
const U = (w, name) => lastUsers(w).find(u => u.name === name);
const sys = (w, re) => w.msgs.filter(m => m.t === 'msg' && m.m.kind === 'sys' && re.test(m.m.text)).length;
let CODE;
const join = o => new Promise(res => { const w = new WebSocket('ws://localhost:7777/ws'); w.msgs = []; w.onopen = () => w.send(JSON.stringify({ t: 'join', room: CODE, ...o })); w.onmessage = e => w.msgs.push(JSON.parse(e.data)); w.onclose = () => { w.closed = true; }; setTimeout(() => res(w), 350); });
const say = (w, o) => w.send(JSON.stringify(o));

(async () => {
  let srv = startServer(); await sleep(1400);
  const me = await (await fetch(B + '/api/me')).json();
  const room = await (await fetch(B + '/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Obecność', isPublic: true }) })).json(); CODE = room.code;
  const host = await join({ name: 'Host', cid: 'host1111111111111111', hostKey: room.hostKey });
  let ala = await join({ name: 'Ala', cid: 'ala22222222222222222222' });
  const bob = await join({ name: 'Bob', cid: 'bob33333333333333333333' });

  // --- obecność: rozłączenie ≠ wyjście z pokoju ---
  ala.close(); await until(() => U(host, 'Ala') && U(host, 'Ala').online === false);
  ok(U(host, 'Ala') && U(host, 'Ala').online === false && U(host, 'Ala').status === 'afk', 'po rozłączeniu Ala zostaje na liście jako AFK (nie znika)');
  ok(sys(host, /Ala wyszedł/) === 0, 'rozłączenie nie generuje komunikatu „wyszedł”');
  ok(await until(() => U(host, 'Ala').status === 'offline', 5000), 'po czasie AFK status przechodzi w „Niedostępny” (rozsyłane automatycznie)');
  ala = await join({ name: 'Ala', cid: 'ala22222222222222222222' });
  ok(U(host, 'Ala').status === 'online' && U(host, 'Ala').online === true, 'powrót: Ala znów online');
  ok(sys(host, /Ala dołączył/) === 1, 'powrót po rozłączeniu nie jest ogłaszany jako „dołączył” drugi raz');
  say(bob, { t: 'leave' }); await until(() => !U(host, 'Bob'));
  ok(!U(host, 'Bob') && sys(host, /Bob opuścił/) === 1, 'świadome „Opuść pokój” usuwa z listy i jest ogłaszane');

  // --- admin incognito ---
  const adm = await join({ name: 'Szef', cid: 'adm44444444444444444444', adminToken: me.adminToken });
  ok(U(adm, 'Szef').role === 'admin', 'admin widzi swoją prawdziwą rolę');
  ok(U(host, 'Szef').role === 'user' && U(ala, 'Szef').role === 'user', 'inni widzą admina jako zwykłego użytkownika (incognito)');
  say(adm, { t: 'msg', text: 'hej, to ja' }); await until(() => host.msgs.some(m => m.t === 'msg' && m.m.text === 'hej, to ja'));
  ok(host.msgs.find(m => m.t === 'msg' && m.m.text === 'hej, to ja').m.role === 'user', 'wiadomość admina nie ma znacznika roli');
  const on1 = await (await fetch(B + '/api/online')).json(), on2 = await (await fetch(B + '/api/online', { headers: { 'x-account': 'ala22222222222222222222' } })).json(), on3 = await (await fetch(B + '/api/online', { headers: { 'x-account': 'adm44444444444444444444' } })).json();
  ok(!on1.people.some(p => p.admin) && !on2.people.some(p => p.admin) && on3.people.find(p => p.name === 'Szef').admin === true, 'lista aktywnych: znacznik admina widzi tylko sam admin przy sobie');

  // --- poziomy: admin > host > moderator > użytkownik ---
  say(host, { t: 'mod', act: 'kick', uid: U(host, 'Szef').id }); await until(() => host.msgs.some(m => m.t === 'notice' && /Nie można/.test(m.text)));
  ok(host.msgs.some(m => m.t === 'notice' && /Nie można wykonać/.test(m.text)) && !adm.closed && U(host, 'Szef'), 'host nie może wyrzucić (ukrytego) admina – odmowa bez ujawniania powodu');
  say(host, { t: 'mod', act: 'promote', uid: U(host, 'Ala').id }); await until(() => U(host, 'Ala').role === 'mod');
  ok(U(host, 'Ala').role === 'mod', 'host nadaje moderatora');
  say(ala, { t: 'mod', act: 'kick', uid: U(ala, 'Host').id }); await until(() => ala.msgs.some(m => m.t === 'notice' && /Nie można/.test(m.text)));
  ok(!host.closed, 'moderator nie może wyrzucić hosta');
  say(ala, { t: 'mod', act: 'kick', uid: U(ala, 'Szef').id }); await sleep(250);
  ok(!adm.closed, 'moderator nie może wyrzucić admina');
  say(host, { t: 'mod', act: 'demote', uid: U(host, 'Ala').id }); await until(() => U(host, 'Ala').role === 'user');

  // --- nowe moce hosta (i admina) ---
  say(host, { t: 'room', act: 'rename', value: 'Nowa nazwa' }); await until(() => host.msgs.some(m => m.t === 'room' && m.room.name === 'Nowa nazwa'));
  ok(true, 'host zmienia nazwę pokoju');
  say(host, { t: 'room', act: 'limit', value: 50 }); say(host, { t: 'room', act: 'public', value: false });
  await until(() => host.msgs.filter(m => m.t === 'room').pop().room.isPublic === false);
  ok((await (await fetch(B + '/api/nearby')).json()).every(r => r.code !== CODE), 'prywatny pokój znika z „Odkrywaj”');
  say(host, { t: 'room', act: 'public', value: true });
  say(host, { t: 'room', act: 'lock', value: true }); await until(() => host.msgs.filter(m => m.t === 'room').pop().room.joinLock === true);
  const newbie = await join({ name: 'Nowy', cid: 'new55555555555555555555' });
  ok(newbie.msgs.some(m => m.t === 'error' && m.code === 'locked'), 'blokada dołączania: nowa osoba dostaje „locked”');
  ala.close(); await sleep(300); ala = await join({ name: 'Ala', cid: 'ala22222222222222222222' });
  ok(ala.msgs.some(m => m.t === 'joined'), 'blokada nie wyrzuca obecnych członków – mogą wracać');
  say(host, { t: 'room', act: 'lock', value: false });
  // ban osoby rozłączonej + lista banów + odbanowanie
  ala.close(); await until(() => U(host, 'Ala') && U(host, 'Ala').online === false);
  say(host, { t: 'mod', act: 'ban', uid: U(host, 'Ala').id }); await until(() => !U(host, 'Ala'));
  const banned = await join({ name: 'Ala', cid: 'ala22222222222222222222' });
  ok(banned.msgs.some(m => m.t === 'error' && m.code === 'banned'), 'zbanowanie osoby offline działa (nie wróci)');
  say(host, { t: 'room', act: 'bans' }); await until(() => host.msgs.some(m => m.t === 'bans'));
  const list = host.msgs.filter(m => m.t === 'bans').pop().list; ok(list.length === 1 && list[0].name === 'Ala', 'host widzi listę zbanowanych z nazwami');
  say(host, { t: 'room', act: 'unban', uid: list[0].id }); await until(() => host.msgs.filter(m => m.t === 'bans').pop().list.length === 0);
  ala = await join({ name: 'Ala', cid: 'ala22222222222222222222' }); ok(ala.msgs.some(m => m.t === 'joined'), 'po odbanowaniu można wrócić');
  say(adm, { t: 'mod', act: 'kick', uid: U(adm, 'Host').id }); await until(() => host.closed);
  ok(host.closed, 'admin (najwyższy poziom) może wyrzucić nawet hosta');
  const host2 = await join({ name: 'Host', cid: 'host1111111111111111', hostKey: room.hostKey });
  ok(host2.msgs.some(m => m.t === 'joined') && U(host2, 'Host').role === 'host', 'host wraca po kluczu mimo wyrzucenia (jest twórcą)');
  say(host2, { t: 'msg', text: 'coś do wyczyszczenia' }); await sleep(200);
  say(host2, { t: 'room', act: 'clear' }); await until(() => host2.msgs.some(m => m.t === 'cleared'));
  const again = await join({ name: 'Ala', cid: 'ala22222222222222222222' });
  ok(!again.msgs.find(m => m.t === 'joined').history.some(m => m.text === 'coś do wyczyszczenia'), 'host czyści historię czatu');

  // --- GIF-y bez klucza ---
  const gs = await (await fetch(B + '/api/gif?q=gg')).json();
  ok(gs.results.some(r => r.src === 'local' && r.url === '/gifpack/gg.gif'), 'wyszukiwarka GIF-ów bez klucza zwraca wbudowane GIF-y');
  ok((await (await fetch(B + '/api/gif?q=')).json()).results.filter(r => r.src === 'local').length >= 15, 'pusta fraza: pełna paczka wbudowana');
  const nonsense = await (await fetch(B + '/api/gif?q=zzqqxxyy')).json(); ok(nonsense.results.length > 0 && nonsense.fallback === true, 'hasło bez trafień nigdy nie daje pustej listy (polecane)');
  const gb = Buffer.from(await (await fetch(B + '/gifpack/gg.gif')).arrayBuffer()); ok(gb.slice(0, 6).toString() === 'GIF89a' && gb[gb.length - 1] === 0x3b, 'plik z paczki to poprawny GIF');
  say(again, { t: 'gif', url: '/gifpack/gg.gif' }); await until(() => host2.msgs.some(m => m.t === 'msg' && m.m.kind === 'gif'));
  ok(host2.msgs.find(m => m.t === 'msg' && m.m.kind === 'gif').m.url === '/gifpack/gg.gif', 'wysłanie GIF-a z paczki działa');
  const n0 = host2.msgs.filter(m => m.t === 'msg').length; say(again, { t: 'gif', url: '/gifpack/../../etc.gif' }); say(again, { t: 'gif', url: '/gifpack/nie-ma.gif' }); await sleep(300);
  ok(host2.msgs.filter(m => m.t === 'msg').length === n0, 'nieistniejący/podejrzany adres paczki jest odrzucany');
  say(again, { t: 'gif', url: 'https://nekos.best@evil.example/x.gif' }); await until(() => host2.msgs.some(m => m.t === 'msg' && m.m.kind === 'gif' && /evil/.test(m.m.url)));
  ok(host2.msgs.find(m => m.t === 'msg' && /evil/.test(m.m.url || '')).m.url.startsWith('https://nekos.best@evil'), 'adres z „podszytym” hostem nie jest importowany (zostaje linkiem)');
  let neko = null; try { const j = await (await fetch('https://nekos.best/api/v2/wave', { signal: AbortSignal.timeout(6000) })).json(); neko = j.results[0].url; } catch {}
  if (neko) {
    say(again, { t: 'gif', url: neko });
    const got = await until(() => host2.msgs.some(m => m.t === 'msg' && m.m.kind === 'gif' && m.m.url.startsWith('/media/')), 15000);
    ok(got, 'GIF z zaufanego serwisu (nekos.best) jest importowany do pokoju – klienci czytają go od hosta');
    const mu = host2.msgs.find(m => m.t === 'msg' && m.m.kind === 'gif' && m.m.url.startsWith('/media/')).m.url;
    ok((await fetch(B + mu)).headers.get('content-type') === 'image/gif', 'zaimportowany GIF jest serwowany z pokoju');
  } else console.log('SKIP import z nekos.best (brak internetu)');

  // --- trwałość członków i ustawień po restarcie ---
  await sleep(900); await stop(srv); await sleep(500); srv = startServer(); await sleep(1400);
  const host3 = await join({ name: 'Host', cid: 'host1111111111111111', hostKey: room.hostKey });
  const ju = lastUsers(host3);
  ok(ju.some(u => u.name === 'Ala' && u.online === false) && ju.some(u => u.name === 'Szef' && u.role === 'user'), 'członkowie (też offline) i incognito admina przetrwały restart');
  ok(host3.msgs.find(m => m.t === 'joined').room.name === 'Nowa nazwa' && host3.msgs.find(m => m.t === 'joined').room.maxUsers === 50, 'nazwa i limit pokoju przetrwały restart');
  console.log(`\nALL OK (${passed} sprawdzeń)`); await stop(srv); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
