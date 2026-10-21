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
    minutes: QUICK ? 3 : 10,
    seeds: QUICK ? [101, 102] : range(101, 110),
    combinedSeeds: QUICK ? [101, 102] : range(101, 120),
    seriousKmh: (CFG.scenario && CFG.scenario.seriousKmh) || 30,
    realCrossingsPerHour: 0.3,   // a night hotspot on a forested Singapore road (Tay et al. 2024): used to convert delay per crossing into delay per car
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
  // Study variables (research/traffic.html, research/run-traffic-study.js):
  //   seePolicy  what a driver does on seeing an animal: nothing | slow | stop
  //   signRule   warned driver at the line: slow (never stops) | fixed 5 / 10 s | clear + 0.5 / 2 / 5 s after the sign goes off
  //   signTrigger what makes the sign flash: any animal in view | only one on the road
  // Everything else is fixed at the research values (config.research).
  const POLICIES = [["nothing", "driver never brakes for animals"], ["slow", "driver slows for animals (today)"], ["stop", "driver stops for any animal on the road"]];
  const RULES = [
    ["slow", "no stop, 20 km/h past the sign", (c) => { c.tuning.signRule = "slow"; }],
    ["fixed5", "stop 5 s at the line", (c) => { c.tuning.signRule = "fixed"; c.tuning.signFixedWaitSec = 5; }],
    ["fixed10", "stop 10 s at the line", (c) => { c.tuning.signRule = "fixed"; c.tuning.signFixedWaitSec = 10; }],
    ["clear", "wait until the sign is off (+0.5 s)", (c) => { c.tuning.signRule = "clear"; c.tuning.signClearSec = 0.5; }],
    ["clear2", "wait until the sign is off + 2 s", (c) => { c.tuning.signRule = "clear"; c.tuning.signClearSec = 2; }],
    ["clear5", "wait until the sign is off + 5 s", (c) => { c.tuning.signRule = "clear"; c.tuning.signClearSec = 5; }],
  ];
  const TRIGGERS = [["view", "sign on while an animal is in view"], ["road", "sign on only while an animal is on the road"]];
  const SETTINGS = [];
  POLICIES.forEach((pol) => RULES.forEach((rule) => TRIGGERS.forEach((trig) => {
    const isBase = pol[0] === "slow" && rule[0] === "clear" && trig[0] === "view";
    SETTINGS.push({
      id: isBase ? "base" : "P" + pol[0] + "_R" + rule[0] + "_T" + trig[0], policy: pol[0], rule: rule[0], trigger: trig[0],
      factor: "policy x sign rule x trigger", system: true,
      label: pol[1] + " · " + rule[1] + " · " + trig[1],
      apply: (c) => { c.tuning.seePolicy = pol[0]; rule[2](c); c.tuning.signTrigger = trig[0]; },
    });
  })));
  // Sensitivities on the baseline: compliance, demand, lens, crossings anywhere, headlights.
  function sensitivitySettings() {
    return [
      { id: "base", factor: "baseline", system: true, label: "baseline (30% of drivers follow the sign rule)", apply: () => {} },
      { id: "comply10", factor: "sign compliance", label: "10% of drivers follow the sign rule", apply: (c) => { c.tuning.signCompliance = 0.1; } },
      { id: "comply60", factor: "sign compliance", label: "60% of drivers follow the sign rule", apply: (c) => { c.tuning.signCompliance = 0.6; } },
      { id: "comply100", factor: "sign compliance", label: "every driver follows the sign rule", apply: (c) => { c.tuning.signCompliance = 1; } },
      { id: "hw20", factor: "traffic demand", label: "a car every 20 s per direction", apply: () => {}, headwayMeanSec: 20 },
      { id: "hw90", factor: "traffic demand", label: "a car every 90 s per direction", apply: () => {}, headwayMeanSec: 90 },
      { id: "lens60", factor: "lens", label: "60° lens", apply: (c) => { c.cameras[0].fovDeg = 60; } },
      { id: "lens110", factor: "lens", label: "110° lens (the demo's)", apply: (c) => { c.cameras[0].fovDeg = 110; } },
      { id: "north75", factor: "arrival side", label: "75% of animals from the north verge", apply: (c) => { c.spawning.northShare = 0.75; } },
      { id: "uniform", factor: "crossing pattern", label: "crossings anywhere along the road", apply: () => {}, xDist: (rnd) => 60 + rnd() * 880 },
      { id: "gap120", factor: "arrival rate (check)", label: "a group every 120 s (rate-independence check)", apply: (c) => { c.spawning.meanGapSec = 120; } },
      { id: "gantry", factor: "signs", label: "the demo's two gantry signs at the camera instead of one per direction", apply: () => {}, perDirSigns: false },
    ];
  }
  // Placement stage: every single-camera placement for a lens, with per-direction
  // signs, plus three two-camera layouts. "p90-today" is the demo camera with
  // per-direction signs so the grid has a like-for-like reference.
  function placementSettings(fovDeg) {
    const L = "p" + (fovDeg || CFG.research.camera.fovDeg) + "-";
    const lens = (c) => { c.cameras.forEach((cam) => { cam.fovDeg = fovDeg || CFG.research.camera.fovDeg; }); };
    const out = [{ id: L + "today", factor: "placement", system: true, label: "today's camera (x 590 centreline facing W)", apply: lens, perDirSigns: true, lens: fovDeg }];
    S.xs.forEach((x) => S.laterals.forEach((lat) => S.facings.forEach((f) => {
      out.push({ id: L + x + "-" + lat.id + "-" + f.id, factor: "placement", system: true,
        label: "x " + x + " · " + lat.label + " · facing " + f.id, apply: (c) => { cam(x, lat.y, f.deg)(c); lens(c); }, perDirSigns: true,
        x: x, lat: lat.id, face: f.id, lens: fovDeg });
    })));
    const pair = (id, label, a, b) => out.push({ id: L + id, factor: "placement", system: true, label: label, perDirSigns: true, lens: fovDeg, pair: true,
      apply: (c) => { Object.assign(c.cameras[0], a); c.cameras.push(Object.assign({}, c.cameras[0], { id: "cam2", name: "Cam 2" }, b)); lens(c); } });
    pair("pair-verges", "pair at x 490: north verge facing S + south verge facing N", { x: 490, y: 330, facingAngleDeg: 90 }, { x: 490, y: 430, facingAngleDeg: 270 });
    pair("pair-split", "pair: x 400 north verge facing S + x 550 south verge facing N", { x: 400, y: 330, facingAngleDeg: 90 }, { x: 550, y: 430, facingAngleDeg: 270 });
    pair("pair-b2b", "pair at x 490 centreline: facing W + facing E", { x: 490, y: 380, facingAngleDeg: 180 }, { x: 490, y: 380, facingAngleDeg: 0 });
    return out;
  }

  // ---- Config snapshot / restore -----------------------------------------------
  // restore() puts the demo config back; baseline() then applies config.research
  // (the literature values) on top, which is what every setting starts from.
  const KEYS = ["cameras", "signals", "tuning", "species", "spawning", "crossing", "traffic"];
  const BASE = JSON.parse(JSON.stringify(pick(CFG, KEYS)));
  function pick(o, keys) { const out = {}; keys.forEach((k) => { out[k] = o[k]; }); return out; }
  function restore() { Object.assign(CFG, JSON.parse(JSON.stringify(BASE))); delete CFG.carDir; }
  function applyResearch() { WW.applyResearch(CFG); }
  function baseline() { restore(); applyResearch(); }

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
  function carStream(rnd, meanSec) { return WW.spawner.createCarStream({ rnd: rnd, meanSec: meanSec }); }

  // One sign per camera per direction, at the upstream edge of the camera's
  // coverage along that direction's lane (as the placement study did).
  function perDirectionSigns() { CFG.signals = WW.car.directionSigns({ kerbOffset: 0, message: "" }); }

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
      entered: m.entered, compliers: m.compliers,
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
      // Research installation: one sign per camera per direction at the edge of
      // the camera's coverage (so the sign is seen signSightDistance before the
      // stop line). perDirSigns: false keeps the demo's two gantry signs at the camera.
      if (setting.perDirSigns !== false) { perDirectionSigns(); WW.car.reset(); }
      WW.detection.reset(); WW.stats.reset();
      w.car.state.visible = false; // the primary car is parked: the stream drives
      w.m = { hitKmh: [], farLane: 0, seriousBy: { east: 0, west: 0 }, crossings: 0, reached: new Set(), fromNorth: new Map(),
        delays: [], delaySum: 0, delaySq: 0, stops: 0, stoppedSec: 0, lineSec: 0, blockedSec: 0,
        queueSum: 0, queueMax: 0, steps: 0, unneededSteps: 0, signOnSteps: 0, entered: 0, compliers: 0 };
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
      streams.forEach((st) => st.s.due(t).forEach((ev) => worlds.forEach((w) => w.entry[st.dir].push({ releaseT: ev.t, cruiseKmh: ev.cruiseKmh, complies: ev.complies }))));

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
            const car = WW.car.addCar({ dir: d, cruiseKmh: ev.cruiseKmh, complies: ev.complies });
            WW.car.startLap(car);
            m.entered++; if (ev.complies) m.compliers++;
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
      baseline(); setting.apply(CFG);
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
      "cars", "delaySum", "delaySq", "stops", "stoppedSec", "lineSec", "blockedSec", "queueSum", "queueMax", "steps", "unneededSteps", "signOnSteps", "entered", "compliers"]
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
      complianceShare: o.entered ? o.compliers / o.entered : 0,
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
    const headway = setting.headwayMeanSec || (CFG.research && CFG.research.traffic && CFG.research.traffic.headwayMeanSec) || CFG.traffic.headwayMeanSec;
    // Rate-independent cost: extra driver-seconds per crossing event; and what that
    // means per car at the real crossing rate and this traffic volume.
    const delayPerCrossing = extraDelay / 100;
    const realDelayPerCar = delayPerCrossing * S.realCrossingsPerHour / (3600 / headway);
    return {
      id: setting.id, factor: setting.factor, label: setting.label, system: !!setting.system, seeds: perSeed.length,
      policy: setting.policy, rule: setting.rule, trigger: setting.trigger, lens: setting.lens, pair: !!setting.pair,
      headwayMeanSec: headway, delayPerCrossing: delayPerCrossing, realDelayPerCar: realDelayPerCar,
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
      ["serious_cut", "serious_cut_lo", "serious_cut_hi", "near_cut", "hits_cut", "far_lane_cut", "delay_diff_s", "delay_diff_lo", "delay_diff_hi", "sec_per_hit_prevented", "delay_per_crossing_s", "real_delay_per_car_s", "compliance_share"]);
    const rows = r.grid.concat([r.combined, r.baseline].filter(Boolean)).map((g) =>
      [g.id, g.factor, g.label, g.seeds, g.headwayMeanSec].concat(sideCols(g.off), sideCols(g.on),
        [g.seriousCut, g.seriousCutCI[0], g.seriousCutCI[1], g.nearCut, g.hitCut, g.farLaneCut, g.delayDiff, g.delayDiffCI[0], g.delayDiffCI[1], g.secPerHitPrevented, g.delayPerCrossing, g.realDelayPerCar, g.on.complianceShare]));
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
    document.getElementById("meta").textContent = SETTINGS.length + " settings (3 driver policies × 6 sign rules × 2 sign triggers) × " + S.seeds.length + " seeds × " + S.minutes + " simulated minutes, two-way traffic at the research values; combined check with " + S.combinedSeeds.length + " seeds" + (QUICK ? " · QUICK MODE" : "");
  }

  window.TrafficStudy = { S, SETTINGS, placementSettings, sensitivitySettings, run, evaluate, runTwoWay, summarise, pickCombined, toCSV, restore, baseline, applyResearch, perDirectionSigns };
  if (window.addEventListener && typeof document !== "undefined") window.addEventListener("DOMContentLoaded", init);
})();
