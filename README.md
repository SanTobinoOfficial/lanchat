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
- Profil i ustawienia zapisujesz tak, jak wybierzesz (**Ustawienia → Dane i zapis**, bez kodów konta): **u admina**, **w przeglądarce** albo jako **kod base64** – szczegóły niżej.
- Wiele pokoi naraz jak serwery na Discordzie: **+** tworzy/dołącza kodem, **🧭** pokazuje publiczne pokoje.

## Funkcje i QOL
Emotki, naklejki, GIF-y, obrazy (wklej/przeciągnij), linki z podglądem, `**pogrubienie**`, `*kursywa*`, `` `kod` ``, bloki kodu, cytaty `>`, `||spoiler||`, odpowiedzi, reakcje, edycja, usuwanie, wzmianki `@osoba` (wyróżnione), lista aktywnych osób, role Admin/Host/Moderator, wyciszanie, bany, tryb powolny, hasło do pokoju, własna ikona pokoju.
Wygoda: **Ctrl+K** szybki przełącznik · **Alt+↑/↓** pokoje · **Ctrl+/** ściąga skrótów · podpowiedzi `@` `:` `/` · linia „NOWE” i przycisk „Przejdź do najnowszych” · separatory dat · menu pod prawym przyciskiem (wiadomości, ikony pokoi) · przeciąganie ikon pokoi · wyciszanie pokoi · szkice wiadomości przetrwają przeładowanie · pisanie bez klikania w pole · przycisk „Zaproś” · auto-idle po 5 min · widok kompaktowy i rozmiar tekstu · powiadomienia pulpitu (localhost/https) · kropka nieprzeczytanych na favikonie · autostart z Windows (panel admina, bez UAC).

## GIF-y bez klucza
Panel GIF ma 4 warstwy i nigdy nie jest pusty: **(1)** wbudowana paczka własnych animacji (działa offline), **(2)** reakcje z [nekos.best](https://nekos.best) (darmowe, bez klucza; anime), **(3)** Wikimedia Commons dla dowolnych haseł, **(4)** Giphy – tylko jeśli admin wpisze własny klucz. To nie jest biblioteka memów jak Giphy/Tenor: te serwisy wymagają kluczy (wspólne klucze demo są wyłączone). Można też wkleić link (również ze strony giphy.com) albo wysłać plik. GIF-y z zaufanych serwisów są kopiowane do pokoju.

## Gdzie zapisują się Twoje dane (4 metody)
| Metoda | Gdzie leży profil | Co widzi serwer | Powrót na innym urządzeniu |
|---|---|---|---|
| **U admina** (domyślna) | na dysku admina (`~/.lanchat/accounts.json`) | profil, **adres IP i rodzaj urządzenia** (system, przeglądarka, typ, ekran) w rejestrze admina | „Mam już konto” → serwer rozpoznaje Cię po IP → „To ja” |
| **Hasło** | na dysku admina, jak „u admina”; odzyskanie nazwą konta i hasłem (na dysku tylko skrót scrypt z solą) | profil, **IP i rodzaj urządzenia**, skrót hasła | „Mam już konto” → nazwa konta + hasło (z dowolnego urządzenia) |
| **W tej przeglądarce** | tylko w `localStorage` przeglądarki | **adres IP i rodzaj urządzenia** (profilu nie przechowuje) | kod base64 |
| **Kod base64** | nigdzie – wszystkie dane (profil, ustawienia, pokoje, tożsamość) są w jednym tekście, który trzymasz Ty | **nic nie zapisuje** (ani IP, ani urządzenia); admin nie widzi IP takiej osoby | wklej kod w „Mam już konto” |

Użytkownik zmienia metodę (też na hasło i z powrotem) w ustawieniach (dane są przenoszone, a przy przejściu na base64 serwer kasuje profil i wpis IP/urządzenie). W ustawieniach widać dokładnie, co serwer o Tobie zapisał. Admin widzi w panelu listę osób z IP i urządzeniami (poza trybem base64). Hasło: nazwa konta jest unikalna, po 5 błędnych próbach logowania IP jest blokowane na 5 minut, a błędna nazwa i błędne hasło dają tę samą odpowiedź. **Hasło w sieci lokalnej idzie bez szyfrowania (HTTP)** – użyj hasła, którego nie używasz nigdzie indziej. Uwaga: rozpoznanie po IP to wygoda, nie zabezpieczenie – ktoś z tym samym IP mógłby kliknąć „To ja”; kod base64 zawiera Twoją tożsamość i hasła do pokoi, więc traktuj go jak hasło. Samo połączenie zawsze ujawnia IP serwerowi, ale w trybie base64 nie jest on zapisywany.

## Obecność i uprawnienia
Rozłączenie nie wyrzuca z pokoju: osoba przechodzi w **AFK**, po 10 min w **Niedostępny**; „wyszedł” tylko po „Opuść pokój”. Poziomy: **admin** (ukryty – inni widzą zwykłego użytkownika) > **host** (twórca) > moderator > użytkownik; wyższy poziom może działać na niższych, także na osobach offline. Host i admin: nazwa, ikona, hasło, blokada dołączania, limit, publiczny/prywatny, tryb powolny, czyszczenie historii, lista banów.

## Uruchomienie z kodu
`node server.js` (Node ≥ 22) → `http://localhost:7777`. Plik wykonywalny: `node build.js` (wynik w `dist/`). Testy: `node test.js`.

## Konsola admina (terminal)
Okno, w którym działa LanChat, jest konsolą admina (TUI) – lokalną, bez udziału strony WWW. Wpisz `help`; **Tab** uzupełnia komendy, kody pokoi i nazwy osób, **↑/↓** wybierają podpowiedź lub historię, **PgUp/PgDn** przewijają dziennik. Przykłady: `rooms`, `users`, `kick KOD ala`, `say all Restart za 5 minut`, `banip 192.168.1.20`, `set maxRooms 50`, `chat off` (ukrywa treść wiadomości w dzienniku). `--no-tui` wyłącza konsolę (zwykłe logi).

## Komendy w czacie i własne komendy
Wpisz **/** w polu wiadomości: pojawią się podpowiedzi (**/help** pokazuje wszystko z opisami). Są komendy zabawowe (`/roll 2d6`, `/flip`, `/8ball`, `/choose a | b`), profilu (`/nick`, `/bio`, `/color`, `/theme`, `/afk`), pokoju (`/search`, `/invite`, `/code`, `/users`) i moderacji (`/kick`, `/mute`, `/slow`… – dla moderatorów i hosta). **Własne komendy:** Ustawienia → Moje komendy, np. `gg` → „Dobra gra, {args}! – {me}”; host dodaje komendy pokoju: `/cmd add zasady Szanujemy się`. Aby wysłać tekst zaczynający się od „/”, wpisz „//”.

## AI w czacie (/ai)
Admin wpisuje klucz z openrouter.ai/keys w panelu admina (🛡️) lub w konsoli: `set openrouterKey sk-or-…` (sprawdzisz: `ai`, `ai test`). Wtedy każdy może napisać `/ai pytanie` – zapytanie wysyła serwer, więc goście nie potrzebują klucza i go nie widzą. Domyślnie serwer używa wyłącznie **darmowych modeli** (lista z OpenRouter, automatyczne przełączanie przy limitach i błędach; podgląd: `ai models`) – darmowe modele mają własne limity OpenRouter. Możesz przypiąć konkretny model (`set aiModel …`, także płatny – wtedy koszty liczy OpenRouter na Twoim koncie); dzienne limity serwera ograniczają zużycie. **Prywatność:** treść pytań trafia do OpenRouter (a z włączonym kontekstem także 10 ostatnich wiadomości pokoju). Klucz jest zapisany jawnym tekstem w `~/.lanchat/settings.json` (jak klucz Giphy) – chroń ten folder.

## Próba instalacji w czystym Windows (bez admina)
`toolssandboxStart-InstallTest.ps1` otwiera Windows Sandbox z kontem standardowym i gotową komendą (tryb `-Local` bez internetu) – patrz tools/sandbox/README.md.

## Zapora Windows (ważne)
Aplikacja nie dotyka zapory. Komputer, na którym działa LanChat, musi przyjmować połączenia przychodzące (TCP 7777, UDP 7778) – przy pierwszym uruchomieniu Windows może pokazać okno „Zezwól na dostęp”. Bez praw administratora nie da się go zatwierdzić; wtedy użyj komputera, na którym to możliwe. Goście łączą się wychodząco i niczego nie potrzebują.

## Publikacja wydania (maintainer)
1. Utwórz puste repo na GitHubie, `git remote add origin https://github.com/WLASCICIEL/REPO.git`, `node tools/set-repo.js WLASCICIEL/REPO`, commit, `git push -u origin main`.
2. `git tag v0.2.0 && git push origin v0.2.0` – GitHub Actions zbuduje pliki dla Windows/Linux/macOS i opublikuje wydanie razem z instalatorami (`.github/workflows/release.yml`).
3. Od tej chwili jednolinijkowce powyżej działają. (Buduje x64 dla Windows/Linux i arm64 dla macOS; na Linux arm64 trzeba zbudować z kodu.)

## Dane i prywatność
Wszystko w `~/.lanchat`: `settings.json`, `accounts.json`, `rooms.json`, `media/`. Hasła do pokoi są przy koncie zapisane jawnie na dysku admina. Lista aktywnych osób jest widoczna dla każdego w sieci (imię i status, bez nazw pokoi). Ruch nie jest szyfrowany (HTTP/WS w sieci lokalnej). Zapis jest odroczony o 0,5 s – przy twardym ubiciu procesu można stracić ostatnie wiadomości.
