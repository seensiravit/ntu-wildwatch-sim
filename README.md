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
- **Near misses:** the car was going faster than 35 km/h when it got closest to the
  animal, but didn't touch it.
- **Safe passes:** the car was at 35 km/h or slower by then, and nothing touched.

Each animal is scored once per lap. If an animal already counted as a near miss or safe
pass touches the car later in the same lap, it moves to hits.

Below the three tiles: the average speed at the animal, (ON side) animals detected, and
animals that turned back at the roadside because of the car. The ON side also compares
its hits and near misses with the OFF side.

### Driver model (`js/car.js`, `config.tuning`)

The driver is modelled on driving research (sources below):

1. **Noticing.** The driver notices an animal once it is on the road ahead within
   headlight range (150 units ≈ 21 m: an unalerted driver sees a dark animal under low
   beams at roughly half the ~34 m an alerted one does), or on the verge **inside the
   headlight beam**. They remember it until they
   have passed it, even if it leaves the beam.
2. **Reaction.** Speed doesn't change until the perception-reaction time has passed:
   **0.5 s** for an unexpected animal, **0.35 s** once the driver has been warned by a
   sign. (These are quick, attentive-driver values chosen so the demo car visibly stops;
   research means are 1.1–1.3 s.) An animal the driver was already slowing for that
   steps into the lane is registered as "in my lane" 0.35 s after it enters; meanwhile
   the driver keeps slowing.
   In the last 0.2 s the foot moves to the brake and the car coasts slightly. Letting
   off the brake is quick (under a second).
3. **Braking** then starts, building up smoothly (limited jerk), never beyond an emergency
   limit of about 8 m/s² (0.8 g). What the driver does depends on where the animal is:

| Animal is… | Driver |
|---|---|
| in the car's own lane | brakes about 1.3× harder than strictly needed, easing into a stop 15 units short of it |
| in the other lane | slows (≈2.5 m/s²) to a speed from which it could still stop if the animal steps across, but no slower than 20 km/h |
| on the verge within 40 units of the kerb | eases off (≈1.25 m/s²) to 40 km/h until it has passed |
| on the verge outside the beam | doesn't notice it |

4. **Afterwards.** Once the animal has cleared, the driver waits about 0.5 s, then speeds
   up gently (≈1.5 m/s²) back to 50 km/h.
5. **Signs.** Signs are visible from 480 units (≈67 m). A flashing sign means an animal
   is in the crossing area, so a driver who sees one registers it after the 0.5 s
   reaction time and brakes steadily (≈4 m/s²) to a **stop line** 20 units before the
   camera's coverage begins (x 320 with the current camera, clear of the crossing
   hotspot; drawn as an amber dashed line across the lane while the sign flashes). The car waits there until the sign has been off for 1 s (20 s at most),
   then drives on at 20 km/h through the area, staying warned (slow and alert) until the
   end of the zone. A driver who sees the sign too late to stop at the line without
   braking harder than ≈6 m/s² goes through slowly at 20 km/h instead.

At 50 km/h the driver **cannot** stop for an animal first seen in the lane at the far edge
of the headlights: reaction plus braking need about 22 m and the light reaches 21 m, so
the car arrives at the animal still doing about 20 km/h. This is the "outdriving your
headlights" problem the camera and signs exist to fix. A warned driver, already at
20 km/h or waiting at the stop line, needs only about 5 m.

**What this means for the demo.** Over 20 fast-forwarded 20-minute demos per layout
(hits split by the car's speed at contact):

| | Hits OFF → ON | …of which over 30 km/h | …under 5 km/h | Near misses | Safe passes | Avg speed at the animal |
|---|---|---|---|---|---|---|
| today's settings (camera 110°, range 250; headlights 150; signs at the camera; driver stops at the line) | 165 → 118 (−28%) | 132 → 23 (−83%) | 4 → 28 | 241 → 19 (−92%) | 49 → 648 | 41 → 9 km/h |
| same with the earlier 84° camera view | 178 → 114 (−36%) | 142 → 27 (−81%) | 6 → 24 | 271 → 38 (−86%) | 69 → 627 | 40 → 12 km/h |

Without the system the driver outdrives the headlights: most contacts happen above
30 km/h. With it the car waits at the stop line and then creeps through the area, so the
contacts that remain are mostly animals walking into a slow or stopped car (most ON hits
are under 30 km/h). Serious hits fall by four fifths and near misses by six sevenths. Hits are rare events, so compare many runs, not a few minutes of
live demo.

Sources for the driver model: Green (2000), reaction times
(<https://www.visualexpert.com/Resources/reactiontime.html>); NCHRP 15-75 reaction-time and
deceleration data (<https://onlinepubs.trb.org/onlinepubs/webinars/250206.pdf>); AASHTO
stopping sight distance (<https://en.wikipedia.org/wiki/Stopping_sight_distance>); Markkula
et al. 2016, brake build-up in real near-crashes
(<https://eprints.whiterose.ac.uk/id/eprint/102162/>); Grace et al. 2015, drivers brake
earlier for deer when warned (<https://natureconservation.pensoft.net/article_preview.php?id=4420>).
The verge and other-lane responses and the jerk values are estimates.

If the booth screen is left idle, an **auto-demo** plays, with animals arriving as
described below; any interaction hands control back to the visitor.

**Preset scenario (▶ Scenario, or `S`).** A scripted, repeatable 3-act comparison, about
80 seconds, with identical animals on both maps so the only difference is the car:

| Act | What happens | System OFF | System ON |
|---|---|---|---|
| 1 · Out of the dark | A macaque is already on the verge; a wild boar steps into the road as the car arrives | near miss, then a hit at ~41 km/h | camera sees them on the verge, signs flash, car stops at the stop line |
| 2 · A troop crosses | Five macaques cross in a line | near misses one after another, a low-speed hit | waits at the line until the sign clears |
| 3 · The one that doesn't notice | A slow pangolin crosses from the Hall 15 side and never notices the car | near miss at 50 km/h | stops at the line |

The hint shows each act's caption; the cars wait during captions. At the end the sim
freezes on a **results card** (serious hits over 30 km/h, low-speed contacts, near misses,
safe passes, average speed at the animal, per side). `S` replays, `Esc` or **Reset**
returns to the live demo. The script lives in `js/config.js` → `scenario` (an animal
with a negative `atSec` is released during the caption, before the cars start, e.g. so
the sign is already flashing as the warned car approaches).

Extra controls: **Pause** freezes the simulation (drag/drop still works while paused);
**Reset** clears animals, the log and both scoreboards; **Key** shows the legend;
**Animal activity** sets how often animals arrive (level 4 = a group every 12 s on
average, level 10 = every 4.8 s). Shortcuts: Space = pause, R = reset, S = scenario,
Esc = leave the scenario.

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
  units of the crossing point (it sees and hears it coming), or stopped within 70 units of it.
- **Doesn't notice the car:** a few animals never notice it and keep walking: 5% of
  macaques, 10% of boar and 25% of pangolins (which have poor eyesight).
- **Car nearby:** its boldness and species decide whether it crosses anyway (macaque
  25%, boar 50%, pangolin 30%), waits (shown by three pulsing dots), or turns back
  (shown by "↩"). The species types follow
  Jacobson et al. (2016): macaques are avoiders, wild boar are speeders (they dash across,
  faster), and pangolins are pausers (they freeze, and curl up when threatened).
- **Waiting:** a waiting animal crosses once the car has been gone for 1 s, a gap in
  traffic like the ones deer studies describe. If it waits too long, it turns back.

Counting the ones that don't notice it, the share of animals that meet a car nearby and
still cross is 29% for macaques, 55% for boar and 48% for pangolins. The
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
area)**: one straight road, one overhead camera on the centreline looking west (110° view, 250-unit range, reaching
well up the wildlife verge at the hotspot so animals are seen before they step out; the
settings study found 110° cut serious hits most), and
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
js/scenario.js      Preset 3-act scenario (scripted animals, results card)
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

### Settings study (`research/settings.html`)

`research/settings.html` asks a different question: under which settings does the system
work best, and which settings make the difference between OFF and ON clearest? It runs
the split-screen demo itself (both sides, same animals, laps started together, exactly
like `js/main.js`) for 20 simulated minutes per seed, 10 seeds per setting, changing one
factor at a time from today's settings: camera range, field of view and placement; how
far the sign is visible; whether the warned driver stops at the line, and where; the
warned speed; the driver's headlight range, reaction time and cruise speed; animal
activity and boldness; and hotspot vs anywhere crossings. It then tries the best level of
each system-controlled factor together. Hits are split by the car's speed at contact
("serious" = over 30 km/h) and normalised per 100 crossings so busy and quiet settings
compare fairly. Results are saved in `research/results/settings-study.csv` / `.json`;
`?quick` gives a 30-second smoke run. `tuning.stopForSign` exists for this study (false =
the warned driver only slows to 20 km/h).

Findings (250 runs): today's settings are already near the best of the grid, cutting
serious hits by 78% and near misses by 86%. The one change that helps on both counts is a
**wider camera view, 110°** (serious ON hits 0.88 → 0.72 per 100 crossings, near misses
−92%, about +2 s per lap for the warned car). A longer range (350), a 60° view, the other
two camera positions, a sign visible from only 320, and a stop line 80 units back all did
worse. Without the stop line, serious hits are unchanged but the near-miss cut drops to
78% and the total-hit cut to 10%. Busy traffic (a group every 6 s) shows the biggest
contrast (91%) but makes the warned car wait 13 s more per lap; crossings anywhere along
the road cut the effect to 23%, which is the case for deploying at a known hotspot. With
research-mean reaction times (1.1 / 0.7 s) the system still cuts serious hits by 62%.

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
