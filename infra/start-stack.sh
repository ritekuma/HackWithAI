#!/bin/bash
# HackWithAI v2 - Start all services (Docker + PM2)
# Usage: ./start-stack.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🐳 Starting Docker infrastructure (Centrifugo + Qdrant)..."
cd "$SCRIPT_DIR"
docker compose up -d

echo ""
echo "🟢 Starting PM2 processes (Next.js + Convex)..."
export PATH="$HOME/.npm-global/bin:$PATH"
pm2 start "$SCRIPT_DIR/ecosystem.config.cjs" 2>/dev/null || pm2 reload all
pm2 save

echo ""
echo "✅ Stack started!"
echo "   - Next.js:   http://localhost:3006"
echo "   - Centrifugo: ws://localhost:8000/connection/websocket"
echo "   - Qdrant:    http://localhost:6333/dashboard"
echo "   - Redis:     redis://127.0.0.1:6379"
