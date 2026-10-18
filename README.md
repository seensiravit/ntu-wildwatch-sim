# NTU WildWatch — Demo (v1)

A visual, **simulated** demo of an *Active Monitoring & Dynamic Warning Pipeline*
for reducing wildlife roadkill around NTU (CC0006 group project, Prong 1).

Roadside cameras "detect" animals near a road; when an animal enters a camera's
view cone, an upstream warning sign flashes and a car slows down. The page shows the
same scene **twice, side by side**: **System OFF** on the left (no cameras, no signs)
and **System ON** on the right, so you can see whether the system actually helps. There is **no
real AI or computer vision** — every detection is simulated. See `SPEC.md` for the
full design.

## Run it

**Just double-click `index.html`** — it opens in Chrome or Edge and runs fully
offline. No install, no build step, no internet, no dependencies.

> If you clone from GitHub, keep the folder structure intact (`index.html` next to
> the `css/` and `js/` folders). Opening the file directly (`file://`) is supported.

## Deploy (optional — Render static site)

The demo is a plain static site, so it hosts anywhere with no build. To put it online
with [Render](https://render.com) using the included `render.yaml`:

1. Render dashboard → **New → Blueprint**.
2. Connect this GitHub repo and apply the blueprint.
3. It deploys to a URL like `https://ntu-wildwatch-sim.onrender.com` and
   **auto-redeploys on every push to `main`**.

No build command, no environment variables. (Manual alternative: **New → Static Site**,
Build Command *empty*, Publish Directory `.`)

## 3-step presenter demo

The two maps share their animals: anything you drop, aim or release on **either** map
appears on both, so both drivers meet exactly the same crossings. Each side has its own
car and its own dashboard underneath. Both cars start every lap together. The OFF car
never slows for the signs, so it finishes first and waits off-map for the ON car.

1. **Drag an animal** from the tray (Macaque / Wild boar / Pangolin) onto the green
   verge opposite Hall 15, just north of Nanyang Crescent, on either map. It appears
   semi-transparent with a **direction arrow** — drag the arrow tip to aim it across
   the road.
2. **Click the animal** to release it. It starts walking. On the **ON** map, when it
   enters the camera's view cone (**Cam 1 · Opp Hall 15**), the camera card shows **Detecting**, a thermal
   blob appears, **both signs flash** `WILDLIFE AHEAD – SLOW DOWN`, and a **detection
   log** entry is recorded.
3. **Compare the two cars.** On the right, the car sees the flashing signs and slows
   from **50 → 20 km/h** before the crossing. On the left there is no warning: the
   driver only notices the animal once it's on the road, still at full speed. An orange
   **NEAR MISS** or a red **HIT** marker shows what happened. There are no crash graphics.

**The key message is in the two Impact scoreboards.** Each sorts every car–animal
encounter into one of three outcomes:

- **Animals hit:** the car and the animal touched, whoever moved into whom, even with
  the car standing still (a car stopped in an animal's path is in the wrong place).
- **Near misses:** the car came at the animal faster than 35 km/h but didn't touch it.
- **Safe passes:** the car had already slowed to 35 km/h or less, and nothing touched.

Each animal is scored once per lap. If an animal already counted as a near miss or safe
pass touches the car later in the same lap, it moves to hits.

Below the three tiles: the average speed at the animal, (ON side) animals detected, and
animals that turned back at the roadside because of the car. The ON side also compares
its hits and near misses with the OFF side.

How hits happen: the driver needs a reaction time (`tuning.driverReactionSec`, 0.8 s)
after noticing an animal on the road ahead before braking starts. A driver warned by a
flashing sign is expecting animals, so reacts faster (`alertReactionSec`, 0.4 s), and is
already slower. Over 100 fast-forwarded minutes of the auto-demo (5 runs of 20 min at the
default activity): OFF 44 hits / 109 near misses / 3 safe passes; ON 24 hits / 41 near
misses / 76 safe passes. Most remaining ON hits are animals crossing outside the single
camera's view. Hits are rare events (about one every 2–3 minutes on the OFF side), so a
few minutes of live demo is a small sample: let it run, or raise **Animal activity**.

If the booth screen is left idle, an **auto-demo** plays, with animals arriving as
described below; any interaction hands control back to the visitor.

Extra controls: **Pause** freezes the simulation (drag/drop still works while paused);
**Reset** clears animals, the log and both scoreboards; **Key** shows the legend;
**Animal activity** sets how often animals arrive (level 4 = a group every 12 s on
average, level 10 = every 4.8 s). Shortcuts: Space = pause, R = reset.

## Animal arrivals and roadside behaviour

Every animal appears on both maps at once, as a pair of twins with the same path and
"boldness". So both drivers face the same arrivals, and each twin then reacts to its own
side's car. Dragging, aiming or releasing an animal on either map applies to both twins.

**When (`js/spawner.js`, `config.spawning`).** Animals arrive in **groups**, and groups
arrive as a **Poisson process**:
- The gap between groups is a shifted exponential: 3 s + an exponential with mean 9 s,
  so a group arrives every 12 s on average (demo time is compressed).
- Exponential gaps are the standard model for random, independent arrivals; road-crossing
  and collision models use them for both vehicles and animals. The 3 s minimum stops two
  unrelated groups arriving at the same moment.
- Each group is one species, weighted toward wild boar (the most common crossing species
  on a forest-edge road in Singapore). Its size is 1 + Poisson(extra), capped: macaque
  troops average 2 and boar sounders 1.6, both up to 4; pangolins are solitary. Group
  members follow each other 0.8–1.8 s apart.
- This clumping is why real roadkill counts are more variable than a plain Poisson count,
  which is why roadkill studies use negative binomial models.

**Where.** Crossing points along the road ~ Normal(490, sd 60), around the Tamarind
verge hotspot. 75% come from the wildlife verge (north), 25% from the Hall 15 side.
Headings are straight across ± a few degrees; speeds vary ±12% around the species speed.
Some crossings fall outside the camera's view, which shows its coverage gaps honestly.

**Roadside behaviour (`js/animals.js`, `config.crossing`, each species' `traffic`).**
Each animal decides once, 25 units before the road edge:
- **No car nearby:** it crosses. A car counts as nearby if it's approaching within 170
  units of the crossing point (about headlight range), or stopped within 70 units of it.
- **Car nearby:** its boldness and species decide whether it crosses anyway, waits
  (shown by three pulsing dots), or turns back (shown by "↩"). The species types follow
  Jacobson et al. (2016): macaques are avoiders, wild boar are speeders (they dash across,
  faster), and pangolins are pausers (they freeze, and curl up when threatened).
- **Waiting:** a waiting animal crosses once the car has been gone for 1 s, a gap in
  traffic like the ones deer studies describe. If it waits too long, it turns back.

With a car parked at the hotspot, about half of the animals still cross (the ones
outside its 70-unit range plus the bold ones), against all of them on an empty road. The
response probabilities and the demo arrival rate are assumptions chosen to match these
patterns, not measured values.

Sources:
- Jaarsma, Van Langevelde & Botma, road-traversing model with Poisson-distributed car
  arrivals: <https://swov.nl/en/publicatie/flattened-fauna-and-mitigation-traffic-victims-related-road-traffic-vehicle-and-species>
- Poisson model of vehicle arrivals and crossing probability: <https://escholarship.org/uc/item/4th0121d>
- Collision risk with Poisson car arrivals (2025 preprint): <https://arxiv.org/pdf/2507.17058>
- Overdispersed roadkill counts, negative binomial models: <https://rdpc.uevora.pt/handle/10174/4041>
- Jacobson et al. 2016, behavioural responses to traffic (Ecosphere): <https://doaj.org/article/d834bfffa653415daa6cf658c6b44f85>
- Deer gap acceptance (30–60 s between vehicles): <https://rosap.ntl.bts.gov/view/dot/58648>
- Singapore road crossings, wild boar 68% (Ecosphere 2024): <https://doaj.org/article/c309a3e824954f2d8463f925c73d158d>
- Sunda pangolins, roadkill and curling up (NParks): <https://avs.nparks.gov.sg/wildlife/encountering-wildlife/pangolins/>

## Editing the scene (`js/config.js`)

Everything about the scene lives in **`js/config.js`**, in logical map units on a
`1000 × 700` grid. The current map is **Nanyang Crescent opposite Hall 15 (Tamarind
area)**: one straight road, one overhead camera on the centreline looking west, and
two warning signs flanking the road at the camera. Traffic drives **eastbound** (left
to right) toward the camera; drivers see the flashing signs ahead and slow before the
crossing. The road is a
**centerline polyline** (`NANYANG_CRESCENT`, currently two points), so it can follow
any real road shape by adding points. Nothing is hard-coded in the rendering or logic
files, so you can reshape the demo by editing config alone:

- **Road shape / car route** — the `NANYANG_CRESCENT` polyline (used by both
  `road.centerline` and `carPath`); `road.crosswalkT` places the crossing.
- **Scene** — `scene`: `greenArea` (verge), `water` (canal), `buildings` (Hall 15)
  and `labels`. Each part is optional.
- **Cameras** — `cameras[]`: each has `x, y, facingAngleDeg, fovDeg, range`. The view
  cone is drawn from the angle, field-of-view and range. (Angles are degrees,
  clockwise from east, with +y pointing down: `0`=right, `90`=down, `180`=left,
  `270`=up.)
- **Signals** — `signals[]`: each has `x, y, linkedCameraId, message`. One camera can
  drive several signs. A sign should be before (or at) its camera's coverage along
  the car's route. Drivers start slowing `tuning.signSightDistance` before a
  flashing sign, i.e. once they can see it.
- **Car direction & lane** — the car drives eastbound (left to right) in its own
  lane: Singapore drives on the left, so `carPath` is the centre line shifted half a
  lane to the left of travel (`sidePath(NANYANG_CRESCENT, LANE_WIDTH / 2)`, the north
  lane). For westbound use `sidePath(NANYANG_CRESCENT.slice().reverse(), LANE_WIDTH / 2)`.
- **Species** — `species[]`: label, colour, size, speed, heat colour, shape.
- **Behaviour tuning** — `tuning`: cruise/warning speeds, accel/decel, braking
  look-ahead, confidence range, flash rate, headlight cone, etc.

Save the file and reload `index.html` to see your changes.

## Project layout

```
index.html          Page shell + script load order (classic scripts, file:// safe)
css/style.css       Layout + night theme
js/config.js        All geometry, cameras, signals, species, tuning  <-- edit this
js/geometry.js      Pure helpers (cones, point-in-polygon)
js/animals.js       Animal entities: drag / rotate / release / walk, roadside decisions
js/spawner.js       When and where animals arrive (Poisson groups, hotspot locations)
js/car.js           Car: path following + speed rules
js/detection.js     Camera <-> animal detection, signal + log state
js/render.js        Map + night rendering (road, cones, signals, car, animals)
js/dashboard.js     Dashboard strip under each map: impact, camera feed, signs, log
js/main.js          The two worlds (OFF | ON), game loop, controls, input wiring
js/stats.js         Impact scoreboard (detections, hits, near misses, safe passes, speeds)
wildwatch-dashboard.js  Team's DED dashboard extension (vendored — see below)
```

### How the split screen works

`js/main.js` defines two worlds, `WW.worlds.off` and `WW.worlds.on`. Each world has its
own canvas, car, camera/sign state, log and scoreboard. The animals (`WW.animals.list`)
are **shared**. `car.js`, `detection.js`, `stats.js` and `render.js` keep their per-world
state behind a `use(world)` switch, and `WW.useWorld(w)` points them all at one side.
Each frame the loop moves the animals once, then selects each world in turn to update
it, and does the same again to draw it. `WW.system.enabled` reads the selected world's
`systemOn`, so the module code works the same on either side. If you add state to one
of these modules that differs between the sides, put it behind its `use()` as well.

## Camera placement study (`research/`)

`research/index.html` runs the demo's own simulation modules headlessly to answer where
to put the cameras, which way to aim them and how many to install. It works offline:
open it and press **Run study** (about 6 minutes, about 3,600 runs). Every layout faces
the same seeded animal crossings and is compared with no system. Four scenarios: hotspot
or anywhere crossings, eastbound or westbound traffic.

- **Stage 1:** 120 single cameras (5 positions × 3 mounting spots × 8 directions).
- **Stage 2:** 1 to 4 cameras, chosen greedily, plus three hand-designed layouts.
- **Stage 3:** lens and driver sight-distance sensitivity.

Results are saved in `research/results/` (`camera-study.csv`, `study-run.json`).
Headline: put the camera at the crossing hotspot and aim its view at the crossing. One
camera prevents about 45% of near-misses, two about 60%, three about 70% and four about
72%, so three is where the benefit levels off. Add `?quick` to the URL for a 15-second
smoke test.

For the study, `js/car.js` measures a camera's coverage from its whole view footprint
projected onto the road, so a verge camera that sees the crossing also covers it. It
also honours an optional `dir` on signals (`config.carDir`). The demo's signs have no
`dir`, and for its camera the footprint ends about 23 units later than before.

## DED dashboard (`wildwatch-dashboard.js`)

The **DED Dashboard** tab in the header is the team's monitoring and decision-support
extension (for NTU's Development & Estate Department). It shows a campus-wide
hotspot map, risk-scored event log, species and time-of-day charts, an
infrastructure priority list (Prong 2: canopy bridge / culvert / fencing), CSV
export and a 30-day sample history.

How it connects to the simulator:

- On each detection, `js/detection.js` reports to the extension:
  ```js
  WildWatch.record({ species, location, camera, confidence /* 0..1 */, proximity });
  ```
  Only from the System ON side (the OFF side has no cameras, so no detections).
- Our camera reports as the dashboard's existing **Tamarind area (CAM-04)** camera
  (`js/config.js` → `dashboard.cameraLocations`), so no extra map node is needed.
  To put a camera somewhere its map doesn't cover yet, add it under
  `dashboard.extraLocations` (plus optional `extraRoads` / `extraLabels`).
- **Our signals stay authoritative.** The car slows and our signs flash for every
  detection. The dashboard's risk model decides what *it* logs as the
  recommended response; it does not drive the simulation.
- The top of its page has our **"Live simulation: with vs without WildWatch"** table:
  near-misses, average speed at the animal, the share of encounters where the car had
  slowed in time, and animals detected, without vs with, updated live. `js/dashboard.js`
  (`buildDed`) inserts the card from our side, so her file needs no change for it.
- Its tabs are docked in our header, and its roadside-response panel is turned off
  (`dashboard.showDock`) because our in-map signs and signal cards already show it.
- **Reset** also clears its saved history. Otherwise that history survives page
  reloads, because the extension keeps it in the browser's local storage.

`wildwatch-dashboard.js` is vendored from the teammate's file. Local changes are
minimal and marked `[host-config]` (they let the host add cameras and roads to the map).
Re-apply them if you pull a newer copy of her file.

## Scope

Night mode only. Day mode, multiple cars, movable cameras, and any real detection
model are intentionally out of scope — see `SPEC.md §12`.
