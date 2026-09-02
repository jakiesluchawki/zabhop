# ŻabHop launch media

Five silent 1080 × 1920 H.264 Stories, matching still JPG alternatives,
two 1080 × 1350 feed posts, copy/sticker instructions and a mobile download gallery.

The two references provided by the owner were Chmurnik's `/premiera/` launch pack
and `/premiera/historia/?v=20260903-fast-v2`. The package preserves the shared
Romie / Roobert typography and pink / olive / violet felt identity, but uses only
ŻabHop's own graphics and already-public iOS screenshots.

These are deliberately described as product montages, not genuine gesture
recordings. Crops and camera moves preserve the screenshots' original pixel
content. No gestures, store data, personal origin story or endorsements are invented.
The source screenshots depict a historical state, not current opening hours.

## Build

From the canonical checkout on macOS with the Xcode command-line tools:

```
node social/premiere/build.mjs
```

Optional stages: `--images-only`, `--videos-only`, `--package-only`.
The first run imports only the two named public screenshots from the local
App Store material folder into `assets/`; the committed copies make subsequent
builds independent of private release material. No external packages or network
access are required to render. Original bundled OTF fonts are registered only
for the renderer process, not installed in the user's system.

The Swift compositor creates fixed text layouts, JPEGs and transparent copy
overlays. The encoder composites those overlays on every frame, validates the
video track/codec/duration and exports decoded QA frames. Intermediate render
plans, font metrics and frame proofs stay under ignored `.local/premiere-build/`.
The public manifest contains hashes, dimensions, sources and exact export lists.

Only `premiera/` is a public website output. Sources under `social/` must be
excluded from both shared GitHub Pages workflows. Native iOS source and the
application itself are not changed by this campaign.

## Copy and safe zones

All story typography starts below y=220 and ends before y=1704. The blank
600 × 120 Link sticker area is x=240, y=1510. Neither artwork nor copy overlaps
it. The user must add a real Instagram Link sticker; no fake clickable control
is burned into images or video. Full story copy remains visible throughout
each 7–7.2 second montage. The file share action is explicitly user-triggered;
the gallery does not download full videos automatically.

App Store availability and zero price were verified in Apple's public Polish
storefront on 2026-09-02. The short store link uses ID 6789961777. No social-account
post is submitted by this package, and publishing its gallery is a separate action.
