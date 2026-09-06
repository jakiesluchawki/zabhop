#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"
if [ -n "${POGODAPARK_ASC_ENV_FILE:-}" ]; then . "$POGODAPARK_ASC_ENV_FILE"; fi
: "${POGODAPARK_ASC_KEY_PATH:?Provide the private App Store Connect key path}"
: "${POGODAPARK_ASC_KEY_ID:?Provide the App Store Connect key ID}"
: "${POGODAPARK_ASC_ISSUER_ID:?Provide the App Store Connect issuer ID}"
: "${POGODAPARK_SIGNING_KEYCHAIN_PATH:?Provide the existing distribution keychain}"
: "${POGODAPARK_SIGNING_IDENTITY:?Provide the exact existing distribution certificate SHA-1}"
TEAM_ID=78N6WG8P57
BUNDLE_ID=pl.mieszkomahboob.pogodapark
PROFILE="${POGODAPARK_PROVISIONING_PROFILE_SPECIFIER:-PogodaPark App Store Distribution}"
BUILD_NUMBER="${POGODAPARK_BUILD_NUMBER:-$(date -u '+%Y%m%d%H%M%S')}"
RELEASE_DIR="${POGODAPARK_RELEASE_DIR:-$PROJECT_DIR/.local/releases/$BUILD_NUMBER}"
ARCHIVE="$RELEASE_DIR/PogodaPark.xcarchive"
OPTIONS="$RELEASE_DIR/ExportOptions.plist"
[ -f "$POGODAPARK_ASC_KEY_PATH" ]
[ -f "$POGODAPARK_SIGNING_KEYCHAIN_PATH" ]
mkdir -p "$RELEASE_DIR"
npm test
npm run ios:sync
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -disableAutomaticPackageResolution -skipPackageUpdates -jobs "${POGODAPARK_BUILD_JOBS:-1}" \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -derivedDataPath "$RELEASE_DIR/DerivedData" \
  "CURRENT_PROJECT_VERSION=$BUILD_NUMBER" "DEVELOPMENT_TEAM=$TEAM_ID" \
  CODE_SIGN_STYLE=Manual "CODE_SIGN_IDENTITY=$POGODAPARK_SIGNING_IDENTITY" \
  "PROVISIONING_PROFILE_SPECIFIER=$PROFILE" \
  "OTHER_CODE_SIGN_FLAGS=--keychain \"$POGODAPARK_SIGNING_KEYCHAIN_PATH\"" archive
APP="$ARCHIVE/Products/Applications/App.app"
[ "$(/usr/libexec/PlistBuddy -c 'Print:CFBundleIdentifier' "$APP/Info.plist")" = "$BUNDLE_ID" ]
[ "$(/usr/libexec/PlistBuddy -c 'Print:CFBundleVersion' "$APP/Info.plist")" = "$BUILD_NUMBER" ]
codesign --verify --deep --strict "$APP"
plutil -create xml1 "$OPTIONS"
plutil -insert method -string app-store-connect "$OPTIONS"
plutil -insert destination -string upload "$OPTIONS"
plutil -insert signingStyle -string manual "$OPTIONS"
plutil -insert teamID -string "$TEAM_ID" "$OPTIONS"
plutil -insert signingCertificate -string "$POGODAPARK_SIGNING_IDENTITY" "$OPTIONS"
plutil -insert manageAppVersionAndBuildNumber -bool NO "$OPTIONS"
plutil -insert uploadSymbols -bool YES "$OPTIONS"
plutil -insert provisioningProfiles -dictionary "$OPTIONS"
/usr/libexec/PlistBuddy -c "Add :provisioningProfiles:$BUNDLE_ID string $PROFILE" "$OPTIONS"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$RELEASE_DIR/upload" \
  -exportOptionsPlist "$OPTIONS" -allowProvisioningUpdates \
  -authenticationKeyPath "$POGODAPARK_ASC_KEY_PATH" \
  -authenticationKeyID "$POGODAPARK_ASC_KEY_ID" \
  -authenticationKeyIssuerID "$POGODAPARK_ASC_ISSUER_ID"
printf 'PogodaPark build %s uploaded. Verify processing in App Store Connect.\n' "$BUILD_NUMBER"
