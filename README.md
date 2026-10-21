# NTU WildWatch — Demo (v1)

A visual, **simulated** demo of an *Active Monitoring & Dynamic Warning Pipeline*
for reducing wildlife roadkill around NTU (CC0006 group project, Prong 1).

Roadside cameras "detect" animals near a road; when an animal enters a camera's
view cone, an upstream warning sign flashes and a car slows down. The page shows the
same scene **twice, side by side**: **System OFF** on the left (no cameras, no signs)
and **System ON** on the right, so you can see whether the system actually helps. There is **no
real AI or computer vision** — every detection is simulated. See `SPEC.md` for the
full design.

## Where to look

| If you want to… | Open |
|---|---|
| **See the demo** (the one for presentations) | `index.html`, double-click it. Press **S** for the scripted 3-act scenario. |
| See the system as it would be **installed**, with research values and cars both ways | `installation.html` |
| **Present** the project | [docs/scenario.md](docs/scenario.md): the 3-act scenario, what each act shows, and presenter notes |
| Know **what to recommend** (where the cameras go, what the sign does, what it costs drivers) | [research/reports/installation-study.html](research/reports/installation-study.html), the one report to cite; its "Conclusion for each setting" table is the summary |
| Understand **how the simulation works**, in plain language | [docs/simulation-settings.html](docs/simulation-settings.html) (same page as in `research/reports/`) |
| Look up **a rule or a number** and where it comes from | [docs/simulation-model.md](docs/simulation-model.md), and the "Fixed parameters" table below for the research values and their sources |
| See the **code structure** (modules, data, state machines) or **who calls whom** | [docs/uml-diagrams.md](docs/uml-diagrams.md) and [docs/sequence-diagrams.md](docs/sequence-diagrams.md) |
| **Change** the map, cameras, signs, animals or driver | `js/config.js` only (see "Editing the scene" below); nothing else hard-codes a number |
| Read the **earlier studies** and why their answers changed | [research/reports/](research/reports/): camera placement, settings, two-way traffic; each says at the top what superseded it |
| **Re-run a study** | the `research/*.html` pages (few seeds, in the browser) or `node research/run-*.js` (all cores); results land in `research/results/` |
| Know what the project **does not** do | the "Scope" section at the end, and "What this study cannot tell you" in each report |

## Run it

**Just double-click `index.html`** — it opens in Chrome or Edge and runs fully
offline. No install, no build step, no internet, no dependencies.

> If you clone from GitHub, keep the folder structure intact (`index.html` next to
> the `css/` and `js/` folders). Opening the file directly (`file://`) is supported.

### Installation demo (`installation.html`)

A second page, same code, different settings: `installation.html` runs the
installation study's **recommended two-camera layout** on the **research values** (1 m/s
animals, 1.5 s reactions; two 90° cameras in crossfire, one on the Hall 15 verge at x 400
facing north-east and one on the wildlife verge at x 550 facing south-west, the study's
98% option with 82% of the crossing corridor in view; one sign for each direction at the
edge of their combined coverage, driven by both cameras, flashing for any animal in
view, asking drivers to slow; 30% of drivers obey it, the rest slow by 7 km/h) with a **stream of cars in both directions** (a car every
20 s per direction, each with its own speed, following and queuing). Animals arrive
every 30 s at knob level 4 so there is something to watch, and the whole scene runs at
**2× speed** (`config.installation.timeScale`, sub-stepped) because a 1 m/s animal is
only a few screen pixels a second in real time; both sides get the same animals and the
same cars. The scoreboard footer adds cars through and their average
delay against free flow. `index.html` is unchanged: it keeps the presentation pacing
and the one-car-per-side scenario. The page is selected by `<body data-mode="installation">`,
which makes `js/main.js` apply `config.research` and `config.installation`.

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
encounter into one of four outcomes:

- **Serious hits:** the car and the animal touched while the car was doing more than
  30 km/h (`scenario.seriousKmh`).
- **Low-speed contacts:** any other touch, whoever moved into whom, even with the car
  standing still (a car stopped in an animal's path is in the wrong place). With the
  system on these are mostly animals walking into a car waiting at the line.
- **Near misses:** the car was going faster than 35 km/h when it got closest to the
  animal, but didn't touch it.
- **Safe passes:** the car was at 35 km/h or slower by then, and nothing touched.

Each animal is scored once per lap. If an animal already counted as a near miss or safe
pass touches the car later in the same lap, it moves to hits.

Below the four tiles: the average speed at the animal, (ON side) animals detected, and
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
   hotspot; drawn as an amber dashed line across the lane while the sign flashes). The
   car waits there until the sign has been off for 0.5 s (20 s at most), then drives on:
   at 20 km/h while the sign is still flashing, otherwise at 35 km/h (`tuning.clearKmh`)
   through the area, alert, and back to cruise past the end of the zone. A driver who
   sees the sign too late to stop at the line without braking harder than ≈6 m/s² goes
   through slowly instead.

At 50 km/h the driver **cannot** stop for an animal first seen in the lane at the far edge
of the headlights: reaction plus braking need about 22 m and the light reaches 21 m, so
the car arrives at the animal still doing about 20 km/h. This is the "outdriving your
headlights" problem the camera and signs exist to fix. A warned driver, already at
20 km/h or waiting at the stop line, needs only about 5 m.

**What this means for the demo.** Over 1,500 fast-forwarded 20-minute demos of today's
settings (the settings study's baseline, 244,000 crossings per side; counts per 100
animals that reached the road, hits split by the car's speed at contact):

| | Hits OFF → ON | …of which over 30 km/h | …under 5 km/h | Near misses | Safe passes | Avg speed at the animal |
|---|---|---|---|---|---|---|
| today's settings (camera 110°, range 250; headlights 150; signs at the camera; driver stops at the line) | 5.3 → 3.2 (−39%) | 4.3 → 0.95 (−78%) | 0.2 → 0.4 | 8.6 → 1.0 (−88%) | 1.9 → 21.5 | 41 → 10 km/h |
| same with the earlier 84° camera view (800 seeds) | 5.9 → 4.0 (−34%) | 4.8 → 1.6 (−66%) | 0.3 → 0.5 | 9.3 → 1.9 (−80%) | 2.0 → 19.0 | 41 → 14 km/h |

Without the system the driver outdrives the headlights: most contacts happen above
30 km/h. With it the car waits at the stop line and then creeps through the area, so the
contacts that remain are mostly animals walking into a slow or stopped car (most ON hits
are under 30 km/h). Serious hits fall by four fifths and near misses by seven eighths.
Hits are rare events, so compare many runs, not a few minutes of live demo.

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

## Further reading

- [docs/simulation-settings.html](docs/simulation-settings.html) (also in
  `research/reports/`): one page, in plain language, explaining how the simulation works
  and every setting behind it, demo values beside research values, with a drawing of
  the map.
- [research/reports/](research/reports/): the four study reports as standalone pages that
  open offline: [installation-study.html](research/reports/installation-study.html)
  (research parameters, two-way traffic, placement with area coverage: the
  recommendation), [two-way-traffic-study.html](research/reports/two-way-traffic-study.html)
  (first two-way pass at the demo's parameters),
  [settings-study.html](research/reports/settings-study.html) and
  [camera-placement-study.html](research/reports/camera-placement-study.html) (one-car
  studies at the demo's parameters).

- [docs/scenario.md](docs/scenario.md): the preset scenario act by act, the results card,
  how to change the script, presenter notes.
- [docs/simulation-model.md](docs/simulation-model.md): every rule and number behind the
  demo: how animals arrive, what they do at the roadside, what the driver sees, how the
  car decides to slow, stop and move on (in priority order), scoring, sources, tuning.
- [docs/sequence-diagrams.md](docs/sequence-diagrams.md): sequence diagrams (Mermaid,
  rendered on GitHub) of one frame of the demo, an animal becoming a warning, the
  driver reacting to an animal, one research run, and the installation demo's start.
- [docs/uml-diagrams.md](docs/uml-diagrams.md): UML (Mermaid): the modules and their
  dependencies, the data model (worlds, cars, animals, routes, signals), and the state
  machines of an animal, a car, a sign and the scenario.

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
The study ranks layouts by the share of **serious hits** (contact over 30 km/h) they
prevent, averaged over the four scenarios, with today's lens (110°, range 250) and today's
driver. Headline (second run, 3,788 runs): the best single camera stands on the Hall 15
verge next to the hotspot (x 550) and looks north across the road and up the wildlife
verge; it prevents about 77% of serious hits. Looking across the road beats looking along
it (60% from the same spot facing west). Two cameras prevent about 85% (add x 400 on the
wildlife verge facing south), three 87%, four 90%, so two is where the benefit levels
off. The lens matters most: with the old 84°/150 lens one camera prevents only about
36%. The demo keeps its centreline camera at x 590 facing west: in the demo loop
(eastbound traffic, three in four animals from the wildlife verge) it beats the verge
camera, which cannot see the Hall 15 side until an animal is on the road (settings study
below). This study's ranking, which averages both directions of travel, is the
deployment recommendation. Add `?quick` to the URL for a 15-second
smoke test.

### Settings study (`research/settings.html`)

`research/settings.html` asks a different question: under which settings does the system
work best, and which settings make the difference between OFF and ON clearest? It runs
the split-screen demo itself (both sides, same animals, laps started together, exactly
like `js/main.js`) for 20 simulated minutes per seed, 10 seeds per setting in the
browser (800 with the Node driver below), changing one factor at a time from today's
settings: camera range, field of view and placement; how
far the sign is visible; whether the warned driver stops at the line, and where; the
warned speed; the driver's headlight range, reaction time and cruise speed; animal
activity and boldness; and hotspot vs anywhere crossings. It then tries the best level of
each system-controlled factor together. Hits are split by the car's speed at contact
("serious" = over 30 km/h) and normalised per 100 crossings so busy and quiet settings
compare fairly. Results are saved in `research/results/settings-study.csv` / `.json`;
`?quick` gives a 30-second smoke run. `tuning.stopForSign` exists for this study (false =
the warned driver only slows to 20 km/h). `node research/run-settings-study.js` runs the
same study across all cores with 800 seeds per setting and 1,500 for the combined check
(19,800 runs, about 45 minutes on 22 cores); it gives the same numbers as the page, seed
for seed, and wrote the results that are checked in.

Findings (19,800 runs, today's driver): today's settings are the best system
configuration in the grid, cutting serious hits by 78% (interval 77–79%) and near misses
by 88%; the ON side has 0.95 serious hits per 100 crossings. No system setting beats it:
a sign visible from 640 is a tie (0.94), a 350 range or no stop line gives a similar cut
with a quicker warned lap (+2.3 s instead of +5.1 s) but more serious ON hits (0.99 /
1.10) and more low-speed contacts; the previous 84° view is clearly worse (1.62, cut
66%), as are 60° (2.59), range 150 (2.51), a sign visible from only 320 (2.13), the stop
line 80 units back (1.13) and both other camera positions. The placement study's best
camera (south verge, x 550, facing north) scores 70% here because it cannot see animals
coming from the Hall 15 side until they are on the road; at the demo's 75% north
arrivals the centreline camera wins. The combined check (best level per factor) picked
only the 640 sign distance: 79% against the baseline's 78% on the same 1,500 seeds, so
nothing to change. Busy traffic (a group every 6 s) shows the biggest contrast (87%) but
makes the warned car wait 13 s more per lap; crossings anywhere along the road cut the
effect to 21%, which is the case for deploying at a known hotspot. With research-mean
reaction times (1.1 / 0.7 s) the system still cuts serious hits by 72%, and with brighter
headlights (32 m) by 58%.

### Short-run reliability study (`research/demo-runs.html`)

Hits are rare, so a single demo-length run can show the ON side with *more* hits than
OFF. `research/demo-runs.html` runs the split-screen demo many times (200 seeds × 10 min
per setting, 2,600 runs, every run recorded in `research/results/demo-runs.csv`) and
scores each run two ways: by the real benefit (ON has no more serious hits and no more
near misses, and fewer of at least one) and by today's "Animals hit" tile. Run it in
Node across all cores with `node research/run-demo-runs.js` (~2 min) or in the browser
(`?quick` for a smoke run).

Findings (re-run after the driver was made to resume sooner and drive off briskly): on
serious hits + near misses the system is ahead in **100% of 10-minute runs** at today's
settings (88% after 2 min, 98% after 5), and near misses alone also 100%. On the hits
tile as it was ("Animals hit", all contacts together) only **74%** of runs showed ON
lower, 10% equal and **17% higher**, because the ON car stops at the line or creeps
through the hotspot and animals walk into it at under 5 km/h. That is why the scoreboard
now splits hits into serious (over 30 km/h) and low-speed contacts. No setting fixes the
combined tile (best 77% / 9%, at warned speed 30). Because both cars start laps
together, OFF rates shift between settings; compare shares and the ON column, not OFF
across settings.

For the study, `js/car.js` measures a camera's coverage from its whole view footprint
projected onto the road, so a verge camera that sees the crossing also covers it. It
also honours an optional `dir` on signals (`config.carDir`). The demo's signs have no
`dir`, and for its camera the footprint ends about 23 units later than before.

## Fixed parameters for the research runs (`config.research`)

The demo is paced for a two-minute presentation: animals move 5–8× faster than life,
a group arrives every 12 s and the driver reacts in 0.5 s. The research runs
(`research/traffic.js`) apply the literature values below on top of the demo config
(`config.research`, deep-merged by `TrafficStudy.baseline()`); the demo itself is
unchanged. 1 map unit ≈ 0.139 m, so 1 m/s ≈ 7.2 units/s. "Confidence" says how the value
was obtained: measured (a study reports it), estimated (derived from related
measurements) or guess (no data; chosen to be plausible).

| Parameter | Demo | Research | Confidence | Source |
|---|---|---|---|---|
| Macaque walking speed | 5.6 m/s | 1.0 m/s | measured (lab) | Higurashi et al. 2019, *J. Neurophysiol.*; Courtine et al. 2005 |
| Wild boar walking / dash | 8.3 m/s | 1.0 / 2.5 m/s (trot) | estimated | Wildlife Online (secondary); urban GPS studies |
| Pangolin walking speed | 3.1 m/s | 0.4 m/s | guess | NParks ("slow-moving"); no measured value |
| Night species mix | 40 / 45 / 15 % | boar 75, macaque 15, pangolin 10 % | estimated | Tay et al. 2024, *Ecosphere* (boar 68% of crossings); macaques diurnal (Brotcorne et al. 2014); pangolins ~3% but kept visible |
| Group size | 1+Poisson(1) ≤4 / (0.6) ≤4 / 1 | macaque 1+Poisson(4) ≤10; boar 1+Poisson(1.2) ≤8; pangolin 1 | measured (boar) / estimated | Koh, Webb & Leung 2018, *Raffles Bull. Zool.* (boar mean 2.2, 57% singles, max 8); Riley et al. 2015 (troops ~24) |
| Crossing rate at a night hotspot | a group every 12 s | ~0.3 groups/h (runs use one a minute and report per crossing) | estimated | Tay et al. 2024 (1,133 crossings in 9 months over a road section) |
| Side of arrival | 75% north | 50 / 50 | estimated | collared boar alternate sides within days (Koh et al. 2018); no study reports a one-sided bias |
| Cross / wait / retreat when a car is noticed | boar .50/.35/.15, macaque .25/.50/.25, pangolin .30/.60/.10 | boar .60/.25/.15, macaque .50/.30/.20, pangolin .50/.40/.10 | estimated / guess | Jacobson et al. 2016 response types; Brieger et al. 2022 (boar least affected by vehicles); Thurfjell et al. 2015 |
| Distance at which a car is a threat | 24 m | 42 m | estimated | boar flight distance 84–93 m from people (Wielgus et al. 2024); earlier with LED lights (Pakula et al.) |
| Cruise speed | 50 km/h | 50 km/h, cars 50 ± 4 | measured (law) | Singapore default limit 50 km/h (LTA); no NTU-specific limit found |
| Night traffic | — | a car every 45 s per direction (~80/h) | guess (proxy) | 2.4% of daily traffic at 22:00 (VanDelden et al. 2008) on a 5–10k AADT road |
| Reaction time, surprise | 0.5 s | 1.5 s | measured | Green 2000, *Transp. Human Factors*; SHRP2 naturalistic mean 1.51 s |
| Reaction time, warned by a sign | 0.35 s | 1.0 s | measured | Green 2000 (expected 0.7 s, common 1.25 s) |
| Comfortable braking | 3.3 m/s² | 3.4 m/s² | measured | AASHTO Green Book |
| Hard braking | 8 m/s² cap, 6.25 for a sign stop | 7 m/s² cap, 5 for a sign stop | measured (dry) | SAE 2023-01-0616 (ABS cars 8–10 m/s²); average driver below that |
| Brake build-up (jerk) | 2.5 / 6 / 12 m/s³ | 2 / 6 / 10 m/s³ | estimated | comfort ≤ 2 m/s³ (arXiv 2001.00135); emergency ramps 5–10 |
| Pull-away acceleration | 2.5 m/s² | 1.5 m/s² | measured (calibration) | IDM city set, Treiber & Kesting |
| Headlight seeing distance, dark animal | 21 m | 30 m unalerted, 45 m once warned | estimated | Olson & Sivak 1983 (46 m for dark clothing, alerted); Roper & Howard (unalerted ≈ half); Wood et al. 2005 |
| Car-following | 2 m, 1.5 s, 3.3 m/s² | 2 m, 1.0 s, 2.0 m/s² | measured (calibration) | Treiber, Hennecke & Helbing 2000; Treiber & Kesting city set |
| Drivers who follow the sign rule | 100% | 30%; the rest slow by 7 km/h | estimated | sign alone −3 to −8 km/h at night, −13 to −20% with the animal visible (Huijser et al. 2009, 2017; Gordon et al. 2004; Gagnon et al. 2019); share who stop not reported |
| Camera lens | 110° | 90° (a 7.5 mm thermal lens); 60° tested | measured (products) | thermal lenses: 7.5 mm ≈ 90°, 13 mm ≈ 45°, 19 mm ≈ 32° horizontal |
| Sign placement | two gantry signs at the camera | one sign per direction at the edge of the camera's coverage | design | so the sign is seen `signSightDistance` before the stop line |

Not modelled, and worth knowing: pangolins freeze mid-road (a Jacobson "pauser"); here a
pangolin only pauses at the roadside. Macaque night crossings are rare in reality and
would cluster at dusk and dawn. The hotspot's position and width are not measured.

### Two-way traffic study (`research/traffic.html`)

The studies above drive one car per direction, one lap at a time, so they count hits
but say nothing about traffic flow. `research/traffic.js` runs the same two maps with a
**stream of cars in both directions**: per direction a Poisson process (headway 2 s +
Exponential, 20 s on average; 40 and 10 s as settings), each car with its own cruise
speed, following the car ahead (Intelligent Driver Model, `tuning.follow`), queuing
behind a car waiting at the line. Besides serious hits, near misses and far-lane hits
(an animal hit in the second lane it entered), it measures what the system costs
drivers: delay per car against free flow, stops, time at the line, time waiting to
enter, queue length, and the share of sign-on time with no animal on the road. The
grid varies demand, the warned driver's stopping times (`signClearSec`, `signMaxWaitSec`,
`clearHoldSec`, the new `signHoldSec`), the sign rules (no stop line, sight distance,
warned speed, one sign per direction), and the usual robustness levels; a second stage
re-runs the camera placement grid two-way. Scores: serious ON hits per 100 crossings
first, mean delay per car second, driver-seconds per serious hit prevented as the
tie-break. `node research/run-traffic-study.js` (and `--stage placement`) runs it
across all cores; results in `research/results/traffic-study.*` and
`traffic-placement.*`.

Findings of the first pass (20,200 runs at the demo's parameters, kept in the git
history of `research/results/traffic-study.*`): with cars both ways the system cut
serious hits 83% for 8.6 s of delay per car, giving up at the line after 10 s kept the
safety and cut delay, and the placement ranking was asymmetric because 75% of animals
came from the north.

**Installation study (research parameters).** The second pass fixes every parameter at
the research values above (`config.research`) and varies only three things: the camera
placement, the driver's own policy on seeing an animal (never brakes / slows / stops for
anything on the road), and what the sign asks of the 30% who follow it (no stop; stop 5
or 10 s; wait until the sign is off, plus 0.5, 2 or 5 s), crossed with what makes the
sign flash (any animal in view, or only one on the road). 36 settings × 300 seeds × 10
simulated minutes, 12 sensitivities, and the placement stages for the 90° lens: every
single camera (121), the best first camera plus each second (124 pairs), the best pair
plus each third (119 triples), plus the single-camera grid for a 60° lens; 161,900
runs. Groups arrive once a minute so crossings are independent, and costs are reported
per crossing event. Placement layouts are scored on safety and on **area coverage**
(the share of the crossing corridor, hotspot ± 2 sd with both verges and the road, that
the cameras can see), ranked by safety with coverage breaking ties within 2 points.
Results in `research/results/traffic-policy.*`, `traffic-sens.*`, `traffic-placement-90/60.*`,
`traffic-pairs-90.*`, `traffic-triples-90.*`; `node research/run-traffic-study.js --stage
policy | sens | placement | pairs | triples [--lens 90] [--first auto] [--second auto]`.

Findings: the **sign trigger** is the decision that matters: flashing for any animal in
view cuts serious hits **90%** (26.24 → 2.53 per 100 crossings), flashing only once the
animal is on the road 82%. The **sign rule hardly matters** (2.49–2.54 per 100 across all
six rules, inside noise) because the benefit comes from every warned driver looking
further and reacting a second sooner, not from the minority who stop; full compliance
would give 2.3 for twice the delay, and 10% compliance 2.59. The **driver's own
policy**: slowing and stopping for animals are equal (2.53 vs 2.42); a driver who never
brakes leaves the system cutting 27%. Cost: about 3.9 driver-seconds of extra delay per
crossing event, 17 per serious hit prevented; at the real rate of 0.3 groups an hour that
is under a hundredth of a second per car. Lens: 110° 93%, 90° 90%, 60° 84%.
Per-direction signs at the coverage edge beat the demo's gantry signs (90% vs 88%).
**Placement** with balanced arrivals: one 90° camera tops out at 91% (x 400 · south verge · facing NE)
with today's centreline camera at 90% and 56% of the corridor in view; **two cameras in
crossfire**, one on each verge just outside the hotspot looking diagonally across the
road toward it (x 400 · south verge · facing NE + x 550 · north verge · facing SW), prevent **98%** and see 82% of the corridor
(99% of animals seen before they step out) for the same delay per crossing; the first
pass's pair on opposite verges facing straight across saw the verges (85%) but little
road and prevented 93%; a third camera reaches 99% and up to 93% of the corridor. With
the 60° lens only the centreline camera looking along the road works (84%).
Recommendation: two 90° cameras in crossfire, one sign per direction at the edge of their
combined coverage driven by both cameras, flashing for any animal in view, asking
drivers to slow; a stop line is optional. `installation.html` shows this layout.

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
