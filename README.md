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

## 3-step presenter demo

1. **Drag an animal** from the tray (Macaque / Wild boar / Pangolin) onto the road
   near the corner. It appears semi-transparent with a **direction arrow** — drag
   the arrow tip to aim it across the road.
2. **Click the animal** to release it. It starts walking. When it enters **Cam 1's**
   view cone, the camera card shows **Detecting**, a thermal blob appears, **Signal 1
   flashes** `WILDLIFE AHEAD – SLOW DOWN`, and a **detection log** entry is recorded.
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
`1000 × 700` grid. Nothing is hard-coded in the rendering or logic files, so you can
reshape the demo by editing config alone:

- **Road shape / car route** — `road.corner` and the `carPath` polyline points.
- **Cameras** — `cameras[]`: each has `x, y, facingAngleDeg, fovDeg, range,
  linkedSignalId`. The view cone is drawn from the angle, field-of-view and range.
  (Angles are degrees, clockwise from east, with +y pointing down: `0`=right,
  `90`=down, `180`=left, `270`=up.)
- **Signals** — `signals[]`: each has `x, y, linkedCameraId, message`. Place a
  signal *upstream* of its camera's coverage along the car's route.
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
```

## Scope

This is **v1** (night mode only, generic map). Day mode, the real NTU map,
before/after comparison, multiple cars, movable cameras, and any real detection
model are intentionally out of scope — see `SPEC.md §12`.
