/* study.js — camera placement study (position, angle, number of cameras).
 *
 * Runs the demo's own simulation modules (animals, car, detection, stats)
 * headlessly on a fixed timestep, for many camera layouts, against the SAME
 * seeded schedules of animal crossings, and compares each layout with a
 * "no system" baseline. Headline: serious hits (car faster than
 * config.scenario.seriousKmh at contact) prevented; also near misses and all
 * dangerous encounters (hits + near misses). Scored in four scenarios: {hotspot, uniform crossings}
 * x {eastbound, westbound traffic}.
 *
 * Stages: 1) every single-camera setup (5 positions x 3 lateral x 8 directions),
 *         2) number of cameras: greedy 1 -> 4 plus hand-designed layouts,
 *         3) sensitivity of the best layouts to the lens and driver sight distance.
 * Results: on the page, as CSV, and on window.STUDY for scripted runs.
 * Classic script (file:// safe), no dependencies. */
(function () {
  const WW = window.WW;
  const CFG = WW.config;
  const QUICK = /[?&]quick\b/.test(location.search); // smoke test: tiny study

  // ---- Study settings ------------------------------------------------------
  const S = {
    dt: 1 / 30,                 // fixed sim step (s)
    crossings: QUICK ? 40 : 200, // animals per run
    // Arrivals use the demo's model (js/spawner.js: Poisson groups, hotspot
    // locations, species mix), with groups twice as frequent as the demo's
    // default so a run stays short.
    meanGapSec: 6,
    tailSec: 30,                // keep running after the last spawn so it can finish
    seeds: QUICK ? [1] : [1, 2, 3, 4, 5],
    greedySeeds: QUICK ? [1] : [1, 2, 3],
    finalSeeds: QUICK ? [1, 2] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    greedyPool: QUICK ? 6 : 15, // stage-2 candidates = best N single cameras
    maxCameras: 4,
    patterns: ["hotspot", "uniform"],
    dirs: ["east", "west"],
    hotspot: CFG.spawning.hotspot, // "hotspot" scenario: the demo's crossing distribution
    uniform: { x0: 60, x1: 940 },  // "anywhere" scenario: uniform along the road
    // Stage-1 grid
    xs: [250, 400, 550, 700, 850],
    laterals: [
      { id: "centre", label: "centreline gantry", y: 380 },
      { id: "north", label: "north verge", y: 330 }, // wildlife side
      { id: "south", label: "south verge", y: 430 }, // Hall 15 side
    ],
    lens: {
      today: { fovDeg: CFG.cameras[0].fovDeg, range: CFG.cameras[0].range, label: "showcase day " + CFG.cameras[0].fovDeg + "°/" + CFG.cameras[0].range },
      wide: { fovDeg: 84, range: 150, label: "wide 84°/150" },   // the first study's camera
      standard: { fovDeg: 60, range: 200, label: "standard 60°/200" },
      narrow: { fovDeg: 40, range: 260, label: "narrow 40°/260" },
    },
    sights: [CFG.tuning.signSightDistance, 320], // showcase-day sign visibility, and a shorter one
  };
  // Eight compass directions (screen angles: 0 = east, 90 = south). Includes
  // facing away from the road, i.e. watching a verge for animals approaching it.
  const FACINGS = [
    { id: "E", label: "facing E (along road)", deg: 0 },
    { id: "SE", label: "facing SE", deg: 45 },
    { id: "S", label: "facing S", deg: 90 },
    { id: "SW", label: "facing SW", deg: 135 },
    { id: "W", label: "facing W (along road)", deg: 180 },
    { id: "NW", label: "facing NW", deg: 225 },
    { id: "N", label: "facing N", deg: 270 },
    { id: "NE", label: "facing NE", deg: 315 },
  ];
  function facings() { return FACINGS; }

  // ---- Crossing schedule ----------------------------------------------------
  // The arrivals for one (pattern, seed): identical for every layout, so layouts
  // are compared on the same animals.
  const scheduleCache = {};
  function schedule(pattern, seed) {
    const key = pattern + ":" + seed;
    if (scheduleCache[key]) return scheduleCache[key];
    const stream = WW.spawner.createStream({
      rnd: WW.spawner.mulberry32(seed * 7919 + (pattern === "hotspot" ? 1 : 2)),
      firstAtSec: 2,
      meanGapSec: () => S.meanGapSec,
      xDist: pattern === "uniform" ? (rnd) => S.uniform.x0 + rnd() * (S.uniform.x1 - S.uniform.x0) : undefined,
    });
    return (scheduleCache[key] = stream.take(S.crossings));
  }

  function roadDist(x, y) { return WW.geo.distToPolyline(x, y, CFG.road.centerline); }

  // ---- One simulation run --------------------------------------------------
  const DEMO = { cameras: CFG.cameras, signals: CFG.signals, carPath: CFG.carPath, sight: CFG.tuning.signSightDistance };
  WW.system = { enabled: true };
  WW.clock = { ms: 0 };

  // layout: array of cameras {x, y, facingAngleDeg, fovDeg, range}; null = no system.
  function runOnce(layout, pattern, dir, seed, sight) {
    const sched = schedule(pattern, seed);
    const sys = !!(layout && layout.length);
    CFG.carPath = dir === "east" ? DEMO.carPath : CFG.carPathWest;
    CFG.carDir = dir;
    CFG.tuning.signSightDistance = sight;
    // Detection needs at least one camera defined even when the system is off.
    CFG.cameras = sys ? layout.map((c, i) => Object.assign({ id: "c" + i, name: "Cam " + (i + 1) }, c)) : DEMO.cameras;
    CFG.signals = [];
    WW.system.enabled = sys;

    const world = {};
    WW.animals.setWorlds([world]);
    WW.animals.use(world); WW.stats.use(world); WW.car.use(world); WW.detection.use(world);
    WW.animals.clear();
    WW.clock.ms = 0;
    WW.car.reset(); // builds this direction's path, so coverage() projects onto it

    // Sign rule: one sign per camera for this direction, at the upstream edge of
    // the camera's coverage along this lane (drivers see it signSightDistance earlier).
    if (sys) {
      CFG.signals = CFG.cameras.map((cam) => {
        const cov = WW.car.coverage(cam);
        const p = WW.car.posAt(Math.max(0, cov.start));
        return { id: "s-" + cam.id, x: p.x, y: p.y, linkedCameraId: cam.id, dir: dir, message: "" };
      });
      WW.car.reset();
    }
    WW.detection.reset();
    WW.stats.reset();

    const halfRoad = CFG.road.roadWidth / 2;
    const track = new Map(); // animal id -> { onRoad, reached, early }
    const m = { crossings: 0, early: 0, onRoadSteps: 0, protectedSteps: 0, slowedSteps: 0, unneededSteps: 0, laps: 0, lapSum: 0 };
    let next = 0, t = 0, lapStart = 0, waitSec = 0;
    const end = sched[sched.length - 1].t + S.tailSec;
    const dt = S.dt;

    while (t < end) {
      while (next < sched.length && sched[next].t <= t) {
        const c = sched[next++];
        const a = WW.animals.spawn(Object.assign({}, c, { state: "walking" }));
        track.set(a.id, { reached: false, early: false });
      }
      WW.clock.ms += dt * 1000;
      WW.animals.update(dt);
      WW.detection.update();
      const wasVisible = WW.car.state.visible;
      WW.car.update(dt);
      t += dt;

      // Laps: time from start to leaving the map, then the respawn pause.
      if (wasVisible && !WW.car.state.visible) { m.laps++; m.lapSum += t - lapStart; waitSec = 0; }
      if (!WW.car.state.visible) {
        waitSec += dt;
        if (waitSec >= CFG.tuning.carRespawnDelaySec) { WW.car.startLap(); lapStart = t; }
      }

      // Per-animal metrics.
      const camState = WW.detection.camState;
      const zones = WW.car.warnZones;
      for (const a of WW.animals.list) {
        const tr = track.get(a.id);
        const onRoad = roadDist(a.x, a.y) <= halfRoad;
        if (!tr.reached) {
          if (sys && !tr.early) {
            for (const id in camState) if (camState[id].episodes.has(a.id)) { tr.early = true; break; }
          }
          if (onRoad) { tr.reached = true; m.crossings++; if (tr.early) m.early++; }
        }
        if (onRoad) {
          m.onRoadSteps++;
          // Protected: a warning zone covering the 100 units before the animal is active,
          // so a car coming this way would already be slowing.
          if (sys) {
            const sA = WW.car.projectS(a.x, a.y);
            for (const z of zones) {
              if (z.start <= sA - 100 && sA <= z.end + 20 && WW.detection.isSignalActive(z.signalId)) { m.protectedSteps++; break; }
            }
          }
        }
      }

      // Driver cost: time slowed by a warning with no animal on (or about to step
      // onto) the road within sight distance ahead = unneeded slowdown.
      if (sys && WW.car.state.visible && WW.car.inActiveWarnZone()) {
        m.slowedSteps++;
        const sCar = WW.car.state.s;
        let needed = false;
        for (const a of WW.animals.list) {
          if (roadDist(a.x, a.y) > halfRoad + 40) continue;
          const ds = WW.car.projectS(a.x, a.y) - sCar;
          if (ds >= 0 && ds <= sight + 50) { needed = true; break; }
        }
        if (!needed) m.unneededSteps++;
      }
    }

    const st = WW.stats.state;
    // The study's "near-miss" counts every dangerous encounter: hits plus near
    // misses (the sim now tells them apart). "avoided" = safe passes.
    m.hits = st.hits;
    m.serious = st.seriousHits;
    m.turnedBack = st.turnedBack;
    m.nearMiss = st.hits + st.nearMiss; m.avoided = st.safe; m.speedSum = st.speedSum; m.speedCount = st.speedCount;
    m.detections = st.detections;
    return m;
  }

  function restoreDemoConfig() {
    CFG.cameras = DEMO.cameras; CFG.signals = DEMO.signals; CFG.carPath = DEMO.carPath;
    CFG.tuning.signSightDistance = DEMO.sight; delete CFG.carDir;
  }

  // ---- Evaluation + aggregation --------------------------------------------
  const baselineCache = {};
  function baseline(pattern, dir, seed) {
    const k = pattern + dir + seed;
    return baselineCache[k] || (baselineCache[k] = runOnce(null, pattern, dir, seed, S.sights[0]));
  }

  function sum(runs, key) { return runs.reduce((acc, r) => acc + r[key], 0); }

  // Evaluate a layout over all 4 scenarios x seeds. `work` yields between runs.
  async function evaluate(layout, seeds, sight, work) {
    const scen = [];
    for (const pattern of S.patterns) {
      for (const dir of S.dirs) {
        const on = [], off = [];
        for (const seed of seeds) {
          off.push(baseline(pattern, dir, seed));
          on.push(runOnce(layout, pattern, dir, seed, sight));
          await work();
        }
        const cut = (a, b) => (a ? 1 - b / a : 0);
        const serOff = sum(off, "serious"), serOn = sum(on, "serious");
        const nmOff = sum(off, "nearMiss"), nmOn = sum(on, "nearMiss");
        const nearOff = nmOff - sum(off, "hits"), nearOn = nmOn - sum(on, "hits");
        scen.push({
          pattern, dir, serOff, serOn, nmOff, nmOn, nearOff, nearOn,
          reduction: cut(serOff, serOn),   // serious hits prevented (the headline)
          dangerCut: cut(nmOff, nmOn),     // all dangerous encounters (hits + near misses)
          nearCut: cut(nearOff, nearOn),   // near misses alone
          extraLap: sum(on, "lapSum") / Math.max(1, sum(on, "laps")) - sum(off, "lapSum") / Math.max(1, sum(off, "laps")),
          on,
        });
      }
    }
    const all = scen.flatMap((s) => s.on);
    const crossings = sum(all, "crossings"), onRoad = sum(all, "onRoadSteps"), slowed = sum(all, "slowedSteps");
    const enc = sum(all, "nearMiss") + sum(all, "avoided");
    return {
      cams: layout.length,
      reduction: avg(scen.map((s) => s.reduction)),
      worst: Math.min.apply(null, scen.map((s) => s.reduction)),
      dangerCut: avg(scen.map((s) => s.dangerCut)),
      nearCut: avg(scen.map((s) => s.nearCut)),
      seriousOn: sum(all, "serious"), seriousOff: scen.reduce((a, s) => a + s.serOff, 0),
      byScenario: scen.map((s) => ({ pattern: s.pattern, dir: s.dir, reduction: s.reduction, serOff: s.serOff, serOn: s.serOn, dangerCut: s.dangerCut, nearCut: s.nearCut })),
      early: crossings ? sum(all, "early") / crossings : 0,
      protectedPct: onRoad ? sum(all, "protectedSteps") / onRoad : 0,
      extraLap: avg(scen.map((s) => s.extraLap)),
      unneeded: slowed ? sum(all, "unneededSteps") / slowed : 0,
      avgKmh: enc ? sum(all, "speedSum") / Math.max(1, sum(all, "speedCount")) : null,
    };
  }
  function avg(a) { return a.reduce((x, y) => x + y, 0) / (a.length || 1); }

  // Ranking: serious-hit reduction (to 0.5 %), then near-miss reduction, then
  // protected time, then driver delay.
  function compare(a, b) {
    const ra = Math.round(a.res.reduction * 200), rb = Math.round(b.res.reduction * 200);
    if (ra !== rb) return rb - ra;
    const na = Math.round(a.res.nearCut * 200), nb = Math.round(b.res.nearCut * 200);
    if (na !== nb) return nb - na;
    if (Math.abs(a.res.protectedPct - b.res.protectedPct) > 0.005) return b.res.protectedPct - a.res.protectedPct;
    return a.res.extraLap - b.res.extraLap;
  }

  // ---- Layout helpers --------------------------------------------------------
  function cam(x, lat, face, lens) {
    const l = lens || S.lens.today;
    return { x, y: lat.y, facingAngleDeg: face.deg, fovDeg: l.fovDeg, range: l.range,
      label: "x" + x + " · " + lat.label + " · " + face.label, latId: lat.id, faceId: face.id };
  }
  function layoutLabel(cams) { return cams.map((c) => c.label).join(" + "); }
  function withLens(cams, lens) { return cams.map((c) => Object.assign({}, c, { fovDeg: lens.fovDeg, range: lens.range })); }

  // ---- The study --------------------------------------------------------------
  async function runStudy(ui) {
    const t0 = performance.now();
    const result = { settings: S, stage1: [], greedy: [], hand: [], finals: [], stage3: [] };
    const singles = [];
    S.xs.forEach((x) => S.laterals.forEach((lat) => facings(lat).forEach((f) => singles.push([cam(x, lat, f)]))));

    // Progress accounting (in runs).
    const scen = S.patterns.length * S.dirs.length;
    const total =
      singles.length * scen * S.seeds.length +
      (S.maxCameras - 1) * S.greedyPool * scen * S.greedySeeds.length +
      (S.maxCameras + 3) * scen * S.finalSeeds.length +
      S.maxCameras * Object.keys(S.lens).length * S.sights.length * scen * S.seeds.length;
    let done = 0, lastYield = performance.now();
    const work = async () => {
      done++;
      if (performance.now() - lastYield > 60) {
        ui.progress(done / total, done + " / ~" + total + " runs · " + ((performance.now() - t0) / 1000).toFixed(0) + " s");
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    };

    // Stage 1: every single camera.
    ui.status("Stage 1: " + singles.length + " single-camera setups");
    for (const L of singles) result.stage1.push({ label: layoutLabel(L), layout: L, res: await evaluate(L, S.seeds, S.sights[0], work) });
    result.stage1.sort(compare);

    // Stage 2a: greedy forward selection from the best single cameras.
    ui.status("Stage 2: number of cameras (greedy)");
    const pool = result.stage1.slice(0, S.greedyPool).map((r) => r.layout[0]);
    let current = [result.stage1[0].layout[0]];
    result.greedy.push({ label: layoutLabel(current), layout: current.slice(), res: result.stage1[0].res });
    for (let n = 2; n <= S.maxCameras; n++) {
      const tried = [];
      for (const c of pool) {
        if (current.indexOf(c) >= 0) continue;
        const L = current.concat([c]);
        tried.push({ label: layoutLabel(L), layout: L, res: await evaluate(L, S.greedySeeds, S.sights[0], work) });
      }
      tried.sort(compare);
      current = tried[0].layout;
      result.greedy.push(tried[0]);
    }

    // Stage 2b: hand-designed layouts, for comparison.
    const best = result.stage1[0].layout[0];
    const lat = (id) => S.laterals.find((l) => l.id === id);
    const face = (latId, fid) => facings(lat(latId)).find((f) => f.id === fid);
    const hand = [
      { name: "Back-to-back pair at the hotspot (centreline, facing W + E)",
        layout: [cam(490, lat("centre"), face("centre", "W")), cam(490, lat("centre"), face("centre", "E"))] },
      { name: "Opposite verges at the hotspot, facing across the road",
        layout: [cam(490, lat("north"), face("north", "S")), cam(490, lat("south"), face("south", "N"))] },
      { name: "Best single camera, repeated at x 250 / 500 / 750",
        layout: [250, 500, 750].map((x) => cam(x, lat(best.latId), face(best.latId, best.faceId))) },
    ];

    // Finals: best greedy layout per camera count + hand layouts, with 10 seeds.
    ui.status("Stage 2: re-running finalists with " + S.finalSeeds.length + " seeds");
    for (const g of result.greedy) {
      result.finals.push({ kind: "greedy", name: g.layout.length + " camera" + (g.layout.length > 1 ? "s" : "") + " (best found)",
        label: g.label, layout: g.layout, res: await evaluate(g.layout, S.finalSeeds, S.sights[0], work) });
    }
    for (const h of hand) {
      result.finals.push({ kind: "hand", name: h.name, label: layoutLabel(h.layout), layout: h.layout,
        res: await evaluate(h.layout, S.finalSeeds, S.sights[0], work) });
    }

    // Stage 3: sensitivity of the best layout per camera count.
    ui.status("Stage 3: lens and sight-distance sensitivity");
    for (const g of result.greedy) {
      for (const lk of Object.keys(S.lens)) {
        for (const sight of S.sights) {
          const L = withLens(g.layout, S.lens[lk]);
          result.stage3.push({ cams: g.layout.length, lens: S.lens[lk].label, sight, label: g.label,
            res: await evaluate(L, S.seeds, sight, work) });
        }
      }
    }

    restoreDemoConfig();
    result.seconds = (performance.now() - t0) / 1000;
    result.runs = done;
    ui.progress(1, done + " runs · " + result.seconds.toFixed(0) + " s");
    return result;
  }

  // ---- Page ------------------------------------------------------------------
  const pct = (v) => (v === null || v === undefined ? "–" : (v * 100).toFixed(0) + "%");
  const num = (v, d) => (v === null || v === undefined ? "–" : v.toFixed(d === undefined ? 1 : d));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function scenCells(res) {
    return res.byScenario.map((s) => "<td>" + pct(s.reduction) + ' <span class="muted">(' + s.serOff + "→" + s.serOn + ")</span></td>").join("");
  }
  const SCEN_HEAD = "<th>Hotspot · E</th><th>Hotspot · W</th><th>Uniform · E</th><th>Uniform · W</th>";
  const METRIC_HEAD = "<th>Serious-hit cut (mean)</th><th>Worst scenario</th>" + SCEN_HEAD +
    "<th>Near-miss cut</th><th>Dangerous cut (hits+near)</th><th>Early detection</th><th>Protected time</th><th>Extra s / lap</th><th>Unneeded slowdown</th>";
  function metricCells(res) {
    return '<td class="strong">' + pct(res.reduction) + "</td><td>" + pct(res.worst) + "</td>" + scenCells(res) +
      "<td>" + pct(res.nearCut) + "</td><td>" + pct(res.dangerCut) + "</td>" +
      "<td>" + pct(res.early) + "</td><td>" + pct(res.protectedPct) + "</td><td>" + num(res.extraLap) + "</td><td>" + pct(res.unneeded) + "</td>";
  }

  function table(head, rows, sortable) {
    return '<div class="tbox"><table' + (sortable ? ' class="sortable"' : "") + "><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function render(r) {
    const out = document.getElementById("results");
    const s1 = r.stage1.map((x, i) => "<tr><td>" + (i + 1) + "</td><td>" + esc(x.label) + "</td>" + metricCells(x.res) + "</tr>").join("");
    const fin = r.finals.map((x) => "<tr><td>" + esc(x.name) + '<div class="muted small">' + esc(x.label) + "</div></td><td>" + x.res.cams + "</td>" + metricCells(x.res) + "</tr>").join("");
    const s3 = r.stage3.map((x) => "<tr><td>" + x.cams + "</td><td>" + esc(x.lens) + "</td><td>" + x.sight + "</td>" + metricCells(x.res) + "</tr>").join("");
    out.innerHTML =
      "<h2>Recommended layouts</h2><p class=\"muted\">Best layout found for each number of cameras (finals, " + S.finalSeeds.length +
      " seeds), drawn on the map. The bars show serious-hit reduction vs no system.</p>" +
      '<div class="layouts" id="layouts"></div>' +
      "<h2>Stage 2: number of cameras</h2>" +
      table("<th>Layout</th><th>Cameras</th>" + METRIC_HEAD, fin, false) +
      "<h2>Stage 1: one camera, " + r.stage1.length + " setups</h2><p class=\"muted\">Click a column to sort. " +
      "Each scenario cell shows the serious-hit reduction and the serious-hit count without → with (summed over " + S.seeds.length + " seeds). Serious = the car was faster than " + ((CFG.scenario && CFG.scenario.seriousKmh) || 30) + " km/h at contact.</p>" +
      table("<th>#</th><th>Camera</th>" + METRIC_HEAD, s1, true) +
      "<h2>Stage 3: sensitivity (lens, driver sight distance)</h2>" +
      table("<th>Cameras</th><th>Lens</th><th>Sight</th>" + METRIC_HEAD, s3, true);
    drawLayouts(r);
    wireSort();
  }

  // Small top-down drawings of the best layout per camera count.
  function drawLayouts(r) {
    const box = document.getElementById("layouts");
    r.finals.filter((f) => f.kind === "greedy").forEach((f) => {
      const card = document.createElement("div");
      card.className = "lcard";
      const c = document.createElement("canvas");
      c.width = 500; c.height = 260;
      card.appendChild(c);
      card.insertAdjacentHTML("beforeend", "<div><b>" + esc(f.name) + "</b> · serious-hit cut " + pct(f.res.reduction) +
        " (worst " + pct(f.res.worst) + ")</div>" +
        '<div class="bar"><span style="width:' + Math.max(0, f.res.reduction * 100).toFixed(1) + '%"></span></div>' +
        '<div class="muted small">' + esc(f.label) + "</div>");
      box.appendChild(card);
      drawMap(c, f.layout);
    });
  }

  function drawMap(c, layout) {
    const ctx = c.getContext("2d");
    const y0 = 150, y1 = 610; // logical band shown
    const sx = c.width / CFG.map.width, sy = c.height / (y1 - y0);
    const P = (p) => ({ x: p.x * sx, y: (p.y - y0) * sy });
    ctx.fillStyle = "#0d1a12"; ctx.fillRect(0, 0, c.width, c.height);
    // Hotspot band
    const h0 = P({ x: S.hotspot.x - S.hotspot.sd, y: y0 }), h1 = P({ x: S.hotspot.x + S.hotspot.sd, y: y0 });
    ctx.fillStyle = "rgba(255,176,32,0.07)"; ctx.fillRect(h0.x, 0, h1.x - h0.x, c.height);
    // Road
    const cl = CFG.road.centerline.map(P);
    ctx.strokeStyle = "#20262e"; ctx.lineWidth = CFG.road.roadWidth * sy;
    ctx.beginPath(); cl.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    ctx.strokeStyle = "#4a4230"; ctx.lineWidth = 1.5; ctx.setLineDash([8, 7]);
    ctx.beginPath(); cl.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.setLineDash([]);
    // Cameras + cones
    layout.forEach((cm) => {
      const poly = WW.geo.conePolygon(cm.x, cm.y, cm.facingAngleDeg, cm.fovDeg, cm.range).map(P);
      ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.fillStyle = "rgba(255,176,32,0.22)"; ctx.fill();
      ctx.strokeStyle = "rgba(255,176,32,0.6)"; ctx.lineWidth = 1; ctx.stroke();
      const p = P(cm); ctx.fillStyle = "#ffb020"; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = "rgba(200,208,220,0.6)"; ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("wildlife verge (north)", 8, 16); ctx.fillText("Hall 15 (south)", 8, c.height - 8);
    ctx.textAlign = "right"; ctx.fillText("shaded = crossing hotspot", c.width - 8, 16); ctx.textAlign = "left";
  }

  function wireSort() {
    document.querySelectorAll("table.sortable").forEach((tbl) => {
      tbl.querySelectorAll("th").forEach((th, col) => {
        th.addEventListener("click", () => {
          const body = tbl.tBodies[0];
          const rows = Array.from(body.rows);
          const key = (r) => { const v = parseFloat(r.cells[col].textContent); return isNaN(v) ? r.cells[col].textContent : v; };
          const dirn = th.dataset.dir === "desc" ? 1 : -1;
          th.dataset.dir = dirn === -1 ? "desc" : "asc";
          rows.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * dirn; });
          rows.forEach((r) => body.appendChild(r));
        });
      });
    });
  }

  function toCSV(r) {
    const head = ["stage", "name", "layout", "cameras", "lens", "sight", "serious_cut_mean", "serious_cut_worst",
      "hotspot_E", "hotspot_W", "uniform_E", "uniform_W", "serious_off", "serious_on", "near_cut", "danger_cut",
      "early_detection", "protected_time", "extra_s_per_lap", "unneeded_slowdown"];
    const row = (stage, name, label, res, lens, sight) => [stage, name, label, res.cams, lens || S.lens.today.label, sight || S.sights[0],
      res.reduction, res.worst].concat(res.byScenario.map((s) => s.reduction)).concat([res.seriousOff, res.seriousOn, res.nearCut, res.dangerCut, res.early, res.protectedPct, res.extraLap, res.unneeded]);
    const rows = []
      .concat(r.stage1.map((x) => row("1", "single", x.label, x.res)))
      .concat(r.finals.map((x) => row("2", x.name, x.label, x.res)))
      .concat(r.stage3.map((x) => row("3", x.cams + " cameras", x.label, x.res, x.lens, x.sight)));
    return [head].concat(rows).map((cols) => cols.map((v) => {
      v = typeof v === "number" ? +v.toFixed(4) : String(v);
      return /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
    }).join(",")).join("\n");
  }

  function init() {
    const btn = document.getElementById("run");
    const bar = document.querySelector("#progress span");
    const label = document.getElementById("progress-label");
    const status = document.getElementById("status");
    const csv = document.getElementById("csv");
    document.getElementById("settings").textContent =
      S.crossings + " animals per run (a group every " + S.meanGapSec + " s on average) · seeds: " + S.seeds.length + " (stage 1), " + S.greedySeeds.length + " (greedy), " +
      S.finalSeeds.length + " (finals) · step " + (1000 * S.dt).toFixed(0) + " ms · lens " + S.lens.today.label + ", sign visible from " + S.sights[0] + (QUICK ? " · QUICK MODE" : "");
    const ui = {
      progress: (f, text) => { bar.style.width = (f * 100).toFixed(1) + "%"; label.textContent = text; },
      status: (text) => { status.textContent = text; },
    };
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await runStudy(ui);
      window.STUDY = r;
      ui.status("Done.");
      render(r);
      csv.hidden = false;
      csv.onclick = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([toCSV(r)], { type: "text/csv" }));
        a.download = "camera-study.csv";
        document.body.appendChild(a); a.click(); a.remove();
      };
      btn.disabled = false;
    });
  }

  // Exposed for scripted runs (Playwright) and quick checks in the console.
  window.CameraStudy = { S, runOnce, evaluate, runStudy, schedule, toCSV, restoreDemoConfig };
  window.addEventListener("DOMContentLoaded", init);
})();
