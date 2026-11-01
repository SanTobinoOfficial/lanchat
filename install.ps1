# LanChat - instalator Windows. Bez UAC, bez zaleznosci, bez zmian w zaporze i ustawieniach sieci.
#   irm https://raw.githubusercontent.com/SanTobinoOfficial/lanchat/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = if ($env:LANCHAT_REPO) { $env:LANCHAT_REPO } else { 'SanTobinoOfficial/lanchat' }
$dir  = Join-Path $env:LOCALAPPDATA 'LanChat'
New-Item -ItemType Directory -Force $dir | Out-Null
$exe  = Join-Path $dir 'lanchat.exe'
$tmp  = "$exe.download"
$base = if ($env:LANCHAT_BASE) { $env:LANCHAT_BASE.TrimEnd('/') } else { "https://github.com/$repo/releases/latest/download" }   # LANCHAT_BASE: wlasne lustro/test
$url  = "$base/lanchat-win-x64.exe"

Write-Host "Pobieram LanChat: $url"
try { Invoke-WebRequest $url -OutFile $tmp -UseBasicParsing } catch { throw "Nie udalo sie pobrac $url - czy wydanie istnieje?" }
if ((Get-Item $tmp).Length -lt 10MB) { Remove-Item $tmp -Force; throw 'Pobrany plik jest za maly - przerwano.' }

# aktualizacja: zamknij dzialajaca kopie, podmien plik
Get-Process lanchat -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400
Move-Item $tmp $exe -Force

# polecenie "lanchat" w terminalu: PATH uzytkownika (HKCU) - nie wymaga uprawnien administratora
$p = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not $p) { $p = '' }
if (-not (($p -split ';') -contains $dir)) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';' + $dir).TrimStart(';'), 'User') }

# skroty: pulpit i menu Start (tylko profil uzytkownika)
try {
  $ws = New-Object -ComObject WScript.Shell
  foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'LanChat.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'LanChat.lnk'))) {
    $s = $ws.CreateShortcut($lnk); $s.TargetPath = $exe; $s.WorkingDirectory = $dir; $s.Save()
  }
} catch {}

if ($env:LANCHAT_NO_LAUNCH) { Write-Host "Gotowe! Zainstalowano w $exe"; return }
Write-Host 'Gotowe! Uruchamiam LanChat (w przyszlosci: skrot na pulpicie albo polecenie "lanchat").'
Start-Process $exe
