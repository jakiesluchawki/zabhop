#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ASC_ENV_FILE="${ZABHOP_ASC_ENV_FILE:-$PROJECT_DIR/.local/app-store-connect.env}"

if [ -f "$ASC_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ASC_ENV_FILE"
elif [ -n "${ZABHOP_ASC_ENV_FILE:-}" ]; then
  printf 'App Store Connect configuration does not exist: %s\n' "$ASC_ENV_FILE" >&2
  exit 1
fi

ZABHOP_ASC_KEY_PATH="${ZABHOP_ASC_KEY_PATH:-${DAILY_BRIEF_ASC_KEY_PATH:-}}"
ZABHOP_ASC_KEY_ID="${ZABHOP_ASC_KEY_ID:-${DAILY_BRIEF_ASC_KEY_ID:-}}"
ZABHOP_ASC_ISSUER_ID="${ZABHOP_ASC_ISSUER_ID:-${DAILY_BRIEF_ASC_ISSUER_ID:-}}"
export ZABHOP_ASC_KEY_PATH ZABHOP_ASC_KEY_ID ZABHOP_ASC_ISSUER_ID

exec node "$PROJECT_DIR/Tools/CheckAppStoreConnect.mjs" "$@"
