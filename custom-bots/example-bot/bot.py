"""
Minimalny bot Telegram (python-telegram-bot), który startuje i loguje,
że jest uruchomiony. Uzupełnij logikę według własnych potrzeb.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import List, Set
from urllib.parse import parse_qs, urlparse

import httpx
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes


logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

SUBSCRIBERS_FILE = os.environ.get("TELEGRAM_BOT_SUBSCRIBERS_FILE") or "/app/data/subscribers.json"
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL") or "gemini-1.5-flash-8b"
_subscribers_lock = threading.Lock()


def load_subscribers() -> Set[int]:
    with _subscribers_lock:
        if not os.path.exists(SUBSCRIBERS_FILE):
            return set()
        try:
            with open(SUBSCRIBERS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError:
            logger.warning("Plik subskrybentów jest uszkodzony, rozpoczynam od pustej listy")
            return set()

    try:
        return {int(chat_id) for chat_id in data}
    except (TypeError, ValueError):
        logger.warning("Nieprawidłowy format listy subskrybentów, rozpoczynam od pustej listy")
        return set()


def save_subscribers(subscribers: Set[int]) -> None:
    os.makedirs(os.path.dirname(SUBSCRIBERS_FILE), exist_ok=True)
    with _subscribers_lock:
        with open(SUBSCRIBERS_FILE, "w", encoding="utf-8") as f:
            json.dump(sorted(subscribers), f)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_chat is None:
        return

    chat_id = update.effective_chat.id
    subscribers = load_subscribers()
    is_new = chat_id not in subscribers

    if is_new:
        subscribers.add(chat_id)
        save_subscribers(subscribers)
        logger.info("Dodano nowego subskrybenta: %s", chat_id)
        text = "Zarejestrowałem Cię do powiadomień ✅"
    else:
        text = "Już jesteś zarejestrowany w powiadomieniach 🙂"

    if update.message:
        await update.message.reply_text(text)


async def generate_curiosities(topic: str, count: int) -> str:
    if not GEMINI_API_KEY:
        raise RuntimeError("Brak GEMINI_API_KEY w zmiennych środowiskowych.")

    safe_count = max(1, min(count, 5))
    prompt = (
        "Jesteś asystentem generującym ciekawostki.\n"
        f"Wygeneruj {safe_count} ciekawostek na temat: '{topic}'.\n"
        "Dla każdej ciekawostki użyj formatu dwóch zdań:\n"
        "1) Pierwsze zdanie: krótki tytuł lub etykieta ciekawostki zakończony dwukropkiem.\n"
        "2) Drugie zdanie: krótkie, treściwe wyjaśnienie tej ciekawostki.\n"
        "Zwróć odpowiedź w języku polskim. Oddziel każdą ciekawostkę pustą linią."
    )

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": prompt,
                    }
                ],
            }
        ],
    }

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(url, params={"key": GEMINI_API_KEY}, json=payload)
        response.raise_for_status()
        data = response.json()

    try:
        candidates = data.get("candidates") or []
        content = candidates[0].get("content", {})
        parts = content.get("parts") or []
        text = parts[0].get("text", "")
    except (IndexError, AttributeError, KeyError, TypeError):
        raise RuntimeError("Nie udało się odczytać treści z odpowiedzi Gemini.") from None

    return text.strip()


async def ciekawostki(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return

    args = context.args or []
    count = 1

    if args and args[0].isdigit():
        try:
            count = int(args[0])
        except ValueError:
            count = 1
        topic_parts = args[1:]
    else:
        topic_parts = args

    topic = " ".join(topic_parts).strip() or "losowe ciekawostki"

    await update.message.reply_text("Szukam ciekawostek w Gemini, chwilka...")

    try:
        text = await generate_curiosities(topic, count)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Błąd podczas wywołania Gemini: %s", exc)
        await update.message.reply_text("Nie udało się pobrać ciekawostek z Gemini 😕")
        return

    await update.message.reply_text(text)


def broadcast_message(text: str) -> List[int]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("Brak TELEGRAM_BOT_TOKEN w zmiennych środowiskowych.")

    subscribers = load_subscribers()
    if not subscribers:
        logger.info("Brak zarejestrowanych subskrybentów, nic nie wysyłam")
        return []

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    sent_to: List[int] = []

    for chat_id in subscribers:
        try:
            response = httpx.post(
                url,
                json={"chat_id": chat_id, "text": text},
                timeout=10,
            )
            if response.status_code == 200:
                sent_to.append(chat_id)
            else:
                logger.warning(
                    "Nie udało się wysłać wiadomości do %s: %s %s",
                    chat_id,
                    response.status_code,
                    response.text,
                )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Błąd przy wysyłaniu wiadomości do %s: %s", chat_id, exc)

    logger.info("Wysłano testową wiadomość do %d subskrybentów", len(sent_to))
    return sent_to


class BotRequestHandler(BaseHTTPRequestHandler):
    def _send_json_response(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # type: ignore[override]  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/send-test":
            query = parse_qs(parsed.query)
            text = query.get("text", ["Testowa wiadomość z bota 🚀"])[0]
            sent_to = broadcast_message(text)
            self._send_json_response(200, {"sent_to": sent_to, "count": len(sent_to)})
        else:
            self._send_json_response(404, {"detail": "Not found"})

    def do_POST(self) -> None:  # type: ignore[override]  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/send-test":
            self._send_json_response(404, {"detail": "Not found"})
            return

        length_header = self.headers.get("Content-Length", "0")
        try:
            length = int(length_header)
        except ValueError:
            length = 0

        raw_body = self.rfile.read(length) if length > 0 else b""
        text = "Testowa wiadomość z bota 🚀"

        if raw_body:
            try:
                data = json.loads(raw_body.decode("utf-8"))
                if isinstance(data, dict) and "text" in data and isinstance(data["text"], str):
                    text = data["text"]
            except json.JSONDecodeError:
                logger.warning("Nie udało się zdekodować JSON z żądania, używam domyślnego tekstu")

        sent_to = broadcast_message(text)
        self._send_json_response(200, {"sent_to": sent_to, "count": len(sent_to)})

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        logger.info("HTTP %s - %s", self.address_string(), format % args)


def start_http_server() -> None:
    port_str = os.environ.get("TELEGRAM_BOT_HTTP_PORT") or "8000"
    try:
        port = int(port_str)
    except ValueError:
        logger.warning("Nieprawidłowy port TELEGRAM_BOT_HTTP_PORT='%s', używam 8000", port_str)
        port = 8000

    server = HTTPServer(("0.0.0.0", port), BotRequestHandler)
    logger.info("Startuję HTTP server bota na porcie %d", port)
    server.serve_forever()


def main() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("Brak TELEGRAM_BOT_TOKEN w zmiennych środowiskowych.")

    http_thread = threading.Thread(target=start_http_server, daemon=True)
    http_thread.start()

    application = Application.builder().token(token).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler(["c", "ciekawostki"], ciekawostki))

    logger.info("Uruchamiam bota Telegram...")
    application.run_polling()


if __name__ == "__main__":
    main()

