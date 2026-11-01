# Zmiany

## 0.3.0
- **GIF-y zawsze działają, bez klucza.** Wbudowana paczka 15 własnych animacji (generowana programowo, działa też bez internetu), reakcje z nekos.best, wyszukiwanie dowolnych haseł przez Wikimedia Commons; Giphy tylko opcjonalnie (jeśli admin ma własny klucz). Kategorie po polsku, „ostatnio używane”, linki giphy.com / imgur .gifv zamieniane na prawdziwy GIF. GIF-y z zaufanych serwisów są pobierane do pokoju, więc historia nie zależy od internetu.
- **Zamiast kodów konta – trzy metody zapisu profilu** do wyboru w ustawieniach: u admina, w przeglądarce, kod base64 (wszystkie dane w jednym tekście). Dla dwóch pierwszych serwer zapisuje IP i rodzaj urządzenia (widoczne dla użytkownika i admina; konto „u admina” można odzyskać po IP przyciskiem „To ja”); base64 nie zostawia żadnego śladu i ukrywa IP przed adminem.
- **Obecność zamiast „wychodzenia”.** Rozłączenie nie usuwa nikogo z pokoju: najpierw „AFK”, po 10 minutach „Niedostępny”. „Wyszedł” oznacza tylko świadome „Opuść pokój”. Członkostwo i profile osób przetrwają restart.
- **Admin incognito.** Dla innych admin wygląda jak zwykły użytkownik (bez znacznika, nie ma go na listach jako admin). Poziomy: admin > host > moderator > użytkownik; odmowy są jednakowe, więc nie zdradzają ukrytego admina.
- **Więcej mocy hosta i admina:** nazwa pokoju, blokada dołączania, limit osób, pokój publiczny/prywatny, czyszczenie historii, lista banów i odbanowanie, ban/wyciszenie osób rozłączonych, brak limitu flood dla hosta.

## 0.2.0
- Nowe logo (dymek czatu z mini-siecią) w pasku, na stronie startowej, w onboardingu i jako favikona (z czerwoną kropką przy nieprzeczytanych).
- Strona startowa (landing) z własną nawigacją, podstrona „Hostuj własny”, onboarding z profilem.
- Konta zapisane na serwerze admina, pokoje trwałe (historia, ustawienia, obrazy), wiele pokoi naraz, pasek pokoi z ikonami.
- QOL: Ctrl+K (szybki przełącznik), Alt+↑/↓ (pokoje), ściąga skrótów (Ctrl+/), podpowiedzi `@osoba` `:emotka` `/komenda`, separatory dat, linia „NOWE”, przycisk „Przejdź do najnowszych”, wyróżnione wzmianki, bloki kodu i cytaty, menu pod prawym przyciskiem (wiadomości, ikony pokoi), wyciszanie pokoi, przeciąganie ikon (kolejność zapisana na serwerze), szkice wiadomości przetrwają przeładowanie, pisanie bez klikania w pole, przycisk „Zaproś”, auto-idle po 5 minutach, kompaktowy widok i rozmiar tekstu, powiadomienia pulpitu, lista aktywnych osób.
- Admin: autostart z Windows (skrót w folderze Autostart użytkownika, bez UAC), instalator serwowany z działającej kopii.
- Instalatory: `irm … | iex` / `curl … | sh` – bez UAC, bez sudo, bez zależności.

## 0.1.0
- Pierwsza wersja: serwer HTTP + WebSocket + UDP discovery, role Admin/Host/User, emotki, GIF-y, naklejki, linki.
