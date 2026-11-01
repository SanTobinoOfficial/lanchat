// Podstawia prawdziwe repozytorium GitHub w instalatorach i README:  node tools/set-repo.js WLASCICIEL/REPO
const fs = require('fs'), path = require('path');
const repo = process.argv[2] || '';
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error('Użycie: node tools/set-repo.js WLASCICIEL/REPO  (np. jan/lanchat)'); process.exit(1); }
let n = 0;
for (const f of ['install.ps1', 'install.sh', 'README.md']) {
  const p = path.join(__dirname, '..', f); let s = fs.readFileSync(p, 'utf8'); const c = s.split('OWNER/REPO').length - 1;
  if (c) { fs.writeFileSync(p, s.split('OWNER/REPO').join(repo)); n += c; console.log(f + ': ' + c + ' podstawień'); }
}
console.log(n ? 'Gotowe. Jednolinijkowce:' : 'Nic do podstawienia (repo już ustawione?). Jednolinijkowce:');
console.log('  Windows : irm https://raw.githubusercontent.com/' + repo + '/main/install.ps1 | iex');
console.log('  Linux/macOS: curl -fsSL https://raw.githubusercontent.com/' + repo + '/main/install.sh | sh');
