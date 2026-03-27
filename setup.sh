#!/usr/bin/env bash
set -euo pipefail

echo "==> Checking Node.js version (need >= 18)..."
NODE_MAJOR=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js >= 18 required. Current: $(node -v)"
  exit 1
fi

echo "==> Installing npm dependencies..."
npm install

if [ ! -f .env.local ]; then
  echo "==> .env.local not found. Creating from .env.example..."
  cp .env.example .env.local
  echo "⚠️  Fill in .env.local (Supabase URL, anon key, service role key) then re-run setup.sh"
  exit 1
fi

echo "==> Loading environment from .env.local..."
set -a
# shellcheck disable=SC1091
source .env.local
set +a

missing_vars=()
[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && missing_vars+=("NEXT_PUBLIC_SUPABASE_URL")
[ -z "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ] && missing_vars+=("NEXT_PUBLIC_SUPABASE_ANON_KEY")
[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && missing_vars+=("SUPABASE_SERVICE_ROLE_KEY")

if [ "${#missing_vars[@]}" -gt 0 ]; then
  echo "Error: Missing required env vars in .env.local:"
  for v in "${missing_vars[@]}"; do echo " - $v"; done
  echo "Edit .env.local and set the values, then re-run setup.sh"
  exit 1
fi

echo "==> Seeding players via Supabase..."
npx ts-node scripts/seed-players.ts

echo "==> Starting Next.js dev server..."
npm run dev
