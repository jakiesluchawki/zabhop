# Design QA — PogodaPark / planer Energylandii

## Visual truth

- Final weather comparison, including the original production capture: `../../qa/energylandia-final/weather-comparison.png`.
- Final welcome comparison, including the supplied user screenshot: `../../qa/energylandia-final/welcome-comparison.png`.
- Focused 320 px attraction detail: `../../qa/energylandia-final/detail-320.png`.
- Weather at 320, 390 and 430 px: `../../qa/energylandia-final/weather-responsive.png`.

The implementation keeps the Romie/Roobert typography, rose/olive/violet/cream palette, real felt assets, editorial hierarchy and the original settling weather dial. Intentional differences from the original weather screen are the third-day tab and the live Antistorm safety card.

## Viewports and states checked

- Weather decision: 390 px app surface, 720 px visible height, `Jutro`, Tuesday 14 July, score 96/100.
- Responsive harness: 320, 390 and 430 px app frames at 760 px height.
- Welcome: complete page at 480 px and focused 320 px viewport.
- Plan: two-day default party, day 1, meal, group split, reunion and flexible buffer through 20:00.
- Attraction detail: 320 × 760 px with official photo plus Apple Maps and Google Maps visible together without initial scrolling.

## Comparison history

1. Pass 1: the integrated weather dial was too large at short viewport heights. Added the original compact max-height treatment.
2. Pass 2: the 320 px plan header clipped the `Zmień` action. Reflowed the actions into a full-width two-column row.
3. Accessibility pass: removed timeline clamps for meal/split/flex content, strengthened alert/source metadata contrast, added modal focus trapping/Escape/focus return and restored focus on the generated plan heading.
4. Safety pass: separated `SHELTER_NOW` from `LEAVE_NOW`; a storm already overhead now instructs visitors to shelter instead of starting a long walk to the car.
5. Welcome pass: added a real felt route illustration and changed the three explanatory points from bordered pseudo-buttons into a semantic editorial list.

## Functional checks

- Weather → welcome → seven-question onboarding → two-day itinerary works.
- Weather day tabs, hourly sheet and transparent source sheet work.
- Shared link round-trip preserves dates, both days, backup attractions and the declared 20:00 horizon.
- Native share passes only the URL; `Kopiuj link` exposes only the URL and has a manual selection fallback when Clipboard API is unavailable.
- Completed attraction becomes restorable and disappears from the map while retaining its route number in history.
- Attraction details open at the top and show source, photo and both navigation actions.
- No horizontal overflow was visible at 320, 390 or 430 px.
- 74/74 automated tests pass; production build passes. Browser console had no warnings or errors during the audited flow.

final result: passed
