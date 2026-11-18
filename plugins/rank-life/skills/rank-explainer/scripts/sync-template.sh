#!/usr/bin/env bash
# Синхронизирует движок студии обратно в шаблон скилла (код и эпизоды без кэша; .env, out/, node_modules не трогает).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; . "$HERE/studio-path.sh"
STUDIO="$(studio_path "${1:-}")"; TPL="$HERE/../template"
for f in images.mjs voice.mjs render.mjs make.mjs package.json .gitignore .env.example lib fonts; do cp -R "$STUDIO/$f" "$TPL/" ; done
for d in "$STUDIO"/episodes/*/; do n=$(basename "$d"); mkdir -p "$TPL/episodes/$n"; cp "$d/episode.mjs" "$TPL/episodes/$n/"; done
echo "шаблон обновлён из $STUDIO"
