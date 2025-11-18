#!/usr/bin/env bash
set -e

echo "=== Instalando dependências do Node ==="
npm ci --prefer-offline --no-audit

echo "=== Build finalizado ==="
