### Architectural Decision Records

#### ADR-001: Polyglot Microservices (Node.js + Python) instead of a monolithic Telegram bot

- **Context**: Początkowo cała logika bota Telegram była zaimplementowana w jednym, monolitycznym skrypcie Pythona. Z czasem pojawiły się wymagania dotyczące:
  - integracji z n8n (workflow automation),
  - integracji z zewnętrznymi źródłami biometrów (Garmin),
  - separacji odpowiedzialności (gateway, decision engine, data storage),
  - łatwego skalowania tylko wybranych części systemu.
- **Decision**:
  - Wydzielono dwa niezależne serwisy:
    - `node-gateway` (Node.js + TypeScript, Fastify, Telegraf, pg),
    - `biometric-proxy` (Python, FastAPI, garminconnect).
  - Każdy serwis ma osobny cykl życia, osobny Dockerfile i niezależne testy.
- **Consequences**:
  - Możliwość niezależnego skalowania (np. większy ruch po stronie Telegrama vs rzadsze wywołania biometrów).
  - Lepsza separacja odpowiedzialności (Gateway jako „zewnętrzna kora przedczołowa”, Proxy jako adapter do biometrów).
  - Łatwiejsze eksperymentowanie z różnymi stosami technologicznymi (Node + ekosystem JS do integracji z n8n, Python do pracy z bibliotekami data/ML/biometry).
  - Minimalny, ale akceptowalny koszt dodatkowej złożoności operacyjnej (więcej kontenerów, więcej healthchecków).

---

#### ADR-009: Transakcyjny Outbox dla planów Telegram + bezpieczne voice Base64

- **Context**: Dotychczas `node-gateway` wysyłał payload do n8n synchronicznie z handlera Telegram. Awarie sieci lub n8n powodowały utratę danych. Dla voice przekazywany był ulotny `fileUrl` (TTL). Brak odkurzania powodował bloat bazy.
- **Decision**: Transakcyjny zapis do `outbox_events` z atomową zmianą stanu `awaiting_plan -> default`. Voice: pre-check rozmiaru (`VOICE_BASE64_MAX_BYTES`) przed pobraniem; audio w Base64 w `payload_json`. Worker outbox (setInterval) wysyła do n8n z `x-correlation-id`, `x-webhook-secret`, `x-idempotency-key`; 2xx → processed, 4xx → failed (bez retry), 5xx/timeout → exponential backoff do `OUTBOX_MAX_RETRIES`, potem dead_letter. Pruning rekordów `processed` po 72h.
- **Consequences**: Gwarantowana dostawa do n8n; trwały zasób audio; ochrona Event Loop; ograniczenie bloatu.

---

#### ADR-002: PostgreSQL jako storage dla stanów użytkownika zamiast in-memory / Redis

- **Context**:
  - Stan konwersacji użytkownika (np. `awaiting_plan`, `cooling_down_120s`) musi być trwały (persisted) pomiędzy restartami kontenerów i deployami.
  - Środowisko docelowe (Mikrus) ma ograniczoną ilość RAM – uruchamianie dodatkowych usług typu Redis zwiększa footprint pamięciowy.
  - W systemie i tak istnieje już PostgreSQL jako backend dla n8n.
- **Decision**:
  - Użycie jednej instancji PostgreSQL zarówno dla n8n, jak i dla prostego przechowywania stanów użytkownika (`user_states`).
  - Prosta tabela:
    - `user_id BIGINT PRIMARY KEY`,
    - `current_state VARCHAR DEFAULT 'default'`,
    - `updated_at TIMESTAMP`.
- **Consequences**:
  - Brak dodatkowego serwisu w infrastrukturze (oszczędność RAM i prostszy `docker-compose.yml`).
  - Trwałość stanu konwersacji (rezyliencja na restarty kontenerów, deploye).
  - Minimalnie większe obciążenie istniejącej bazy Postgres, ale przy charakterystyce ruchu bota jest to pomijalne.
  - Możliwość łatwego raportowania i analizy stanów użytkowników (zwykłe zapytania SQL).

---

#### ADR-003: Owner + dynamiczna whitelist'a (ACL) oraz centralizacja routingu alertów stresu w Node Gateway

- **Context**:
  - Pierwotnie alerty stresowe były kierowane na pojedynczy, statyczny `STRESS_ALERT_CHAT_ID` po stronie `biometric-proxy`.
  - Brakowało spójnego modelu bezpieczeństwa bota Telegram – każdy znający token bota mógł potencjalnie korzystać z funkcji gatewaya.
  - Potrzebny był model, który:
    - jasno definiuje **właściciela** systemu (owner),
    - pozwala ownerowi **dynamicznie zarządzać whitelistą** dopuszczonych chatów,
    - centralizuje decyzję „kto dostaje alert stresu” po stronie `node-gateway`.
- **Decision**:
  - Wprowadzono zmienną środowiskową `MASTER_CHAT_ID`, reprezentującą właściciela bota.
  - Dodano tabelę `allowed_chats (chat_id BIGINT PRIMARY KEY, created_at TIMESTAMP)` w tej samej bazie PostgreSQL co `user_states`.
  - W `node-gateway`:
    - globalny middleware Telegrafa wykonuje kontrolę dostępu:
      - `from.id === MASTER_CHAT_ID` → zawsze przepuszcza,
      - w pozostałych przypadkach przepuszcza tylko, jeśli `chat.id` znajduje się w `allowed_chats`,
      - brak dostępu → tylko `console.warn` i przerwanie pipeline'u (bez odpowiedzi do użytkownika).
    - dodano komendy admina dostępne wyłącznie dla ownera:
      - `/allow_here` – dodaje bieżący chat do `allowed_chats`,
      - `/revoke_here` – usuwa bieżący chat z `allowed_chats`,
      - `/allowed_list` – wyświetla listę dopuszczonych chatów.
    - dodano endpoint `POST /api/internal/stress-alert` zabezpieczony nagłówkiem `x-internal-api-key`, który:
      - przyjmuje jedynie `stressValue`,
      - wysyła alert do `MASTER_CHAT_ID` oraz wszystkich czatów z `allowed_chats`,
      - ustawia stan użytkownika na `awaiting_plan` dla wszystkich odbiorców.
  - W `biometric-proxy`:
    - usunięto zależność od `STRESS_ALERT_CHAT_ID`,
    - worker wysyła teraz zdarzenie typu „stress alert” pod `/api/internal/stress-alert`, bez decyzji o adresacie.
- **Consequences**:
  - Jasny, portfelowy model bezpieczeństwa:
    - tylko owner i jawnie dopuszczeni użytkownicy mogą korzystać z bota,
    - zarządzanie ACL odbywa się z poziomu Telegrama (bez modyfikacji kodu).
  - Centralizacja logiki routingu alertów w `node-gateway`:
    - `biometric-proxy` skupia się wyłącznie na detekcji stresu i wysyłaniu zdarzenia,
    - dodanie nowych odbiorców lub zmianę polityki dystrybucji można zrealizować wyłącznie w gatewayu.
  - Lepsza rozbudowywalność:
    - łatwe dodanie kolejnych typów wewnętrznych zdarzeń (inne API niż „stress-alert”) bez modyfikowania kontraktu na poziomie biometrów,
    - możliwość wdrożenia bardziej zaawansowanych reguł ACL (role, tryby demo, itp.) przy zachowaniu tego samego interfejsu wewnętrznego.

---

#### ADR-004: Klikalne menu po /start (inline keyboard) zamiast wyłącznie komend tekstowych

- **Context**:
  - Użytkownicy muszą znać komendy (`/impuls`, `/allow_here` itd.) i wpisywać je ręcznie.
  - Brak jednego punktu wejścia ułatwiającego odkrycie dostępnych akcji; administratorzy muszą pamiętać komendy whitelisty.
- **Decision**:
  - Po komendzie `/start` bot wysyła powitanie oraz **inline keyboard** (przyciski pod wiadomością).
  - Menu jest **pogrupowane**:
    - **Dla wszystkich użytkowników:** przycisk „Złap dystans (Impuls)” → ta sama logika co `/impuls`.
    - **Tylko dla ownera (MASTER_CHAT_ID):** przyciski „Allow here”, „Revoke here”, „Lista whitelist” → odpowiedniki `/allow_here`, `/revoke_here`, `/allowed_list`.
  - Kliknięcie przycisku generuje `callback_query`; handler wywołuje `ctx.answerCbQuery()` i tę samą logikę co przy komendzie (brak duplikacji – reuse `handleImpulsCommand` itd.).
  - Stałe `MENU_CB` (np. `menu:impuls`) eksportowane z `telegramBot.ts` na potrzeby testów i ewentualnych rozszerzeń.
- **Consequences**:
  - Lepsza discoverability: nowy użytkownik po `/start` od razu widzi dostępne akcje.
  - Owner ma szybki dostęp do zarządzania whitelistą bez wpisywania komend.
  - Komendy tekstowe nadal działają (backward compatibility).
  - Jedna źródłowa prawda dla logiki: przyciski i komendy korzystają z tych samych handlerów.

---

#### ADR-005: Rozszerzenie kontraktu stress-alert o restingHeartRate oraz cooldown 4h (antyspam alertów)

- **Context**:
  - Worker w `biometric-proxy` odpytuje Garmin co 15 minut; przy utrzymującym się stresie > progu wysyłał alert w każdej iteracji, co powodowało spam do użytkownika.
  - Potrzeba wzbogacenia alertu o tętno spoczynkowe (resting heart rate) z Garmina dla lepszego kontekstu zdrowotnego w wiadomości alarmowej.
  - Kontrakt `POST /api/internal/stress-alert` (ADR-003) przyjmował wyłącznie `stressValue`.
- **Decision**:
  - **Cooldown 4h (biometric-proxy):**
    - W `DecisionWorker` wprowadzono stan in-memory `last_alert_time`. Alert jest wysyłany tylko gdy stres > próg **oraz** (`last_alert_time` jest `None` lub minęły 4 godziny od ostatniego alertu).
    - Po udanym POST do node-gateway `last_alert_time` jest ustawiane na bieżący czas (UTC).
    - Stała `COOLDOWN_PERIOD = timedelta(hours=4)`.
  - **Kontrakt stress-alert (rozszerzenie):**
    - Payload przyjmuje opcjonalne pole `restingHeartRate?: number`. Walidacja: jeśli podane, musi być liczbą (nie NaN).
    - W `node-gateway` treść wiadomości alarmowej jest uzupełniana o „Tętno spoczynkowe: X” gdy `restingHeartRate` jest obecne.
  - **biometric-proxy:**
    - Provider stresu zwraca strukturę `StressSnapshot(stress_value, resting_heart_rate?)`. Dodano `_extract_resting_hr(raw)` w `main.py` do ekstrakcji RHR z surowej odpowiedzi Garmin (np. klucz `restingHeartRate`). Payload do `/api/internal/stress-alert` zawiera `restingHeartRate` tylko gdy wartość jest dostępna.
- **Consequences**:
  - Zmniejszenie irytującego spamu alertami przy długotrwałym wysokim stresie; użytkownik dostaje co najwyżej jeden alert na 4 godziny w takim samym epizodzie.
  - Cooldown jest in-memory: restart kontenera `biometric-proxy` resetuje stan, więc pierwszy alert po restarcie może przyjść wcześniej niż po 4h od poprzedniego (akceptowalne).
  - Kompatybilność wsteczna: brak `restingHeartRate` w payloadzie nadal jest poprawny; gateway nie wymaga tego pola.
  - Testy BDD/jednostkowe po obu stronach (worker cooldown, parser RHR, endpoint z opcjonalnym RHR) weryfikują zachowanie i kontrakt.

---

#### ADR-006: ESLint + Prettier dla Node Gateway (TypeScript)

- **Context**: Potrzeba spójnego lintu i formatowania w `node-gateway` bez wyciszeń reguł w kodzie.
- **Decision**: Wprowadzono ESLint 9 (flat config) z `typescript-eslint` oraz Prettier. Reguły: recommended + `no-console` z zezwoleniem na `warn`/`error`. Konfiguracja Prettier (semi, double quotes, 100 znaków) w `.prettierrc`. Skrypty: `lint`, `lint:fix`, `format`, `format:check`.
- **Consequences**: Jakość kodu egzekwowana w repo; brak `eslint-disable`/`noqa` — poprawki w kodzie (np. typowany dostęp do `AbortSignal.timeout`).

---

#### ADR-007: Ruff jako linter i formatter dla Pythona (biometric-proxy)

- **Context**: Potrzeba nowoczesnego, jednego narzędzia do lintu i formatowania Pythona (2026 best practice).
- **Decision**: Ruff (lint + format) w `pyproject.toml` z regułami: pycodestyle, Pyflakes, isort, pyupgrade, flake8-bugbear, comprehensions, simplify. Cel: Python 3.12, line-length 100. Zależność dodana do `requirements.txt`; konfiguracja w `[tool.ruff]` i `[tool.ruff.format]`.
- **Consequences**: Jeden narzędzie zamiast wielu (Black, isort, flake8); szybkie sprawdzanie; brak `# noqa` — wszystkie zgłoszenia naprawione w kodzie.

---

#### ADR-008: Usunięcie example-bot, zachowanie zmiennych GEMINI

- **Context**: Katalog `example-bot` był legacy; chęć uproszczenia repo przy zachowaniu możliwości użycia API Gemini w przyszłości.
- **Decision**: Usunięto katalog `custom-bots/example-bot/`. W `.env.example` pozostawiono `GEMINI_API_KEY` oraz `GEMINI_MODEL`. W README dodano notkę referencyjną z hashem ostatniego commita zawierającego example-bot: `ecbcfba2f55579382156957859adda8b7550f8ff`.
- **Consequences**: Mniej kodu do utrzymania; historia Git zachowana; credsy do Gemini gotowe do ewentualnych workflowów/integracji.

---

#### ADR-010: Granularna obsługa błędów i Correlation ID (biometric-proxy)

- **Context**: Szeroki `except Exception` w pętli biometric-proxy maskował przyczyny awarii; brak śledzenia żądań przez usługi.
- **Decision**: Wprowadzono klasy wyjątków (`GarminAuthError`, `GarminTransientError`, `NodeGatewayUnauthorizedError`, `NodeGatewayTransientError`, `NodeGatewayPermanentError`). HTTP client mapuje 401 → NodeGatewayUnauthorizedError, 4xx → NodeGatewayPermanentError, 5xx/timeout → NodeGatewayTransientError. W pętli: obsługa po typie, exponential backoff z jitterem; przy 401 Garmina następna iteracja wykonuje świeże logowanie. Correlation ID (UUID) w nagłówku `x-correlation-id` przy wywołaniach do node-gateway.
- **Consequences**: Łatwiejsza diagnostyka; odróżnienie poison-pill (4xx) od retry (5xx); odtwarzanie sesji Garmina po wygaśnięciu; ścieżka żądania identyfikowalna w logach.

---

