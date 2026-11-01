# LanChat
Prywatny czat w stylu Discorda dla Twojej sieci lokalnej. Jedna osoba go uruchamia, reszta otwiera link w przeglądarce – **bez internetu, bez kont, bez instalacji u znajomych**.

## Instalacja jedną komendą (bez UAC, bez zależności)
Windows (PowerShell – nie musi być „jako administrator”):
```powershell
irm https://raw.githubusercontent.com/SanTobinoOfficial/lanchat/main/install.ps1 | iex
```
Linux / macOS:
```sh
curl -fsSL https://raw.githubusercontent.com/SanTobinoOfficial/lanchat/main/install.sh | sh
```
Instalator pobiera jeden plik z najnowszego wydania do profilu użytkownika (`%LOCALAPPDATA%\LanChat` / `~/.local/bin`), nie rusza zapory ani ustawień sieci, dodaje skróty i polecenie `lanchat`, po czym uruchamia aplikację. Ponowne uruchomienie komendy = aktualizacja. Zmienne: `LANCHAT_BASE` (własne lustro plików), `LANCHAT_NO_LAUNCH=1` (tylko zainstaluj).

> Robisz własnego forka? Podmień repozytorium w instalatorach i README jedną komendą: `node tools/set-repo.js WLASCICIEL/REPO`.

## Jak to działa dla ludzi
- **Admin** (jedyna osoba, która dotyka terminala) uruchamia LanChat. Na stronie głównej dostaje link do wysłania znajomym, np. `http://192.168.1.20:7777`.
- **Pozostali** otwierają link w przeglądarce, ustawiają nick/zdjęcie/opis i piszą. Nic nie instalują.
- Profil, lista pokoi (kolejność, wyciszenia) i ustawienia są zapisane **na serwerze admina**; na nowym urządzeniu wystarczy „Mam już konto” + kod konta. Pokoje (historia, ustawienia, obrazy) przetrwają restart.
- Wiele pokoi naraz jak serwery na Discordzie: **+** tworzy/dołącza kodem, **🧭** pokazuje publiczne pokoje.

## Funkcje i QOL
Emotki, naklejki, GIF-y, obrazy (wklej/przeciągnij), linki z podglądem, `**pogrubienie**`, `*kursywa*`, `` `kod` ``, bloki kodu, cytaty `>`, `||spoiler||`, odpowiedzi, reakcje, edycja, usuwanie, wzmianki `@osoba` (wyróżnione), lista aktywnych osób, role Admin/Host/Moderator, wyciszanie, bany, tryb powolny, hasło do pokoju, własna ikona pokoju.
Wygoda: **Ctrl+K** szybki przełącznik · **Alt+↑/↓** pokoje · **Ctrl+/** ściąga skrótów · podpowiedzi `@` `:` `/` · linia „NOWE” i przycisk „Przejdź do najnowszych” · separatory dat · menu pod prawym przyciskiem (wiadomości, ikony pokoi) · przeciąganie ikon pokoi · wyciszanie pokoi · szkice wiadomości przetrwają przeładowanie · pisanie bez klikania w pole · przycisk „Zaproś” · auto-idle po 5 min · widok kompaktowy i rozmiar tekstu · powiadomienia pulpitu (localhost/https) · kropka nieprzeczytanych na favikonie · autostart z Windows (panel admina, bez UAC).

## Uruchomienie z kodu
`node server.js` (Node ≥ 22) → `http://localhost:7777`. Plik wykonywalny: `node build.js` (wynik w `dist/`). Testy: `node test.js`.

## Zapora Windows (ważne)
Aplikacja nie dotyka zapory. Komputer, na którym działa LanChat, musi przyjmować połączenia przychodzące (TCP 7777, UDP 7778) – przy pierwszym uruchomieniu Windows może pokazać okno „Zezwól na dostęp”. Bez praw administratora nie da się go zatwierdzić; wtedy użyj komputera, na którym to możliwe. Goście łączą się wychodząco i niczego nie potrzebują.

## Publikacja wydania (maintainer)
1. Utwórz puste repo na GitHubie, `git remote add origin https://github.com/WLASCICIEL/REPO.git`, `node tools/set-repo.js WLASCICIEL/REPO`, commit, `git push -u origin main`.
2. `git tag v0.2.0 && git push origin v0.2.0` – GitHub Actions zbuduje pliki dla Windows/Linux/macOS i opublikuje wydanie razem z instalatorami (`.github/workflows/release.yml`).
3. Od tej chwili jednolinijkowce powyżej działają. (Buduje x64 dla Windows/Linux i arm64 dla macOS; na Linux arm64 trzeba zbudować z kodu.)

## Dane i prywatność
Wszystko w `~/.lanchat`: `settings.json`, `accounts.json`, `rooms.json`, `media/`. Hasła do pokoi są przy koncie zapisane jawnie na dysku admina. Lista aktywnych osób jest widoczna dla każdego w sieci (imię i status, bez nazw pokoi). Ruch nie jest szyfrowany (HTTP/WS w sieci lokalnej). Zapis jest odroczony o 0,5 s – przy twardym ubiciu procesu można stracić ostatnie wiadomości.
