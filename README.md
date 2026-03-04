## AI-driven Automation Gateway Template

To repozytorium jest szablonem **rozproszonej bramy automatyzacji sterowanej AI**, łączącej:

- **n8n** (event-driven workflow automation),
- **Telegram** (interfejs konwersacyjny),
- **Garmin / biometria** (sygnały stresu),
- **PostgreSQL** (trwały stan użytkownika),
- lekkie mikroserwisy:
  - `node-gateway` (Node.js + TypeScript + Fastify + Telegraf + pg),
  - `biometric-proxy` (Python + FastAPI + garminconnect).

System jest zaprojektowany tak, aby:

- łatwo odpalić go **lokalnie w Dockerze**,
- równie łatwo przenieść konfigurację na **serwer Mikrus**.

---

## Struktura repozytorium

- `infrastructure/`
  - `install-docker.sh` – instalacja Docker + Docker Compose plugin na serwerze (np. Mikrus).
  - `setup-firewall.sh` – podstawowy firewall w oparciu o `ufw` (otwiera tylko kluczowe porty).
- `n8n-workflows/`
  - Eksportowane workflowy n8n (`.json`) trzymane w Git.
- `custom-bots/`
  - `node-gateway/` – gateway Telegram + internal API + state machine (TypeScript, Fastify, Telegraf, pg).
  - `biometric-proxy/` – proxy biometrów Garmin (Python, FastAPI, garminconnect).
  - Katalog `example-bot/` został usunięty; ostatni commit z jego zawartością: `ecbcfba2f55579382156957859adda8b7550f8ff` (jako referencja w historii Git).
- `deploy/`
  - `docker-compose.yml` – przepis na cały zestaw usług:
    - `postgres` dla n8n i stanów użytkownika,
    - `n8n`,
    - `node-gateway`,
    - `biometric-proxy`.
- `.env.example`
  - Szablon zmiennych środowiskowych (n8n, Postgres, Telegram, Garmin, internal API keys).

---

## Wymagania wstępne

- Lokalnie:
  - system z Docker + Docker Compose plugin (`docker compose`),
  - dostęp do powłoki (bash / zsh).
- Na serwerze Mikrus:
  - działający serwer (np. frog/turtle itp.),
  - dostęp przez SSH jako użytkownik z uprawnieniami `sudo`,
  - podstawowa znajomość dokumentacji Mikrusa (`https://wiki.mikr.us/`).

---

## Konfiguracja `.env`

1. Skopiuj szablon:

```bash
cp .env.example .env
```

2. Edytuj `.env`:

- **Podstawowe zmienne n8n:**
  - `N8N_HOST` – lokalnie np. `localhost`, na Mikrusie: domena / IP.
  - `N8N_PORT` – domyślnie `5678`.
  - `N8N_PROTOCOL` – lokalnie zazwyczaj `http` (w produkcji najlepiej za reverse proxy z HTTPS).
  - `N8N_BASIC_AUTH_USER`, `N8N_BASIC_AUTH_PASSWORD` – ustaw własne, silne hasło.
  - `N8N_ENCRYPTION_KEY` – losowy, długi string (ważne w produkcji).
- **Baza Postgres:**
  - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` – ustaw własne wartości (nie commituj prawdziwych haseł).
- **Telegram / Gateway:**
  - `TELEGRAM_BOT_TOKEN` – token z `@BotFather` używany przez `node-gateway`.
- **Distributed Automation Gateway:**
  - `N8N_WEBHOOK_URL` – URL webhooka w n8n, na który gateway wysyła zdarzenia.
  - `N8N_WEBHOOK_SECRET` – sekretny nagłówek do uwierzytelniania żądań `node-gateway -> n8n`.
  - `VOICE_BASE64_MAX_BYTES` – maksymalny rozmiar notatki głosowej dopuszczony do pobrania i kodowania Base64.
  - `OUTBOX_PROCESSED_TTL_HOURS` – retencja rekordów outbox ze statusem `processed` (domyślnie 72h).
  - `INTERNAL_API_KEY` – sekretny klucz do komunikacji między `biometric-proxy` a `node-gateway`.
  - `GARMIN_EMAIL`, `GARMIN_PASSWORD` – dane logowania do Garmin Connect.
  - `STRESS_ALERT_THRESHOLD` – próg stresu, powyżej którego wysyłany jest impuls (domyślnie 70).
  - `MASTER_CHAT_ID` – Chat ID właściciela bota, który:
    - ma pełny dostęp do gatewaya,
    - zawsze otrzymuje alerty stresowe,
    - może zarządzać whitelistą dopuszczonych chatów.
- **Ogólne:**
  - `TZ` – strefa czasowa, np. `Europe/Warsaw`.

Plik `.env` powinien pozostać **tylko lokalnie / na serwerze**. Do Gita commituj wyłącznie `.env.example`.

---

## Uruchomienie lokalne – pełny gateway (Docker)

1. Upewnij się, że masz Docker:

```bash
docker --version
docker compose version
```

2. W katalogu repo:

```bash
cp .env.example .env
# edytuj .env (min. hasła, host, tokeny, INTERNAL_API_KEY, dane Garmina, MASTER_CHAT_ID)

cd deploy
docker compose up -d
```

3. Wejdź w przeglądarce na panel n8n:

- `http://localhost:5678` (jeśli nie zmieniałeś `N8N_PORT`),
- lub `http://localhost:<N8N_PORT>` jeśli zmieniłeś.

4. W Telegramie:

- utwórz bota przez `@BotFather`,
- ustaw `TELEGRAM_BOT_TOKEN` i `MASTER_CHAT_ID` (swój Chat ID) w `.env`,
- wyślij do bota komendę **`/start`** – pojawi się powitanie i **klikalne menu** (przyciski: Impuls, a dla ownera także Allow here / Revoke here / Lista whitelist),
- możesz też wpisać `/impuls`, aby przetestować zmianę stanu na `cooling_down_120s`.

5. W Garminie:

- ustaw realne `GARMIN_EMAIL` i `GARMIN_PASSWORD`,
- po przekroczeniu progu stresu (`STRESS_ALERT_THRESHOLD`) `biometric-proxy` wyśle alert do `node-gateway`, który przekaże go do ownera i whitelistowanych chatów w Telegramie.

---

## Uruchomienie na Mikrusie

1. Przygotowanie serwera (Docker + firewall):

```bash
git clone <URL_DO_TEOREPO> n8n-setup
cd n8n-setup

sudo bash infrastructure/install-docker.sh
sudo SSH_PORT=22 N8N_PORT=5678 bash infrastructure/setup-firewall.sh
```

2. Konfiguracja `.env` na serwerze:

```bash
cp .env.example .env
nano .env   # lub inny edytor
```

Ustaw:

- `N8N_HOST` na swoją domenę / subdomenę Mikrusa,
- `N8N_PORT` na port zgodny z konfiguracją / Cloudflare / proxy,
- realne hasła, tokeny, dane Garmina, `INTERNAL_API_KEY`, `MASTER_CHAT_ID`.

3. Uruchomienie usług na Mikrusie:

```bash
cd deploy
docker compose up -d
```

To uruchomi:

- `postgres`,
- `n8n`,
- `node-gateway`,
- `biometric-proxy`.

Następnie:

- skonfiguruj domenę / subdomenę zgodnie z dokumentacją Mikrusa i ewentualnie Cloudflare,
- możesz użyć Nginx jako reverse proxy.

---

## Workflowy n8n w Git

- Eksportuj workflowy w n8n do plików `.json`.
- Zapisuj je w katalogu `n8n-workflows/`.
- Commituj do repo razem z infrastrukturą.

Dzięki temu:

- masz historię zmian automatyzacji,
- możesz łatwo odtworzyć / porównać workflowy między środowiskami.

---

## Security Considerations

- **Izolacja sieci**:
  - Wszystkie serwisy (`postgres`, `n8n`, `node-gateway`, `biometric-proxy`) działają w jednej, prywatnej sieci Dockera.
  - Do świata zewnętrznego wystawione są tylko:
    - port n8n (`N8N_PORT`),
    - port bota (`8000` – jeśli chcesz wystawić webhooki zewnętrznie lub panel diagnostyczny).
- **Internal API keys**:
  - Komunikacja między `biometric-proxy` a `node-gateway` odbywa się po prywatnym adresie `http://node-gateway:8000` z nagłówkiem `x-internal-api-key`.
  - `INTERNAL_API_KEY` jest tajnym kluczem przechowywanym wyłącznie w `.env` / sekrecie serwera.
  - Bez poprawnego klucza wewnętrzne endpointy `/api/internal/message` zwracają `401 Unauthorized`.
- **Sekrety**:
  - Tokeny Telegrama, dane logowania do Garmina, klucze n8n i `INTERNAL_API_KEY` **nigdy** nie powinny trafiać do Gita.
  - Zawsze edytuj tylko lokalny `.env` lub sekrety środowiskowe na serwerze (np. Mikrus).

---

## Dalsza rozbudowa

- Dodaj kolejne mikroserwisy (np. integracje z innymi dostawcami biometrów).
- Rozbuduj workflowy w `n8n-workflows/` tak, aby:
  - generować plany działania w odpowiedzi na stres,
  - uruchamiać dodatkowe automatyzacje (np. zapisy do Notion / Obsidian, trigger tasków).
- Dodaj E2E testy (np. Playwright dla panelu www, jeśli dodasz frontend).

---

## Testy i coverage

- **Node Gateway (Jest + ts-jest)**:
  - uruchomienie testów z coverage:

    ```bash
    cd custom-bots/node-gateway
    npm test          # z włączonym collectCoverage oraz progami globalnymi (min. 50%)
    # lub jawnie
    npm run test:coverage
    ```

  - coverage jest liczone dla kluczowej logiki (`src/telegramBot.ts`, `src/server.ts`),
  - próg globalny wymusza minimalne pokrycie, tak aby nie dopuścić do całkowicie nietestowanego kodu.

- **Biometric Proxy (pytest + pytest-cov)**:
  - uruchomienie testów z coverage:

    ```bash
    cd custom-bots/biometric-proxy
    pytest --cov=app --cov-report=term-missing --cov-fail-under=60
    ```

  - Dockerfile build stage również używa komendy z coverage gate (`--cov-fail-under=60`),
  - 100% pokrycia dla logiki decyzyjnej (`DecisionWorker`) i parsera stresu, sensowne minimum dla reszty (config / main / http client).

### Lint i formatowanie

- **Node Gateway (ESLint + Prettier)**:
  - `cd custom-bots/node-gateway && npm run lint` — sprawdzenie reguł,
  - `npm run lint:fix` — automatyczne poprawki,
  - `npm run format` — formatowanie kodu, `npm run format:check` — weryfikacja bez zapisu.
- **Biometric Proxy (Ruff)**:
  - `cd custom-bots/biometric-proxy && ruff check app tests` — lint,
  - `ruff check app tests --fix` — automatyczne poprawki,
  - `ruff format app tests` — formatowanie, `ruff format --check app tests` — weryfikacja.

## n8n-setup – automatyzacje + boty Telegram

Repozytorium służy do wersjonowania infrastruktury pod:

- **n8n** (automatyzacje),
- **boty Telegram** (np. w Pythonie),
- **konfigurację serwera Mikrus** (firewall, Docker),
- **workflowy n8n w JSON** (pod Git).

Całość jest zaprojektowana tak, aby:

- łatwo odpalić n8n **lokalnie w Dockerze**,
- równie łatwo przenieść konfigurację na **serwer Mikrus**.

---

## Struktura repozytorium

- **`infrastructure/`**
  - `install-docker.sh` – instalacja Docker + Docker Compose plugin na serwerze (np. Mikrus).
  - `setup-firewall.sh` – podstawowy firewall w oparciu o `ufw` (otwiera tylko kluczowe porty).
- **`n8n-workflows/`**
  - Tutaj trzymasz eksportowane workflowy n8n (`.json`).
  - Dzięki temu masz historię zmian w Gicie.
- **`custom-bots/`**
  - Miejsce na boty Telegram i gateway (Node Gateway, Biometric Proxy). Katalog `example-bot/` usunięty; referencja w Git: `ecbcfba2f55579382156957859adda8b7550f8ff`.
- **`deploy/`**
  - `docker-compose.yml` – przepis na cały zestaw usług:
    - `postgres` dla n8n,
    - `n8n`,
    - przykładowy `telegram-bot`.
- **`.env.example`**
  - Szablon zmiennych środowiskowych (n8n, Postgres, Telegram).
  - **Nigdy nie commituj prawdziwych tokenów / haseł.**

---

## Wymagania wstępne

- Lokalnie:
  - system z Docker + Docker Compose plugin (`docker compose`),
  - dostęp do powłoki (bash / zsh).
- Na serwerze Mikrus:
  - działający serwer (np. frog/turtle itp.),
  - dostęp przez SSH jako użytkownik z uprawnieniami `sudo`,
  - podstawowa znajomość dokumentacji Mikrusa: [`https://wiki.mikr.us/`](https://wiki.mikr.us/).

---

## Konfiguracja `.env`

1. Skopiuj szablon:

   ```bash
   cp .env.example .env
   ```

2. Edytuj `.env`:

   - **Podstawowe zmienne n8n:**
     - `N8N_HOST` – lokalnie np. `localhost`, na Mikrusie: domena / IP.
     - `N8N_PORT` – domyślnie `5678`.
     - `N8N_PROTOCOL` – lokalnie zazwyczaj `http` (w produkcji najlepiej za reverse proxy z HTTPS).
     - `N8N_BASIC_AUTH_USER`, `N8N_BASIC_AUTH_PASSWORD` – ustaw własne, silne hasło.
     - `N8N_ENCRYPTION_KEY` – losowy, długi string (ważne w produkcji).
   - **Baza Postgres:**
     - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` – ustaw własne wartości (nie commituj prawdziwych haseł).
   - **Telegram:**
     - `TELEGRAM_BOT_TOKEN` – token z `@BotFather`.
     - `TELEGRAM_WEBHOOK_URL` – do webhooków (opcjonalnie, jeśli użyjesz).
   - **Ogólne:**
     - `TZ` – strefa czasowa, np. `Europe/Warsaw`.

Plik `.env` powinien pozostać **tylko lokalnie / na serwerze**. Do Gita commituj wyłącznie `.env.example`.

---

## Uruchomienie n8n lokalnie (Docker)

1. Upewnij się, że masz Docker:

   ```bash
   docker --version
   docker compose version
   ```

2. W katalogu repo:

   ```bash
   cp .env.example .env
   # edytuj .env (min. hasła i host)

   cd deploy
   docker compose up -d postgres n8n
   ```

3. Wejdź w przeglądarce na:

   - `http://localhost:5678` (jeśli nie zmieniałeś `N8N_PORT`),
   - lub `http://localhost:<N8N_PORT>` jeśli zmieniłeś.

4. Workflowy:

   - eksportuj z n8n do plików `.json`,
   - zapisuj w `n8n-workflows/`,
   - commituj do Gita razem z resztą repo.

### Lokalny test bota Telegram

1. Uzupełnij w `.env`:

   - `TELEGRAM_BOT_TOKEN`.

2. Odpal bota:

   ```bash
   cd deploy
   docker compose up -d telegram-bot
   ```

3. W Telegramie wyślij do swojego bota komendę `/start`. Logikę bota rozbudowuj w `custom-bots/node-gateway/`.

---

## Uruchomienie na Mikrusie

### 1. Przygotowanie serwera (Docker + firewall)

Na Mikrusie zaloguj się przez SSH, sklonuj repo i przejdź do katalogu:

```bash
git clone <URL_DO_TEOREPO> n8n-setup
cd n8n-setup
```

1. **Instalacja Dockera**:

   ```bash
   sudo bash infrastructure/install-docker.sh
   ```

2. **Firewall (ufw)**:

   Skrypt domyślnie otworzy porty:

   - `22` (SSH – można zmienić przez `SSH_PORT`),
   - `80` (HTTP),
   - `443` (HTTPS),
   - `5678` (port n8n – można zmienić przez `N8N_PORT`).

   Uruchom:

   ```bash
   sudo SSH_PORT=22 N8N_PORT=5678 bash infrastructure/setup-firewall.sh
   ```

   Jeśli wcześniej zmieniłeś port SSH w `sshd_config`, podaj tu ten sam port w `SSH_PORT`.

### 2. Konfiguracja `.env` na serwerze

Na Mikrusie w katalogu repo:

```bash
cp .env.example .env
nano .env   # lub inny edytor
```

Ustaw:

- `N8N_HOST` na swoją domenę / subdomenę Mikrusa,
- `N8N_PORT` na port zgodny z konfiguracją / Cloudflare / proxy,
- realne hasła i tokeny (nie commituj ich do Gita).

### 3. Uruchomienie usług na Mikrusie

```bash
cd deploy
docker compose up -d
```

To uruchomi:

- `postgres`,
- `n8n`,
- przykładowego `telegram-bot` (domyślnie z `replicas: 0`, więc nie będzie aktywny, dopóki nie zmienisz konfiguracji).

Następnie:

- skonfiguruj domenę / subdomenę zgodnie z dokumentacją Mikrusa i ewentualnie Cloudflare,
- możesz użyć Nginx jako reverse proxy (patrz: sekcje typu *Reverse Proxy na Nginx* w [`https://wiki.mikr.us/`](https://wiki.mikr.us/)).

---

## Workflowy n8n w Git

- **Eksportuj** workflowy w n8n do plików `.json`.
- **Zapisuj** je w katalogu `n8n-workflows/`.
- **Commituj** do repo razem z infrastrukturą.

Dzięki temu:

- masz historię zmian automatyzacji,
- możesz łatwo odtworzyć / porównać workflowy między środowiskami.

---

## Custom boty Telegram

- Każdy bot trzyma swój kod w osobnym podkatalogu `custom-bots/<nazwa-bota>/`.
- Obecne serwisy: `node-gateway/` (TypeScript) i `biometric-proxy/` (Python). Katalog `example-bot/` został usunięty (referencja: commit `ecbcfba2f55579382156957859adda8b7550f8ff`).
- Aby dodać nowego bota:
  1. Utwórz nowy katalog w `custom-bots/`.
  2. Dodaj `Dockerfile` i kod bota.
  3. Dodaj nowy serwis do `deploy/docker-compose.yml`.
  4. Ustaw odpowiednie zmienne w `.env` (np. nowe tokeny).

---

## Przydatne linki

- **Dokumentacja Mikrusa**: [`https://wiki.mikr.us/`](https://wiki.mikr.us/)
- (opcjonalnie) Dokumentacja n8n: [`https://docs.n8n.io/`](https://docs.n8n.io/)

