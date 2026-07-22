# Logo integracji

Wrzuć tu pliki logo platform, a pojawią się w „Dodaj integrację" i na liście kont
(zamiast emoji). Nazwy plików = klucz platformy, format **SVG** (najlepiej) lub PNG:

- `allegro.svg`
- `erli.svg`
- `inpost.svg`
- `fakturownia.svg`
- `fakturowo.svg`

Ścieżka w aplikacji: `/logos/<platforma>.svg` (folder `public/` jest serwowany z roota).
Jeśli pliku nie ma, UI pokaże fallback (literę/kolor) — nic się nie zepsuje.

Zalecane: kwadratowe, ~64×64, czytelne na jasnym i ciemnym tle.
