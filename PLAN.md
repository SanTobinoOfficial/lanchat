# LanChat – plan

Jeden plik wykonywalny, zero zależności, czat w sieci LAN bez serwera centralnego.

## Architektura
Każda instalacja = lokalny serwer (`http://localhost:7777`, nasłuch też w LAN).

| Rola | Kto | Uprawnienia |
|---|---|---|
| **Admin** | osoba, która uruchomiła aplikację (żądania z loopback + token) | panel admina: wszystkie pokoje tej instancji, zamykanie, bany IP, ustawienia (limity, hosting dla gości LAN, klucz Giphy) |
| **Host pokoju** | twórca pokoju (`hostKey` w przeglądarce) | kick/ban/wyciszenie, usuwanie wiadomości, temat, tryb powolny, awans na moda, własne naklejki, zamknięcie pokoju |
| **User** | każdy, kto dołączy kodem | pisanie, GIF-y, naklejki, reakcje, edycja własnych |

Każdy może być hostem lub userem – wystarczy mieć aplikację. Gość bez instalacji może wejść w przeglądarce na `http://IP-hosta:7777`.

## Dołączanie kodem (bez serwera)
1. Host tworzy pokój → kod `ABC-123`.
2. User wpisuje kod → jego lokalna instancja rozsyła **UDP broadcast** (port 7778) „kto ma pokój ABC123?”.
3. Instancja hosta odpowiada `ip:port`; przeglądarka usera łączy się **bezpośrednio przez WebSocket** z hostem.
4. Awaryjnie: ręczne wpisanie `ip:port` (gdy sieć blokuje broadcast).
Dodatkowo „Pokoje w pobliżu” (publiczne pokoje, UDP `list`).

## Funkcje QOL
Emoji (picker + `:shortcode:`), naklejki (wbudowane + własne pokoju), GIF-y (wklejony link, upload, wyszukiwarka Giphy po wpisaniu klucza), obrazy (wklej Ctrl+V / przeciągnij), linki klikalne + podgląd obrazów, markdown-lite (`**b**`, `*i*`, `~~s~~`, `` `kod` ``, `||spoiler||`), odpowiedzi, reakcje, edycja/usuwanie, @wzmianki, „pisze…”, powiadomienia + licznik w tytule, motyw jasny/ciemny, komendy `/me /shrug /topic`.

## Dystrybucja
- Node SEA → `lanchat-win-x64.exe`, `lanchat-linux-x64`, `lanchat-macos-arm64` (GitHub Actions).
- Instalacja jedną komendą: `irm https://…/install.ps1 | iex` (Windows) / `curl -fsSL https://…/install.sh | sh` (Linux/macOS).

## Etapy
1. [x] Serwer (HTTP+WS+UDP, role, moderacja, upload)
2. [x] UI (czat, picker, admin)
3. [ ] Pakowanie SEA + instalatory + CI
4. [ ] Testy w prawdziwej sieci (2 komputery), firewall Windows (UDP 7778 / TCP 7777)
5. [ ] Opcjonalnie: szyfrowanie (HTTPS z self-signed), historia na dysku, aplikacja mobilna (PWA)
