#!/usr/bin/env bash
set -e

echo "=== Atualizando apt e instalando Chromium e dependências ==="
apt-get update -y
apt-get install -y --no-install-recommends \
  chromium \
  chromium-driver \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgdk-pixbuf2.0-0 \
  libnspr4 \
  libnss3 \
  libu2f-udev \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  xdg-utils

echo "=== Instalando dependências do Node ==="
npm ci --prefer-offline --no-audit

echo "=== Build finalizado ==="
