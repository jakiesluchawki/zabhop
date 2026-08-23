#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IOS_PROJECT="${ZABHOP_IOS_PROJECT:-$PROJECT_DIR/ZabHop.xcodeproj}"
SCHEME="${ZABHOP_IOS_SCHEME:-ZabHop}"
EXPECTED_TEAM="${ZABHOP_IOS_TEAM_ID:-78N6WG8P57}"
EXPECTED_BUNDLE_ID="${ZABHOP_IOS_BUNDLE_ID:-pl.mieszkomahboob.zabhop}"
RELEASE_ROOT="${ZABHOP_TESTFLIGHT_DIR:-$PROJECT_DIR/.local/releases/testflight}"
BUILD_NUMBER="${ZABHOP_BUILD_NUMBER:-$(date -u '+%Y%m%d%H%M%S')}"
BUILD_STAMP=$(date '+%Y%m%d-%H%M%S')
WORK_DIR="$RELEASE_ROOT/$BUILD_STAMP"
ARCHIVE_PATH="$WORK_DIR/ZabHop.xcarchive"
DERIVED_DATA="$WORK_DIR/DerivedData"
TEST_DERIVED_DATA="$WORK_DIR/TestDerivedData"
EXPORT_DIR="$WORK_DIR/upload"
EXPORT_OPTIONS="$WORK_DIR/ExportOptions-TestFlight.plist"
WEB_LOG="$WORK_DIR/web-tests.log"
TEST_LOG="$WORK_DIR/ios-tests.log"
ARCHIVE_LOG="$WORK_DIR/archive.log"
UPLOAD_LOG="$WORK_DIR/upload.log"

fail() {
  printf 'ŻabHop TestFlight upload failed: %s\n' "$1" >&2
  exit 1
}

command -v xcodebuild >/dev/null 2>&1 || fail "Xcode command-line tools are unavailable."
command -v xcrun >/dev/null 2>&1 || fail "Xcode simulator tools are unavailable."
command -v node >/dev/null 2>&1 || fail "Node.js is required for web and catalog tests."
[ -d "$IOS_PROJECT" ] || fail "Xcode project does not exist: $IOS_PROJECT"

ASC_ENV_FILE="${ZABHOP_ASC_ENV_FILE:-$PROJECT_DIR/.local/app-store-connect.env}"
if [ -f "$ASC_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ASC_ENV_FILE"
elif [ -n "${ZABHOP_ASC_ENV_FILE:-}" ]; then
  fail "App Store Connect configuration does not exist: $ASC_ENV_FILE"
fi

# Legacy variable names remain accepted during a one-time credential migration,
# but this script never imports code or configuration from another project.
KEY_PATH="${ZABHOP_ASC_KEY_PATH:-${DAILY_BRIEF_ASC_KEY_PATH:-}}"
KEY_ID="${ZABHOP_ASC_KEY_ID:-${DAILY_BRIEF_ASC_KEY_ID:-}}"
ISSUER_ID="${ZABHOP_ASC_ISSUER_ID:-${DAILY_BRIEF_ASC_ISSUER_ID:-}}"
SIGNING_KEYCHAIN_PATH="${ZABHOP_SIGNING_KEYCHAIN_PATH:-}"
SIGNING_KEYCHAIN_PASSWORD_FILE="${ZABHOP_SIGNING_KEYCHAIN_PASSWORD_FILE:-}"
SIGNING_IDENTITY="${ZABHOP_SIGNING_IDENTITY:-}"
SIGNING_PROFILE="${ZABHOP_PROVISIONING_PROFILE_SPECIFIER:-}"
[ -n "$KEY_PATH" ] && [ -n "$KEY_ID" ] && [ -n "$ISSUER_ID" ] \
  || fail "set ZABHOP_ASC_KEY_PATH, ZABHOP_ASC_KEY_ID and ZABHOP_ASC_ISSUER_ID."
[ -f "$KEY_PATH" ] || fail "App Store Connect API key file is unavailable."

if [ -n "$SIGNING_KEYCHAIN_PATH$SIGNING_KEYCHAIN_PASSWORD_FILE$SIGNING_IDENTITY$SIGNING_PROFILE" ]; then
  [ -n "$SIGNING_KEYCHAIN_PATH" ] && [ -n "$SIGNING_IDENTITY" ] && [ -n "$SIGNING_PROFILE" ] \
    || fail "manual signing requires ZABHOP_SIGNING_KEYCHAIN_PATH, ZABHOP_SIGNING_IDENTITY and ZABHOP_PROVISIONING_PROFILE_SPECIFIER."
  [ -f "$SIGNING_KEYCHAIN_PATH" ] || fail "configured signing keychain does not exist."
  if [ -n "$SIGNING_KEYCHAIN_PASSWORD_FILE" ]; then
    [ -f "$SIGNING_KEYCHAIN_PASSWORD_FILE" ] || fail "configured signing keychain password file does not exist."
  fi
  SIGNING_STYLE="manual"
else
  SIGNING_STYLE="automatic"
fi

mkdir -p "$WORK_DIR" "$DERIVED_DATA" "$TEST_DERIVED_DATA" "$EXPORT_DIR"

printf '%s\n' "Validating ŻabHop web behavior and both catalogs…"
if ! (
  cd "$PROJECT_DIR"
  node Tools/ValidateCatalogs.mjs
  node --test tests/*.test.cjs Tools/*.test.mjs
) >"$WEB_LOG" 2>&1; then
  tail -n 100 "$WEB_LOG" >&2
  fail "web or catalog safeguards did not pass."
fi

TEST_DESTINATION="${ZABHOP_TEST_DESTINATION:-}"
if [ -z "$TEST_DESTINATION" ]; then
  SIMULATOR_ID=$(xcrun simctl list devices available -j | node -e '
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => {
      const all = Object.values(JSON.parse(text).devices).flat();
      const candidates = all.filter((device) => device.isAvailable
        && (/iPhone/i.test(device.name) || /ZabHop/i.test(device.name)));
      candidates.sort((left, right) => Number(right.state === "Booted") - Number(left.state === "Booted"));
      if (candidates[0]) process.stdout.write(candidates[0].udid);
    });
  ')
  [ -n "$SIMULATOR_ID" ] || fail "no available iPhone simulator; set ZABHOP_TEST_DESTINATION."
  TEST_DESTINATION="id=$SIMULATOR_ID"
fi

printf '%s\n' "Running native iPhone tests before TestFlight release…"
if ! xcodebuild \
  -project "$IOS_PROJECT" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "$TEST_DESTINATION" \
  -derivedDataPath "$TEST_DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  test >"$TEST_LOG" 2>&1; then
  tail -n 120 "$TEST_LOG" >&2
  fail "native iPhone tests did not pass."
fi

plutil -create xml1 "$EXPORT_OPTIONS"
plutil -insert destination -string upload "$EXPORT_OPTIONS"
plutil -insert manageAppVersionAndBuildNumber -bool NO "$EXPORT_OPTIONS"
plutil -insert method -string app-store-connect "$EXPORT_OPTIONS"
plutil -insert signingStyle -string "$SIGNING_STYLE" "$EXPORT_OPTIONS"
plutil -insert stripSwiftSymbols -bool YES "$EXPORT_OPTIONS"
plutil -insert teamID -string "$EXPECTED_TEAM" "$EXPORT_OPTIONS"
plutil -insert uploadSymbols -bool YES "$EXPORT_OPTIONS"

if [ "$SIGNING_STYLE" = "manual" ]; then
  plutil -insert signingCertificate -string "$SIGNING_IDENTITY" "$EXPORT_OPTIONS"
  plutil -insert provisioningProfiles -dictionary "$EXPORT_OPTIONS"
  /usr/libexec/PlistBuddy \
    -c "Add :provisioningProfiles:$EXPECTED_BUNDLE_ID string $SIGNING_PROFILE" \
    "$EXPORT_OPTIONS"

  if [ -n "$SIGNING_KEYCHAIN_PASSWORD_FILE" ]; then
    printf '%s\n' "Unlocking the configured distribution signing keychain…"
    if ! node -e '
      const fs = require("node:fs");
      const { spawnSync } = require("node:child_process");
      const [keychainPath, passwordPath] = process.argv.slice(1);
      const password = fs.readFileSync(passwordPath, "utf8").trim();
      if (!password) {
        process.stderr.write("Signing keychain password file is empty.\n");
        process.exit(1);
      }
      const result = spawnSync("/usr/bin/security", [
        "unlock-keychain", "-p", password, keychainPath
      ], {
        stdio: ["ignore", "ignore", "pipe"],
        encoding: "utf8"
      });
      if (result.error || result.status !== 0) {
        process.stderr.write("Configured signing keychain could not be unlocked.\n");
        if (result.stderr) process.stderr.write(result.stderr);
        process.exit(1);
      }
    ' "$SIGNING_KEYCHAIN_PATH" "$SIGNING_KEYCHAIN_PASSWORD_FILE"; then
      fail "distribution signing keychain could not be unlocked."
    fi
  fi
fi

printf 'Archiving ŻabHop build %s…\n' "$BUILD_NUMBER"
set -- xcodebuild \
  -project "$IOS_PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -derivedDataPath "$DERIVED_DATA" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER_ID" \
  "CURRENT_PROJECT_VERSION=$BUILD_NUMBER"

if [ "$SIGNING_STYLE" = "manual" ]; then
  set -- "$@" \
    CODE_SIGN_STYLE=Manual \
    "CODE_SIGN_IDENTITY=$SIGNING_IDENTITY" \
    "PROVISIONING_PROFILE_SPECIFIER=$SIGNING_PROFILE" \
    "DEVELOPMENT_TEAM=$EXPECTED_TEAM" \
    "OTHER_CODE_SIGN_FLAGS=--keychain \"$SIGNING_KEYCHAIN_PATH\""
fi

set -- "$@" archive
if ! "$@" >"$ARCHIVE_LOG" 2>&1; then
  tail -n 120 "$ARCHIVE_LOG" >&2
  fail "signed archive did not succeed."
fi

APP_PATH="$ARCHIVE_PATH/Products/Applications/ZabHop.app"
[ -d "$APP_PATH" ] || fail "application bundle is missing from the archive."
ACTUAL_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print:CFBundleIdentifier" "$APP_PATH/Info.plist")
ACTUAL_BUILD_NUMBER=$(/usr/libexec/PlistBuddy -c "Print:CFBundleVersion" "$APP_PATH/Info.plist")
[ "$ACTUAL_BUNDLE_ID" = "$EXPECTED_BUNDLE_ID" ] \
  || fail "expected bundle $EXPECTED_BUNDLE_ID, found $ACTUAL_BUNDLE_ID."
[ "$ACTUAL_BUILD_NUMBER" = "$BUILD_NUMBER" ] \
  || fail "expected build $BUILD_NUMBER, found $ACTUAL_BUILD_NUMBER."

printf '%s\n' "Uploading the verified archive to App Store Connect…"
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
  fail "App Store Connect upload did not succeed."
fi

printf '%s\n' "ŻabHop TestFlight upload: OK"
printf 'Team: %s\n' "$EXPECTED_TEAM"
printf 'Bundle: %s\n' "$ACTUAL_BUNDLE_ID"
printf 'Build: %s\n' "$ACTUAL_BUILD_NUMBER"
printf 'Archive: %s\n' "$ARCHIVE_PATH"
printf '%s\n' "App Store Connect can take several minutes to finish processing the build."
