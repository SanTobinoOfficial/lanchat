# Okno PowerShell zwyklego uzytkownika (bez uprawnien administratora) - tu wklejasz komende instalacyjna.
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$cmd = (Get-Content C:\Temp\lc\command.txt -Raw).Trim()
try { Set-Clipboard -Value $cmd } catch {}
Clear-Host
Write-Host ''
Write-Host '  LanChat - proba instalacji jako ZWYKLY uzytkownik' -ForegroundColor Cyan
Write-Host ('  Konto: ' + $id.Name + '    Administrator: ' + $isAdmin + '    Node/git/Python: brak') -ForegroundColor Gray
Write-Host ''
Write-Host '  1) Wklej ponizsza komende (jest w schowku - Ctrl+V / prawy przycisk) i nacisnij Enter:' -ForegroundColor White
Write-Host ''
Write-Host ('     ' + $cmd) -ForegroundColor Green
Write-Host ''
Write-Host '  2) LanChat uruchomi sie sam. Okno zapory Windows (jesli sie pojawi) pokazuje ograniczenie zwyklego konta:' -ForegroundColor White
Write-Host '     bez admina nie da sie zezwolic na polaczenia z innych komputerow - lokalnie (localhost) wszystko dziala.' -ForegroundColor Gray
Write-Host '  3) Sprawdz: skrot LanChat na pulpicie, polecenie "lanchat" w nowym oknie, strona http://localhost:7777 w Edge.' -ForegroundColor White
Write-Host ''
