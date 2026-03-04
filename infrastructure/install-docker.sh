#!/usr/bin/env bash

set -euo pipefail

# Skrypt instalujący Docker i Docker Compose (plugin) na serwerze (np. Mikrus).
# Użycie:
#   sudo bash infrastructure/install-docker.sh

echo "[docker] Aktualizacja listy pakietów..."
apt-get update -y

echo "[docker] Instalacja wymaganych zależności..."
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release

if ! command -v docker >/dev/null 2>&1; then
  echo "[docker] Dodawanie oficjalnego repozytorium Dockera..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" >/etc/apt/sources.list.d/docker.list

  echo "[docker] Aktualizacja listy pakietów po dodaniu repozytorium..."
  apt-get update -y

  echo "[docker] Instalacja Docker Engine i pluginu compose..."
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "[docker] Docker jest już zainstalowany, pomijam instalację."
fi

echo "[docker] Dodawanie bieżącego użytkownika do grupy docker (jeśli istnieje zmienna SUDO_USER)..."
if [[ -n "${SUDO_USER:-}" ]]; then
  usermod -aG docker "${SUDO_USER}"
  echo "[docker] Aby używać dockera bez sudo, wyloguj i zaloguj się ponownie jako ${SUDO_USER}."
fi

echo "[docker] Wersje zainstalowanych narzędzi:"
docker --version || true
docker compose version || true

echo "[docker] Gotowe."

