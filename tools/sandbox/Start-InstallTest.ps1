# LanChat - realistyczne srodowisko do proby instalacji (Windows Sandbox).
# Czyste Windows, zwykle konto BEZ uprawnien administratora, bez Node/gita/Pythona, bez UAC.
#
#   .\Start-InstallTest.ps1            # prawdziwa komenda z GitHuba (potrzebuje internetu i opublikowanego wydania)
#   .\Start-InstallTest.ps1 -Local     # bez internetu: komenda dziala na lokalnym "mirrorze" z dist\lanchat-win-x64.exe
#
# Wymaga: Windows 10/11 Pro/Enterprise z wlaczonym "Windows Sandbox" (Funkcje systemu Windows). Samo uruchomienie nie wymaga admina.
param([switch]$Local)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..\..')).Path
if (-not (Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue)) { throw 'Brak Windows Sandbox. Wlacz funkcje "Windows Sandbox" (Containers-DisposableClientVM) i zrestartuj komputer.' }
$wsbCli = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wsb.exe'   # wsb list: pewniejsze niz szukanie procesow (po zamknieciu zostaja pomocnicze)
$running = if (Test-Path $wsbCli) { ((& $wsbCli list 2>&1 | Out-String) -match '[0-9a-f]{8}-') } else { [bool](Get-Process WindowsSandboxClient -ErrorAction SilentlyContinue) }
if ($running) { throw 'Windows Sandbox jest juz uruchomiony - zamknij go i sprobuj ponownie (dziala tylko jedna instancja).' }
if ($Local -and -not (Test-Path (Join-Path $repo 'dist\lanchat-win-x64.exe'))) { throw 'Brak dist\lanchat-win-x64.exe - zbuduj najpierw: node build.js' }

$mode = if ($Local) { 'local' } else { 'real' }
$net  = if ($Local) { 'Disable' } else { 'Default' }
$folders = "<MappedFolder><HostFolder>$here\guest</HostFolder><SandboxFolder>C:\guest</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>"
if ($Local) { $folders += "<MappedFolder><HostFolder>$repo</HostFolder><SandboxFolder>C:\repo</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>" }
$cfg = "<Configuration><VGpu>Disable</VGpu><Networking>$net</Networking><MemoryInMB>4096</MemoryInMB><MappedFolders>$folders</MappedFolders>" +
       "<LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\guest\setup.ps1 -Mode $mode</Command></LogonCommand></Configuration>"
$wsb = Join-Path $env:TEMP "lanchat-install-$mode.wsb"
[IO.File]::WriteAllText($wsb, $cfg, (New-Object Text.UTF8Encoding($false)))
Write-Host "Uruchamiam Windows Sandbox (tryb: $mode)..."
Write-Host 'Po chwili otworzy sie okno PowerShell jako zwykly uzytkownik - tam wklej komende (jest juz w schowku).'
Start-Process WindowsSandbox.exe -ArgumentList "`"$wsb`""
