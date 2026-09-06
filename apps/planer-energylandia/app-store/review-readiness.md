# PogodaPark — App Store review readiness

Prepared 2026-09-04 for the iOS app in `apps/planer-energylandia`. This is a source audit and submission checklist, not evidence that Apple has approved or received a build.

## App Store Connect metadata prepared

On 2026-09-04, `prepare-listing.mjs` applied and read back metadata for app **6808553115**, bundle **pl.mieszkomahboob.pogodapark**, iOS version **1.0** (`2488c837-248f-4e10-93c7-ac250b04c5a7`). The script confirmed the exact app and bundle before writes. The resulting age rating is **4+**, categories are **Travel / Weather**, price is **free**, availability is **Poland only**, and release is set to **after approval**. IDFA use is false. Polish listing, privacy/support URLs, the existing developer review contact and English review instructions are saved. A second run performed **zero changes**.

Version-localization ID for screenshot uploads: `fa82949a-569a-4b01-995f-7f56d9a69ac6`. The content-rights declaration and App Privacy label were deliberately outside this script's writes. Private API evidence, including the review contact, is under repository `.local/pogodapark/listing-preparation.json` and `listing-verified.json`; do not commit those files.

## Listing and public pages

- Name: **PogodaPark**. Polish subtitle: **Pogoda i plan Energylandii**.
- Main category: Travel; secondary: Weather. Intended as an adult-managed trip-planning utility, not a Kids Category product.
- Polish listing and English review instructions: `listing-pl.json`. Review contact email: `mieszko@mahboob.pl`.
- Support: https://jakiesluchawki.github.io/zabhop/planer-energylandia/support.html
- Privacy: https://jakiesluchawki.github.io/zabhop/planer-energylandia/privacy.html
- Verify both public pages return HTTP 200 after deployment, work at iPhone width and have visible links inside the shipped app.
- Use screenshots of the actual release build. No fake live data or claims of official affiliation. Do not present seasonal unavailability as a defect or silently invent a date with confirmed opening hours.

The contact address is present in existing local projects and was publicly published with Mieszko Mahboob's name in [Archives of Acoustics, Polish Academy of Sciences](https://journals.pan.pl/Content/101530?format_id=1). Use the verified existing App Store Connect account contact phone, without committing it to this repository.

## Audited data flow

| Data or feature | Actual handling | App Privacy consequence |
| --- | --- | --- |
| Participant labels, profile, visit plan, completed rides | `App.jsx` stores on device via local storage. No account or identity service. | Not collected when retained only on device. |
| Selected age and height ranges | App uses the conservative lower bound for ride eligibility. | Local-only use is not collection; short-link copies must be disclosed separately. |
| GPS | Optional foreground access; distances/reranking and map marker computed on device. OSM map remains bounded to the park and does not recenter on user GPS. | No developer GPS collection in audited code. Recheck final native bridge and external-navigation URLs. |
| Weather | Fixed Zator coordinates in `weather.js`, not user GPS. Direct Open-Meteo, MET Norway, Bright Sky, Antistorm and ICM requests. | Provider technical request data still requires consideration; do not label fixed park coordinates as user location. |
| Queue, show and opening snapshots | Downloaded from GitHub Pages, sourced from Queue-Times and official Energylandia sources at build time. | No participant data is attached. Standard host connection data is separate. |
| Official attraction images / OSM tiles | Downloaded from their providers. OSM receives the displayed park tile coordinates. | Providers receive network information, including IP; map area is not evidence of the user's location. |
| Short shared plan | `share.js` removes labels and creates compact-v2; Cloudflare Worker stores token, payload and expiry in SQLite. Payload includes dates/times, rides, show selections, preferences and each role + age/height lower bound. | This **is collection** under Apple's definition: retained off device, even if anonymous and optional. |
| Short-link retention | `PLAN_TTL_MS` = 90 days; purge on reads/writes plus expiry alarm. No public list or delete endpoint. | Public policy accurately describes expiry and a private support request for earlier deletion; do not promise a one-tap revoke control. |
| Email/PDF | Email is transient UI state passed to `mailto:`; no delivery backend. PDF generated locally. Exports can contain participant labels. | Developer does not receive these exports by default. Recipient/service gets content only after the user chooses to send. |
| Support | User may email the developer or open a public issue. | A direct support request can meet Apple's optional-disclosure exception; no automatic upload exists. Do not put personal support messages into public issues. |

The Worker source does not read client IP, write request headers into its plan database, log request bodies or join plans to a user/device. `wrangler.jsonc` has no enabled observability setting. This does not prove that Cloudflare, GitHub, map or weather providers retain no operational logs; their service policies and final production logging configuration must be considered separately.

## Proposed App Privacy answers

Do **not** choose “Data Not Collected” while short-link creation remains enabled. The documented payload requires at least:

| App Store Connect data type | Purpose | Linked to identity | Tracking | Basis |
| --- | --- | --- | --- | --- |
| Other User Content | App Functionality | No, for the audited compact-plan store | No | User-selected itinerary, dates, rides, show choices, preferences and group assignments are stored to reopen the plan. |
| Other Data Types | App Functionality | No, for the audited compact-plan store | No | Role and conservative age/height range values are deliberately stored for itinerary eligibility. There are no names, birthdates, diagnoses, health history or HealthKit access. |

“Not linked” is based on stripping participant labels before transmission, no user/device ID in the payload, random plan tokens and no identity join in application storage. A plan token identifies a document, not an account. The app must not later join these records with IP logs or another identifying dataset.

Age/height classification above is a conservative product-context interpretation of Apple's categories, not an Apple ruling. The app asks for coarse eligibility ranges for rides, not medical data. If the current App Store Connect questionnaire offers a more specific age or physical-characteristic category, use that category. If App Review requires Health for height, disclose that specific type accurately; never imply that HealthKit is used.

Before publishing the label, inspect actual retained provider/operational logs. If IP/request metadata is retained for security or service troubleshooting, disclose **Other Diagnostic Data → App Functionality**, with linkage answered according to that actual retention. Do not add marketing, analytics, tracking, Coarse Location or Device ID merely because an IP is transiently needed to deliver a response. Conversely, do not omit retained data simply because it is used for app functionality.

Apple's [App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/) define collection as off-device retention, distinguish on-device use, require optional core features to be disclosed, and explain IP classification and anonymous data. [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/) explains the submission fields. These sources were checked 2026-09-04.

## Content rights and review risks

1. **Third-party content evidence:** the app uses official Energylandia photos/descriptions, Queue-Times data and Romie/Roobert font files. This audit did not find an app-specific license or authorization record. Public availability, attribution and an unofficial-app disclaimer do not themselves establish permission. The submitter needs existing licenses/permission evidence, or must ship a version that avoids assets whose use cannot be established. Do not mark Apple's content-rights declaration as confirmed from this document.
2. **Map attribution:** preserve the visible OpenStreetMap contributor attribution and comply with the tile provider's usage policy. The app requests ordinary park tiles; no bulk offline tile download is needed.
3. **Minimum functionality:** the release must bundle functional screens and planning logic, retain local plans offline, and provide working iOS location, share, clipboard and PDF features. A web URL inside an empty shell is not the proposed product. Apple's approval remains a review decision.
4. **Accurate metadata:** avoid “official,” “guaranteed,” “always live,” guaranteed rain warnings or background alerts. Forecasts and queue data can be unavailable or old, and walking time is estimated.
5. **Privacy access:** policy must be reachable both from the App Store listing and within the app. Location purpose text must explain the distance/navigation benefit; requesting it must follow a user action.

Relevant primary references: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (2.3 metadata, 4.2 functionality, 5.1 privacy, 5.2 intellectual property), [OSM attribution](https://www.openstreetmap.org/copyright), [OSM tile usage](https://operations.osmfoundation.org/policies/tiles/), [Cloudflare privacy](https://www.cloudflare.com/privacypolicy/), [GitHub privacy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), [OSM privacy](https://osmfoundation.org/wiki/Privacy_Policy).

## Release checks to record with the actual build

- [x] Listing bounds verified with Unicode character counts: name 10/30, subtitle 26/30, promotional text 146/170, keywords 84/100, description 1,673/4,000, English review notes 2,100/4,000. Public-page semantic IDs, local links and font/texture paths also verified.
- [ ] Fresh install completes onboarding, saves and reloads a local itinerary, and works without GPS permission.
- [ ] GPS permission denial/timeout, native share, clipboard, exported PDF and user-initiated map links verified on iPhone.
- [ ] Offline launch and saved plan verified; old snapshots retain original timestamps and are clearly labelled.
- [ ] Short link created by the native app opens in a browser and preserves safe group/ride semantics.
- [ ] Support/privacy pages deployed and reachable, and in-app links verified in release build.
- [ ] Third-party rights/terms and retained operational logs reviewed against final binary/data flow.
- [ ] App Privacy, age rating, export compliance, pricing and availability filled from verified release facts.
- [ ] Archive validation, upload, processing, screenshots and submission state recorded separately; no claim of approval until Apple confirms it.
