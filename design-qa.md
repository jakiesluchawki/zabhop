# Design QA — ŻabHop felt redesign

Final result: **PASSED**

## Source visual truth

- Approved CHMURNIK mobile reference: `/tmp/chmurnik-style-full-20260711/design/approved/chmurnik-mobile-density-v1.png`
- CHMURNIK felt-material reference: `/tmp/chmurnik-style-full-20260711/public/assets/observer-guide-still-life.png`
- Target viewport: iPhone, 390 × 844 px
- Intentional product variation: ŻabHop keeps CHMURNIK's tactile felt/paper material language, typography and palette, while replacing the cloud product content with a frog and a navigation compass.

## Comparison evidence

- Combined source/implementation board: `../qa/redesign/08-combined-comparison.png`
- Start state: `../qa/redesign/06-after-start.png`
- Live radar state: `../qa/redesign/05-after-radar-v3.png`
- Store picker state: `../qa/redesign/07-shop-list.png`

Both the full mobile composition and the focused felt-material regions were reviewed in one combined visual input. The implementation matches the reference's pink field, olive/ivory/violet palette, high-contrast editorial display type, restrained controls, rounded tactile objects and visible felt fibers.

## Iteration history

### Audit / iteration 0

- P1: previous dark/neon UI did not match CHMURNIK.
- P1: previous compass indicator was visually ambiguous and too small.
- P1: public geocoder omitted the Żabka at Dolna 11.
- P2: link-preview icon was generic and did not express the product.

Fixes applied: full pink/olive/violet redesign, generated felt frog and compass assets, official Phosphor filled direction arrow at dominant scale, bundled sanitized official store coordinates, and a felt frog icon/preview.

### Final / iteration 1

- P0 findings: none.
- P1 findings: none.
- P2 findings: none.
- Visual hierarchy: passed; arrow, distance and selected store are immediately legible.
- Style fidelity: passed; typography, palette, materials and spacing read as the same CHMURNIK family.
- Mobile fit: passed at 390 × 844 px; no horizontal overflow or clipped primary actions.
- Interaction: passed; start, five-store picker, close action and route control are present and keyboard-accessible.
- Data regression: passed; `ul. Dolna 11 lok. U-2, Warszawa` is returned as the closest store in the Dolna test position.
- Browser console: no warnings or errors in the tested start, radar and store-picker states.

## Functional checks

- `node --check app.js`
- `manifest.webmanifest` and `stores.json` JSON parsing
- bundled store dataset nearest-distance check around Dolna, Warsaw
- browser interaction check for exactly one `5 sklepów` button and one `Zamknij` button
- live DOM check showing five stores with Dolna 11 first
