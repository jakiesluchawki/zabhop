#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
EXPECTED_TEAM="${ZABHOP_IOS_TEAM_ID:-78N6WG8P57}"
EXPECTED_BUNDLE_ID="${ZABHOP_IOS_BUNDLE_ID:-pl.mieszkomahboob.zabhop}"
ARCHIVE_PATH="${ZABHOP_EXISTING_ARCHIVE_PATH:-}"
EXPORT_OPTIONS="${ZABHOP_EXPORT_OPTIONS_PATH:-}"

fail() {
  printf 'ŻabHop existing-archive upload failed: %s\n' "$1" >&2
  exit 1
}

command -v xcodebuild >/dev/null 2>&1 || fail "Xcode command-line tools are unavailable."
[ -n "$ARCHIVE_PATH" ] || fail "set ZABHOP_EXISTING_ARCHIVE_PATH."
[ -n "$EXPORT_OPTIONS" ] || fail "set ZABHOP_EXPORT_OPTIONS_PATH."
[ -d "$ARCHIVE_PATH" ] || fail "the requested ŻabHop archive does not exist."
[ -f "$EXPORT_OPTIONS" ] || fail "the requested export options do not exist."

ASC_ENV_FILE="${ZABHOP_ASC_ENV_FILE:-$PROJECT_DIR/.local/app-store-connect.env}"
if [ -f "$ASC_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ASC_ENV_FILE"
elif [ -n "${ZABHOP_ASC_ENV_FILE:-}" ]; then
  fail "App Store Connect configuration does not exist."
fi

KEY_PATH="${ZABHOP_ASC_KEY_PATH:-${DAILY_BRIEF_ASC_KEY_PATH:-}}"
KEY_ID="${ZABHOP_ASC_KEY_ID:-${DAILY_BRIEF_ASC_KEY_ID:-}}"
ISSUER_ID="${ZABHOP_ASC_ISSUER_ID:-${DAILY_BRIEF_ASC_ISSUER_ID:-}}"
[ -n "$KEY_PATH" ] && [ -n "$KEY_ID" ] && [ -n "$ISSUER_ID" ] \
  || fail "App Store Connect API configuration is incomplete."
[ -f "$KEY_PATH" ] || fail "App Store Connect API key file is unavailable."

APP_PATH="$ARCHIVE_PATH/Products/Applications/ZabHop.app"
[ -d "$APP_PATH" ] || fail "the archive does not contain the ŻabHop application."
ACTUAL_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print:CFBundleIdentifier' "$APP_PATH/Info.plist")
ACTUAL_BUILD_NUMBER=$(/usr/libexec/PlistBuddy -c 'Print:CFBundleVersion' "$APP_PATH/Info.plist")
[ "$ACTUAL_BUNDLE_ID" = "$EXPECTED_BUNDLE_ID" ] \
  || fail "the selected archive belongs to a different application."

EXPORT_TEAM=$(/usr/libexec/PlistBuddy -c 'Print:teamID' "$EXPORT_OPTIONS")
SIGNING_STYLE=$(/usr/libexec/PlistBuddy -c 'Print:signingStyle' "$EXPORT_OPTIONS")
SIGNING_IDENTITY=$(/usr/libexec/PlistBuddy -c 'Print:signingCertificate' "$EXPORT_OPTIONS")
SIGNING_PROFILE=$(/usr/libexec/PlistBuddy \
  -c "Print:provisioningProfiles:$EXPECTED_BUNDLE_ID" "$EXPORT_OPTIONS")
[ "$EXPORT_TEAM" = "$EXPECTED_TEAM" ] || fail "export options belong to a different Apple team."
[ "$SIGNING_STYLE" = "manual" ] || fail "the selected export options must use manual distribution signing."
[ -n "$SIGNING_PROFILE" ] || fail "a dedicated ŻabHop distribution provisioning profile is missing."
case "$SIGNING_IDENTITY" in
  *[!a-fA-F0-9]*|'') fail "the export signing identity must be an exact certificate SHA-1 fingerprint." ;;
esac
[ "${#SIGNING_IDENTITY}" -eq 40 ] || fail "the export signing identity fingerprint is invalid."

if [ -n "${ZABHOP_SIGNING_IDENTITY:-}" ]; then
  [ "$SIGNING_IDENTITY" = "$ZABHOP_SIGNING_IDENTITY" ] \
    || fail "the export options do not use the requested ŻabHop distribution certificate."
fi
if [ -n "${ZABHOP_PROVISIONING_PROFILE_SPECIFIER:-}" ]; then
  [ "$SIGNING_PROFILE" = "$ZABHOP_PROVISIONING_PROFILE_SPECIFIER" ] \
    || fail "the export options do not use the requested ŻabHop provisioning profile."
fi

WORK_DIR=$(dirname "$ARCHIVE_PATH")
EXPORT_DIR="${ZABHOP_EXPORT_PATH:-$WORK_DIR/upload-retry}"
UPLOAD_LOG="$WORK_DIR/upload-retry.log"
mkdir -p "$EXPORT_DIR"

printf 'Uploading existing ŻabHop build %s with its verified distribution profile…\n' "$ACTUAL_BUILD_NUMBER"
if ! xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER_ID" \
  >"$UPLOAD_LOG" 2>&1; then
  tail -n 120 "$UPLOAD_LOG" >&2
  fail "App Store Connect export or upload did not succeed."
fi

printf '%s\n' "ŻabHop TestFlight upload: OK"
printf 'Team: %s\n' "$EXPORT_TEAM"
printf 'Bundle: %s\n' "$ACTUAL_BUNDLE_ID"
printf 'Build: %s\n' "$ACTUAL_BUILD_NUMBER"
printf 'Archive: %s\n' "$ARCHIVE_PATH"
