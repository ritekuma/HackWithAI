#!/bin/bash
# HackWithAI v2 - Stop all services
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "🛑 Stopping PM2 processes..."
export PATH="$HOME/.npm-global/bin:$PATH"
pm2 stop all 2>/dev/null || true
echo "🛑 Stopping Docker infrastructure..."
cd "$SCRIPT_DIR"
docker compose down 2>/dev/null || true
echo "✅ All services stopped"
