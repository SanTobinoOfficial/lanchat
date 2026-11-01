// Podstawia repozytorium GitHub w instalatorach i README (przydatne po forku):  node tools/set-repo.js WLASCICIEL/REPO
const fs = require('fs'), path = require('path');
const repo = process.argv[2] || '';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error('Użycie: node tools/set-repo.js WLASCICIEL/REPO  (np. jan/lanchat)'); process.exit(1); }
const root = path.join(__dirname, '..');
const ps = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
const current = (ps.match(/LANCHAT_REPO \} else \{ '([^']+)'/) || [])[1] || 'OWNER/REPO';   // repo wpisane aktualnie jako domyślne
let n = 0;
for (const f of ['install.ps1', 'install.sh', 'README.md', 'server.js']) {
  const p = path.join(root, f), s = fs.readFileSync(p, 'utf8'), c = s.split(current).length - 1;
  if (c && current !== repo) { fs.writeFileSync(p, s.split(current).join(repo)); n += c; console.log(f + ': ' + c + ' podstawień (' + current + ' → ' + repo + ')'); }
}
console.log(n ? 'Gotowe. Jednolinijkowce:' : 'Nic do zmiany (repo już ustawione). Jednolinijkowce:');
console.log('  Windows    : irm https://raw.githubusercontent.com/' + repo + '/main/install.ps1 | iex');
console.log('  Linux/macOS: curl -fsSL https://raw.githubusercontent.com/' + repo + '/main/install.sh | sh');
