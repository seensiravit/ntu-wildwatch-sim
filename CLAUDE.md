# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A visual, simulated demo for a CC0006 group project at NTU: an "Active Monitoring & Dynamic Warning Pipeline" that detects wildlife near a road and flashes warning signs. No real AI/CV — everything is simulated. Full requirements live in `@SPEC.md`.

## Hard constraints (do not violate)

- **No build step, no npm, no frameworks, no CDN, no third-party libraries.** The app must run offline by double-clicking `index.html`.
- **Use classic `<script>` tags, not ES modules.** Chrome/Edge block module imports over `file://`, so `import`/`export` will break the app. Share code via globals across the files below.
- **Draw all graphics with HTML5 Canvas shapes.** No image sprites, no copyrighted/third-party assets.
- **All geometry, tuning, species, cameras and signals live in `js/config.js`** in logical map units (e.g. 1000×700), scaled to the canvas. Never hard-code coordinates or constants in the rendering/logic files — a later version swaps in the real NTU map by editing config only.
- Target a 1920×1080 display; the layout must scale down cleanly to 1366×768.

## File structure (per SPEC §2)

```
index.html
css/style.css
js/config.js      // map, cameras, signals, species, tuning constants
js/geometry.js    // path, cone, point-in-polygon helpers
js/animals.js     // animal entity, drag/rotate/release, movement
js/car.js         // car entity, path following, speed logic
js/detection.js   // camera <-> animal detection, signal state
js/render.js      // map + night rendering
js/dashboard.js   // side panel: camera feeds, signal cards, log
js/main.js        // game loop, input wiring
```

## Testing

There is no test framework. Verify changes manually in a browser: open `index.html` in Chrome or Edge and walk through the acceptance scenarios in `@SPEC.md` §11. Requirement: double-clicking `index.html` works offline with **no console errors**.

## Conventions

- Team project; commit directly to `main`.
- Keep `SPEC.md` as the source of truth. If a change diverges from the spec, call it out.
