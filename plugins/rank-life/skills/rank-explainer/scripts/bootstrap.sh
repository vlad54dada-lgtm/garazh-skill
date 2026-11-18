#!/usr/bin/env bash
# Разворачивает студию rank-life из шаблона скилла (если её ещё нет) и ставит puppeteer-core.
# usage: bootstrap.sh [studio_dir]   (по умолчанию: $RANK_STUDIO или ~/rank-life-studio)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/studio-path.sh"
STUDIO="$(studio_path "${1:-}")"
TPL="$HERE/../template"
if [ -f "$STUDIO/render.mjs" ]; then echo "студия уже есть: $STUDIO"; else
  mkdir -p "$STUDIO" && (cd "$TPL" && tar --exclude=node_modules --exclude=out --exclude='episodes/*/cache' -cf - .) | (cd "$STUDIO" && tar -xf -) && echo "студия создана: $STUDIO"; fi
command -v node >/dev/null || { echo "!! нужен node ≥ 18" >&2; exit 1; }
command -v ffmpeg >/dev/null || echo "!! нужен ffmpeg (Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg)" >&2
[ -d "$STUDIO/node_modules/puppeteer-core" ] || (cd "$STUDIO" && npm install --silent)
[ -n "${OPENROUTER_API_KEY:-}" ] || [ -f "$STUDIO/.env" ] || echo "ключ: cp .env.example .env и впиши OPENROUTER_API_KEY (без него — заглушки и тихая дорожка)"
echo "ok → cd \"$STUDIO\" && node render.mjs --ep rome --preview"
