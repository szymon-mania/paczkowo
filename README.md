# Paczkowo — strona marketingowa

Statyczna strona (landing + podstrony) dla **Paczkowo** ([paczkowo.net](https://paczkowo.net)) —
desktopowego systemu OMS (Tauri) do zarządzania zamówieniami i wysyłkami z **Allegro** i **Erli**
oraz integracji z kurierami (**InPost**).

Strona jest w pełni statyczna (SSG) — **bez backendu i bez bazy danych**.

## Stack

- [Astro 5](https://astro.build/) — generowanie statyczne (SSG)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS 4](https://tailwindcss.com/) (przez `@tailwindcss/vite`)
- [React 19](https://react.dev/) — komponenty interaktywne (przełącznik motywu, formularz)
- Dark mode (klasa `.dark` + `localStorage`), responsywność mobile-first

## Strony

| Ścieżka              | Opis                                                            |
| -------------------- | -------------------------------------------------------------- |
| `/`                  | Landing page (hero, jak to działa, funkcje, cennik, FAQ, kontakt) |
| `/login`             | Ekran logowania (UI)                                            |
| `/dashboard`         | Pulpit (UI demonstracyjne)                                      |
| `/orders`            | Lista zamówień (UI demonstracyjne)                             |
| `/pobierz`           | Pobranie najnowszej wersji Paczkowo dla Windows                |
| `/allegro-api-info`  | Strona informacyjna o integracji z Allegro API                 |

## Wymagania

- Node.js **18+** (zalecane 20+)
- npm

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

Aplikacja deweloperska: <http://localhost:4321>

## Build produkcyjny

```bash
npm run build      # generuje statyczne pliki do katalogu ./dist
npm run preview    # podgląd zbudowanej strony lokalnie
```

| Polecenie         | Działanie                              |
| ----------------- | -------------------------------------- |
| **Build command** | `npm run build`                        |
| **Output directory** | `dist`                              |

## Konfiguracja — formularz kontaktowy / waitlista

Formularz na stronie głównej wysyła `POST` (JSON) na konfigurowalny endpoint.
Adres ustawiany jest przez zmienną środowiskową **`PUBLIC_CONTACT_ENDPOINT`**
(prefiks `PUBLIC_` jest wymagany przez Astro, aby zmienna była dostępna w przeglądarce).

1. Skopiuj `.env.example` do `.env`:

   ```bash
   cp .env.example .env
   ```

2. Ustaw wartość:

   ```env
   PUBLIC_CONTACT_ENDPOINT=https://api.paczkowo.net/contact
   ```

Jeśli zmienna nie jest ustawiona, używany jest domyślny adres `https://api.paczkowo.net/contact`.
Endpoint na razie może jedynie logować przychodzące zgłoszenia — strona nie posiada własnej bazy danych.

Wysyłany payload:

```json
{
  "name": "Jan",
  "email": "jan@sklep.pl",
  "message": "...",
  "source": "paczkowo.net/waitlist",
  "submittedAt": "2026-06-26T10:00:00.000Z"
}
```

## Deploy — Cloudflare Pages

Projekt jest przygotowany pod **Cloudflare Pages** (statyczny output `dist`).
Pełna instrukcja podpięcia repozytorium i domeny `paczkowo.net` znajduje się poniżej.

### Ustawienia builda w Cloudflare Pages

- **Framework preset:** `Astro` (lub `None`)
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Environment variables:** `PUBLIC_CONTACT_ENDPOINT = https://api.paczkowo.net/contact`

### Kroki — podłączenie do Cloudflare Pages i domeny paczkowo.net

1. **Wypchnij repozytorium na GitHub/GitLab**

   ```bash
   git remote add origin git@github.com:<twoj-uzytkownik>/paczkowo.git
   git push -u origin main
   ```

2. **Utwórz projekt w Cloudflare Pages**
   - Zaloguj się do [dash.cloudflare.com](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → zakładka **Pages** → **Connect to Git**.
   - Wybierz repozytorium `paczkowo` i zatwierdź dostęp.

3. **Skonfiguruj build**
   - Framework preset: **Astro**
   - Build command: **`npm run build`**
   - Build output directory: **`dist`**
   - (Opcjonalnie) dodaj zmienną środowiskową `PUBLIC_CONTACT_ENDPOINT`.
   - Kliknij **Save and Deploy**. Po chwili strona będzie dostępna pod adresem `https://<projekt>.pages.dev`.

4. **Podłącz domenę `paczkowo.net`**
   - W projekcie Pages otwórz zakładkę **Custom domains** → **Set up a custom domain**.
   - Wpisz `paczkowo.net` i zatwierdź. Powtórz dla `www.paczkowo.net` (opcjonalnie).
   - **Jeśli domena jest już w Cloudflare:** rekordy DNS dodadzą się automatycznie — wystarczy zatwierdzić.
   - **Jeśli domena jest u innego rejestratora:** albo przenieś domenę do Cloudflare (zmiana nameserverów), albo dodaj wskazane rekordy ręcznie:
     - `paczkowo.net` → rekord **CNAME** (lub Apex/ALIAS) na `<projekt>.pages.dev`
     - `www` → **CNAME** na `<projekt>.pages.dev`
   - Cloudflare automatycznie wystawi certyfikat SSL (HTTPS). Propagacja DNS może potrwać do kilkudziesięciu minut.

5. **Gotowe.** Każdy `git push` na gałąź `main` uruchomi automatyczny redeploy.

## Licencja

© Paczkowo. Wszelkie prawa zastrzeżone.
