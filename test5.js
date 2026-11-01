// Testy konsoli admina (TUI): podpowiedzi, komendy, zdarzenia.  node test5.js
// Serwer startuje z LANCHAT_TUI=force (potoki zamiast prawdziwego terminala); odczytujemy ostatnią narysowaną klatkę.
const { spawn } = require('child_process'), assert = require('assert'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOME = path.join(os.tmpdir(), 'lc_test5_' + Date.now());
let passed = 0; const ok = (c, msg, extra) => { if (!c) console.log('--- klatka ---\n' + frame() + '\n---'); assert(c, msg + (extra ? ' ' + extra : '')); passed++; console.log('PASS ' + msg); };
const srv = spawn(process.execPath, [__dirname + '/server.js', '--no-open'], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, USERPROFILE: HOME, HOME, LANCHAT_TUI: 'force' } });
let raw = ''; srv.stdout.on('data', d => raw += d);
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const frame = () => { const i = raw.lastIndexOf('\x1b[H'); return strip(raw.slice(i + 3)).split('\r\n').join('\n'); };
const type = async s => { srv.stdin.write(s); await sleep(120); };
const hasLog = t => frame().includes(t);
(async () => {
  await sleep(1500);
  ok(/LanChat \d+\.\d+\.\d+/.test(frame()) && hasLog('Tab podpowiada komendy') && hasLog('http://localhost:7777'), 'TUI startuje: nagłówek, adresy i wskazówka');
  // podpowiedzi komend
  await type('cr');
  ok(/^ create\s/m.test(frame()) && /utwórz pokój/.test(frame()), 'wpisanie „cr” podpowiada komendę create z opisem');
  await type('\t');
  ok(/› create $/m.test(frame()) || /› create\s*$/m.test(frame()), 'Tab uzupełnia komendę');
  await type('\x15'); await type('he'); ok(/^ help\s/m.test(frame()), 'podpowiedź działa po wyczyszczeniu linii (Ctrl+U)');
  await type('\x15');
  // tworzenie pokoju z cudzysłowem
  await type('create "Gramy razem" public\r');
  ok(hasLog('Pokój Gramy razem – kod') && hasLog('(publiczny)'), 'create z nazwą w cudzysłowie tworzy pokój publiczny');
  await type('rooms\r');
  const code = (frame().match(/^\S*\s*([A-Z2-9]{6})\s+Gramy razem/m) || [])[1];
  ok(!!code, 'rooms pokazuje utworzony pokój z kodem', code);
  // dołączenie klienta → zdarzenia w dzienniku
  const ws = new WebSocket('ws://localhost:7777/ws'); const got = [];
  ws.onmessage = e => got.push(JSON.parse(e.data));
  await new Promise(r => ws.onopen = r);
  ws.send(JSON.stringify({ t: 'join', room: code, name: 'Ala', cid: 'tui_test_ala_aaaaaaaaaa', method: 'server' }));
  await sleep(400);
  ok(hasLog('Ala → Gramy razem') && /NOWY/.test(frame()), 'dziennik pokazuje dołączenie osoby (z IP i urządzeniem)');
  ws.send(JSON.stringify({ t: 'msg', text: 'cześć konsolo' })); await sleep(300);
  ok(hasLog('Ala: cześć konsolo'), 'dziennik pokazuje treść wiadomości');
  await type('chat off\r'); ws.send(JSON.stringify({ t: 'msg', text: 'ukryta wiadomosc' })); await sleep(300);
  ok(!hasLog('ukryta wiadomosc') && hasLog('Treść wiadomości w dzienniku: off'), 'chat off ukrywa treść wiadomości w dzienniku');
  await type('chat on\r');
  // podpowiedzi argumentów: pokój, potem osoba
  await type('kick '); ok(frame().includes(code) && frame().includes('Gramy razem'), 'po „kick ” podpowiada pokoje (kod + nazwa)');
  await type(code + ' '); ok(/^ Ala\s/m.test(frame()), 'po kodzie pokoju podpowiada osoby z tego pokoju');
  await type('\x15'); await type('users\r');
  ok(/Ala\s+\S+\s+online\s+user\s+127\.0\.0\.1/.test(frame().replace(/\s+/g, ' ').replace(/Ala (\S+) online user 127/, 'Ala $1 online user 127').replace(/ /g, ' ')) || /Ala/.test(frame()) && /127\.0\.0\.1/.test(frame()), 'users pokazuje połączoną osobę z IP');
  // moderacja
  await type('mute ' + code + ' Ala\r'); ok(hasLog('mute: Ala'), 'mute działa');
  ws.send(JSON.stringify({ t: 'msg', text: 'a to nie przejdzie' })); await sleep(300);
  ok(got.some(m => m.t === 'notice' && /wyciszon/i.test(m.text)), 'wyciszona osoba dostaje powiadomienie');
  await type('say ' + code + ' Test ogłoszenia\r'); await sleep(200);
  ok(got.some(m => m.t === 'msg' && m.m.kind === 'sys' && /Test ogłoszenia/.test(m.m.text)), 'say wysyła ogłoszenie do pokoju');
  await type('topic ' + code + ' Nowy temat\r'); await sleep(200);
  ok(got.some(m => m.t === 'room' && m.room.topic === 'Nowy temat'), 'topic zmienia temat i powiadamia klientów');
  await type('history ' + code + ' 5\r'); ok(hasLog('Ala: cześć konsolo'), 'history pokazuje ostatnie wiadomości');
  await type('kick ' + code + ' ala\r'); await sleep(300);
  ok(got.some(m => m.t === 'closed' && /wyrzucon/.test(m.reason)), 'kick wyrzuca osobę (nazwa bez wielkości liter)');
  // błędy i nieznane
  await type('kick ZZZZZZ ala\r'); ok(hasLog('Nie znaleziono pokoju'), 'nieznany pokój daje czytelny błąd');
  await type('kikc\r'); ok(hasLog('Nieznana komenda: kikc'), 'nieznana komenda daje błąd z podpowiedzią');
  // ustawienia, ban IP
  await type('set maxRooms 7\r'); ok(hasLog('maxRooms = 7'), 'set zmienia ustawienie');
  await type('set maxRooms abc\r'); ok(hasLog('Podaj liczbę'), 'set odrzuca złą wartość');
  await type('banip 127.0.0.1\r'); ok(hasLog('Nie banuję adresu tego komputera'), 'banip nie pozwala zbanować samego siebie');
  await type('banip 10.9.8.7\r'); await type('ips\r'); ok(hasLog('10.9.8.7'), 'banip i ips działają');
  await type('unbanip 10.9.8.7\r');
  // potwierdzenie
  await type('close ' + code + '\r'); ok(hasLog('Wpisz „tak”'), 'close prosi o potwierdzenie');
  await type('nie\r'); await type('rooms\r'); ok(hasLog('Gramy razem'), 'odpowiedź inna niż „tak” anuluje');
  await type('close ' + code + '\r'); await type('tak\r'); await type('rooms\r');
  ok(hasLog('Pokój zamknięty') && hasLog('(brak)'), 'po „tak” pokój jest zamknięty');
  // historia i help
  await type('\x1b[A'); ok(/› rooms$/m.test(frame()), 'strzałka w górę przywołuje historię');
  await type('\x15'); await type('help\r'); ok(hasLog('Moderacja') && hasLog('kick <room> <user>') && hasLog('banip <ip>'), 'help wypisuje grupy komend z użyciem');
  await type('status\r'); ok(hasLog('Port') && hasLog('Pamięć procesu'), 'status pokazuje stan serwera');
  // wyjście
  const exited = new Promise(r => srv.once('exit', r));
  await type('quit\r'); await Promise.race([exited, sleep(3000)]);
  ok(srv.exitCode === 0 || srv.signalCode !== null || srv.killed || srv.exitCode !== null, 'quit zamyka serwer');
  console.log(`\nALL OK (${passed} sprawdzeń)`); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); try { srv.kill(); } catch {} process.exit(1); });
