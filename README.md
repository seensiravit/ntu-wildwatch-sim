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
   driver only reacts once the animal is in the headlights, reaches it at full speed,
   and a red **NEAR MISS** flashes. (Either car stops and waits if an animal is on the
   road directly ahead; there are no collisions.)

**The key message is in the two Impact scoreboards.** Each counts near-misses, encounters
where the car had already slowed ("Slowed in time") and the average speed at the animal.
The ON side also counts animals detected and shows how many near-misses it prevented
compared to the OFF side. A typical 90-second auto-demo run: OFF 6 near-misses at about
38 km/h, ON 0 near-misses at about 14 km/h.

If the booth screen is left idle, an **auto-demo** spawns animals on a loop; any
interaction hands control back to the visitor.

Extra controls: **Pause** freezes the simulation (drag/drop still works while paused);
**Reset** clears animals, the log and both scoreboards; **Key** shows the legend;
**Spawn rate** sets how often the auto-demo adds animals. Shortcuts: Space = pause,
R = reset.

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
js/animals.js       Animal entities: drag / rotate / release / walk
js/car.js           Car: path following + speed rules
js/detection.js     Camera <-> animal detection, signal + log state
js/render.js        Map + night rendering (road, cones, signals, car, animals)
js/dashboard.js     Dashboard strip under each map: impact, camera feed, signs, log
js/main.js          The two worlds (OFF | ON), game loop, controls, input wiring
js/stats.js         Impact scoreboard (detections, near-misses, avoided, speeds)
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
