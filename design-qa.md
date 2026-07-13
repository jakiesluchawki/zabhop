# Design QA — PogodaPark / planer Energylandii

## Materiał porównawczy

- Source visual truth (pogoda / barometr): `/Users/mieszkomahboob/.codex/attachments/75bad5d8-688a-4fed-a8d1-348c5c3833da/codex-clipboard-2cddf554-35a8-4098-9a74-41af2c731dbf.png`
- Source visual truth (plan / spokojna karta papieru): `/Users/mieszkomahboob/.codex/attachments/2633649c-e4e0-4a3d-8b6e-799db6753730/codex-clipboard-d519a368-edaf-4db6-8a7d-bd661e196217.png`
- Rendered implementation: `/tmp/pogodapark-weather-mobile-qa.jpg`
- Full-view comparison board: `/tmp/pogodapark-weather-comparison.png`
- Viewport: 390 × 844 px.
- State: wejście → „Najpierw sprawdź pogodę”, świeże dane, karta Antistorm widoczna; testowane 2026-07-13.

Comparison board places the supplied weather source and the rendered browser capture side by side at a normalized phone height. The source is a taller 850 × 1652 capture, so the comparison intentionally focuses on the visible weather decision region rather than browser chrome or the lower continuation of the page.

## Primary interactions checked

- Entry choice opens the weather decision view.
- Weather day switch, score, route CTA and Antistorm safety card remain present above the fold at 390 px.
- Planner onboarding contains a reversible „Pokazy na żywo” opt-in; generated plan keeps official-show material optional and expands its official description, time, place, photo and source links.
- Show feed reports source freshness and does not schedule an event when it would consume a core ride, meal or exit buffer.
- Tested browser console: only Vite / React development informational messages; no application errors or warnings.

## Findings

### Final visual pass

- P0 findings: none.
- P1 findings: none.
- P2 findings: none.

### Required fidelity surfaces

- Fonts and typography: passed. Romie remains the editorial display face for the verdict; Roobert carries compact controls, source labels and metrics with legible line lengths. No truncation or one-word columns appear in the tested weather region.
- Spacing and layout rhythm: passed. The weather view now shares the planner’s restrained paper frame, thin olive dividers, rounded hierarchy and mobile padding while keeping the score, meter and direct route action visible without a first scroll.
- Colors and visual tokens: passed. The intentional move from the older all-pink weather shell to a cream/rose paper surface aligns it with the planner; violet remains reserved for the active day and numerical score, green for the route action and safe status.
- Image quality and asset fidelity: passed. The supplied felt barometer art remains a real raster asset at the center of the decision screen; its stitched dial, needle and settling animation were not substituted or redrawn in CSS/SVG.
- Copy and app-specific content: passed. „Pokazy na żywo” is framed as a quiet, voluntary add-on and its user-facing show descriptions, places and times come from Energylandia’s official show pages.

## Comparison history

### Iteration 1 — warm-paper unification

- Earlier issue: the older weather shell and the newer planner introduced competing material treatments.
- Fix applied: moved the weather page into the same warm-paper card hierarchy, token palette, radii, dividers and compact mobile rhythm as the planner; preserved the barometer asset and its pointer behavior.
- Post-fix evidence: `/tmp/pogodapark-weather-comparison.png` shows the shared paper hierarchy without losing the barometer’s tactile illustration, score hierarchy or information density.
- P0 findings: none.
- P1 findings: none.
- P2 findings: none.

### Iteration 2 — mobile show/planner regression

- Earlier issue: a new optional show section could have widened dense timeline rows on very narrow devices.
- Fix applied: made the show row use the same narrow timeline grid as meals and flexible buffers, kept show material inside a bounded accordion, and compacted the opt-in treatment on short phones.
- Post-fix evidence: 390 px DOM check reports matching `scrollWidth` and `clientWidth` (390 px); the official-show panel has no horizontal overflow.
- P0 findings: none.
- P1 findings: none.
- P2 findings: none.

## Open questions

- None blocking release. Show performance times remain explicitly subject to operator changes; the UI labels the checked time and keeps the official Energylandia link available.

## Implementation checklist

1. Preserve the real felt barometer asset and animation when changing weather layout.
2. Keep show insertion restricted to an explicit opt-in, a fresh official feed and the final flexible window.
3. Keep the source timestamp and the official show/map links visible whenever show data is shown.
4. Re-run this 390 × 844 comparison when a future weather or planner shell changes.

## Follow-up polish

- P3: When live schedule coverage expands beyond the current four-day official range, surface a short availability note before the user chooses a farther future visit date.

final result: passed
