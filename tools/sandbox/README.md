# Realistyczna próba instalacji (Windows Sandbox)

Czyste Windows, **zwykłe konto bez uprawnień administratora**, bez UAC, bez Node, gita i Pythona – dokładnie tak, jak u osoby, która pierwszy raz instaluje LanChat.

```powershell
cd tools\sandbox
.\Start-InstallTest.ps1          # prawdziwa komenda z GitHuba (internet + opublikowane wydanie)
.\Start-InstallTest.ps1 -Local   # bez internetu: ta sama komenda, ale plik bierze z lokalnego dist\
```

Co się dzieje:
1. Otwiera się Windows Sandbox (jednorazowy, po zamknięciu wszystko znika).
2. Skrypt tworzy w nim konto `uzytkownik` **bez uprawnień administratora** i otwiera w jego imieniu okno PowerShell.
3. W oknie jest gotowa komenda (też w schowku). Wklejasz ją i naciskasz Enter – tak jak na stronie LanChat.
4. LanChat instaluje się do profilu użytkownika (`%LOCALAPPDATA%\LanChat`), dodaje skróty i polecenie `lanchat` (PATH użytkownika) i się uruchamia.

Wymagania: Windows 10/11 Pro/Enterprise z funkcją „Windows Sandbox” (włączenie jej wymaga admina i restartu – raz). Sandbox działa w jednej instancji naraz.

Uwaga: w trybie z GitHuba wydanie musi istnieć (`releases/latest`). Tryb `-Local` używa pliku z `dist\lanchat-win-x64.exe` (zbuduj `node build.js`).

Okno zapory Windows, które pojawi się przy pierwszym uruchomieniu, pokazuje jedyne ograniczenie zwykłego konta: bez admina nie da się zezwolić na połączenia przychodzące z innych komputerów. Lokalnie (localhost) wszystko działa.
