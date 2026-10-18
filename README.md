# NTU WildWatch — Demo (v1)

A visual, **simulated** demo of an *Active Monitoring & Dynamic Warning Pipeline*
for reducing wildlife roadkill around NTU (CC0006 group project, Prong 1).

Roadside cameras "detect" animals near a road; when an animal enters a camera's
view cone, an upstream warning sign flashes and a car slows down. There is **no
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

1. **Drag an animal** from the tray (Macaque / Wild boar / Pangolin) onto the green
   verge opposite Hall 15, just north of Nanyang Crescent. It appears
   semi-transparent with a **direction arrow** — drag the arrow tip to aim it across
   the road.
2. **Click the animal** to release it. It starts walking. When it enters the camera's
   view cone (**Cam 1 · Opp Hall 15**), the camera card shows **Detecting**, a thermal
   blob appears, **both signs flash** `WILDLIFE AHEAD – SLOW DOWN`, and a **detection
   log** entry is recorded.
3. **Watch the car** loop around the road. As it passes the flashing sign its speed
   drops from **50 → 20 km/h**. If an animal is walking on the road directly ahead,
   the car **stops and waits**, then resumes once the road is clear.

**The key message — flip `System: ON` to `OFF`.** With the system **off**, the
cameras and signs are gone, the driver gets no early warning, and the car reaches the
animal at full speed — a red **NEAR MISS** flashes. Turn it back **on** and the same
crossing is detected early, the sign warns, the car slows, and the encounter is
**avoided**. The **Impact** panel keeps score: animals detected, near-misses (system
off) vs near-misses avoided (system on), and average speed at the crossing.

If the booth screen is left idle, an **auto-demo** plays the with/without comparison on
a loop; any interaction hands control back to the visitor.

Extra controls: **Pause** freezes the simulation (drag/drop still works while paused);
**Reset** clears animals, the log and the scoreboard; **Key** shows the legend.

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
js/dashboard.js     Side panel: camera feeds, signal cards, detection log
js/main.js          Game loop, controls, input wiring
js/stats.js         Impact scoreboard (detections, near-misses, avoided, speeds)
wildwatch-dashboard.js  Team's DED dashboard extension (vendored — see below)
```

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
  Only while the System is ON (no cameras = no detections).
- Our camera reports as the dashboard's existing **Tamarind area (CAM-04)** camera
  (`js/config.js` → `dashboard.cameraLocations`), so no extra map node is needed.
  To put a camera somewhere its map doesn't cover yet, add it under
  `dashboard.extraLocations` (plus optional `extraRoads` / `extraLabels`).
- **Our signals stay authoritative.** The car slows and our signs flash for every
  detection. The dashboard's risk model decides what *it* logs as the
  recommended response; it does not drive the simulation.
- Its tabs are docked in our header, and its roadside-response panel is turned off
  (`dashboard.showDock`) because our in-map signs and signal cards already show it.
- **Reset** also clears its saved history. Otherwise that history survives page
  reloads, because the extension keeps it in the browser's local storage.

`wildwatch-dashboard.js` is vendored from the teammate's file. Local changes are
minimal and marked `[host-config]` (they let the host add cameras and roads to the map).
Re-apply them if you pull a newer copy of her file.

## Scope

This is **v1** (night mode only, generic map). Day mode, the real NTU map,
before/after comparison, multiple cars, movable cameras, and any real detection
model are intentionally out of scope — see `SPEC.md §12`.
