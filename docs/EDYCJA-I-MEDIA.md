# Edycja strony i media

## Co edytujesz najczęściej

- Teksty strony głównej: `src/pages/index.astro`.
- Strona pobierania Windows: `src/pages/pobierz.astro`.
- Stały adres pobierania: `src/config/downloads.ts`. Nie zmieniaj go na adres
  z numerem wydania - ma pozostać `https://api.paczkowo.net/downloads/latest/windows-x64`.
- Kolory i typografia: `src/styles/global.css`.

Po zmianie uruchom `npm run dev`; przeglądarka odświeży podgląd automatycznie.
Wersję produkcyjną buduje `npm run build`.

## Animacje produktu

Do pokazywania interfejsu używaj przede wszystkim krótkiego filmu WebM, z MP4
jako zapasowym formatem. GIF-y są wyraźnie cięższe, gorzej się kompresują i nie
powinny być używane do nagrań aplikacji. Sekwencje PNG mają sens tylko w bardzo
specyficznych przypadkach i na tej stronie nie są potrzebne.

Polecany materiał:

- 6-12 sekund, tylko jedna konkretna czynność w aplikacji;
- 1280 px szerokości lub mniej, 24-30 FPS;
- WebM VP9 jako główne źródło, MP4 H.264 jako fallback;
- statyczny plakat WebP w tym samym kadrze;
- bez dźwięku, a film uruchamiany z `muted`, `playsinline`, `loop`;
- filmy niżej na stronie ładuj dopiero, gdy użytkownik do nich dojdzie.

Przykład osadzenia:

```astro
<video autoplay muted loop playsinline poster="/media/pakowanie.webp" preload="metadata">
  <source src="/media/pakowanie.webm" type="video/webm" />
  <source src="/media/pakowanie.mp4" type="video/mp4" />
</video>
```

Pliki wgrywaj do `public/media/`; będą dostępne pod adresem `/media/nazwa-pliku`.

## Wizualna edycja

Obecna strona jest statyczna, więc publiczny edytor „kliknij i zapisz” wymaga
logowania oraz miejsca, które bezpiecznie zapisze treść. Nie warto otwierać
takiego panelu bez autoryzacji. Najlepszy następny krok produkcyjny to osobny
panel CMS na tym samym serwerze (np. Directus + PostgreSQL) z rolą tylko dla
właściciela strony. Wtedy edytujesz teksty, zdjęcia i filmy w przeglądarce,
a publikacja przebudowuje tę stronę automatycznie.
