# Dziala WEWNATRZ Windows Sandbox przy logowaniu (jako WDAGUtilityAccount - w Sandboxie to admin).
# Tworzy zwykle konto lokalne i otwiera w jego imieniu okno PowerShell - dalej wszystko dzieje sie BEZ uprawnien administratora.
param([ValidateSet('real', 'local')][string]$Mode = 'real')
$ErrorActionPreference = 'Continue'
$pw = 'Lc!Instal1234'   # maks. 14 znakow (dluzsze wywoluja pytanie w "net user")
New-Item -ItemType Directory -Force C:\Temp\lc | Out-Null
Copy-Item C:\guest\user-session.ps1 C:\Temp\lc\user-session.ps1 -Force
& icacls C:\Temp\lc /grant '*S-1-1-0:(OI)(CI)F' | Out-Null   # SID "Wszyscy" - dziala w kazdym jezyku Windows
& net user uzytkownik /delete 2>&1 | Out-Null
& net user uzytkownik $pw /add /fullname:"Zwykly uzytkownik" 2>&1 | Out-Null
$cred = New-Object Management.Automation.PSCredential('.\uzytkownik', (ConvertTo-SecureString $pw -AsPlainText -Force))

if ($Mode -eq 'local') {
  # lokalny "GitHub" w natywnym PowerShellu: serwuje install.ps1 i exe z repozytorium (bez internetu)
  New-Item -ItemType Directory -Force C:\Temp\lc\srv | Out-Null
  Copy-Item C:\repo\install.ps1, C:\repo\dist\lanchat-win-x64.exe C:\Temp\lc\srv -Force
  $one = "`$env:LANCHAT_BASE='http://localhost:8099'; irm http://localhost:8099/install.ps1 | iex"
} else {
  $one = 'irm https://raw.githubusercontent.com/SanTobinoOfficial/lanchat/main/install.ps1 | iex'
}
Set-Content -Path C:\Temp\lc\command.txt -Value $one -Encoding UTF8
Start-Process powershell.exe -Credential $cred -LoadUserProfile -WorkingDirectory C:\Users -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', 'C:\Temp\lc\user-session.ps1'

if ($Mode -eq 'local') {
  $l = New-Object Net.HttpListener; $l.Prefixes.Add('http://localhost:8099/'); $l.Start()
  while ($l.IsListening) {
    $c = $l.GetContext(); $p = $c.Request.Url.AbsolutePath.TrimStart('/'); $f = 'C:\Temp\lc\srv\' + $p
    if ($p -match '^(install\.ps1|lanchat-win-x64\.exe)$' -and (Test-Path $f)) { $b = [IO.File]::ReadAllBytes($f); $c.Response.ContentLength64 = $b.Length; $c.Response.OutputStream.Write($b, 0, $b.Length) } else { $c.Response.StatusCode = 404 }
    $c.Response.Close()
  }
}
