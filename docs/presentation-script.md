# Presentation script (≈ 2 min 30 s)

A spoken script for showcasing the demo: what the problem is, how WildWatch works, the
preset scenario, and what the numbers say. About 370 spoken words. Stage directions are
in *[brackets]*. Every number comes from the project (the scenario results card, the
short-run study in `research/demo-runs.html`, the camera study in `research/index.html`).

## 0:00 Open (15 s)

*[Demo on screen, both maps running live, scenario not started]*

> NTU WildWatch. Every year animals are killed on campus roads like Nanyang Crescent,
> where macaques, wild boar and pangolins cross from the green verge to Hall 15. Our
> project is an active monitoring and dynamic warning pipeline: a camera watches the
> crossing, and when it sees an animal, roadside signs flash before the driver gets
> there.

## 0:15 The problem (20 s)

*[Point at the left map, SYSTEM OFF]*

> The problem is simple physics. At night a driver at 50 km/h sees about 20 metres by
> headlight. That is not enough distance to stop. By the time the animal is in the beam,
> the driver has half a second to react and the car arrives still doing around 20 km/h.
> The driver is outdriving the headlights.

## 0:35 How it works (25 s)

*[Point at the right map, SYSTEM ON: the camera cone, the two signs]*

> On the right the same road has one thermal camera on the hotspot, looking across the
> road. It sees the animal on the verge, before it steps out. Each detection flashes two
> signs and an LED board, and a driver who sees a flashing sign stops at an amber line
> before the crossing. Everything you see here is simulated, including the detection,
> but the geometry, speeds and reaction times come from the literature.

## 1:00 Scenario (75 s)

*[Press **S**. The same animals appear on both maps. Speak each act's lines during its
caption pause and the first seconds of the lap.]*

**Act 1 · Out of the dark**

> A boar steps out as the car arrives. Left: the driver sees it only in the headlights
> and hits it at 50. Right: the camera already saw a macaque on the verge, the sign was
> flashing, and the car stopped at the line before the boar even moved.

**Act 2 · A troop crosses**

> Five macaques, one after another. Left: two near misses, then a low-speed hit on the
> third. Right: one warning covers the whole troop. The car waits, then goes.

**Act 3 · The one that doesn't notice**

> Pangolins have poor eyesight. This one never reacts to the car. Left: a near miss at
> 50. Right: the system doesn't need the animal to notice. It stopped anyway.

## 2:15 Results (15 s)

*[Results card is on screen]*

> Same animals, both roads. Without WildWatch: one serious hit, one low-speed contact,
> four near misses. With it: none. Across 200 ten-minute simulations the warned road had
> fewer serious hits and near misses in every single run, cutting serious hits by about
> four fifths. Our placement study says one camera on the Hall 15 verge prevents about
> three quarters of serious hits, and two cameras 85 percent.

## 2:30 Close (5 s)

> One camera, two signs, and the driver gets the warning the headlights can't give.
> Thank you.

## Delivery notes

- The scenario runs about 80 s on its own. If you are behind, use the shorter presenter
  lines in [scenario.md](scenario.md) and let the captions do the talking.
- Say "simulated" once, as written in the "How it works" section, so nobody takes the
  counts as field data.
- Where the numbers come from:
  - Headlight 20 m, reaction 0.5 s, "arrives still doing about 20 km/h": driver model,
    see [simulation-model.md](simulation-model.md).
  - Scenario card (1 serious hit, 1 low-speed contact, 4 near misses vs 0 / 0 / 0):
    [scenario.md](scenario.md).
  - "Every single run", "about four fifths": short-run study, 200 seeds × 10 min, system
    ahead in 100% of runs; serious hits 4.5 → 0.9 per 100 crossings
    (`research/results/demo-runs-summary.json`).
  - 77% for one camera, 85% for two: camera placement study
    (`research/results/study-run.json`).
- Strongest fallback line for questions: act 3, the system works even when the animal
  doesn't notice the car.
