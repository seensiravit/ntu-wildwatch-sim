# UML diagrams: structure and states

Technical companion to [sequence-diagrams.md](sequence-diagrams.md) (behaviour over
time) and [simulation-model.md](simulation-model.md) (rules and numbers). This page
shows the **structure** (which modules exist, what they own, how they depend on each
other) and the **state machines** (what an animal, a car, a sign and the scenario can
be doing). The code is plain JavaScript with modules as objects on one global, `WW`;
the class notation below maps each module to a class and each shared data record to a
class, which is how the code is organised even though there is no `class` keyword.

All diagrams are Mermaid and render on GitHub.

## 1. Modules and their dependencies

Arrows point from the module that calls to the module it calls. `config` is read by
everyone and is left out of the arrows.

```mermaid
classDiagram
    direction LR
    class config {
        map, road, carPath, carPathWest
        cameras[], signals[], species[]
        spawning, crossing, nearMiss, tuning
        scenario, attract, traffic, research, installation, dashboard
        +applyResearch(cfg)
        +mergeConfig(dst, src)
    }
    class geometry {
        +degToRad(), dist()
        +conePolygon(), pointInCone()
        +pointInPolygon(), distToPolyline()
    }
    class spawner {
        +mulberry32(seed), gauss(), poisson(), exponential()
        +createStream(opts) animals
        +createCarStream(opts) cars
    }
    class animals {
        list (current world)
        +use(world), setWorlds(worlds)
        +spawn(props) twins, create(), clear()
        +update(dt)
        +onPointerDown/Move/Up() drag and release
    }
    class car {
        state (primary car), cars, current
        routes: east, west
        +use(world), reset(), startLap(car, opts), update(dt)
        +addCar(opts), removeCar(car), entryClear(dir, kmh)
        +posAt(s), projectS(x, y), projectOn(dir, x, y), posOn(dir, s)
        +coverage(cam), coverageOf(dir, cam), directionSigns(opts)
        +currentKmh(), kmhOf(car), inActiveWarnZone()
    }
    class detection {
        camState, sigState, logEntries
        +use(world), reset(), update()
        +isSignalActive(id), flashOn()
    }
    class stats {
        state (counters)
        +use(world), reset()
        +onDetection(), onTurnedBack()
        +onEncounter(kind, x, y, kmh), upgradeToHit()
        +avgKmh(), activeMarkers()
    }
    class render {
        +use(world), frame(ctx, W, H)
    }
    class dashboard {
        +build(), update(), buildDed()
    }
    class scenario {
        state: active, phase, act, results
        +start(worlds), stop(), update(dt)
    }
    class main {
        worlds: off, on
        +init(), loop(ts), resetAll()
        +syncLaps() demo
        +applyInstallation(), trafficRelease(), trafficRetire() installation
    }
    main --> animals
    main --> car
    main --> detection
    main --> stats
    main --> render
    main --> dashboard
    main --> scenario
    main --> spawner
    animals --> car : carThreat uses cars, projectOn, kmhOf
    animals --> stats : onTurnedBack
    animals --> geometry
    car --> detection : isSignalActive
    car --> animals : list
    car --> stats : onEncounter, upgradeToHit
    car --> geometry
    detection --> animals : list
    detection --> stats : onDetection
    detection --> geometry
    render --> car
    render --> detection
    render --> animals
    render --> stats
    dashboard --> stats
    dashboard --> detection
    scenario --> animals : spawn
    scenario --> car : state, startLap
    scenario --> stats : hooks onEncounter
```

The research scripts sit on top of the same modules:

```mermaid
classDiagram
    direction LR
    class TrafficStudy["research/traffic.js  (TrafficStudy)"] {
        S, SETTINGS, singleSpecs()
        +baseline() restore + applyResearch
        +runTwoWay(seed, minutes, setting)
        +evaluate(setting, seeds), summarise(setting, perSeed)
        +placementSettings(fov), pairSettings(fov, first), tripleSettings(fov, first, second)
        +sensitivitySettings(), pickCombined(), coverageOf(cameras), toCSV()
    }
    class SettingsStudy["research/settings.js  (SettingsStudy)"] {
        S, SETTINGS
        +runTwin(seed, minutes, opts), evaluate(), summarise(), run(ui), toCSV()
    }
    class CameraStudy["research/study.js  (CameraStudy)"] {
        S, facings
        +runOnce(layout, pattern, dir, seed), evaluate(), runStudy(ui)
    }
    class DemoRuns["research/demo-runs.js  (DemoRuns)"] {
        +runJob(job), run(ui)
    }
    class drivers["research/run-*.js  (Node, worker_threads)"] {
        +settingsFor(stage, lens, first, second)
        +runJobs(jobs), bestOf(grid), autoKey(file)
    }
    drivers --> TrafficStudy
    drivers --> SettingsStudy
    drivers --> DemoRuns
    DemoRuns --> SettingsStudy : runTwin
    TrafficStudy --> car
    TrafficStudy --> animals
    TrafficStudy --> detection
    TrafficStudy --> stats : hooks onEncounter
    TrafficStudy --> spawner : createStream, createCarStream
    SettingsStudy --> car
    SettingsStudy --> animals
    CameraStudy --> car : coverage, posAt, carDir
    class car
    class animals
    class detection
    class stats
    class spawner
```

## 2. The data model

What a world owns, and what each record holds. A `World` is a plain object that the
modules attach their per-world state to the first time `use(world)` is called.

```mermaid
classDiagram
    direction TB
    class World {
        id: "off" | "on"
        systemOn: boolean
        animals: Animal[]
        car: CarBundle  (the primary car)
        cars: CarBundle[]
        stats: Stats
        detection: DetectionState
        flow, recs, entry  (installation / research only)
    }
    class Animal {
        id, speciesId, label, radius
        x, y, dirDeg
        baseSpeed, speed
        state: "placed" | "walking"
        phase: "approach" | "cross" | "wait" | "retreat"
        boldness, noticeRoll, groupId
        waitSec, clearSec, lastRoadDist
    }
    class CarBundle {
        dir: "east" | "west"
        cruiseKmh, complies
        state: CarState
        scored: Map~animalId, outcome~
        pending: Map~animalId, Encounter~
        seen: Map~animalId, Noticed~
    }
    class CarState {
        x, y, headingDeg, s
        speedUnitsPerSec, accel, visible, braking
        holdSec, signTimer, signZoneEnd, warnedUntil
        signOffSec, lineWaitSec
        brakeSec, vBeforeBrake, queued
    }
    class Route {
        dir
        segs[], total
        warnZones: WarnZone[]
    }
    class WarnZone {
        signalId
        start, end  (path distance)
        stopS
    }
    class Stats {
        detections, hits, seriousHits
        nearMiss, safe, turnedBack
        speedSum, speedCount
        markers[]
    }
    class DetectionState {
        camState: cameraId → CamState
        sigState: signalId → SigState
        logEntries[]
    }
    class CamState {
        detecting, trigger
        animalsInCone[]
        episodes: Map~animalId, confidence~
    }
    class SigState {
        flashing, lastOnMs
    }
    class Camera {
        id, name, x, y
        facingAngleDeg, fovDeg, range
    }
    class Signal {
        id, name, x, y, message
        linkedCameraId, linkedCameraIds[]
        dir  (optional)
    }
    class Species {
        id, label, color, radius, speedUnitsPerSec
        spawn: weight, extraMean, maxGroup
        traffic: type, notice, cross, wait, maxWaitSec, crossSpeedMul
    }
    World "1" *-- "0..12" Animal
    World "1" *-- "1" CarBundle : car
    World "1" *-- "1..*" CarBundle : cars
    World "1" *-- "1" Stats
    World "1" *-- "1" DetectionState
    CarBundle "1" *-- "1" CarState
    CarBundle --> Route : drives
    Route "1" *-- "0..*" WarnZone
    WarnZone --> Signal
    DetectionState *-- CamState
    DetectionState *-- SigState
    CamState --> Camera
    SigState --> Signal
    Signal "1" --> "1..*" Camera : linked to
    Animal --> Species
    Animal "2" .. "1" Animal : twin in the other world, same id
```

Notes: a `Route` is shared by all worlds (built from config); each world's cars keep
their own position `s` along it. `cars[0]` is the primary car, the one `WW.car.state`
refers to; the demo only ever has that one.

## 3. State machines

### An animal

```mermaid
stateDiagram-v2
    [*] --> placed : dragged from the tray
    [*] --> walking_approach : spawned by the stream or the scenario
    placed --> walking_approach : click to release
    walking_approach --> walking_approach : walk toward the road
    walking_approach --> cross : decisionDist from the edge and no threat, or did not notice, or bold
    walking_approach --> wait : threat noticed, boldness < cross + wait
    walking_approach --> retreat : threat noticed, otherwise
    wait --> cross : no threat for clearSec
    wait --> retreat : waited maxWaitSec
    cross --> [*] : off the map
    retreat --> [*] : off the map
    note right of cross : once on the road the animal never reacts again
```

### A car (the driver)

Two things are true at once about a car: whether it is warned by a sign, and what it is
doing on the road. Mermaid draws them as two concurrent regions.

```mermaid
stateDiagram-v2
    [*] --> OffMap
    OffMap --> OnRoad : startLap(), in the demo both cars together, in a stream when entryClear
    OnRoad --> OffMap : s past the end of the route
    state OnRoad {
        [*] --> cruise
        cruise --> reacting : animal noticed, or sign seen
        reacting --> cruise : the animal is gone
        reacting --> slowing : reaction time over, animal on the road or verge, or sign flashing
        slowing --> stopping : animal in the lane, or a stop line ahead, or a stopped car ahead
        slowing --> cruise : clear, past the zone
        stopping --> stopped : speed below 0.5
        stopped --> holding : clear (animal gone, sign off, line reached)
        holding --> accelerating : clearHoldSec over
        accelerating --> cruise : back at the target speed
        accelerating --> slowing : something new ahead
        --
        [*] --> unwarned
        unwarned --> sign_seen : inside a zone whose sign is flashing
        sign_seen --> warned : driverReactionSec later
        warned --> unwarned : past the end of the zone
        note right of warned : alertReactionSec, alertRange, and the sign rule apply
    }
```

### A warning sign

```mermaid
stateDiagram-v2
    [*] --> off
    off --> flashing : a linked camera's trigger is on (animal in view, or on the road)
    flashing --> flashing : trigger still on
    flashing --> holding : trigger off and signHoldSec > 0
    flashing --> off : trigger off and signHoldSec = 0
    holding --> flashing : trigger on again
    holding --> off : signHoldSec elapsed
```

### The preset scenario (`index.html`, key S)

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> caption : start(worlds)
    caption --> act : captionPauseSec over (cars released, lap starts)
    act --> caption : all animals released, cars off the map, no animal left, more acts
    act --> done : same, last act (results card)
    caption --> idle : stop() (Esc, Reset)
    act --> idle : stop()
    done --> caption : S (replay)
    done --> idle : Esc, Reset
```

## 4. Pages and what they load

```mermaid
classDiagram
    direction LR
    class index_html["index.html  (presentation demo)"] {
        one car per side, demo pacing
        scenario, tray, DED tab
    }
    class installation_html["installation.html  (installation demo)"] {
        body data-mode = installation
        research values, two cameras, cars both ways, 2x speed
    }
    class research_pages["research/*.html"] {
        index (camera study), settings, demo-runs, traffic
        run the studies in the browser with few seeds
    }
    class reports["research/reports/*.html"] {
        standalone report pages with the results inlined
    }
    class js_modules["js/*.js"] {
        config, geometry, stats, animals, spawner, car, detection, render, dashboard, scenario, main
    }
    class vendored["wildwatch-dashboard.js"] {
        DED dashboard extension (teammate's file)
    }
    index_html --> js_modules
    index_html --> vendored
    installation_html --> js_modules
    installation_html --> vendored
    research_pages --> js_modules : all but render, dashboard, scenario, main
    reports ..> research_pages : generated from their results
```
