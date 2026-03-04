#!/usr/bin/env bash

set -euo pipefail

# Podstawowa konfiguracja firewalla (ufw) dla serwera Mikrus.
# Skrypt:
# - instaluje ufw (jeśli trzeba),
# - blokuje cały ruch przychodzący poza wybranymi portami,
# - dopuszcza cały ruch wychodzący.
#
# Domyślnie otwarte porty:
# - 22   (SSH)
# - 80   (HTTP)
# - 443  (HTTPS)
# - 5678 (n8n, możesz zmienić/wyłączyć)
#
# Użycie:
#   sudo bash infrastructure/setup-firewall.sh

ALLOWED_SSH_PORT="${SSH_PORT:-22}"
ALLOWED_N8N_PORT="${N8N_PORT:-5678}"

echo "[firewall] Aktualizacja listy pakietów..."
apt-get update -y

echo "[firewall] Instalacja ufw (jeśli nie jest zainstalowany)..."
if ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y ufw
fi

echo "[firewall] Ustawianie polityk domyślnych..."
ufw default deny incoming
ufw default allow outgoing

echo "[firewall] Zezwalanie na SSH na porcie ${ALLOWED_SSH_PORT}..."
ufw allow "${ALLOWED_SSH_PORT}"/tcp

echo "[firewall] Zezwalanie na HTTP (80/tcp) i HTTPS (443/tcp)..."
ufw allow 80/tcp
ufw allow 443/tcp

if [[ -n "${ALLOWED_N8N_PORT}" ]]; then
  echo "[firewall] Zezwalanie na n8n (${ALLOWED_N8N_PORT}/tcp)..."
  ufw allow "${ALLOWED_N8N_PORT}"/tcp
fi

echo "[firewall] Włączanie ufw (odpowiedz 'y' jeśli zostaniesz o to poproszony)..."
yes | ufw enable || true

echo "[firewall] Status ufw:"
ufw status verbose

echo "[firewall] Gotowe."

