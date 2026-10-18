# NTU WildWatch Demo — Spec (v1)

## 1. Context

This is a visual demo for a CC0006 group project at NTU: *How might NTU reduce wildlife roadkill on or around campus?*

The demo covers **Prong 1 only: Active Monitoring & Dynamic Warning Pipeline**.

- **Detect:** Roadside cameras (optical + thermal, edge AI) detect animals near high-risk road stretches.
- **Warn:** On detection, a warning sign 50–100 m upstream flashes (amber beacon + LED message board) so drivers slow down.
- **Log:** Each detection is recorded to a central dashboard (for NTU's Office of Estate and Development).

**Purpose of the demo:** show the *process* in a real-world-like scenario at a project showcase. Visitors should understand the flow in a few seconds by watching or playing with it. No real AI / computer vision is involved. Everything is simulated.

**Audience:** peers and instructors at a showcase booth, viewing on a laptop or TV screen.

## 2. Tech constraints

- Plain HTML + CSS + vanilla JavaScript, rendered with HTML5 Canvas.
- **No build step, no frameworks, no npm dependencies, no CDN.** It must run offline by double-clicking `index.html`.
- Use classic `<script>` tags, not ES modules. Chrome blocks module imports over `file://`.
- Draw all graphics with canvas shapes. Use no third-party or copyrighted sprites.
- Target a 1920×1080 display. The layout scales down cleanly to a 1366×768 laptop.

Suggested structure:

```
index.html
css/style.css
js/config.js      // map, cameras, signals, species, tuning constants
js/geometry.js    // path, cone, point-in-polygon helpers
js/animals.js     // animal entity, drag/rotate/release, movement
js/spawner.js     // (added) when/where animals arrive: Poisson groups around the hotspot
js/car.js         // car entity, path following, speed logic
js/detection.js   // camera ↔ animal detection, signal state
js/render.js      // map + night rendering
js/dashboard.js   // dashboard strip under each map: impact, camera feed, signs, log
js/main.js        // game loop, input wiring
README.md         // how to run + how to edit config
```

## 3. Screen layout

```
┌───────────────────────────────────────────────────────────────┬──────────────────────┐
│ Animal tray: [Macaque] [Wild boar] [Pangolin]   [Night mode] [Day mode – next version] [⏸] [Reset] │
├───────────────────────────────────────────────┬──────────────────────┤
│                                               │  CAM 1   [Detecting] │
│                 MAP (canvas)                  │  ┌ thermal feed ┐    │
│                                               │  └──────────────┘    │
│      night scene, L-shaped road,              │  CAM 2   [Idle]      │
│      2 cameras + cones, 2 signals, 1 car      │  ┌ thermal feed ┐    │
│                                               │  SIGNAL 1 [Flashing] │
│                                               │  SIGNAL 2 [Off]      │
│                                               │  DETECTION LOG       │
└───────────────────────────────────────────────┴──────────────────────┘
```

- Map is about 65–70% of the width; the dashboard fills the rest.
- Top bar holds the animal tray, a mode badge and the controls.

## 4. The map (generic v1)

All geometry is defined in `config.js` in logical map units (e.g. a 1000×700 map), scaled to the canvas. **Nothing is hard-coded in the rendering or logic files.** A later version will replace this map with a real NTU road by editing config only.

> **Superseded (current build):** the generic L-road below has been replaced by the real location: **Nanyang Crescent opposite Hall 15 (Tamarind area)**, a straight road with **one overhead camera** on the centreline looking west, and **two warning signs** flanking the road at the camera (one per verge), both driven by it. The car drives **eastbound** (left to right) toward the camera; drivers react to the flashing signs from a distance. Green verge and Sungei Choa Chu Kang canal to the north, Hall 15 blocks to the south. §4.1–4.3 describe the original generic map.

### 4.1 Road

- An **L-shaped two-lane road**: a horizontal segment from the left edge to a corner on the right, then a vertical segment from the corner up to the top edge.
- Show the lane markings as dashed centre lines.
- Draw a verge or grass everywhere off the road, with a few simple trees or bushes as decoration.
- Define the car's route as a **polyline path**: enter from the left edge → drive to the corner → turn → drive up → exit at the top edge.

### 4.2 Cameras (fixed in v1)

| id | Placement | Covers |
|----|-----------|--------|
| cam1 | Roadside, right of the corner | The corner area of the road |
| cam2 | Roadside, right of the upper vertical stretch | The upper part of the vertical road |

Each camera has: `id, name, x, y, facingAngleDeg, fovDeg, range, linkedSignalId`.

- The view cone is derived from the facing angle, FOV and range.
- The cone is always drawn as a faint translucent overlay so the audience can see coverage.
- When the camera is detecting, its cone tints amber.

### 4.3 Signals (fixed in v1)

Each signal has: `id, name, x, y, linkedCameraId, message`.

- signal1 sits beside the horizontal road, **upstream of cam1's zone** (before the corner, from the car's point of view).
- signal2 sits beside the vertical road, **upstream of cam2's zone**.
- Each signal is drawn as **both**:
  - an **amber beacon** (circle) that flashes on and off at about 2 Hz while active
  - an **LED message board** (small dark rectangle) that shows `WILDLIFE AHEAD – SLOW DOWN` in amber while active and is blank when off
- Each signal also defines a **warning zone** along the car path, from the signal to the end of its camera's coverage. The car uses this zone for slowing (see 6.2).
  *(Current build: the zone starts `tuning.signSightDistance` (320 units) **before** the sign — where drivers can first see it — so signs placed right at the camera still warn drivers before the crossing.)*

## 5. Animals

### 5.1 Species (config-driven)

| Species | Size | Walk speed | Notes |
|---------|------|-----------|-------|
| Macaque | small | medium | |
| Wild boar | large | fast | |
| Pangolin | small | slow | |

Each species has: `id, label, color, radius, speedUnitsPerSec, heatColor`.

- Draw each species as a simple, distinct shape and colour, with the label near it.
- Several animals can be on the map at once.

### 5.2 Interaction flow

1. **Drag from the tray** onto the map to create an animal in the **Placed** state. It is drawn semi-transparent, with a dashed outline.
2. **Set direction:** a Placed animal shows a **direction arrow** coming out of its body.
   - The user drags the arrow's tip to rotate it, with free 360°.
   - The default direction is straight down.
3. **Move:** dragging the animal's body moves it while it is still Placed.
4. **Release:** a **click** on the animal (a pointer-down/up with less than 5 px of movement) switches it to **Walking**.
   - It becomes fully opaque, the arrow is hidden, and it walks in a straight line at its species speed.
5. **Exit:** when a Walking animal leaves the map bounds, it is removed.
6. **Reset** clears all animals and restarts the car.

> **Changed:** a Walking animal now decides at the roadside whether to cross if a car is
> near: it crosses anyway, waits for a gap, or turns back, by species (avoider, speeder,
> pauser). Auto-demo animals arrive in groups as a Poisson process around the crossing
> hotspot (`js/spawner.js`). Each animal exists on both maps as twins that react to
> their own side's car. See the README, "Animal arrivals and roadside behaviour".

Only **Walking** animals can be detected. Placed animals are set-up only, so the presenter can arrange a scene without triggering signs.

Animals ignore the road and car when choosing their path; they just walk straight.

## 6. The car

### 6.1 Basics

- There is **one car** in v1.
- It follows the route polyline, oriented along the path, and drives on the correct lane.
- When it exits, it respawns at the start after about 1.5 s, looping forever.
- A **speed label** floats near the car (e.g. `50 km/h`). Use a config constant to map map units per second to displayed km/h.

### 6.2 Speed rules (checked every frame, in priority order)

1. **Brake for animal:**
   - Check a rectangle directly ahead of the car along its path, covering the lane width and the stopping distance.
   - If any Walking animal is inside it, decelerate to 0 and wait.
   - Once the rectangle is clear, accelerate back up.
   - Nothing graphic happens: no crash animation.
   - > **Changed:** the driver now has a reaction time (`tuning.driverReactionSec`,
     > shorter `alertReactionSec` while a sign is flashing) before braking for an
     > animal on the road ahead, so a fast, unwarned car can hit an animal that steps
     > out close in front. Any contact between car and animal counts as a hit, even
     > with the car stopped, and is marked "HIT" on the map, alongside near misses and
     > safe passes (see README). An animal in the other lane makes the
     > driver slow to 20 km/h; one in the car's own lane makes them stop.
2. **Warning slowdown:** if the car is inside the warning zone of an **active** signal, the target speed is **20 km/h**.
3. **Otherwise** the target speed is **50 km/h** (cruise).

Speed changes smoothly toward the target, with separate acceleration and deceleration constants. The label updates live.

## 7. Detection & signal logic

- On every frame, for each camera, find the Walking animals whose centre lies inside the camera's cone polygon.
- **Camera status:** `Detecting` when one or more animals are inside the cone, otherwise `Idle`.
- **Signal status:** the linked signal is `Flashing` **exactly while** its camera is Detecting, and `Off` as soon as no animal remains in the cone. There is no hold time.
- **Detection event:** raised when an animal *enters* a cone (it was not in that cone last frame).
  - Assign a confidence value of 85–97%, random but fixed for that animal-in-cone episode.
  - Append a log entry.
- **Animal outside every cone:** nothing happens. This is intentional.

## 8. Night mode (only mode in v1)

- Draw the whole map in a dark night palette: dark grass, dark grey road, dim markings.
- The **car's headlights** are a short, bright cone ahead of the car.
  - Inside the cone, animals are shown fully.
  - Outside it, animals stay visible to the audience but **dimmed** (about 40% brightness), to convey that the driver can't see them.
- Signal beacons and message boards glow clearly at night. This makes the point that the driver sees the warning before seeing the animal.
- The top bar shows a `Night mode` badge and a disabled `Day mode – next version` badge. There is no working day mode in v1, but keep the palette in config so day mode can be added later.

## 9. Dashboard (side panel)

> **Changed:** the page now shows the scene twice, side by side (System OFF | ON),
> and the dashboard is a strip under each map instead of a side panel. The camera
> card, signal cards and log below still apply to the ON side; on the OFF side they
> read "Not installed". See §12 and the README.

All values update live from the simulation state.

### 9.1 Camera cards (one per camera)

- **Header:** camera name and a status pill.
  - `Idle` is grey.
  - `Detecting` is amber, and the card border turns amber too.
- **Simulated thermal feed:** a small canvas of about 280×120.
  - The background is a dark purple/black thermal look with subtle noise.
  - For each animal in the cone, draw a heat blob (orange/yellow radial shape).
    - Horizontal position comes from the animal's angle within the FOV.
    - Blob size comes from its distance to the camera (closer means bigger).
  - Draw a green bounding box around each blob, labelled `Macaque 92%` (species + confidence).
  - When Idle, show the noise only, with a faint `No heat signature` caption.

### 9.2 Signal cards (one per signal)

- Signal name and a status pill: `Off` (grey) or `Flashing` (amber, blinking in sync with the map beacon).
- While active, show the message text.

### 9.3 Detection log

- The newest entry is at the top. Each entry shows `HH:MM:SS  Cam 1  Macaque  92%`, using the real clock.
- Keep the last 50 entries, and scroll inside the log card only.

## 10. Controls

- **Pause / Play:** freezes the simulation, including movement, flashing and feeds. Drag and drop still works while paused.
- **Reset:** removes all animals, clears the log, and restarts the car at the start of the route.

## 11. Acceptance scenarios

1. **Basic warning:** drop a macaque on the verge beside the road, aim it across the road and click it.
   - When it enters cam1's cone, Cam 1 shows `Detecting` and a thermal blob with a box.
   - Signal 1 flashes and shows the message, and a log entry appears.
   - When the car passes Signal 1, its label drops to about 20 km/h.
2. **Localised warning:** an animal in cam2's cone flashes **only Signal 2**. Signal 1 stays off.
   *(Not applicable to the current single-camera map; it applies again whenever a second camera/signal is configured.)*
3. **Sign turns off:** when the animal walks out of the cone, the signal turns off immediately and the camera goes back to `Idle`.
4. **Braking:** when a Walking animal is on the road just ahead of the car, the car stops, waits, and resumes once the road is clear. There is no collision.
5. **No coverage:** an animal walking where no cone reaches triggers nothing.
6. **Set-up mode:** a Placed (unreleased) animal sitting inside a cone does **not** trigger detection.
7. **Direction arrow:** dragging the arrow tip rotates the direction freely, and the released animal walks that way.
8. **Offline:** double-clicking `index.html` with no internet works in Chrome and Edge, with no console errors.

## 12. Out of scope for v1 (planned for later versions)

- Day mode and a day/night toggle
- ~~The real NTU road map, which replaces the config geometry only~~ — **landed**:
  Nanyang Crescent opposite Hall 15 (Tamarind area), one camera (see §4 note)
- ~~Before/after comparison ("without system" vs "with system")~~ — **landed early in
  v1.2** as a System ON/OFF toggle with near-miss tally, then replaced by a
  **split screen**: OFF and ON side by side, same animals, a scoreboard under each
  (see README)
- Multiple cars and two-way traffic, including signals for both directions
- Movable cameras and signals
- ~~Near-miss alerts~~ (landed in v1.2) and ~~hotspot heatmap on the dashboard~~ —
  **landed** via the team's DED dashboard extension (`wildwatch-dashboard.js`, the
  "DED Dashboard" tab): campus hotspot map, risk-scored log and charts
- Prong 2 (rope bridges, culvert ledges, funnel fencing) — still not simulated, but
  the DED dashboard now **recommends** Prong 2 measures per hotspot (decision
  support only)
- Any real detection model (YOLO etc.)

## 13. Deliverables

- A working app matching the structure above.
- A `README.md` covering:
  - how to run it (double-click `index.html`)
  - a 3-step demo script for presenters
  - how to edit `config.js` to move the road, cameras and signals
