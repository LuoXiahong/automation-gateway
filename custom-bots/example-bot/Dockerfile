FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN pip install --no-cache-dir python-telegram-bot==21.6

COPY bot.py /app/bot.py

CMD ["python", "bot.py"]

