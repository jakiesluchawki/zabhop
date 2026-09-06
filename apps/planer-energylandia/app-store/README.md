# PogodaPark release tools

Run from `apps/planer-energylandia`. Existing credentials stay in the repository's ignored `.local/pogodapark/app-store-connect.json`. Both tools default to read-only API checks; only `--apply` permits upload or submission. They are pinned to PogodaPark app `6808553115`, bundle `pl.mieszkomahboob.pogodapark`, iOS version `1.0` (`2488c837-248f-4e10-93c7-ac250b04c5a7`). They do not change ŻabHop.

## Signing and upload

`node app-store/release.mjs` checks the existing app and local signing paths without uploading. After native QA, set the exact tested `POGODAPARK_BUILD_NUMBER` and run `node app-store/release.mjs --upload`. The release command runs tests, syncs the bundled application, archives, verifies the signed bundle and sends it to Apple. Detailed logs and receipts stay under repository `.local/pogodapark/releases/`.

The private configuration names the existing distribution certificate, dedicated keychain, provisioning profile and App Store Connect API key. `signingKeychainPasswordPath` can point to that keychain's existing password file. The helper reads the original lock state and restores it after the release; it never changes the login keychain or the keychain search list. The archive defaults to one compilation job for an 8 GB Mac; `POGODAPARK_BUILD_JOBS` can override it on another host.

`node app-store/asc.mjs profile` reuses a matching active profile, or provisions one for the exact app and configured existing certificate. It does not create or revoke signing certificates. When a signing file moves, verify the certificate fingerprint and availability before updating the private path.

## Screenshots

Create a JSON manifest next to the reviewed screenshots. Paths are resolved relative to that manifest. Replace all example values with the exact captured release build number, real filenames and SHA-256 hashes; no glob expansion or directory upload is supported.

```json
{
  "schemaVersion": 1,
  "appId": "6808553115",
  "bundleId": "pl.mieszkomahboob.pogodapark",
  "appStoreVersionId": "2488c837-248f-4e10-93c7-ac250b04c5a7",
  "version": "1.0",
  "buildNumber": "YYYYMMDDHHMMSS",
  "locale": "pl",
  "sets": [
    { "displayType": "APP_IPHONE_67", "files": [
      { "path": "iphone/01-start.png", "sha256": "REPLACE_WITH_64_HEX_CHARACTERS" }
    ] },
    { "displayType": "APP_IPAD_PRO_3GEN_129", "files": [
      { "path": "ipad/01-start.png", "sha256": "REPLACE_WITH_64_HEX_CHARACTERS" }
    ] }
  ]
}
```

Each set takes 1–10 non-interlaced 8-bit RGB PNG files, without alpha or transparency. Supported portrait dimensions (landscape swaps also accepted): iPhone 1260×2736, 1290×2796, 1320×2868; iPad 2048×2732, 2064×2752. The script checks PNG chunks, CRC, actual pixel payload and SHA-256; it does not change the images. API display-type identifiers retain their older names.

```sh
node app-store/upload-screenshots.mjs --manifest /absolute/path/manifest.json
node app-store/upload-screenshots.mjs --manifest /absolute/path/manifest.json --apply
```

The manifest defines screenshot order. Existing assets must match its prefix by checksum, or be an unfinished reservation made by this tool for the exact same file/build. Identical assets are reused; interrupted uploads can resume using the private receipt. Different screenshots, extra assets or a different order cause a stop before any upload. This tool never deletes, replaces or reorders existing screenshots; resolve a deliberate change in App Store Connect first. Apple may still be processing after upload: `allProcessed: false` is not a ready-for-review result.

## Submission

After the signed build has finished processing, screenshots are COMPLETE, metadata and privacy are published, and the content-rights basis is confirmed:

```sh
node app-store/submit-review.mjs --build YYYYMMDDHHMMSS --build-id EXACT_APPLE_BUILD_UUID
node app-store/submit-review.mjs --build YYYYMMDDHHMMSS --build-id EXACT_APPLE_BUILD_UUID --apply
```

The build number is required; the UUID is an additional guard. The tool verifies the app/bundle/marketing version, VALID processing, App Store audience, non-expired build, resolved encryption, both screenshot sets, Polish metadata, review contact, free Polish pricing and availability. No automatic selection of the newest build is made. `--apply` attaches that build, creates or reuses this version's review draft, adds its review item (Apple's server-side validation), and submits it. A later run is a no-op when the same build is already submitted. Other active iOS submissions or unresolved rejections require inspection rather than automatic replacement.

The dry-run reports API-check blockers; it cannot pre-approve Apple's server validation or read all App Privacy/account requirements. Never report App Store approval merely because these checks pass. User-content rights and App Privacy attestations are managed separately, not guessed or changed by these scripts.

Upload receipts and submission evidence are written only under ignored `.local/pogodapark/`. Do not commit that directory. `--help` requires no network.

Primary references: [Apple screenshot sizes](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), [screenshot-set API identifiers](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-appscreenshotsets), [asset uploads](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect), [review submissions](https://developer.apple.com/documentation/appstoreconnectapi/reviewsubmissions).
