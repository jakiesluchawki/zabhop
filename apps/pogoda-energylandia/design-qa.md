# Design QA — PogodaPark / „Na miejscu”

## Evidence

- Source visual truth: `qa/reference-gdzie-zaba-mobile.png` and `qa/reference-chmurnik-mobile.png`.
- Final implementation: `qa/park-route-mobile-390x844.png`.
- Map and WC state: `qa/park-map-mobile-390x844.png`.
- Weather tab with shared navigation: `qa/weather-with-nav-mobile-390x844.png`.
- Responsive captures: `qa/park-tablet-768x1024.png` and `qa/park-desktop-1280x900.png`.
- Same-input full-view comparison: `qa/comparison-park-final.png`.
- Same-input focused comparison: `qa/comparison-park-focus.png`.
- Primary viewport/state: 390 × 844 CSS px; two children aged six, both in the 110–119 cm profile; no completed attractions; live queue snapshot loaded.

## Comparison findings

- No remaining P0/P1/P2 visual or interaction issue.
- Typography: Romie display headings and Roobert UI text preserve the reference hierarchy. Long attraction names wrap without clipping; compact metadata remains legible.
- Layout: the 16 px mobile gutter, divider rhythm, large serif headings, tactile cards and fixed two-tab navigation match the source products. The 390 px view has no horizontal overflow.
- Color and surfaces: rose paper texture, olive copy, violet action color and restrained bordered surfaces map directly to the Gdzie Żabka / Chmurnik language.
- Imagery: the supplied paper texture and weather dial remain real raster assets. The park map uses real OpenStreetMap tiles rather than illustrative placeholder art.
- Icons: Phosphor icons use a consistent rounded weight across GPS, map, WC, route and status controls.
- Content: the first screen answers the practical questions in order — who the route is for, what to do next, current weather, map/location, WC and the remaining plan. Safety disclaimers and sources are visible.
- Responsiveness: mobile, tablet and desktop views remain centered and usable. No horizontal overflow was found at 390, 768 or 1280 px.
- Accessibility: controls are semantic buttons/links, dialogs have names and modal roles, map actions have visible text, primary tap targets are at least 44 px, and focus styling remains visible.

## Primary interactions tested

- Switched from „Pogoda” to „Na miejscu” and back.
- Opened the family profile; selected 110–119 cm independently for both children; verified route reset and 12 eligible stops.
- Confirmed that the toddler-oriented Candy Carousel is excluded.
- Marked Honey Harbour as complete; verified progress and the next recommendation changed.
- Selected route and WC map layers; opened the nearest-WC action and verified the map refocused.
- Triggered geolocation denial; verified the app gives a usable manual fallback instead of failing.
- Opened and closed the sources dialog; verified official map, official attractions, OpenStreetMap, Queue-Times and family-report links.
- Loaded the production Vite build at `#park`; the bundled queue snapshot appeared and no console error was logged.
- Checked browser console errors after the complete interaction pass: none.

## Comparison history

### Iteration 1

- The initial route included Candy Carousel despite the brief excluding attractions primarily for the smallest children.
- Fixed by marking it `toddlerLike` and filtering that category from both route construction and next-stop selection.

### Iteration 2

- Queue aliases failed on Polish `ł`, and Queue-Times used „Honey Harbor” while the official attraction uses „Honey Harbour”.
- Fixed shared normalization and added the alternate spelling. Deterministic queue and route tests cover both cases.

### Iteration 3

- Final combined comparison confirmed the reference hierarchy, tactile palette, rounded controls, action color and compact mobile density.
- Map/WC, profile, source, completion, navigation, queue and geolocation-fallback states passed browser verification.

## Follow-up polish

- P3: OpenStreetMap label density varies with live tile data and zoom. It does not obscure the route, WC toggle or primary actions.

final result: passed
