# Sequence diagrams: how the simulation runs

Technical companion to [simulation-model.md](simulation-model.md). Each diagram shows
who calls whom, in order, with the real module and function names from `js/` and
`research/`. The diagrams are Mermaid and render on GitHub; in another viewer, read the
numbered notes under each one.

Participants: **main** (`js/main.js`, the page loop), **spawner** (`js/spawner.js`),
**animals** (`js/animals.js`), **detection** (`js/detection.js`), **car** (`js/car.js`),
**stats** (`js/stats.js`), **render** (`js/render.js`), **dashboard** (`js/dashboard.js`),
**DED** (the vendored `wildwatch-dashboard.js`), **traffic** (`research/traffic.js`).

## 1. One frame of the demo (`index.html`)

Sixty times a second, `main.js loop()` advances the shared animals, then runs detection
and the car for each world (OFF, then ON), then syncs the laps, then draws.

```mermaid
sequenceDiagram
    autonumber
    participant main as main.js loop()
    participant spawner as spawner (arrival stream)
    participant animals as animals.js
    participant detection as detection.js
    participant car as car.js
    participant stats as stats.js
    participant render as render.js
    participant dashboard as dashboard.js

    main->>spawner: due(attractSec)
    spawner-->>main: arrival events (species, x, y, heading, boldness, noticeRoll)
    main->>animals: spawn(event) for each event
    Note over animals: one animal object per world: twins with the same values
    loop for each world: OFF, then ON
        main->>main: useWorld(w)  (selects the world's animals, stats, car, detection)
        main->>animals: update(dt)
        animals->>car: carThreat(a): cars, projectOn(dir, x, y), kmhOf(car)
        car-->>animals: is a car a threat to this animal?
        animals->>stats: onTurnedBack() when an animal gives up
        main->>detection: update()
        detection->>stats: onDetection() on a new episode (once per animal)
        detection-->>detection: sign flashing = OR of its cameras' triggers (+ hold)
        main->>car: update(dt)
        car->>detection: isSignalActive(signalId)  (watchSigns, plan)
        car->>animals: list  (perceive, detectEncounters)
        car->>stats: onEncounter(kind, x, y, kmh) / upgradeToHit(...)
    end
    main->>car: syncLaps(): startLap() on both worlds when both cars are off the map
    loop for each world
        main->>render: frame(ctx, W, H)
        render->>car: cars, routeOf(dir), posOn(dir, s), kmhOf(car)
        render->>detection: camState, isSignalActive, flashOn
    end
    main->>dashboard: update()
    dashboard->>stats: state (tiles, DED card)
    dashboard->>detection: camState, logEntries, isSignalActive
```

Notes: (2) the spawner draws from a seeded generator, so a run can be replayed. (4) the
same animal exists once per world; each twin reacts to its own world's cars. (6–7) the
roadside decision (`decide` in `animals.js`) looks at every car in the world through
`WW.car.cars`. (9) `detection.update()` only runs the cameras when `WW.system.enabled`
is true, so the OFF world never flashes a sign. (12–14) `car.update()` runs `watchSigns`,
`perceive`, `plan`, the jerk-limited braking, then `detectEncounters`, which reports to
`stats`. (16) in the demo both cars start every lap together.

## 2. From an animal on the verge to a warned driver (ON world)

```mermaid
sequenceDiagram
    autonumber
    participant animal as animal (twin in the ON world)
    participant detection as detection.js
    participant DED as DED dashboard (WildWatch.record)
    participant sign as signal state
    participant car as car.js (the driver)
    participant stats as stats.js

    animal->>detection: walks into a camera's cone (pointInCone)
    detection->>detection: new episode: confidence drawn once, addLog(cam, a)
    detection->>stats: onDetection()
    detection->>DED: record({species, location, camera, confidence})
    detection->>sign: flashing = true (trigger "view": any animal in view, "road": only on the carriageway)
    car->>sign: activeZone(): is the car inside a zone whose sign is flashing?
    sign-->>car: yes: signTimer starts
    Note over car: after driverReactionSec the driver is "warned" until the end of the zone
    car->>car: plan(): warned branch
    alt driver follows the sign rule (car.complies)
        car->>car: signRule "clear": brake steadily to the stop line, wait until the sign has been off for signClearSec (give up after signMaxWaitSec)
        car->>car: signRule "fixed": stop signFixedWaitSec, then go
        car->>car: signRule "slow": no stop, warnKmh through the area
    else driver does not follow it
        car->>car: slow by signOnlySlowKmh while the sign flashes
    end
    Note over car: every warned driver also reacts in alertReactionSec and sees headlight.alertRange
    animal->>detection: leaves the cone
    detection->>sign: flashing = false (after signHoldSec, if any)
    car->>car: sign off for signClearSec: drive on at clearKmh, cruise past the zone
```

Notes: (3–4) counted and reported once even if several cameras see the animal. (6) a
zone runs from `signSightDistance` before the sign to the end of the cameras' coverage
of that lane; its stop line is `stopBeforeArea` before the coverage. (10–13) the
`signRule`, `signClearSec`, `signFixedWaitSec`, `signMaxWaitSec`, `signCompliance` and
`signOnlySlowKmh` settings are all in `config.tuning`.

## 3. The driver and an animal in the headlights (either world)

```mermaid
sequenceDiagram
    autonumber
    participant animal as animal
    participant car as car.js perceive()
    participant plan as car.js plan()
    participant move as car.js updateCar()
    participant stats as stats.js

    car->>animal: inside headlight range (on the road) or inside the beam (on the verge)?
    animal-->>car: noticed: seen.set(id, {sec: 0, laneSec})
    Note over car: stays noticed until the car has passed it
    car->>plan: noticed list with ahead, where (lane / road / verge), clocks
    plan->>plan: reaction: nothing until driverReactionSec (alertReactionSec if warned), coast in the last footMoveSec
    alt animal in the car's own lane (laneSec ≥ alertReactionSec)
        plan->>plan: stop stopGap short of it (front-loaded braking, ≤ maxDecel)
    else animal elsewhere on the road
        plan->>plan: slowFor(): a speed it could still stop from, ≥ otherLaneMinKmh (policy "stop": stop instead)
    else animal on the verge within vergeCautionDist and lit
        plan->>plan: ease to vergeCautionKmh
    end
    plan->>plan: car-following (IDM) against the leader, if any
    plan-->>move: {targetV, decel, coast, stopping, atLine, queued}: lowest speed and strongest braking win
    move->>move: applyJerk(aCmd): braking builds at a limited rate, brake lights
    move->>stats: detectEncounters(): hit (serious > 30 km/h) / near miss (> 35 km/h at closest) / safe pass, once per animal per lap
    move->>move: integrate speed and position, off the map → visible = false
```

Notes: (1) `seePolicy "nothing"` skips perceive entirely (research baseline). (6) if even
the hardest braking cannot stop in time, `touches()` scores a hit at the contact speed.
(11) the IDM follower uses the car's own cruise speed for its free-road term and notices
the leader's brake lights after `follow.reactionSec`.

## 4. One research run: two worlds, cars both ways (`research/traffic.js runTwoWay`)

```mermaid
sequenceDiagram
    autonumber
    participant driver as run-traffic-study.js (worker)
    participant traffic as traffic.js runTwoWay()
    participant cfg as config (baseline + setting)
    participant streams as spawner streams (animals, cars east, cars west)
    participant world as world OFF / world ON
    participant car as car.js
    participant sum as traffic.js summarise()

    driver->>cfg: restore() demo config, applyResearch(), setting.apply()
    driver->>traffic: runTwoWay(seed, minutes, setting)
    traffic->>world: reset car / detection / stats, park the primary car
    traffic->>car: directionSigns({onePerDirection}) → config.signals, reset()
    traffic->>streams: createStream(seed) for animals, createCarStream(seed') per direction
    loop every 1/60 s until the end
        traffic->>streams: due(t)
        streams-->>traffic: animal groups (spawned as twins) and car releases (same cars for both worlds)
        loop for each world
            traffic->>car: admit waiting cars when entryClear(dir, cruise): addCar(), startLap(car)
            traffic->>world: animals.update, detection.update, car.update (all cars)
            traffic->>traffic: per car: stops, stopped time, time at the line, retire cars that left: delay = trip time − free-flow time
            traffic->>traffic: per world: queue length, sign-on with no animal on the road, crossings, early detections, far-lane hits
        end
    end
    traffic-->>driver: snapshot(OFF), snapshot(ON)
    driver->>sum: summarise(setting, rows of all seeds)
    sum-->>driver: per 100 crossings, cut with bootstrap interval, delay per crossing, coverage, early share
```

Notes: (1) every seed starts from the same config: demo values, research values laid
over, then the setting. (5) the animal stream is seeded by the run seed; the car stream
by a derived seed; both worlds receive the same arrivals so they differ only by the
system. (8) a released car that cannot enter waits off-map and the wait counts as
delay. (12) a hit's speed and lane are captured by the `stats.onEncounter` hook that
`traffic.js` installs at load. The main process runs seeds in 5-seed chunks across
worker threads and summarises with the same `summarise()` the browser page uses, so
both give identical numbers.

## 5. Starting the installation demo (`installation.html`)

```mermaid
sequenceDiagram
    autonumber
    participant page as installation.html (body data-mode)
    participant main as main.js init()
    participant cfg as config
    participant car as car.js
    participant dashboard as dashboard.js
    participant frame as main.js loop()

    page->>main: DOMContentLoaded
    main->>cfg: applyInstallation(): WW.applyResearch(), merge config.installation (cameras, pacing, sign rule)
    main->>car: reset() to build the routes, then directionSigns({onePerDirection}) → config.signals
    main->>dashboard: build(): tiles, one feed per camera, one pill per sign
    main->>main: resetAll(): park the primary cars, create car streams, warm up warmupSec of car-only traffic, zero the flow counters
    loop every frame, fast-forwarded by installation.timeScale and sub-stepped
        frame->>frame: trafficRelease(h): release twin cars, admit when entryClear
        frame->>car: update(h) for every car in each world
        frame->>frame: trafficRetire(): cars off the map → delay, cars through
    end
    frame->>dashboard: update(): tiles plus "cars through, avg delay" from WW.flow
```

Notes: (2) the demo page never calls `applyResearch`, so `index.html` keeps its own
pacing. (3) the signs must exist before the dashboard builds its pills. (5) the warm-up
makes the road carry traffic from the first second, including after Reset.
