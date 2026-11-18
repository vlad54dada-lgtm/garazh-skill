# Путь к студии rank-life: аргумент → $RANK_STUDIO → ~/rank-life-studio
studio_path() {
  if [ -n "${1:-}" ]; then echo "$1"; return; fi
  if [ -n "${RANK_STUDIO:-}" ]; then echo "$RANK_STUDIO"; return; fi
  echo "$HOME/rank-life-studio"
}
