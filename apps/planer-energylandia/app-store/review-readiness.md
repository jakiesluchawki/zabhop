# PogodaPark — App Store review readiness

Prepared 2026-09-04 and updated 2026-09-06 for the iOS app in `apps/planer-energylandia`. This is a source audit and submission checklist, not evidence of App Review approval.

## Release evidence — 2026-09-06

- Commit `d30e6c5be714c79cec1c0c02239c40d5d80f37ad` passed 195 tests and was published by [GitHub Actions run 34017567903](https://github.com/jakiesluchawki/zabhop/actions/runs/34017567903).
- Production planner, privacy, support, legacy weather entry and ŻabHop launch gallery returned HTTP 200. Planner release marker was `d30e6c5be714`; ŻabHop application code was unchanged by this release.
- Signed version **1.0**, build **20260906064500**, uploaded successfully at 06:58 UTC. App Store Connect confirmed **VALID / APP_STORE_ELIGIBLE** at 07:03 UTC; build ID `e614731a-df06-4460-bdaa-a913b2029ec4`, non-exempt encryption `false`.
- The native entry smoke test passed on the warmed iPhone simulator at 07:20 UTC (test body 15.243 s). Earlier Apple Simulator Instruments/Accessibility initialization stalled; a later direct boot exposed repeated Apple `backboardd` crashes in `SimHIDMainScreenTouchServiceCallbackProvider`, before the app launched. Restarting the idle simulator service restored a 9-second boot without erasing devices. The first post-recovery UI test failed while WebKit remained blank, and is preserved as a failed result; a direct launch and the subsequent warmed smoke test rendered the bundled interface.
- Native visual QA found low-contrast white status-bar text over the warm-paper background. Capacitor's `LIGHT` setting means dark foreground text; the configuration was corrected and covered by a regression test. The full suite now passes **196 tests**. This fix requires a new uploaded build after native verification.
- No review submission has been made. At 07:13 UTC, App Store Connect's website showed App Privacy **Published 2 days ago**, with **Other User Content / Other Data Types**, both used for App Functionality and not linked to identity. The detailed preview matched. No existing privacy settings were changed.

### Native QA after the status-bar correction

- Build number reserved for final QA/upload: **20260906072000**. Do not confuse a successful simulator run with an uploaded or Apple-approved build.
- iPhone full flow passed at 07:30 UTC: three days, two adults and two children, conservative 6–7 / 120–129 ranges, actual route generation, all three days, both walking-map actions visible in attraction detail, completion/undo across process relaunch, recalculation, and an actual safe attraction replacement. The earlier failure was a test scroll gesture aimed at an inert outer margin; the corrected test scrolls page content outside the interactive map and retains the same reachability assertions.
- iPhone weather/source-transparency flow passed at 07:32 UTC with actual current responses, not injected weather fixtures.
- The actual native PDF initially had eight pages: four intended sheets plus four blank sheets. A 1 mm A4 rounding allowance and removal of the root minimum print height address WebKit pagination; native export now verifies the expected page count. A four-page export was read with PDF text extraction and rendered for visual QA. Poppler's display of some headers conflicted with PDFium, which rendered the complete headers; this renderer-specific discrepancy is not claimed as an application defect. A larger experimental per-sheet renderer was removed in favor of the small verified pagination correction.
- Native short-link creation, URL-only clipboard and native share sheet passed at 07:47 UTC. A read-back from the actual service restored all three days, four anonymous participant roles, child lower bounds 6 years / 120 cm, 18:00 departure and flex backups. An earlier test used a regex that omitted the legitimate release-cache query; the assertion was corrected, not the URL implementation. Test records and fixture tokens remain private under `.local/pogodapark/qa/`.
- Full automated suite after the PDF regression case: **197 passed, zero failed**. iPad, final binary upload and store submission remain separate gates recorded below when complete.
- Native GPS testing exposed a real bridge bug: returning Capacitor's dynamic plugin proxy directly from an async function made Promise resolution invoke its non-existent `then` method and remain pending before permission was requested. Both the lazy loader and permission helper now keep the proxy inside a plain object. A thenable-proxy regression test covers one-shot and watched locations; the full suite passes **198 tests**. The actual iOS permission prompt and denial path passed after this fix at 07:56 UTC. Earlier unsuccessful location checks are preserved and are not treated as passes.
- The granted-location path passed at 07:57 UTC with an explicitly simulated park coordinate, showing metres and walking minutes in the hero and timeline. This is a QA location fixture, not the user's actual GPS position.
- The full native sharing round trip passed at 08:01 UTC: create a short link, native share sheet, cold-open that link through the registered `pogodapark://` route, and open the same HTTPS link in the simulator's Safari. Both returned the three-day itinerary. The earlier standalone open-link test opened the URL before Xcode installed/relaunched the app and therefore lost the activation; the final test uses XCTest's public `openURL` API after installation and a newly created link, without a hardcoded expiring fixture.
- The full iPad Pro 13-inch flow passed at 08:23 UTC with the final pagination and GPS source. It covers onboarding, all three visit days, visible map actions, completion/undo after relaunch, recalculation, actual replacement and the native PDF share popover. Two earlier iPad runs failed: cold startup exceeded the UI wait, and the warmed run's inferred accessibility tap did not activate the entry button. A normal visible click worked; directing the test's touch to the visible control centre resolved the test without changing application interaction code or weakening assertions.
- The final iPad-generated PDF contains exactly **four non-empty A4 pages**, 6,373,940 bytes. All four pages were extracted and rendered with PDFium for visual review: cover, day 1, day 2, day 3, complete headers, walking notes, conservative participant ranges, meal breaks and the declared 18:00 end. This is evidence from the final minimal renderer, not the removed per-sheet experiment.
- The full automated suite was rerun after the final source edits: **198 passed, zero failed**. Native checks use iOS 26.5 simulators; no physical-device or host-wide network-disconnection test is claimed.
- The iPad weather, next-day selection and source-transparency scenario passed at 08:24 UTC. Both screenshot sets come from actual native simulator captures at the reserved final build number; selected pixels are copied unchanged and bound to SHA-256 checksums before upload.

## Owner's content-rights confirmation — 2026-09-06

The owner answered **„potwierdzam prawa”** to the question covering Energylandia photos, descriptions and the fonts used in this project. This answer was relayed to this task by **MIGRACJA KINGSTON** (task `01a07347-9c68-7932-aa8a-1484d81c1e7a`) on 2026-09-06, explicitly identifying all three content groups. This is the owner's declaration, not an independent legal audit or an attached license document. It resolves the previously missing owner confirmation and is the basis for the app-specific Apple content-rights declaration; do not ask the owner the same question again.

App Store Connect's app-specific `contentRightsDeclaration` was set to `USES_THIRD_PARTY_CONTENT` and verified by a later read after initial eventual-consistency lag.

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

Production was checked in the authenticated Cloudflare dashboard on 2026-09-06: the exact `energylandia-shortlinks` Worker (deployed version prefix `2fb43c62`, compatibility date `2026-07-14`) showed **Workers Logs Disabled**, **Workers Traces Disabled**, and in Settings both switches were **off**, with **no telemetry export destinations**. These settings were read, not changed. The only displayed binding was `PLAN_STORE` to `energylandia-shortlinks_PlanStore`. This verifies that the app developer is not retaining request logs or traces through those Worker facilities; it does not claim that infrastructure providers keep no security/operational records under their own policies, which the public policy already distinguishes from the anonymous plan store.

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

1. **Third-party content evidence:** the app uses official Energylandia photos/descriptions, Queue-Times data and Romie/Roobert font files. The owner confirmed the rights to the photos, descriptions and fonts on 2026-09-06, as recorded above. This declaration resolves the missing owner confirmation; no independent license-document audit is claimed. Preserve Queue-Times' required linked attribution and all other source/credit notices. Public availability or attribution alone is not the basis for the owner's declaration.
2. **Map attribution:** preserve the visible OpenStreetMap contributor attribution and comply with the tile provider's usage policy. The app requests ordinary park tiles; no bulk offline tile download is needed.
3. **Minimum functionality:** the release must bundle functional screens and planning logic, retain local plans offline, and provide working iOS location, share, clipboard and PDF features. A web URL inside an empty shell is not the proposed product. Apple's approval remains a review decision.
4. **Accurate metadata:** avoid “official,” “guaranteed,” “always live,” guaranteed rain warnings or background alerts. Forecasts and queue data can be unavailable or old, and walking time is estimated.
5. **Privacy access:** policy must be reachable both from the App Store listing and within the app. Location purpose text must explain the distance/navigation benefit; requesting it must follow a user action.

Relevant primary references: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (2.3 metadata, 4.2 functionality, 5.1 privacy, 5.2 intellectual property), [OSM attribution](https://www.openstreetmap.org/copyright), [OSM tile usage](https://operations.osmfoundation.org/policies/tiles/), [Cloudflare privacy](https://www.cloudflare.com/privacypolicy/), [GitHub privacy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), [OSM privacy](https://osmfoundation.org/wiki/Privacy_Policy).

## Release checks to record with the actual build

- [x] Listing bounds verified with Unicode character counts: name 10/30, subtitle 26/30, promotional text 146/170, keywords 84/100, description 1,673/4,000, English review notes 2,100/4,000. Public-page semantic IDs, local links and font/texture paths also verified.
- [x] Fresh simulator install completes onboarding, saves and reloads a local itinerary, and works without GPS permission.
- [x] Actual iPhone GPS permission denial/grant, native share, URL-only clipboard and exported PDF verified. Timeout-to-UI mapping is covered by automated tests; map action visibility and exact walking destinations are checked without claiming a completed external navigation journey.
- [x] Bundled local-code launch and saved-plan persistence are covered by source/automated checks and native relaunch. Snapshot-age tests preserve original timestamps. A physical offline/airplane-mode test has not been performed.
- [x] Short link created by the native app opens in Safari and through a cold native activation, preserving three days and safe group/ride semantics.
- [ ] Support/privacy pages deployed and reachable, and in-app links verified in release build.
- [x] Owner's third-party rights declaration and source/terms attribution recorded; production Worker logs/traces inspected against the audited data flow, with provider-policy limits stated above.
- [x] Published App Privacy, age rating, export compliance for the first uploaded build, free pricing and Poland availability verified. Final replacement-build processing is a separate gate.
- [ ] Archive validation, upload, processing, screenshots and submission state recorded separately; no claim of approval until Apple confirms it.
