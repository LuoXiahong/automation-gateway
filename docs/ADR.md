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

