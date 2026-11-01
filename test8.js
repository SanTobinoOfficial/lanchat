// Testy komendy /ai (OpenRouter przez serwer) z udawanym OpenRouterem.  node test8.js
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path'), http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test8_' + Date.now()), B = 'http://localhost:7777', KEY = 'sk-or-test-secret-1234';
let passed = 0; const ok = (c, msg, extra) => { assert(c, msg + (extra ? ' ' + JSON.stringify(extra) : '')); passed++; console.log('PASS ' + msg); };
// udawany OpenRouter
const seen = []; let mode = 'ok';
const fake = http.createServer((req, res) => { let d = ''; req.on('data', c => d += c); req.on('end', () => {
  seen.push({ auth: req.headers.authorization, ref: req.headers['http-referer'], title: req.headers['x-title'], body: JSON.parse(d || '{}') });
  if (mode === 'err') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"upstream boom SECRET-DETAIL"}}'); }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'Odpowiedź testowa AI' } }] }));
}); }).listen(8123);
const start = env => spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME, LANCHAT_OPENROUTER_URL: 'http://localhost:8123/v1/chat/completions', ...env } });
const stop = p => new Promise(r => { p.once('exit', r); p.kill(); setTimeout(r, 1500); });
const join = (room, name, cid, extra) => new Promise(res => {
  const ws = new WebSocket('ws://localhost:7777/ws'), box = { ws, msgs: [], waiters: [] };
  ws.onmessage = e => { const m = JSON.parse(e.data); box.msgs.push(m); box.waiters = box.waiters.filter(w => !(m.t === w.t && (w.f(m), true))); };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name, cid, method: 'server', ...extra }));
  setTimeout(() => res(box), 450);
});
const next = (box, t) => new Promise(r => { box.waiters.push({ t, f: r }); });
const cmd = async (box, line) => { const p = next(box, 'console'); box.ws.send(JSON.stringify({ t: 'console', line })); const m = await Promise.race([p, sleep(1500).then(() => ({ lines: [{ t: 'TIMEOUT' }] }))]); await sleep(620); return m.lines.map(l => l.t).join('\n'); };
const ask = async (box, prompt, waitMs = 900) => { const n = box.msgs.length; box.ws.send(JSON.stringify({ t: 'ai', prompt })); await sleep(waitMs); return box.msgs.slice(n); };
const notice = ms => ms.find(m => m.t === 'notice');
const reqNet = (method, p, body, headers) => new Promise(res => { const r = http.request({ host: '127.0.0.1', port: 7777, path: p, method, headers: { host: 'lan.test:7777', 'content-type': 'application/json', ...headers } }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ status: resp.statusCode, text: d })); }); r.on('error', () => res({ status: 0, text: '' })); if (body) r.write(JSON.stringify(body)); r.end(); });
(async () => {
  let srv = start(); await sleep(1500);
  const me = await (await fetch(B + '/api/me')).json(), H = { 'x-admin': me.adminToken };
  const setCfg = o => fetch(B + '/api/admin/settings', { method: 'POST', headers: H, body: JSON.stringify(o) });
  const room = await (await fetch(B + '/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'AI' }) })).json();
  const host = await join(room.code, 'Host', 'hostcid_aaaaaaaaaaaaaaaa', { hostKey: room.hostKey }), ala = await join(room.code, 'Ala', 'alacid_bbbbbbbbbbbbbbbbbb'), bob = await join(room.code, 'Bob', 'bobcid_cccccccccccccccccc'), cat = await join(room.code, 'Cez', 'catcid_dddddddddddddddddd');
  // --- bez klucza ---
  ok(ala.msgs.find(m => m.t === 'joined').room.ai === false && me.ai === false, 'bez klucza AI jest wyłączone (roomInfo.ai i /api/me.ai = false)');
  ok(/nie jest włączone/.test((notice(await ask(ala, 'hej')) || {}).text), 'bez klucza /ai zwraca czytelne powiadomienie i nie woła OpenRouter'); ok(seen.length === 0, 'żadne zapytanie nie wyszło na zewnątrz');
  // --- admin ustawia klucz (tylko z localhost) ---
  ok((await reqNet('POST', '/api/admin/settings', { openrouterKey: 'x' }, H)).status === 403, 'ustawienia (w tym klucz) są niedostępne spoza localhost');
  await setCfg({ openrouterKey: KEY }); await sleep(300);
  const st = await (await fetch(B + '/api/admin/state', { headers: H })).text();
  ok(!st.includes(KEY) && st.includes('••••1234'), 'panel admina dostaje klucz tylko zamaskowany (••••1234)');
  const me2 = await (await fetch(B + '/api/me')).text(); ok(!me2.includes(KEY) && JSON.parse(me2).ai === true, '/api/me nie zawiera klucza, a ai = true');
  ok(ala.msgs.filter(m => m.t === 'room').pop().room.ai === true, 'po ustawieniu klucza pokoje dostają ai = true na żywo');
  await setCfg({ openrouterKey: '••••1234' }); ok(seen.length === 0 && (await fetch(B + '/api/admin/state', { headers: H }).then(r => r.text())).includes('••••1234'), 'odesłanie zamaskowanej wartości nie nadpisuje klucza');
  // --- pytanie ---
  let ms = await ask(ala, 'Co to jest Wi-Fi?');
  const q = ms.find(m => m.t === 'msg' && m.m.ai === 'q'), a = ms.find(m => m.t === 'msg' && m.m.ai === 'a');
  ok(q && q.m.text === '/ai Co to jest Wi-Fi?' && q.m.name === 'Ala', 'pytanie pojawia się w pokoju jako wiadomość osoby (/ai …)');
  ok(a && a.m.role === 'bot' && a.m.name === 'AI' && a.m.text === 'Odpowiedź testowa AI' && a.m.reply.id === q.m.id, 'odpowiedź AI to wiadomość „bot” z odwołaniem do pytania');
  ok(seen.length === 1 && seen[0].auth === 'Bearer ' + KEY && seen[0].body.model === 'openrouter/auto' && seen[0].body.max_tokens === 500, 'serwer woła OpenRouter swoim kluczem, z modelem i limitem tokenów');
  ok(seen[0].body.messages.length === 2 && seen[0].body.messages[1].content === 'Co to jest Wi-Fi?' && !JSON.stringify(seen[0].body).includes('Ala'), 'domyślnie do OpenRouter idzie tylko treść pytania (bez kontekstu pokoju i nicków)');
  ok(!JSON.stringify(ala.msgs).includes(KEY) && !JSON.stringify(bob.msgs).includes(KEY), 'klucz nie pojawia się w żadnej wiadomości dla gości');
  // --- limity ---
  ok(/Poczekaj/.test((notice(await ask(ala, 'jeszcze jedno', 400)) || {}).text), 'drugie pytanie od razu jest wstrzymane (cooldown 8 s na osobę)');
  // --- kontekst pokoju (opcjonalny) ---
  ala.ws.send(JSON.stringify({ t: 'msg', text: 'tajny kontekst 4711' })); await sleep(200);
  await setCfg({ aiContext: true }); await ask(bob, 'streść rozmowę');
  ok(seen.length === 2 && seen[1].body.messages.some(m => m.role === 'system' && m.content.includes('tajny kontekst 4711')), 'z aiContext = true 10 ostatnich wiadomości trafia jako kontekst');
  await setCfg({ aiContext: false });
  // --- awaria OpenRouter ---
  mode = 'err'; ms = await ask(cat, 'test awarii');
  const fail = ms.find(m => m.t === 'msg' && m.m.ai === 'a');
  ok(fail && /chwilowo niedostępne/.test(fail.m.text) && !/SECRET-DETAIL|boom|sk-or/.test(JSON.stringify(ms)), 'błąd OpenRouter: goście widzą ogólny komunikat, bez szczegółów i klucza'); mode = 'ok';
  // --- host i moderacja ---
  ok(/wymaga roli hosta/.test(await cmd(cat, 'ai off')) || /dostępna dla hosta/.test(await cmd(cat, 'ai off')), 'zwykła osoba nie wyłączy AI w pokoju');
  ok(/wyłączone/.test(await cmd(host, 'ai off')), 'host wyłącza AI w swoim pokoju'); await sleep(250);
  ok(ala.msgs.filter(m => m.t === 'room').pop().room.ai === false, 'pokój dostaje ai = false (klient chowa /ai)');
  await sleep(8200); ok(/Host wyłączył/.test((notice(await ask(ala, 'czy działa?', 400)) || {}).text), 'przy wyłączonym AI pytanie jest odrzucone');
  await cmd(host, 'ai on');
  await cmd(host, 'mute ala'); await sleep(250); ok(/wyciszon/i.test((notice(await ask(ala, 'wyciszony pyta', 400)) || {}).text), 'wyciszona osoba nie może pytać AI'); await cmd(host, 'unmute ala');
  // --- dzienny limit ---
  await setCfg({ aiDailyLimit: 1 }); ok(/Dzienny limit/.test((notice(await ask(bob, 'ponad limit', 400)) || {}).text), 'dzienny limit zapytań jest egzekwowany'); await setCfg({ aiDailyLimit: 300 });
  // --- trwałość ---
  await cmd(host, 'ai off'); await sleep(900); await stop(srv); await sleep(500); srv = start(); await sleep(1500);
  const me3 = await (await fetch(B + '/api/me')).json(); ok(me3.ai === true, 'klucz przetrwał restart serwera (settings.json)');
  const again = await join(room.code, 'Ala', 'alacid_bbbbbbbbbbbbbbbbbb'); ok(again.msgs.find(m => m.t === 'joined').room.ai === false, 'wyłączenie AI w pokoju przetrwało restart');
  await stop(srv);
  // --- konsola admina: klucz nie wycieka do dziennika ---
  const tui = spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, USERPROFILE: HOME, HOME, LANCHAT_TUI: 'force' } });
  let raw = ''; tui.stdout.on('data', d => raw += d); await sleep(1500);
  tui.stdin.write('set openrouterKey sk-or-LEAKCHECK9999\r'); await sleep(400); tui.stdin.write('ai\r'); await sleep(400);
  const frame = raw.slice(raw.lastIndexOf('\x1b[H')).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  ok(!frame.includes('LEAKCHECK') && frame.includes('(zapisano)') && frame.includes('••••9999'), 'konsola admina: klucz nie jest widoczny w dzienniku, ai pokazuje tylko ostatnie 4 znaki');
  tui.stdin.write('quit\r'); await sleep(500); try { tui.kill(); } catch {}
  console.log(`\nALL OK (${passed} sprawdzeń)`); fake.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
