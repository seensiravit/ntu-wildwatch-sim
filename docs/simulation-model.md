# How the simulation works

A reference for every rule and number behind the demo: how animals arrive, what they do
at the roadside, what the driver can see, how the car decides to slow, stop and move on,
and how outcomes are scored. All values are in `js/config.js`; the logic files never
hard-code them. Section order follows the order the simulation runs each frame.

## 1. Units and map

- Map: 1000 × 700 logical units, scaled to the canvas. **1 unit ≈ 0.139 m.**
- Speeds are units/s; **× 0.5 = km/h** (so 100 units/s = 50 km/h). 1 m/s² ≈ 7.2 units/s².
- Road: centreline at y 380, 84 units wide (y 338–422). Lanes 42 wide; the eastbound car
  drives in the north lane at y 359, entering at x −40 and leaving at x 1040. A lap at
  50 km/h takes about 11 s; the car passes x 500 at about 5.4 s.
- Camera: x 590 on the centreline, facing west, 110° view, 250 range. Its coverage along
  the lane starts at x 340. Two signs flank the road at the camera.
- Stop line: 20 units before the coverage, x 320. Crossing hotspot: x 490 ± 60.

Each frame (60 Hz; a fixed 1/30 s in the research pages): the shared animals move, then
for each map in turn: detection, then the car. The two maps have separate copies
("twins") of every animal, so each animal reacts to its own side's car.

## 2. When and where animals arrive (`config.spawning`, `js/spawner.js`)

Animals arrive in **groups**, and groups arrive as a **Poisson process**: the gap between
groups is `minGapSec + Exp(meanGapSec − minGapSec)`. Exponential gaps are the standard
model for independent arrivals; the small minimum keeps two unrelated groups from
landing at once. Each group is one species, drawn by weight; its size is
`1 + Poisson(extraMean)`, capped at `maxGroup`. Everything is drawn from a seeded
generator, so a run can be replayed exactly.

| Parameter | Value | Meaning |
|---|---|---|
| `meanGapSec` | 12 s | average time between groups (the **Animal activity** knob sets it to 48 / level) |
| `minGapSec` | 3 s | no two groups closer than this |
| `maxConcurrent` | 12 | safety cap on animals on screen |
| `followerGapSec` | 0.8–1.8 s | gap between members of a group |
| `followerSpread` | 8 units | sideways scatter of followers |
| `hotspot` | x 490, sd 60 | crossing point along the road ~ Normal, clipped to `xMin`–`xMax` (20–980) |
| `northShare` | 0.75 | share of groups from the wildlife verge (north) |
| `northStart` / `southStart` | 100–140 / 50–80 units from the road edge | where a group starts |
| `headingSdDeg` | 8° | spread around straight across |
| `speedSd`, `speedMin`, `speedMax` | 0.12, 0.7, 1.3 | speed multiplier ~ Normal(1, sd), clipped |

Per species (`species[].spawn`):

| Species | Share of groups | Group size (avg, max) | Walk speed |
|---|---|---|---|
| Wild boar | 45% | 1 + Poisson(0.6) → 1.6, max 4 | 60 units/s |
| Macaque | 40% | 1 + Poisson(1.0) → 2.0, max 4 | 40 units/s |
| Pangolin | 15% | always 1 | 22 units/s |

Each group shares one `boldness` (0–1); each animal draws its own `noticeRoll` (0–1).
Both are set at spawn and copied to the twin, so the two maps get identical animals.

With the defaults that is about 5 groups and 8 animals a minute. Demo time is compressed;
the shares follow a Singapore road study in which wild boar were 68% of crossings.

## 3. What an animal does at the roadside (`config.crossing`, `species[].traffic`, `js/animals.js`)

An animal walks in a straight line through phases **approach → decide → cross | wait |
retreat**. It decides **once**, when it is `decisionDist` (25 units) from the road edge
and still heading toward the road.

**Is the car a threat?** (`carThreat`) Yes if the car is visible on the map and either
- approaching, with the animal's crossing point between the car's rear and
  `approachRadius` (170 units) ahead of it, or
- stopped (under `stoppedKmh` 1 km/h) within `stoppedRadius` (70 units) of the crossing
  point, ahead or behind.

**Decision tree**, in order:
1. No threat → **cross**.
2. `noticeRoll ≥ notice` → the animal never noticed the car → **cross**.
3. `boldness < cross` → **cross anyway** (boar dash at `crossSpeedMul` 1.6×).
4. `boldness < cross + wait` → **wait** at the roadside (shown as three pulsing dots).
   It crosses once the threat has been gone for `clearSec` (1 s); if it has waited
   `maxWaitSec` it **turns back** instead.
5. Otherwise → **turn back** (shown as ↩), counted as "turned back".

| Species (Jacobson type) | Notices a car | Cross / wait / turn back | Max wait | Still crosses, overall |
|---|---|---|---|---|
| Macaque (avoider) | 95% | 25 / 50 / 25% | 10 s | 29% |
| Wild boar (speeder) | 90% | 50 / 35 / 15%, dash ×1.6 | 6 s | 55% |
| Pangolin (pauser) | 75% | 30 / 60 / 10% | 12 s | 48% |

Once on the road an animal keeps walking and never reacts to the car. The probabilities
are assumptions shaped by the response types in Jacobson et al. (2016), not measurements.

## 4. Detection and signs (`js/detection.js`, warn zones in `js/car.js`)

- The camera detects any **walking** animal inside its cone (110°, 250 units). Detection
  is perfect inside the cone: no misses, no false alarms. Each detection is logged, sent
  to the DED dashboard, and counted.
- Both signs flash exactly while their camera is detecting (no hold time).
- A sign's **warning zone** on the car path runs from `signSightDistance` (480 units)
  before the sign to the end of the camera's coverage. Its **stop line** is
  `stopBeforeArea` (20 units) before the coverage starts.
- The OFF side has none of this: no camera, no signs, no zone.

## 5. What the driver can see (`perceive` in `js/car.js`, `tuning.headlight`)

The headlight beam is 40° wide and `range` = **150 units (≈ 21 m)**, about what an
unalerted driver sees of a dark animal under low beams. An animal is **noticed** once it is
- on the road (either lane) within 150 units ahead, or
- on the verge and inside the beam.

Once noticed it stays noticed until the car has passed it, even if it leaves the beam.
For each noticed animal the driver keeps two clocks: time since noticing, and time since
it entered the car's own lane. At 50 km/h the car needs about 22 m to react and stop,
slightly more than it can see: an animal first seen in the lane at the edge of the light
is hit. This is the "outdriving your headlights" problem the system addresses.

## 6. How the car decides, every frame (`plan` in `js/car.js`)

The driver forms a target speed and a braking rate from every rule that applies; the
**lowest target speed and the strongest braking win**. In priority order:

1. **Reaction time.** Nothing changes for `driverReactionSec` (0.5 s) after an animal is
   noticed, or `alertReactionSec` (0.35 s) if the driver is already warned by a sign.
   During the last `footMoveSec` (0.2 s) the foot moves to the brake and the car coasts
   at `coastDecel` (0.5 m/s²). (These are quick, attentive-driver values chosen so the
   demo car visibly stops; research means are 1.1–1.3 s.)
2. **Warned by a sign.** A driver who has seen a flashing sign (after the 0.5 s reaction)
   stays warned until the end of that sign's zone.
   - If the sign is flashing (or has been off for less than `signClearSec`, 0.5 s), the
     stop line is still ahead, stopping there needs no more than
     `signStopMaxDecel` (≈ 6 m/s²), and the car has waited less than `signMaxWaitSec`
     (20 s): **brake steadily to the stop line** (x 320) and wait.
   - Otherwise, if the sign is still flashing: go through at `warnKmh` (**20 km/h**).
   - Otherwise (sign off): go through at `clearKmh` (**35 km/h**), alert, and back to
     cruise past the end of the zone.
3. **Animal in the car's own lane** (registered `alertReactionSec` after it entered):
   **stop** `stopGap` (15 units) short of it. Braking is `stopFrontLoad` (1.3×) what is
   strictly needed, easing as the gap closes, exactly as needed below `finishSpeedUnits`
   (≈ 5.5 km/h), never above `maxDecel` (8 m/s² ≈ 0.8 g). If even that can't stop in
   time, the car hits the animal.
4. **Animal elsewhere on the road** (other lane, or in the lane but not yet registered):
   slow to the speed from which it could still stop if the animal steps across,
   `v = a·(−t + √(t² + 2d/a))` with `a` = `otherLaneStopDecel` (5 m/s²) and `t` =
   0.35 s, but never below `otherLaneMinKmh` (20 km/h); braking between
   `otherLaneDecel` (2.5 m/s²) and 5 m/s².
5. **Animal on the verge** within `vergeCautionDist` (40 units) of the kerb and lit by the
   headlights: ease off to `vergeCautionKmh` (40 km/h) at `vergeDecel` (1.25 m/s²).
6. **Otherwise** cruise at `cruiseKmh` (50 km/h).

Then the car applies the wanted acceleration with a **limited jerk** (`jerk`: braking
builds up at 2.5 / 6 / 12 m/s³ for gentle / firm / emergency braking, release is quick),
so speed curves are smooth. After stopping for an animal or at the line, it holds
`clearHoldSec` (0.3 s) once clear, then accelerates at `accelUnitsPerSec2` (2.5 m/s²,
0 → 50 km/h in about 6 s). Both cars start every lap together, `carRespawnDelaySec`
(1.5 s) after the slower one has left the map, so they meet the same animals.

## 7. Scoring (`detectEncounters` in `js/car.js`, `config.nearMiss`, `js/stats.js`)

- An **encounter** opens when a walking animal is in the car's lane within
  `dangerZoneLen` (150 units) ahead, and closes when it no longer is. The car's speed at
  its **closest approach** is the one scored.
- **Contact** at any speed = a **hit** (car body rectangle vs the animal at 0.8 × its
  radius). A hit above `scenario.seriousKmh` (30 km/h) is a **serious hit**; any other
  contact, including an animal walking into a stopped car, is a **low-speed contact**.
- No contact: **near miss** if the closest-approach speed was above `dangerSpeedKmh`
  (35 km/h), else **safe pass**.
- An encounter already scored as near miss or safe that ends in contact later in the
  lap is moved to hits. Each animal is scored once per lap.
- **Turned back** counts animals that gave up at the roadside because of the car.

The dashboard tiles, the DED dashboard table, the scenario results card and the three
research pages all read these counters.

## 8. Worked examples

**Unwarned car, 50 km/h, animal already in the lane at the edge of the light (150 units
ahead).** 0–0.5 s: no change (reaction). 0.5–0.9 s: braking builds to ~7 m/s². The car
reaches the animal still doing ~20 km/h: a low-speed hit. Had it been at 40 km/h it
would have stopped 15 units short.

**Warned car approaching a flashing sign.** The sign is visible from 480 units before
the stop line. After 0.5 s the driver brakes steadily at ≈ 3.3 m/s² from 50 km/h, stops
with the front on the line, waits until the sign has been off for 0.5 s, then pulls away
at 2.5 m/s²: 20 km/h within 2.3 s, 35 km/h through the area, cruise past the zone.

**Animal steps out 60 units ahead of a car doing 20 km/h.** 0.35 s reaction, then a
stop with room to spare: a safe pass.

## 9. Where the numbers come from

| Parameter | Basis |
|---|---|
| Poisson group arrivals, exponential gaps | standard road-crossing / collision models (Jaarsma et al.; arXiv 2507.17058) |
| Clustered arrivals, species shares | overdispersed roadkill counts; boar 68% of crossings on a Singapore forest-edge road (Ecosphere 2024) |
| Avoider / speeder / pauser types | Jacobson et al. 2016 (Ecosphere); the probabilities are assumptions |
| Waiting for a gap (`clearSec`) | deer gap-acceptance studies (30–60 s gaps on real roads; compressed here) |
| Headlight range 150 (21 m) | an unalerted driver sees a dark animal under low beams at about half the ~34 m an alerted one does (Hobday 2010; Roper & Howard) |
| Reaction times 0.5 / 0.35 s | demo values; research means 1.1–1.3 s unexpected, 0.7 s expected (Green 2000; SHRP2) |
| Braking build-up, 0.8 g limit, front-loaded stop | Markkula et al. 2016; NCHRP 15-75 |
| Sign deceleration 3.3 m/s² | AASHTO design value 3.4 m/s² |
| Verge / other-lane responses, jerk values | estimates |

Full links are in the README ("Animal arrivals and roadside behaviour", "Driver model").

## 10. Tuning guide

| Wish | Change | Effect seen in the studies |
|---|---|---|
| Busier road | `spawning.meanGapSec` (or the knob) | more events per minute; the warned car waits at the line more, laps slow down; the OFF/ON contrast on the hits tile gets worse (more low-speed contacts) |
| Braver animals | `species[].traffic.cross` up | more crossings in front of cars on both sides; contrast roughly unchanged |
| More cautious drivers | `driverReactionSec` down, `headlight.range` up | the OFF side gets safer and the contrast shrinks (headlights 230: serious-hit cut 54% instead of 81%) |
| Earlier warning | `signSightDistance` up, camera `range` / `fovDeg` | 110° view is the one clear win over the earlier 84° (serious ON hits 0.95 vs 1.62 per 100 crossings, 800 seeds); 640 sight is a tie with 480, range 350 trades a few more serious hits for a 3 s quicker warned lap |
| Less creeping | `clearKmh` up, `signClearSec` down | fewer low-speed contacts on the ON side |
| Different crossing place | `spawning.hotspot`, and the camera position | one camera covers one place: crossings anywhere drop its effect to ~23% |
