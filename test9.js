// Testy automatycznego przełączania modeli AI (darmowe modele OpenRouter).  node test9.js
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path'), http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test9_' + Date.now()), B = 'http://localhost:7777', KEY = 'sk-or-chain-test-5678';
let passed = 0; const ok = (c, msg, extra) => { assert(c, msg + (extra ? ' ' + JSON.stringify(extra) : '')); passed++; console.log('PASS ' + msg); };
const FIRST = 'a/free-big:free', SECOND = 'b/free-small:free';
const MODELS = [
  { id: SECOND, context_length: 8000, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'c/paid-model', context_length: 999999, pricing: { prompt: '0.001', completion: '0.002' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: FIRST, context_length: 128000, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'd/image-gen:free', context_length: 500000, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['image'] } }];
let tried = [], mode = 'ok';
const fake = http.createServer((req, res) => { let d = ''; req.on('data', c => d += c); req.on('end', () => {
  if (req.url.endsWith('/models')) { if (mode === 'nomodels') { res.writeHead(500); return res.end('x'); } res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: MODELS })); }
  const model = JSON.parse(d || '{}').model; tried.push(model);
  const status = mode === 'auth' ? 401 : mode === 'first429' && model === FIRST ? 429 : mode === 'first403' && model === FIRST ? 403 : mode.startsWith('pinned404') && model === 'paid/x' ? 404 : 200;
  if (status !== 200) { res.writeHead(status); return res.end('{"error":"x"}'); }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'odp od ' + model } }] }));
}); }).listen(8123);
const start = () => spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME, LANCHAT_OPENROUTER_URL: 'http://localhost:8123/v1/chat/completions' } });
const stop = p => new Promise(r => { p.once('exit', r); p.kill(); setTimeout(r, 1500); });
const join = (room, name, cid) => new Promise(res => {
  const ws = new WebSocket('ws://localhost:7777/ws'), box = { ws, msgs: [] };
  ws.onmessage = e => box.msgs.push(JSON.parse(e.data));
  ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room, name, cid, method: 'server' }));
  setTimeout(() => res(box), 450);
});
const ask = async (box, prompt) => { tried = []; const n = box.msgs.length; box.ws.send(JSON.stringify({ t: 'ai', prompt })); await sleep(1100); const a = box.msgs.slice(n).find(m => m.t === 'msg' && m.m.ai === 'a'); return { tried: [...tried], answer: a && a.m }; };
async function boot(extra) {
  const srv = start(); await sleep(1500);
  const me = await (await fetch(B + '/api/me')).json(), H = { 'x-admin': me.adminToken };
  const cfg = o => fetch(B + '/api/admin/settings', { method: 'POST', headers: H, body: JSON.stringify(o) });
  await cfg({ openrouterKey: KEY, ...extra });
  const room = await (await fetch(B + '/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'M' }) })).json();
  return { srv, cfg, room };
}
(async () => {
  let { srv, cfg, room } = await boot();
  const u1 = await join(room.code, 'U1', 'cid1_aaaaaaaaaaaaaaaaaaaa'), u2 = await join(room.code, 'U2', 'cid2_bbbbbbbbbbbbbbbbbbbb');
  // 1) pierwszy model w limicie (429) → przełączenie na drugi
  mode = 'first429'; let r = await ask(u1, 'pytanie 1');
  ok(JSON.stringify(r.tried) === JSON.stringify([FIRST, SECOND]) && r.answer.model === SECOND && r.answer.text === 'odp od ' + SECOND, 'model w limicie (429) → automatyczne przełączenie na kolejny darmowy', r.tried);
  // 2) zawodzący model odpoczywa – następne pytanie nie traci na niego czasu
  r = await ask(u2, 'pytanie 2');
  ok(JSON.stringify(r.tried) === JSON.stringify([SECOND]) && r.answer.model === SECOND, 'model, który zawiódł, odpoczywa – kolejne pytanie od razu idzie do działającego', r.tried);
  await stop(srv); await sleep(400);
  // 3) model przypięty przez admina + zapas darmowy
  ({ srv, cfg, room } = await boot({ aiModel: 'paid/x' }));
  const v1 = await join(room.code, 'V1', 'cid3_cccccccccccccccccccc'), v2 = await join(room.code, 'V2', 'cid4_dddddddddddddddddddd');
  mode = 'pinned404'; r = await ask(v1, 'z przypiętym');
  ok(r.tried[0] === 'paid/x' && r.tried[1] === FIRST && r.answer.model === FIRST, 'model przypięty jest próbowany pierwszy, a gdy zawiedzie – zapas z darmowych', r.tried);
  await cfg({ aiFallbackFree: false }); await stop(srv); await sleep(400);
  ({ srv, cfg, room } = await boot({ aiModel: 'paid/x', aiFallbackFree: false }));
  const w1 = await join(room.code, 'W1', 'cid5_eeeeeeeeeeeeeeeeeeee');
  r = await ask(w1, 'bez zapasu');
  ok(JSON.stringify(r.tried) === JSON.stringify(['paid/x']) && /chwilowo niedostępne/.test(r.answer.text), 'bez zapasu (aiFallbackFree = false) tylko przypięty model; błąd → ogólny komunikat', r.tried);
  await cfg({ aiModel: '' }); await stop(srv); await sleep(400);
  // 4) błędny klucz (401) nie męczy kolejnych modeli
  ({ srv, cfg, room } = await boot());
  const x1 = await join(room.code, 'X1', 'cid6_ffffffffffffffffffff');
  mode = 'auth'; r = await ask(x1, 'zły klucz');
  ok(r.tried.length === 1 && /chwilowo niedostępne/.test(r.answer.text), 'odrzucony klucz (401) kończy próby od razu – bez przeglądania wszystkich modeli', r.tried);
  await stop(srv); await sleep(400);
  // 4b) 403 (np. moderacja konkretnego modelu) to NIE zły klucz – próbujemy następny model
  ({ srv, cfg, room } = await boot());
  const z1 = await join(room.code, 'Z1', 'cid8_hhhhhhhhhhhhhhhhhhhh');
  mode = 'first403'; r = await ask(z1, 'moderacja');
  ok(JSON.stringify(r.tried) === JSON.stringify([FIRST, SECOND]) && r.answer.model === SECOND, 'HTTP 403 jednego modelu nie kończy prób – odpowiada następny darmowy model', r.tried);
  await stop(srv); await sleep(400);
  // 5) lista modeli niedostępna → lista awaryjna
  mode = 'nomodels'; ({ srv, cfg, room } = await boot());
  const y1 = await join(room.code, 'Y1', 'cid7_gggggggggggggggggggg');
  r = await ask(y1, 'bez listy');
  ok(r.tried[0] === 'openrouter/free', 'gdy listy modeli nie da się pobrać, serwer używa listy awaryjnej (openrouter/free na początku)', r.tried);
  await stop(srv);
  console.log(`\nALL OK (${passed} sprawdzeń)`); fake.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
