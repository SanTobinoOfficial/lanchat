// Builds a single self-contained executable for the CURRENT OS/arch: node build.js
// Output: dist/lanchat-<os>-<arch>[.exe]   (needs network once, for `npx postject`)
const fs = require('fs'), path = require('path'), { execFileSync, execSync } = require('child_process');
const root = __dirname, dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const plat = { win32: 'win', darwin: 'macos', linux: 'linux' }[process.platform], ext = process.platform === 'win32' ? '.exe' : '';
const out = path.join(dist, `lanchat-${plat}-${process.arch}${ext}`);
const cfg = path.join(dist, 'sea-config.json'), blob = path.join(dist, 'sea.blob');
fs.writeFileSync(cfg, JSON.stringify({ main: path.join(root, 'server.js'), output: blob, disableExperimentalSEAWarning: true, assets: { 'index.html': path.join(root, 'public', 'index.html') } }));
execFileSync(process.execPath, ['--experimental-sea-config', cfg], { stdio: 'inherit' });
fs.copyFileSync(process.execPath, out);
if (process.platform === 'darwin') try { execSync(`codesign --remove-signature "${out}"`); } catch {}
const args = ['postject', out, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
if (process.platform === 'darwin') try { execSync(`codesign --sign - "${out}"`); } catch {}
if (process.platform !== 'win32') fs.chmodSync(out, 0o755);
console.log('Built', out, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
