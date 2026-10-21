# Folder structure: what every file is

A map of the repository for someone opening it for the first time. The project is
plain HTML, CSS and JavaScript with no build step: every page runs by double-clicking
it. The code is split into small modules that share one global object, `WW`, loaded in
order by classic `<script>` tags.

```
ntu-wildwatch-sim/
├── index.html              the presentation demo
├── installation.html       the installation demo (research values, cars both ways)
├── css/style.css           all styling for both demo pages
├── js/                     the simulation and the pages' code
├── wildwatch-dashboard.js  a teammate's DED dashboard extension (vendored)
├── docs/                   documentation and reference images
├── research/               the studies: pages, Node drivers, results, reports
├── README.md, SPEC.md, CLAUDE.md, LICENSE, render.yaml, .gitignore
```

## Top level

| File | What it is |
|---|---|
| `index.html` | **The presentation demo.** Two copies of the road side by side, System OFF and System ON, one car per side, animals you can drag from the tray, the auto-demo, and the scripted 3-act scenario (key **S**). Paced to be watched: fast animals, a quick driver. |
| `installation.html` | **The installation demo.** Same code, selected by `<body data-mode="installation">`: applies the research values and the recommended installation (two 90° cameras in crossfire, one sign per direction, "slow down" rule, 30% of drivers obeying), with a stream of cars in both directions, running at 2× speed. |
| `css/style.css` | Layout and colours for both pages: the header, the two maps, the dashboard strips under them, the hint pill, the scenario card, the 1366 px breakpoint. |
| `wildwatch-dashboard.js` | The **DED dashboard** extension written by a teammate and vendored as-is. The simulation only reports detections to it (`WildWatch.record`); it is configured from `js/config.js` → `dashboard` through `window.WILDWATCH_CONFIG`. Edit it as little as possible and mark edits `[host-config]`. |
| `README.md` | The project guide: where to look, how to run it, the presenter demo, the driver and animal models with sources, every study's findings, the DED integration, scope. |
| `SPEC.md` | The original requirements and acceptance scenarios. The source of truth for what the demo must do; changes that diverge from it are called out in the README. |
| `CLAUDE.md` | Working rules for the AI coding assistant used on this repository: the hard constraints (no build, no CDN, classic scripts, all numbers in config), the file list, how to test. |
| `CLAUDE.local.md` | Personal notes for the same assistant; git-ignored, not shared. |
| `LICENSE` | The licence. |
| `render.yaml` | Optional static-site deployment on Render; not needed to run anything. |
| `.gitignore` | Keeps local files (the personal notes, scratch output) out of git. |
| `ntu-wildwatch-dashboard.html` | A teammate's standalone preview of the DED dashboard. Untracked; not part of the demo. |

## `js/`: the simulation

Loaded in this order; each file adds one module to `WW`.

| File | Module | What it does |
|---|---|---|
| `config.js` | `WW.config` | **Every number lives here**: the map and road geometry, car paths, cameras, signals, species, animal arrivals (`spawning`), roadside behaviour (`crossing`), scoring thresholds (`nearMiss`), the driver model (`tuning`), the scenario script, the auto-demo, the traffic stream, the DED dashboard settings, plus `research` (the literature values laid over the demo values by the studies and the installation demo) and `installation` (that page's cameras and pacing). Also `WW.applyResearch` / `WW.mergeConfig`. |
| `geometry.js` | `WW.geo` | Small helpers: distances, angles, the camera cone polygon, point-in-cone, distance to the road centreline. |
| `stats.js` | `WW.stats` | The per-world scoreboard counters: detections, hits and serious hits, near misses, safe passes, turned back, average speed at the animal, the HIT / NEAR MISS markers. |
| `animals.js` | `WW.animals` | Animal objects and their movement; the roadside decision (cross, wait, turn back) against the cars in their world; twins so every animal exists once per world; drag, aim and release from the tray. |
| `spawner.js` | `WW.spawner` | Seeded random numbers and the arrival streams: animal groups as a Poisson process around the hotspot, and car streams per direction for the installation demo and the research runs. |
| `car.js` | `WW.car` | The driver model: routes per direction and their warning zones, what the driver sees (headlights), the decision every frame (reaction time, signs and stop line, animal in the lane, elsewhere on the road, on the verge, cruise), jerk-limited braking, car-following for streams of cars, and the scoring of each car–animal encounter. One primary car per world plus any number of stream cars. |
| `detection.js` | `WW.detection` | Cameras seeing animals (perfect inside the cone), detection episodes with a confidence value, the per-world log, the signs (flashing while any linked camera is triggered, optional hold), and the report to the DED dashboard. |
| `render.js` | `WW.render` | Draws a world onto its canvas: the night map, road, buildings, camera cones, signs and links, stop lines, every car with its headlights and brake lights, animals lit or dimmed, markers, the scenario banner. |
| `dashboard.js` | `WW.dashboard` | The strip under each map: the four outcome tiles and footer, the camera feed(s) with a fake thermal view, the sign pills and the detection log, and the live OFF-vs-ON card inserted into the DED dashboard tab. |
| `scenario.js` | `WW.scenario` | The preset 3-act scenario: releases scripted animals on both maps at set times, holds the cars during captions, builds the results card. |
| `main.js` | the page | Start-up, the frame loop, the auto-demo, input wiring, keyboard shortcuts, lap synchronisation for the demo, and the installation mode (research values, two cameras, car streams, warm-up, fast-forward). |

## `docs/`: documentation

| File | What it is |
|---|---|
| `simulation-settings.html` | **How the simulation works and every setting**, in plain language, demo values beside research values, with a drawing of the map. The page to read first. |
| `simulation-model.md` | The technical reference for the same thing: every rule and number in the order the simulation runs them, worked examples, sources, a tuning guide. |
| `scenario.md` | The preset scenario act by act: the script, what happens on each side, the results card, how to change it, presenter notes. |
| `sequence-diagrams.md` | Mermaid sequence diagrams: one frame of the demo, an animal becoming a warning, the driver reacting to an animal, one research run, the installation demo's start. |
| `uml-diagrams.md` | Mermaid UML: the modules and their dependencies, the data model (worlds, cars, animals, routes, signals), state machines for an animal, a car, a sign and the scenario, and what each page loads. |
| `folder-structure.md` | This file. |
| `ntumap1.jpg`, `ntumap2.jpg`, `ntumap3.jpg` | Reference photos and maps of the NTU site (Nanyang Crescent opposite Hall 15). |
| `layout_simple_v1_sketch.png` | The early sketch of the map layout the demo is based on. |
| `campus-shuttle_*.png` | Campus shuttle route maps, for the site context. |

## `research/`: the studies

Each study has a browser page (few seeds, runs offline) and a Node driver that runs the
same code across all CPU cores with many seeds. All of them load the simulation modules
from `js/` and drive them without drawing, so a study result is exactly what the demo
would do.

| File | What it is |
|---|---|
| `index.html` + `study.js` | **Camera placement study** (one car at a time, demo settings): position × mounting spot × facing for one camera, then one to four cameras, scored on serious hits prevented. `CameraStudy` global. |
| `settings.html` + `settings.js` | **Settings study** (one car, demo settings): one factor at a time around today's configuration; the two-world twin run (`runTwin`) that the other studies reuse. `SettingsStudy` global. |
| `run-settings-study.js` | Node driver for the settings study (800 seeds per setting). |
| `demo-runs.html` + `demo-runs.js` | **Short-run reliability study**: hundreds of short runs to see how often a short demo shows the system ahead. `DemoRuns` global. |
| `run-demo-runs.js` | Node driver for it. |
| `traffic.html` + `traffic.js` | **Two-way traffic / installation study**: cars both ways with following and queues; research values laid over the demo config; the policy × sign-rule × trigger grid, sensitivities, and the placement stages (singles, pairs, triples) scored on safety and area coverage. `TrafficStudy` global. |
| `run-traffic-study.js` | Node driver for it: `--stage policy | sens | placement | pairs | triples`, `--lens`, `--first auto`, `--second auto`. |

### `research/results/`: the numbers

CSV for spreadsheets, JSON for the report pages. Re-running a driver overwrites them.

| Files | From |
|---|---|
| `camera-study.csv`, `study-run.json` | the camera placement study (second run, serious hits) |
| `settings-study.csv/.json` | the settings study (800 seeds, today's driver) |
| `demo-runs.csv`, `demo-runs-summary.json` | the short-run reliability study (every run recorded) |
| `traffic-study.csv/.json`, `traffic-placement.csv/.json` | the **first** two-way pass at the demo's settings (kept for history; superseded) |
| `traffic-policy.csv/.json` | the installation study: driver policy × sign rule × trigger, with the combined check |
| `traffic-sens.csv/.json` | its sensitivities (compliance, demand, lens, arrival side, crossings anywhere, rate check, gantry signs) |
| `traffic-placement-90.csv/.json`, `traffic-placement-60.csv/.json` | every single camera for each lens, with coverage |
| `traffic-pairs-90.csv/.json`, `traffic-triples-90.csv/.json` | the best first camera plus each second; the best pair plus each third |

### `research/reports/`: the reports

Standalone pages with the results inlined; open offline. Each older report says at
the top which study superseded it.

| File | What it is |
|---|---|
| `installation-study.html` | **The report to cite**: research parameters, two-way traffic, the three design choices, placement with area coverage, the recommendation and its layout drawing, a conclusion per setting. |
| `simulation-settings.html` | Same page as `docs/simulation-settings.html`. |
| `two-way-traffic-study.html` | The first two-way pass (demo settings, before the car-following fix). |
| `settings-study.html` | The one-car settings study: why the demo is set the way it is. |
| `camera-placement-study.html` | The one-car placement study (demo settings); its camera answer was overturned by the installation study. |

## Which files go together

- **To run the demo**: `index.html`, `css/`, `js/`, `wildwatch-dashboard.js`. Nothing else.
- **To run the installation demo**: the same plus `installation.html`.
- **To change what the demo shows**: `js/config.js` only. The other `js/` files never hard-code a number, so a later version can swap in the real NTU map by editing the config.
- **To re-run or extend a study**: `research/*.js` and `research/run-*.js`; results go to `research/results/`; reports in `research/reports/` are regenerated from them.
- **To understand it**: `docs/simulation-settings.html` first, then `docs/simulation-model.md`, the diagrams, and the Installation Study report.
