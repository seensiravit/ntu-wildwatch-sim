/* traffic.js — two-way traffic flow study.
 *
 * Runs the split-screen simulation (OFF and ON worlds sharing the same animals)
 * with a STREAM of cars in BOTH directions: per direction, headways are
 * 2 s + Exponential(mean − 2 s) (a Poisson process) and each car has its own
 * cruise speed; cars follow each other (js/car.js, tuning.follow) so queues form
 * behind a car waiting at the stop line. Measures safety as the earlier studies
 * do (serious hits, near misses, per 100 crossings) AND flow per car (delay,
 * stops, time at the line, queue length), to find the setting that cuts serious
 * hits for the least delay if the system were installed.
 *
 * Classic script (file:// safe). Browser: research/traffic.html (small seed
 * counts); Node: research/run-traffic-study.js (all cores, many seeds), which
 * calls runTwoWay / summarise from here so both give the same numbers. */
(function () {
  const WW = window.WW;
  const CFG = WW.config;
  const QUICK = /[?&]quick\b/.test((window.location && window.location.search) || "");

  const S = {
    dt: 1 / 60,
    minutes: QUICK ? 5 : 20,
    seeds: QUICK ? [101, 102] : range(101, 110),
    combinedSeeds: QUICK ? [101, 102] : range(101, 120),
    seriousKmh: (CFG.scenario && CFG.scenario.seriousKmh) || 30,
    headwayMeanSec: CFG.traffic.headwayMeanSec,
    // Placement stage (study 4): the placement study's grid, two-way, today's lens.
    xs: [250, 400, 550, 700, 850],
    laterals: [
      { id: "centre", label: "centreline gantry", y: 380 },
      { id: "north", label: "north verge", y: 330 },
      { id: "south", label: "south verge", y: 430 },
    ],
    facings: [
      { id: "E", deg: 0 }, { id: "SE", deg: 45 }, { id: "S", deg: 90 }, { id: "SW", deg: 135 },
      { id: "W", deg: 180 }, { id: "NW", deg: 225 }, { id: "N", deg: 270 }, { id: "NE", deg: 315 },
    ],
  };
  function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }

  // ---- Settings grid ---------------------------------------------------------
  // Each setting mutates fresh copies of the config (restore() runs first) and may
  // set run options: headwayMeanSec, perDirSigns (one sign per camera per
  // direction at the coverage start, instead of the demo's two signs), xDist.
  const cam = (x, y, deg) => (c) => { Object.assign(c.cameras[0], { x: x, y: y, facingAngleDeg: deg }); };
  const SETTINGS = [
    { id: "base", factor: "baseline", label: "today's settings, a car every 20 s per direction", apply: () => {} },
    // Demand
    { id: "hw40", factor: "traffic demand", label: "a car every 40 s per direction (quiet)", apply: () => {}, headwayMeanSec: 40 },
    { id: "hw10", factor: "traffic demand", label: "a car every 10 s per direction (busy)", apply: () => {}, headwayMeanSec: 10 },
    // Stopping time
    { id: "clear2", factor: "resume after sign clears", system: true, label: "drive on 2 s after the sign clears", apply: (c) => { c.tuning.signClearSec = 2; } },
    { id: "clear5", factor: "resume after sign clears", system: true, label: "drive on 5 s after the sign clears", apply: (c) => { c.tuning.signClearSec = 5; } },
    { id: "wait10", factor: "max wait at the line", system: true, label: "give up waiting after 10 s", apply: (c) => { c.tuning.signMaxWaitSec = 10; } },
    { id: "waitInf", factor: "max wait at the line", system: true, label: "never give up waiting", apply: (c) => { c.tuning.signMaxWaitSec = Infinity; } },
    { id: "hold1", factor: "hold after the lane clears", system: true, label: "hold 1 s after the animal clears", apply: (c) => { c.tuning.clearHoldSec = 1; } },
    { id: "signHold2", factor: "sign hold", system: true, label: "sign stays on 2 s after the last detection", apply: (c) => { c.tuning.signHoldSec = 2; } },
    { id: "signHold5", factor: "sign hold", system: true, label: "sign stays on 5 s after the last detection", apply: (c) => { c.tuning.signHoldSec = 5; } },
    // Sign and driver rule
    { id: "nostop", factor: "warned driver", system: true, label: "slow to 20 km/h only (no stop line)", apply: (c) => { c.tuning.stopForSign = false; } },
    { id: "sight320", factor: "sign visible from", system: true, label: "sign visible from 320", apply: (c) => { c.tuning.signSightDistance = 320; } },
    { id: "sight640", factor: "sign visible from", system: true, label: "sign visible from 640", apply: (c) => { c.tuning.signSightDistance = 640; } },
    { id: "warn30", factor: "warned speed", system: true, label: "warned speed 30 km/h", apply: (c) => { c.tuning.warnKmh = 30; } },
    { id: "dirSigns", factor: "signs", system: true, label: "one sign per direction at the camera's coverage edge", apply: () => {}, perDirSigns: true },
    // Robustness (not system-controlled)
    { id: "react11", factor: "reaction time", label: "reaction 1.1 / 0.7 s (research means)", apply: (c) => { c.tuning.driverReactionSec = 1.1; c.tuning.alertReactionSec = 0.7; } },
    { id: "light230", factor: "driver's headlights", label: "headlights 230 (sees 32 m)", apply: (c) => { c.tuning.headlight.range = 230; } },
    { id: "cruise40", factor: "cruise speed", label: "cruise 40 km/h", apply: (c) => { c.tuning.cruiseKmh = 40; c.traffic.cruiseMinKmh = 30; c.traffic.cruiseMaxKmh = 50; } },
    { id: "cruise60", factor: "cruise speed", label: "cruise 60 km/h", apply: (c) => { c.tuning.cruiseKmh = 60; c.traffic.cruiseMinKmh = 50; c.traffic.cruiseMaxKmh = 70; } },
    { id: "uniform", factor: "crossing pattern", label: "crossings anywhere along the road", apply: () => {}, xDist: (rnd) => 60 + rnd() * 880 },
  ];
  // Stage 4: every single-camera placement, with per-direction signs, plus the
  // opposite-verge pair. `today` is the demo camera with per-direction signs so
  // the grid has a like-for-like reference.
  function placementSettings() {
    const out = [{ id: "p-today", factor: "placement", system: true, label: "today's camera (x 590 centreline facing W)", apply: () => {}, perDirSigns: true }];
    S.xs.forEach((x) => S.laterals.forEach((lat) => S.facings.forEach((f) => {
      out.push({ id: "p-" + x + "-" + lat.id + "-" + f.id, factor: "placement", system: true,
        label: "x " + x + " · " + lat.label + " · facing " + f.id, apply: cam(x, lat.y, f.deg), perDirSigns: true,
        x: x, lat: lat.id, face: f.id });
    })));
    out.push({ id: "p-pair", factor: "placement", system: true, label: "pair at x 490: north verge facing S + south verge facing N", perDirSigns: true,
      apply: (c) => {
        Object.assign(c.cameras[0], { x: 490, y: 330, facingAngleDeg: 90 });
        c.cameras.push(Object.assign({}, c.cameras[0], { id: "cam2", name: "Cam 2", x: 490, y: 430, facingAngleDeg: 270 }));
      } });
    return out;
  }

  // ---- Config snapshot / restore -----------------------------------------------
  const KEYS = ["cameras", "signals", "tuning", "species", "spawning", "crossing", "traffic"];
  const BASE = JSON.parse(JSON.stringify(pick(CFG, KEYS)));
  function pick(o, keys) { const out = {}; keys.forEach((k) => { out[k] = o[k]; }); return out; }
  function restore() { Object.assign(CFG, JSON.parse(JSON.stringify(BASE))); delete CFG.carDir; }

  // ---- Hooks: speed at every contact, and which lane the animal was hit in -----
  let curWorld = null;
  const origEnc = WW.stats.onEncounter, origUp = WW.stats.upgradeToHit;
  function noteHit(x, y) {
    if (!curWorld) return;
    const kmh = WW.car.currentKmh();
    curWorld.m.hitKmh.push(kmh);
    // The animal at (x, y) and the car being updated: a hit in the lane the
    // animal entered second is a "far-lane" hit (it had crossed the first lane).
    const a = WW.animals.list.find((an) => an.x === x && an.y === y);
    const fromNorth = a && curWorld.m.fromNorth.get(a.id);
    const car = WW.car.current;
    if (a && fromNorth !== undefined && car && ((car.dir === "east") !== fromNorth)) curWorld.m.farLane++;
    if (kmh > S.seriousKmh) curWorld.m.seriousBy[car ? car.dir : "east"]++;
  }
  WW.stats.onEncounter = function (kind, x, y, kmh) {
    if (kind === "hit") noteHit(x, y);
    return origEnc.apply(this, arguments);
  };
  WW.stats.upgradeToHit = function (from, x, y, kmh) {
    noteHit(x, y);
    return origUp.apply(this, arguments);
  };

  // ---- Car stream: one per direction ---------------------------------------------
  // headway = headwayMinSec + Exponential(mean − min); cruise ~ Normal(cruiseKmh, sd) clipped.
  function carStream(rnd, meanSec) {
    const tr = CFG.traffic, t = CFG.tuning;
    const min = Math.min(tr.headwayMinSec, meanSec);
    let next = WW.spawner.exponential(rnd, meanSec); // first car: no car "before" the run
    return {
      due(now) {
        const out = [];
        while (next <= now) {
          const cruise = Math.max(tr.cruiseMinKmh, Math.min(tr.cruiseMaxKmh, t.cruiseKmh + WW.spawner.gauss(rnd) * tr.cruiseSdKmh));
          out.push({ t: next, cruiseKmh: cruise });
          next += min + WW.spawner.exponential(rnd, meanSec - min);
        }
        return out;
      },
    };
  }

  // One sign per camera per direction, at the upstream edge of the camera's
  // coverage along that direction's lane (as the placement study did).
  function perDirectionSigns() {
    const signs = [];
    CFG.traffic.dirs.forEach((dir) => {
      CFG.cameras.forEach((cam) => {
        const cov = WW.car.coverageOf(dir, cam);
        const p = WW.car.posOn(dir, Math.max(0, cov.start));
        signs.push({ id: "s-" + dir + "-" + cam.id, name: "Sign " + dir + " " + cam.id, x: p.x, y: p.y, linkedCameraId: cam.id, dir: dir, message: "" });
      });
    });
    CFG.signals = signs;
  }

  // ---- One two-way run ---------------------------------------------------------------
  function snapshot(w) {
    const st = w.stats, m = w.m;
    const sorted = m.delays.slice().sort((a, b) => a - b);
    return {
      hits: st.hits, serious: m.hitKmh.filter((k) => k > S.seriousKmh).length, crawl: m.hitKmh.filter((k) => k < 5).length,
      near: st.nearMiss, safe: st.safe, back: st.turnedBack, speedSum: st.speedSum, speedCount: st.speedCount,
      crossings: m.crossings, farLane: m.farLane, seriousEast: m.seriousBy.east, seriousWest: m.seriousBy.west,
      cars: m.delays.length, delaySum: m.delaySum, delaySq: m.delaySq, delays: sorted,
      stops: m.stops, stoppedSec: m.stoppedSec, lineSec: m.lineSec, blockedSec: m.blockedSec,
      queueSum: m.queueSum, queueMax: m.queueMax, steps: m.steps, unneededSteps: m.unneededSteps, signOnSteps: m.signOnSteps,
      entered: m.entered,
    };
  }

  function runTwoWay(seed, minutes, setting) {
    setting = setting || {};
    const worlds = [{ id: "off", systemOn: false }, { id: "on", systemOn: true }];
    WW.system = { get enabled() { return curWorld ? curWorld.systemOn : true; } };
    WW.clock = { ms: 0 };
    const use = (w) => { curWorld = w; WW.animals.use(w); WW.stats.use(w); WW.car.use(w); WW.detection.use(w); };
    WW.animals.setWorlds(worlds);
    const dirs = CFG.traffic.dirs;
    worlds.forEach((w) => {
      use(w); WW.car.reset();
      if (setting.perDirSigns) { perDirectionSigns(); WW.car.reset(); }
      WW.detection.reset(); WW.stats.reset();
      w.car.state.visible = false; // the primary car is parked: the stream drives
      w.m = { hitKmh: [], farLane: 0, seriousBy: { east: 0, west: 0 }, crossings: 0, reached: new Set(), fromNorth: new Map(),
        delays: [], delaySum: 0, delaySq: 0, stops: 0, stoppedSec: 0, lineSec: 0, blockedSec: 0,
        queueSum: 0, queueMax: 0, steps: 0, unneededSteps: 0, signOnSteps: 0, entered: 0 };
      w.recs = new Map();                 // car -> flow record
      w.entry = {}; dirs.forEach((d) => { w.entry[d] = []; }); // released cars waiting to enter
    });
    const animalStream = WW.spawner.createStream({
      rnd: WW.spawner.mulberry32(seed), firstAtSec: 1,
      meanGapSec: () => CFG.spawning.meanGapSec, xDist: setting.xDist,
    });
    const headway = setting.headwayMeanSec || CFG.traffic.headwayMeanSec;
    const carRnd = WW.spawner.mulberry32(seed * 7919 + 17);
    const streams = dirs.map((d) => ({ dir: d, s: carStream(carRnd, headway) }));

    const dt = S.dt, end = minutes * 60, halfRoad = CFG.road.roadWidth / 2, centreY = CFG.road.centerline[0].y;
    const roadLen = { east: WW.car.routeOf("east").total, west: WW.car.routeOf("west").total };
    const unitsPerKmh = 1 / CFG.tuning.unitsPerSecToKmh;
    let t = 0;
    while (t < end) {
      t += dt; WW.clock.ms += dt * 1000;
      const onScreen = Math.max.apply(null, worlds.map((w) => w.animals.length));
      animalStream.due(t).forEach((ev) => { if (onScreen < CFG.spawning.maxConcurrent) WW.animals.spawn(Object.assign({}, ev, { state: "walking" })); });
      streams.forEach((st) => st.s.due(t).forEach((ev) => worlds.forEach((w) => w.entry[st.dir].push({ releaseT: ev.t, cruiseKmh: ev.cruiseKmh }))));

      worlds.forEach((w) => {
        use(w);
        const m = w.m;
        WW.animals.update(dt);
        WW.detection.update();
        // Admit waiting cars whose entry is clear.
        dirs.forEach((d) => {
          const q = w.entry[d];
          while (q.length && WW.car.entryClear(d, q[0].cruiseKmh)) {
            const ev = q.shift();
            const car = WW.car.addCar({ dir: d, cruiseKmh: ev.cruiseKmh });
            WW.car.startLap(car);
            m.entered++;
            w.recs.set(car, { dir: d, releaseT: ev.releaseT, enterT: t, cruiseKmh: ev.cruiseKmh, stops: 0, stoppedSec: 0, lineSec: 0, wasStopped: false });
          }
          m.blockedSec += q.length * dt;
        });
        WW.car.update(dt);
        // Per-car flow bookkeeping; retire cars that left the map.
        let queued = 0;
        for (const car of WW.car.cars.slice()) {
          const rec = w.recs.get(car);
          if (!rec) continue;
          const c = car.state;
          if (!c.visible) {
            const free = roadLen[rec.dir] / (rec.cruiseKmh * unitsPerKmh);
            const delay = Math.max(0, t - rec.releaseT - free);
            m.delays.push(delay); m.delaySum += delay; m.delaySq += delay * delay;
            m.stops += rec.stops; m.stoppedSec += rec.stoppedSec; m.lineSec += rec.lineSec;
            w.recs.delete(car); WW.car.removeCar(car);
            continue;
          }
          const stopped = c.speedUnitsPerSec < 0.5;
          if (stopped) { rec.stoppedSec += dt; if (!rec.wasStopped) rec.stops++; if (c.lineWaitSec > 0) rec.lineSec += dt; }
          rec.wasStopped = stopped;
          if (stopped || c.queued) queued++;
        }
        dirs.forEach((d) => { queued += w.entry[d].length; });
        m.queueSum += queued; m.queueMax = Math.max(m.queueMax, queued); m.steps++;
        // Crossings, which side each animal came from, and unneeded warnings.
        let onRoad = false;
        for (const a of w.animals) {
          const d = WW.geo.distToPolyline(a.x, a.y, CFG.road.centerline);
          if (d <= halfRoad) {
            onRoad = true;
            if (!m.reached.has(a.id)) { m.reached.add(a.id); m.crossings++; m.fromNorth.set(a.id, a.y < centreY); }
          }
        }
        if (w.systemOn) {
          const flashing = CFG.signals.some((sig) => WW.detection.isSignalActive(sig.id));
          if (flashing) { m.signOnSteps++; if (!onRoad) m.unneededSteps++; }
        }
      });
    }
    curWorld = null;
    return worlds.map(snapshot);
  }

  // ---- Evaluate a setting over seeds ------------------------------------------------
  async function evaluate(setting, seeds, work) {
    const perSeed = [];
    for (const seed of seeds) {
      restore(); setting.apply(CFG);
      const [off, on] = runTwoWay(seed, S.minutes, setting);
      perSeed.push({ seed, off, on });
      if (work) await work();
    }
    restore();
    return summarise(setting, perSeed);
  }

  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  function side(rows) {
    const o = {};
    ["hits", "serious", "crawl", "near", "safe", "back", "speedSum", "speedCount", "crossings", "farLane", "seriousEast", "seriousWest",
      "cars", "delaySum", "delaySq", "stops", "stoppedSec", "lineSec", "blockedSec", "queueSum", "queueMax", "steps", "unneededSteps", "signOnSteps", "entered"]
      .forEach((k) => { o[k] = k === "queueMax" ? Math.max.apply(null, rows.map((r) => r[k])) : sum(rows, k); });
    const per100 = (v) => (o.crossings ? (100 * v) / o.crossings : 0);
    const perCar = (v) => (o.cars ? v / o.cars : 0);
    // Pooled 95th percentile of delay over every car of every seed.
    const all = [].concat.apply([], rows.map((r) => r.delays)).sort((a, b) => a - b);
    const p95 = all.length ? all[Math.min(all.length - 1, Math.floor(0.95 * all.length))] : 0;
    return {
      hits: o.hits, serious: o.serious, crawl: o.crawl, near: o.near, safe: o.safe, back: o.back, crossings: o.crossings,
      farLane: o.farLane, seriousEast: o.seriousEast, seriousWest: o.seriousWest, cars: o.cars,
      hitsPer100: per100(o.hits), seriousPer100: per100(o.serious), nearPer100: per100(o.near), farLanePer100: per100(o.farLane),
      carsPer100: per100(o.cars),
      avgKmh: o.speedCount ? o.speedSum / o.speedCount : null,
      delayMean: perCar(o.delaySum), delayP95: p95,
      stopsPerCar: perCar(o.stops), stoppedSecPerCar: perCar(o.stoppedSec), lineSecPerCar: perCar(o.lineSec), blockedSecPerCar: perCar(o.blockedSec),
      queueMean: o.steps ? o.queueSum / o.steps : 0, queueMax: o.queueMax,
      unneededShare: o.signOnSteps ? o.unneededSteps / o.signOnSteps : 0, signOnShare: o.steps ? o.signOnSteps / o.steps : 0,
    };
  }
  const cut = (a, b) => (a ? 1 - b / a : 0);
  // Seed-bootstrap 95% intervals: serious-hit reduction, and the ON − OFF delay per car.
  function bootstrap(perSeed) {
    const n = perSeed.length, rnd = WW.spawner.mulberry32(7), cuts = [], dds = [];
    for (let i = 0; i < 1000; i++) {
      let a = 0, b = 0, ca = 0, cb = 0, da = 0, db = 0, na = 0, nb = 0;
      for (let j = 0; j < n; j++) {
        const r = perSeed[Math.floor(rnd() * n)];
        a += r.off.serious; b += r.on.serious; ca += r.off.crossings; cb += r.on.crossings;
        da += r.off.delaySum; db += r.on.delaySum; na += r.off.cars; nb += r.on.cars;
      }
      cuts.push(cut(ca ? a / ca : 0, cb ? b / cb : 0));
      dds.push((nb ? db / nb : 0) - (na ? da / na : 0));
    }
    cuts.sort((x, y) => x - y); dds.sort((x, y) => x - y);
    const ci = (v) => [v[Math.floor(0.025 * v.length)], v[Math.floor(0.975 * v.length)]];
    return { cut: ci(cuts), delay: ci(dds) };
  }
  function summarise(setting, perSeed) {
    const off = side(perSeed.map((r) => r.off)), on = side(perSeed.map((r) => r.on));
    const b = bootstrap(perSeed);
    const prevented = off.seriousPer100 - on.seriousPer100;            // per 100 crossings
    const extraDelay = (on.delayMean - off.delayMean) * on.carsPer100;  // driver-seconds per 100 crossings
    return {
      id: setting.id, factor: setting.factor, label: setting.label, system: !!setting.system, seeds: perSeed.length,
      headwayMeanSec: setting.headwayMeanSec || CFG.traffic.headwayMeanSec,
      x: setting.x, lat: setting.lat, face: setting.face,
      off, on,
      seriousCut: cut(off.seriousPer100, on.seriousPer100), seriousCutCI: b.cut,
      nearCut: cut(off.nearPer100, on.nearPer100), hitCut: cut(off.hitsPer100, on.hitsPer100), farLaneCut: cut(off.farLanePer100, on.farLanePer100),
      delayDiff: on.delayMean - off.delayMean, delayDiffCI: b.delay,
      secPerHitPrevented: prevented > 0 ? extraDelay / prevented : null,
      perSeed,
    };
  }

  // ---- The study (browser page; the Node driver mirrors this) ----------------------
  async function run(ui, settings) {
    const t0 = Date.now();
    settings = settings || SETTINGS;
    const total = settings.length * S.seeds.length + 2 * S.combinedSeeds.length;
    let done = 0, lastYield = Date.now();
    const work = async () => {
      done++;
      if (Date.now() - lastYield > 100) {
        ui.progress(done / total, done + " / " + total + " runs · " + Math.round((Date.now() - t0) / 1000) + " s");
        await new Promise((r) => setTimeout(r, 0));
        lastYield = Date.now();
      }
    };
    const result = { settings: S, minutes: S.minutes, grid: [], combined: null, baseline: null };
    for (const st of settings) {
      ui.status("Grid: " + st.label);
      result.grid.push(await evaluate(st, S.seeds, work));
    }
    const combined = pickCombined(result.grid, settings);
    ui.status("Combined check (" + S.combinedSeeds.length + " seeds): " + combined.label);
    result.combined = await evaluate(combined, S.combinedSeeds, work);
    ui.status("Baseline on the same " + S.combinedSeeds.length + " seeds");
    result.baseline = await evaluate(settings[0], S.combinedSeeds, work);
    result.seconds = (Date.now() - t0) / 1000;
    result.runs = done;
    ui.progress(1, done + " runs · " + Math.round(result.seconds) + " s");
    return result;
  }

  // Per system-controlled factor, the level with the fewest serious ON hits per
  // 100 crossings (the baseline level counts too), run together.
  function pickCombined(grid, settings) {
    const base = grid.find((g) => g.id === "base") || grid[0];
    const factors = {};
    grid.filter((g) => g.system).forEach((g) => { (factors[g.factor] = factors[g.factor] || []).push(g); });
    const picks = [];
    Object.keys(factors).forEach((f) => {
      const best = factors[f].concat([Object.assign({}, base, { factor: f })]).sort((a, b) => a.on.seriousPer100 - b.on.seriousPer100)[0];
      if (best.id !== base.id) picks.push(settings.find((s) => s.id === best.id));
    });
    return {
      id: "combined", factor: "combined", system: true,
      label: picks.length ? "best per factor: " + picks.map((p) => p.label).join(" + ") : "baseline (no factor beat it)",
      apply: (c) => picks.forEach((p) => p.apply(c)),
      perDirSigns: picks.some((p) => p.perDirSigns), ids: picks.map((p) => p.id),
    };
  }

  // ---- CSV ----------------------------------------------------------------------------
  function toCSV(r) {
    const sideCols = (s) => [s.crossings, s.cars, s.hits, s.serious, s.crawl, s.near, s.safe, s.farLane, s.seriousEast, s.seriousWest,
      s.seriousPer100, s.nearPer100, s.hitsPer100, s.farLanePer100, s.avgKmh, s.delayMean, s.delayP95, s.stopsPerCar, s.stoppedSecPerCar, s.lineSecPerCar, s.blockedSecPerCar, s.queueMean, s.queueMax, s.unneededShare, s.signOnShare];
    const names = ["crossings", "cars", "hits", "serious", "crawl", "near", "safe", "far_lane", "serious_east", "serious_west",
      "serious_per100", "near_per100", "hits_per100", "far_lane_per100", "avg_kmh", "delay_mean_s", "delay_p95_s", "stops_per_car", "stopped_s_per_car", "line_s_per_car", "blocked_s_per_car", "queue_mean", "queue_max", "unneeded_share", "sign_on_share"];
    const head = ["id", "factor", "setting", "seeds", "headway_s"].concat(names.map((n) => "off_" + n), names.map((n) => "on_" + n),
      ["serious_cut", "serious_cut_lo", "serious_cut_hi", "near_cut", "hits_cut", "far_lane_cut", "delay_diff_s", "delay_diff_lo", "delay_diff_hi", "sec_per_hit_prevented"]);
    const rows = r.grid.concat([r.combined, r.baseline].filter(Boolean)).map((g) =>
      [g.id, g.factor, g.label, g.seeds, g.headwayMeanSec].concat(sideCols(g.off), sideCols(g.on),
        [g.seriousCut, g.seriousCutCI[0], g.seriousCutCI[1], g.nearCut, g.hitCut, g.farLaneCut, g.delayDiff, g.delayDiffCI[0], g.delayDiffCI[1], g.secPerHitPrevented]));
    const esc = (v) => (v === null || v === undefined ? "" : typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(4)) : '"' + String(v).replace(/"/g, '""') + '"');
    return [head.join(",")].concat(rows.map((row) => row.map(esc).join(","))).join("\n");
  }

  // ---- Page (research/traffic.html) ----------------------------------------------------
  const pct = (v) => (v === null || v === undefined ? "–" : Math.round(v * 100) + "%");
  const num = (v, d) => (v === null || v === undefined ? "–" : v.toFixed(d === undefined ? 1 : d));
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  function render(r) {
    const row = (g) => "<tr><td>" + esc(g.label) + "</td><td>" + num(g.off.seriousPer100, 2) + "</td><td>" + num(g.on.seriousPer100, 2) + "</td><td>" + pct(g.seriousCut) +
      "</td><td>" + pct(g.nearCut) + "</td><td>" + num(g.off.delayMean) + "</td><td>" + num(g.on.delayMean) + "</td><td>" + num(g.on.delayP95) + "</td><td>" + num(g.on.queueMax, 0) +
      "</td><td>" + (g.secPerHitPrevented === null ? "–" : num(g.secPerHitPrevented, 0)) + "</td></tr>";
    const table = (rows) => '<table><thead><tr><th>Setting</th><th>OFF serious /100</th><th>ON serious /100</th><th>Serious cut</th><th>Near cut</th><th>OFF delay s/car</th><th>ON delay s/car</th><th>ON p95</th><th>ON queue max</th><th>Driver-s per hit prevented</th></tr></thead><tbody>' + rows.map(row).join("") + "</tbody></table>";
    return "<h2>Grid (" + r.grid[0].seeds + " seeds × " + r.minutes + " min)</h2>" + table(r.grid.slice().sort((a, b) => a.on.seriousPer100 - b.on.seriousPer100)) +
      "<h2>Combined check</h2><p class=\"muted\">" + esc(r.combined.label) + "</p>" + table([r.baseline, r.combined]);
  }
  function init() {
    const btn = document.getElementById("run"), out = document.getElementById("out"), bar = document.getElementById("bar"), status = document.getElementById("status"), dl = document.getElementById("download");
    if (!btn) return;
    const ui = { progress: (f, text) => { bar.style.width = Math.round(f * 100) + "%"; status.textContent = text; }, status: (text) => { status.textContent = text; } };
    btn.addEventListener("click", async () => {
      btn.disabled = true; out.innerHTML = "";
      const r = await run(ui);
      out.innerHTML = render(r);
      const blob = new Blob([toCSV(r) + "\n"], { type: "text/csv" });
      dl.href = URL.createObjectURL(blob); dl.download = "traffic-study.csv"; dl.hidden = false;
      btn.disabled = false;
    });
    document.getElementById("meta").textContent = SETTINGS.length + " settings × " + S.seeds.length + " seeds × " + S.minutes + " simulated minutes, two-way traffic; combined check with " + S.combinedSeeds.length + " seeds" + (QUICK ? " · QUICK MODE" : "");
  }

  window.TrafficStudy = { S, SETTINGS, placementSettings, run, evaluate, runTwoWay, summarise, pickCombined, toCSV, restore };
  if (window.addEventListener && typeof document !== "undefined") window.addEventListener("DOMContentLoaded", init);
})();
