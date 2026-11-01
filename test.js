// Smoke test: node test.js (startuje własne serwery na porcie 7777 – zamknij inne instancje)
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test_' + Date.now());
const B = 'http://localhost:7777';
const startServer = () => spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: 'ignore', env: { ...process.env, USERPROFILE: HOME, HOME } });
const stop = p => new Promise(r => { p.once('exit', r); p.kill(); setTimeout(r, 1500); });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

(async () => {
  let srv = startServer(); await sleep(1300);
  const me = await (await fetch(B + '/api/me')).json();
  assert(me.isAdmin && me.adminToken, 'admin via loopback');
  assert.equal((await fetch(B + '/api/admin/state', { headers: { 'x-admin': 'nope' } })).status, 403);

  // --- konta ---
  const secret = 'abcdef0123456789abcdef01';
  let a = await (await fetch(B + '/api/account', { headers: { 'x-account': secret } })).json(); assert.equal(a.exists, false);
  assert.equal((await fetch(B + '/api/account', { headers: { 'x-account': 'x' } })).status, 400, 'zły kod konta');
  const avatar = 'data:image/png;base64,' + PNG.toString('base64');
  await fetch(B + '/api/account', { method: 'PUT', headers: { 'x-account': secret }, body: JSON.stringify({ name: 'Ola', color: '#ff0000', bio: 'cześć', avatar, status: 'idle', theme: 'light', sound: false, rooms: [{ addr: 'localhost:7777', code: 'abc-123', name: 'X', password: 'p' }, { addr: '', code: '' }] }) });
  a = await (await fetch(B + '/api/account', { headers: { 'x-account': secret } })).json();
  assert(a.exists && a.profile.name === 'Ola' && a.profile.status === 'idle' && a.profile.theme === 'light' && a.profile.rooms.length === 1 && a.profile.rooms[0].code === 'ABC123', 'konto zapisane i oczyszczone');
  await fetch(B + '/api/account', { method: 'PUT', headers: { 'x-account': secret }, body: JSON.stringify({ avatar: 'javascript:alert(1)', color: 'red' }) });
  a = await (await fetch(B + '/api/account', { headers: { 'x-account': secret } })).json(); assert.equal(a.profile.avatar, '', 'zły awatar odrzucony'); assert.equal(a.profile.color, '#ff0000');

  // --- pokoje ---
  const room = await (await fetch(B + '/api/rooms', { method: 'POST', body: JSON.stringify({ name: 'Test', password: 'pw', isPublic: true }) })).json();
  assert(room.code && room.hostKey);
  assert.equal((await (await fetch(B + '/api/resolve?code=' + room.code)).json()).port, 7777);
  assert((await (await fetch(B + '/api/nearby')).json()).some(r => r.code === room.code), 'UDP list');
  const mk = join => new Promise(ok => { const w = new WebSocket('ws://localhost:7777/ws'); w.msgs = []; w.onopen = () => w.send(JSON.stringify({ t: 'join', room: room.code, ...join })); w.onmessage = e => w.msgs.push(JSON.parse(e.data)); w.onclose = () => { w.closed = true; }; setTimeout(() => ok(w), 300); });
  const wrong = await mk({ name: 'X', cid: 'cx', password: 'bad' }); assert(wrong.msgs.some(m => m.t === 'error' && m.code === 'password'));
  const host = await mk({ name: 'Host', cid: 'c1', hostKey: room.hostKey });
  const user = await mk({ name: 'Ala', cid: 'c2', password: 'pw', bio: 'lubię koty', status: 'dnd' });
  assert.equal(host.msgs.find(m => m.t === 'joined').you.role, 'host');
  const uj = user.msgs.find(m => m.t === 'joined'); assert.equal(uj.you.role, 'user'); assert.equal(uj.you.bio, 'lubię koty'); assert.equal(uj.you.status, 'dnd');

  // awatar: upload + profile; duplikat nie zapisuje się drugi raz
  const up1 = await (await fetch(B + '/upload', { method: 'POST', headers: { 'x-key': uj.uploadKey }, body: PNG })).json();
  const up2 = await (await fetch(B + '/upload', { method: 'POST', headers: { 'x-key': uj.uploadKey }, body: PNG })).json();
  assert(up1.url && up1.url === up2.url, 'deduplikacja uploadu');
  user.send(JSON.stringify({ t: 'profile', avatar: up1.url, bio: 'nowe bio' })); await sleep(150);
  assert.equal(host.msgs.filter(m => m.t === 'users').pop().users.find(u => u.name === 'Ala').avatar, up1.url);
  user.send(JSON.stringify({ t: 'profile', avatar: '/media/' + 'f'.repeat(32) })); await sleep(120);
  assert.equal(host.msgs.filter(m => m.t === 'users').pop().users.find(u => u.name === 'Ala').avatar, up1.url, 'cudzy/nieistniejący awatar odrzucony');
  user.send(JSON.stringify({ t: 'msg', text: 'cześć **świat** https://example.com' })); await sleep(150);
  const got = host.msgs.find(m => m.t === 'msg' && m.m.kind === 'text'); assert(got && got.m.avatar === up1.url, 'wiadomość niesie awatar');
  assert.equal((await fetch(B + '/upload', { method: 'POST', headers: { 'x-key': uj.uploadKey }, body: Buffer.from('<script>1</script>') })).status, 415);
  assert.equal((await fetch(B + '/media/..%2f..%2fsettings.json')).status, 404, 'brak path traversal');
  assert.equal((await fetch(B + up1.url)).headers.get('content-type'), 'image/png');
  user.send(JSON.stringify({ t: 'img', url: up1.url })); await sleep(120);

  // moderacja
  const uid = host.msgs.filter(m => m.t === 'users').pop().users.find(u => u.name === 'Ala').id;
  const hid = user.msgs.filter(m => m.t === 'users').pop().users.find(u => u.name === 'Host').id;
  user.send(JSON.stringify({ t: 'mod', act: 'kick', uid: hid })); await sleep(150); assert(!host.closed, 'user nie wyrzuci hosta');
  host.send(JSON.stringify({ t: 'mod', act: 'kick', uid })); await sleep(250); assert(user.closed, 'host wyrzucił usera');
  const adm = await mk({ name: 'Adm', cid: 'c3', adminToken: me.adminToken }); assert.equal(adm.msgs.find(m => m.t === 'joined').you.real, 'admin'); assert.equal(adm.msgs.find(m => m.t === 'joined').you.role, 'user', 'admin nie jest oznaczony nawet we własnym widoku');
  host.send(JSON.stringify({ t: 'room', act: 'topic', value: 'temat' })); await sleep(150);
  // ikona pokoju: tylko obraz z mediów tego pokoju, rozgłaszana w odkrywaniu
  const hj = host.msgs.find(m => m.t === 'joined');
  const upI = await (await fetch(B + '/upload', { method: 'POST', headers: { 'x-key': hj.uploadKey }, body: PNG })).json();
  host.send(JSON.stringify({ t: 'room', act: 'icon', value: 'https://evil.example/x.png' })); await sleep(120);
  assert(!host.msgs.filter(m => m.t === 'room').some(m => m.room.icon), 'zewnętrzny URL nie może być ikoną');
  host.send(JSON.stringify({ t: 'room', act: 'icon', value: upI.url })); await sleep(150);
  assert.equal(host.msgs.filter(m => m.t === 'room').pop().room.icon, upI.url, 'ikona ustawiona');
  assert((await (await fetch(B + '/api/nearby')).json()).some(r => r.code === room.code && r.icon === upI.url), 'ikona w odkrywaniu');

  // --- trwałość po restarcie ---
  const histLen = adm.msgs.find(m => m.t === 'joined').history.length;
  await sleep(900); // zapis jest odroczony o 0,5 s (twarde ubicie procesu na Windows nie wykonuje handlerów exit)
  await stop(srv); await sleep(500); srv = startServer(); await sleep(1300);
  a = await (await fetch(B + '/api/account', { headers: { 'x-account': secret } })).json(); assert(a.exists && a.profile.name === 'Ola', 'konto po restarcie');
  const again = await (await fetch(B + '/api/resolve?code=' + room.code)).json(); assert.equal(again.name, 'Test', 'pokój po restarcie');
  const w2 = await new Promise(ok => { const w = new WebSocket('ws://localhost:7777/ws'); w.msgs = []; w.onopen = () => w.send(JSON.stringify({ t: 'join', room: room.code, name: 'Host', cid: 'c1', hostKey: room.hostKey })); w.onmessage = e => w.msgs.push(JSON.parse(e.data)); setTimeout(() => ok(w), 400); });
  const j2 = w2.msgs.find(m => m.t === 'joined');
  assert(j2, 'host wraca po restarcie (hostKey zachowany)'); assert.equal(j2.you.role, 'host'); assert.equal(j2.room.topic, 'temat'); assert.equal(j2.room.icon, upI.url, 'ikona po restarcie');
  assert(j2.history.some(m => m.kind === 'text' && m.text.includes('cześć')), 'historia po restarcie');
  assert(j2.history.length >= histLen, 'pełna historia');
  assert.equal((await fetch(B + up1.url)).status, 200, 'obraz po restarcie');
  // zamknięcie pokoju usuwa obraz
  const st = await (await fetch(B + '/api/admin/state', { headers: { 'x-admin': (await (await fetch(B + '/api/me')).json()).adminToken } })).json(); assert.equal(st.rooms.length, 1);
  console.log('ALL OK'); await stop(srv); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
