#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"
npm run ios:sync
exec xcodebuild -quiet -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -disableAutomaticPackageResolution -skipPackageUpdates \
  -destination "${POGODAPARK_SIMULATOR_DESTINATION:-generic/platform=iOS Simulator}" \
  -derivedDataPath "${POGODAPARK_DERIVED_DATA:-/tmp/pogodapark-ios-derived}" \
  "ARCHS=${POGODAPARK_SIMULATOR_ARCH:-$(uname -m)}" ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO build
