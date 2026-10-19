# The preset scenario

A scripted, repeatable comparison of the road **without** and **with** WildWatch. The
same three crossings play on both maps at the same moment; the only difference is
whether the car has a camera and warning signs. It takes about 80 seconds and ends on a
results card.

## Running it

- Press **▶ Scenario** in the header, or the **S** key.
- The auto-demo and random arrivals stop while it plays. Dragging animals from the tray
  still works but isn't needed.
- At the end the simulation freezes on the results card. **S** replays from act 1;
  **Esc** or **Reset** returns to the live demo.
- Pressing **S** while a scenario is already running restarts it from act 1.

## How an act plays

1. **Caption.** The act's title and caption appear in the hint pill and as an amber
   banner across the top of both maps. Both cars wait off-map ("cars waiting…" on the
   banner) for `captionPauseSec` (2.5 s). Animals whose `atSec` is negative are released
   during this pause, that many seconds before the cars start.
2. **Lap.** When the caption ends, both cars enter the map together at 50 km/h. Animals
   with `atSec ≥ 0` are released that many seconds after the lap starts.
3. **End of act.** The act ends once every scripted animal has been released, both cars
   have left the map, and no scripted animal is left on either map. The next act's
   caption begins.

Every animal is created as a pair of **twins**, one per map, with the same start point,
heading, speed, `boldness` and `noticeRoll`. So both sides see identical animals; they can
only diverge because each side's animal reacts to its own car (an animal may wait for a
stopped car on one side and cross freely on the other).

## The three acts

Positions are map units (1 unit ≈ 0.14 m). The road runs along y 338–422; the eastbound
car drives at y 359. The camera at x 590 looks west over the hotspot; its coverage starts
at x 340, and the warned driver's **stop line** is at x 320. The OFF car passes x 500 about
5.4 s into a lap.

### Act 1 · Out of the dark

| Animal | Release | Start | Why |
|---|---|---|---|
| Macaque (decoy) | 1.5 s before the lap | (440, 290), heading south | Already on the verge inside the camera's view, so the signs are flashing as the warned car approaches. The OFF driver can't see it (it's on the verge, outside the headlights) and it has crossed before the OFF car arrives. |
| Wild boar | 4.5 s into the lap | (500, 290), heading south | Bold (`boldness` 0.05): it crosses in front of the car. Released so it steps into the lane just as the OFF car reaches it. |

- **OFF:** the driver first sees the boar when it is already in the lane inside the 21 m of
  headlight; 0.5 s of reaction plus braking is not enough. **Hit at ~50 km/h.**
- **ON:** the sign has been flashing since before the lap started; the driver registers it,
  brakes steadily and **stops at the line at x 320**, waits for the sign to clear, then
  drives through.
- Lesson: at night the driver outdrives the headlights; only the camera sees the verge.

### Act 2 · A troop crosses

| Animal | Release | Start |
|---|---|---|
| Macaque (decoy) | 1.5 s before the lap | (430, 290), heading south |
| Macaques ×4, one group | 1.7, 2.7, 3.7, 4.7 s into the lap | (470, 300), (486, 302), (502, 300), (518, 303), heading south |

All bold (`boldness` 0.05) so they cross rather than wait.

- **OFF:** the car meets them one after another: **near misses at 50 and 35 km/h, then a
  low-speed hit (~21 km/h)** on the third, and a safe pass on the fourth once it has
  stopped.
- **ON:** the car **waits at the line** until the whole troop has crossed and the sign has
  been off for half a second, then goes through at 20–35 km/h. No encounters.
- Lesson: one warning covers a whole group; the unwarned driver has to react to each
  animal separately at speed.

### Act 3 · The one that doesn't notice

| Animal | Release | Start | Why |
|---|---|---|---|
| Pangolin | 3.0 s before the lap | (540, 480), heading north | `noticeRoll` 1: it never notices the car. Slow (22 units/s), so it is released during the caption to be on the road as the OFF car arrives. |

- **OFF:** the pangolin is in the far lane when the driver sees it; the car passes it at
  **50 km/h, a near miss** (it is a few units short of the car's lane).
- **ON:** the camera saw it on the Hall 15 verge; the car **stops at the line**.
- Lesson: some animals never react to traffic (pangolins have poor eyesight); the
  system doesn't rely on the animal.

## The results card

| Row | Meaning |
|---|---|
| Serious hits | contact while the car was faster than `scenario.seriousKmh` (30 km/h) |
| Low-speed contacts | any other contact, including an animal walking into a stopped car |
| Near misses | car faster than 35 km/h at its closest approach, no contact |
| Safe passes | car at 35 km/h or slower by then, no contact |
| Average speed at the animal | mean car speed over the side's encounters |

The verdict line reads the numbers out, e.g. *"Without WildWatch: 1 serious hit (at
50 km/h) and 4 near misses. With it: 0 serious hits and 0 near misses. The same animals
crossed both roads."*

With the current script the card shows **OFF: 1 serious hit, 1 low-speed contact, 4 near
misses, 1 safe pass, ~35 km/h; ON: 0 / 0 / 0 / 0**. The scenario is deterministic: the same
numbers every time.

## Changing the script

Everything lives in `js/config.js` → `scenario`:

```js
scenario: {
  captionPauseSec: 2.5,   // pause between acts
  seriousKmh: 30,         // "serious hit" threshold (shared with the scoreboard)
  acts: [
    { title, caption, animals: [
        { atSec, speciesId, x, y, dirDeg, boldness, noticeRoll, groupId? }, …
    ] }, …
  ],
}
```

- `atSec` < 0 releases the animal during the caption (before the cars start); animals in
  an act must be listed in release order.
- `boldness` 0–1 (low = bold): compared with the species' `cross` / `wait` chances.
  `noticeRoll` 0–1: ≥ the species' `notice` means it never notices the car.
- Timing rule of thumb: the OFF car reaches x at about `(x + 40) / 100` s into the lap.
  An animal must be *in the car's lane* when the OFF car arrives; one that reaches the
  lane after the car has passed produces no encounter at all.
- For the ON car to stop at the line, the sign must already be flashing when the car is
  ~480 units before the stop line (x ≈ −160, i.e. before it enters). That is what the
  decoy animals are for: without one, the ON car sees the sign too late and goes through
  slowly instead.

A headless harness for trying a script (`scenario_test.js` and `act_try.js` in the
session scratchpad) runs the real modules in Node and prints every encounter.

## Presenter notes

- **Act 1:** "On the left the driver only has headlights. Watch the verge on the right: the
  camera already sees the macaque, the signs are flashing, and the car stops at the
  amber line before the boar even moves."
- **Act 2:** "Five animals, one warning. The left car has to react to each one at speed."
- **Act 3:** "This pangolin never notices the car. The system doesn't need it to."
- **Card:** point at the serious-hits row, then the near-miss row.
