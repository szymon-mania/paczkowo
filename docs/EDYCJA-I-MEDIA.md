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

## DaVinci Resolve: szybki workflow

1. Nagraj ekran aplikacji w rozdzielczości 1920x1080, ale pokazuj jedną czynność: np. utworzenie etykiety albo filtrowanie zamówień.
2. W DaVinci ustaw krótkie ujęcie, najlepiej 6-12 sekund, 24 lub 30 FPS. Usuń długie przejścia i dźwięk.
3. Wyeksportuj plik MP4 H.264, 1080p, z rozsądnym bitrate. Zostaw pierwszy kadr czytelny, bo posłuży jako plakat.
4. Wygeneruj plakat WebP z pierwszego kadru: `public/media/nazwa.webp`.
5. Dla jeszcze mniejszej wagi przygotuj WebM VP9 z MP4 za pomocą ffmpeg:

```powershell
ffmpeg -i public/media/nazwa.mp4 -c:v libvpx-vp9 -crf 33 -b:v 0 -an public/media/nazwa.webm
```

6. Wstaw oba pliki według przykładu z poprzedniej sekcji. Strona najpierw wybierze WebM, a MP4 zostanie zapasowym formatem.

Nie eksportuj prezentacji aplikacji jako GIF. Ten sam materiał będzie wielokrotnie cięższy, bez jakości potrzebnej do czytania interfejsu.

## Wizualna edycja

Obecna strona jest statyczna, więc publiczny edytor „kliknij i zapisz” wymaga
logowania oraz miejsca, które bezpiecznie zapisze treść. Nie warto otwierać
takiego panelu bez autoryzacji. Najlepszy następny krok produkcyjny to osobny
panel CMS na tym samym serwerze (np. Directus + PostgreSQL) z rolą tylko dla
właściciela strony. Wtedy edytujesz teksty, zdjęcia i filmy w przeglądarce,
a publikacja przebudowuje tę stronę automatycznie.
