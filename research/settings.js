/* settings.js — settings study: system OFF vs ON under many parameter settings.
 *
 * Runs the split-screen demo headlessly (two worlds sharing the same arrivals,
 * exactly like js/main.js) for N simulated minutes per seed, for every setting
 * in a one-factor-at-a-time grid around today's config. Two questions:
 *   1. Best system:      fewest serious hits (> 30 km/h) and near misses on the ON side.
 *   2. Clearest contrast: biggest OFF -> ON reduction in serious hits and near misses.
 * Then a combined check: the best level of each factor the system controls, together.
 * Results: on the page, as CSV, and on window.SETTINGS_STUDY. Also runnable from
 * Node (window.SettingsStudy.run). Classic script (file:// safe), no dependencies. */
(function () {
  const WW = window.WW;
  const CFG = WW.config;
  const QUICK = /[?&]quick\b/.test((window.location && window.location.search) || "");

  const S = {
    dt: 1 / 60,
    minutes: QUICK ? 5 : 20,                                   // simulated minutes per run
    seeds: QUICK ? [101, 102] : range(101, 110),               // per setting
    combinedSeeds: QUICK ? [101, 102] : range(101, 120),       // for the combined check (and its baseline)
    seriousKmh: 30,                                            // a hit above this speed is "serious"
  };
  function range(a, b) { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; }

  // ---- Settings grid ---------------------------------------------------------
  // Each setting mutates fresh copies of the config (restore() runs first) and may
  // give run options { xDist }. `system` marks factors the system designer controls.
  const cam = (x, y, deg) => (c) => { Object.assign(c.cameras[0], { x: x, y: y, facingAngleDeg: deg }); };
  const bold = (k) => (c) => c.species.forEach((sp) => {
    sp.traffic.cross = Math.min(0.95, sp.traffic.cross * k);
    sp.traffic.wait = Math.min(sp.traffic.wait, 1 - sp.traffic.cross);
  });
  const SETTINGS = [
    { id: "base", factor: "baseline", label: "today's settings", apply: () => {} },
    { id: "range150", factor: "camera range", system: true, label: "camera range 150", apply: (c) => { c.cameras[0].range = 150; } },
    { id: "range350", factor: "camera range", system: true, label: "camera range 350", apply: (c) => { c.cameras[0].range = 350; } },
    { id: "fov60", factor: "camera field of view", system: true, label: "camera 60° view", apply: (c) => { c.cameras[0].fovDeg = 60; } },
    { id: "fov110", factor: "camera field of view", system: true, label: "camera 110° view", apply: (c) => { c.cameras[0].fovDeg = 110; } },
    { id: "camE", factor: "camera placement", system: true, label: "camera x 400 centreline facing E", apply: cam(400, 380, 0) },
    { id: "camS", factor: "camera placement", system: true, label: "camera x 490 south verge facing N", apply: cam(490, 430, 270) },
    { id: "sight320", factor: "sign visible from", system: true, label: "sign visible from 320", apply: (c) => { c.tuning.signSightDistance = 320; } },
    { id: "sight640", factor: "sign visible from", system: true, label: "sign visible from 640", apply: (c) => { c.tuning.signSightDistance = 640; } },
    { id: "line80", factor: "warned driver", system: true, label: "stop line 80 before the area", apply: (c) => { c.tuning.stopBeforeArea = 80; } },
    { id: "nostop", factor: "warned driver", system: true, label: "slow to 20 km/h only (no stop line)", apply: (c) => { c.tuning.stopForSign = false; } },
    { id: "warn30", factor: "warned speed", system: true, label: "warned speed 30 km/h", apply: (c) => { c.tuning.warnKmh = 30; } },
    { id: "light230", factor: "driver's headlights", label: "headlights 230 (sees 32 m)", apply: (c) => { c.tuning.headlight.range = 230; } },
    { id: "react11", factor: "reaction time", label: "reaction 1.1 / 0.7 s (research means)", apply: (c) => { c.tuning.driverReactionSec = 1.1; c.tuning.alertReactionSec = 0.7; } },
    { id: "cruise40", factor: "cruise speed", label: "cruise 40 km/h", apply: (c) => { c.tuning.cruiseKmh = 40; } },
    { id: "cruise60", factor: "cruise speed", label: "cruise 60 km/h", apply: (c) => { c.tuning.cruiseKmh = 60; } },
    { id: "gap6", factor: "animal activity", label: "a group every 6 s (busy)", apply: (c) => { c.spawning.meanGapSec = 6; } },
    { id: "gap24", factor: "animal activity", label: "a group every 24 s (quiet)", apply: (c) => { c.spawning.meanGapSec = 24; } },
    { id: "shy", factor: "animal boldness", label: "animals half as bold", apply: bold(0.5) },
    { id: "boldx", factor: "animal boldness", label: "animals 1.5× as bold", apply: bold(1.5) },
    { id: "uniform", factor: "crossing pattern", label: "crossings anywhere along the road", apply: () => {},
      xDist: (rnd) => 60 + rnd() * 880 },
  ];

  // ---- Config snapshot / restore -----------------------------------------------
  const KEYS = ["cameras", "signals", "tuning", "species", "spawning", "crossing"];
  const BASE = JSON.parse(JSON.stringify(pick(CFG, KEYS)));
  function pick(o, keys) { const out = {}; keys.forEach((k) => { out[k] = o[k]; }); return out; }
  function restore() { Object.assign(CFG, JSON.parse(JSON.stringify(BASE))); }

  // ---- Hit-speed hook: record the car's speed at every contact -----------------
  let curWorld = null;
  const origEnc = WW.stats.onEncounter, origUp = WW.stats.upgradeToHit;
  WW.stats.onEncounter = function (kind, x, y, kmh) {
    if (kind === "hit" && curWorld) curWorld.m.hitKmh.push(WW.car.currentKmh());
    return origEnc.apply(this, arguments);
  };
  WW.stats.upgradeToHit = function () {
    if (curWorld) curWorld.m.hitKmh.push(WW.car.currentKmh());
    return origUp.apply(this, arguments);
  };

  // ---- One twin run (mirrors the loop in js/main.js) -----------------------------
  function runTwin(seed, minutes, opts) {
    const worlds = [{ id: "off", systemOn: false }, { id: "on", systemOn: true }];
    WW.system = { get enabled() { return curWorld ? curWorld.systemOn : true; } };
    WW.clock = { ms: 0 };
    const use = (w) => { curWorld = w; WW.animals.use(w); WW.stats.use(w); WW.car.use(w); WW.detection.use(w); };
    WW.animals.setWorlds(worlds);
    worlds.forEach((w) => {
      use(w); WW.car.reset(); WW.detection.reset(); WW.stats.reset();
      w.m = { hitKmh: [], laps: 0, lapSum: 0, lapStart: 0, lineWait: 0, crossings: 0, reached: new Set() };
    });
    const stream = WW.spawner.createStream({
      rnd: WW.spawner.mulberry32(seed), firstAtSec: 1,
      meanGapSec: () => CFG.spawning.meanGapSec, xDist: opts && opts.xDist,
    });
    const dt = S.dt, end = minutes * 60, halfRoad = CFG.road.roadWidth / 2;
    let t = 0, lapWait = 0;
    while (t < end) {
      t += dt; WW.clock.ms += dt * 1000;
      const onScreen = Math.max.apply(null, worlds.map((w) => w.animals.length));
      stream.due(t).forEach((ev) => { if (onScreen < CFG.spawning.maxConcurrent) WW.animals.spawn(Object.assign({}, ev, { state: "walking" })); });
      worlds.forEach((w) => {
        use(w);
        WW.animals.update(dt);
        WW.detection.update();
        const c = w.car.state, wasVisible = c.visible;
        WW.car.update(dt);
        if (c.visible && c.speedUnitsPerSec < 0.5 && c.lineWaitSec > 0) w.m.lineWait += dt;
        if (wasVisible && !c.visible) { w.m.laps++; w.m.lapSum += t - w.m.lapStart; }
        for (const a of w.animals) {
          if (!w.m.reached.has(a.id) && WW.geo.distToPolyline(a.x, a.y, CFG.road.centerline) <= halfRoad) { w.m.reached.add(a.id); w.m.crossings++; }
        }
      });
      if (!worlds.some((w) => w.car.state.visible)) {
        lapWait += dt;
        if (lapWait >= CFG.tuning.carRespawnDelaySec) { lapWait = 0; worlds.forEach((w) => { use(w); WW.car.startLap(); w.m.lapStart = t; }); }
      }
    }
    curWorld = null;
    return worlds.map((w) => {
      const st = w.stats, m = w.m;
      return {
        hits: st.hits, serious: m.hitKmh.filter((k) => k > S.seriousKmh).length, crawl: m.hitKmh.filter((k) => k < 5).length,
        near: st.nearMiss, safe: st.safe, back: st.turnedBack, speedSum: st.speedSum, speedCount: st.speedCount,
        laps: m.laps, lapSum: m.lapSum, lineWait: m.lineWait, crossings: m.crossings,
      };
    });
  }

  // ---- Evaluate a setting over seeds ------------------------------------------------
  async function evaluate(setting, seeds, work) {
    const perSeed = [];
    for (const seed of seeds) {
      restore(); setting.apply(CFG);
      const [off, on] = runTwin(seed, S.minutes, setting);
      perSeed.push({ seed, off, on });
      await work();
    }
    restore();
    return summarise(setting, perSeed);
  }

  const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
  function side(rows) {
    const o = {};
    ["hits", "serious", "crawl", "near", "safe", "back", "speedSum", "speedCount", "laps", "lapSum", "lineWait", "crossings"].forEach((k) => { o[k] = sum(rows, k); });
    const per100 = (v) => (o.crossings ? (100 * v) / o.crossings : 0);
    return {
      hits: o.hits, serious: o.serious, crawl: o.crawl, near: o.near, safe: o.safe, back: o.back, crossings: o.crossings,
      hitsPer100: per100(o.hits), seriousPer100: per100(o.serious), nearPer100: per100(o.near),
      avgKmh: o.speedCount ? o.speedSum / o.speedCount : null,
      lapSec: o.laps ? o.lapSum / o.laps : null,
      lineWaitPerLap: o.laps ? o.lineWait / o.laps : 0,
    };
  }
  const cut = (a, b) => (a ? 1 - b / a : 0);
  // Seed-bootstrap 95% interval for the serious-hit reduction.
  function bootstrap(perSeed, key) {
    const n = perSeed.length, rnd = WW.spawner.mulberry32(7), vals = [];
    for (let i = 0; i < 1000; i++) {
      let a = 0, b = 0;
      for (let j = 0; j < n; j++) { const r = perSeed[Math.floor(rnd() * n)]; a += r.off[key]; b += r.on[key]; }
      vals.push(cut(a, b));
    }
    vals.sort((x, y) => x - y);
    return [vals[Math.floor(0.025 * vals.length)], vals[Math.floor(0.975 * vals.length)]];
  }
  function summarise(setting, perSeed) {
    const off = side(perSeed.map((r) => r.off)), on = side(perSeed.map((r) => r.on));
    return {
      id: setting.id, factor: setting.factor, label: setting.label, system: !!setting.system, seeds: perSeed.length,
      off, on,
      seriousCut: cut(off.seriousPer100, on.seriousPer100), seriousCutCI: bootstrap(perSeed, "serious"),
      nearCut: cut(off.nearPer100, on.nearPer100), hitCut: cut(off.hitsPer100, on.hitsPer100),
      lapCostSec: off.lapSec !== null && on.lapSec !== null ? on.lapSec - off.lapSec : null,
      perSeed,
    };
  }

  // ---- The study ----------------------------------------------------------------------
  async function run(ui) {
    const t0 = Date.now();
    const total = SETTINGS.length * S.seeds.length + 2 * S.combinedSeeds.length;
    let done = 0, lastYield = Date.now();
    const work = async () => {
      done++;
      if (Date.now() - lastYield > 100) {
        ui.progress(done / total, done + " / " + total + " runs · " + Math.round((Date.now() - t0) / 1000) + " s");
        await new Promise((r) => setTimeout(r, 0));
        lastYield = Date.now();
      }
    };
    const result = { settings: S, minutes: S.minutes, grid: [], combined: null, baseline20: null };

    for (const st of SETTINGS) {
      ui.status("Grid: " + st.label);
      result.grid.push(await evaluate(st, S.seeds, work));
    }

    // Combined: per system-controlled factor, the level with the fewest serious ON hits
    // per 100 crossings (the baseline level counts too).
    const base = result.grid.find((g) => g.id === "base");
    const factors = {};
    result.grid.filter((g) => g.system).forEach((g) => { (factors[g.factor] = factors[g.factor] || []).push(g); });
    const picks = [];
    Object.keys(factors).forEach((f) => {
      const best = factors[f].concat([Object.assign({}, base, { factor: f })]).sort((a, b) => a.on.seriousPer100 - b.on.seriousPer100)[0];
      if (best.id !== "base") picks.push(SETTINGS.find((s) => s.id === best.id));
    });
    const combined = {
      id: "combined", factor: "combined", system: true,
      label: picks.length ? "best per factor: " + picks.map((p) => p.label).join(" + ") : "baseline (no factor beat it)",
      apply: (c) => picks.forEach((p) => p.apply(c)),
    };
    ui.status("Combined check (" + S.combinedSeeds.length + " seeds): " + combined.label);
    result.combined = await evaluate(combined, S.combinedSeeds, work);
    ui.status("Baseline on the same " + S.combinedSeeds.length + " seeds");
    result.baseline20 = await evaluate(SETTINGS[0], S.combinedSeeds, work);

    result.seconds = (Date.now() - t0) / 1000;
    result.runs = done;
    ui.progress(1, done + " runs · " + Math.round(result.seconds) + " s");
    return result;
  }

  // ---- Page ------------------------------------------------------------------------
  const pct = (v) => (v === null || v === undefined ? "–" : Math.round(v * 100) + "%");
  const num = (v, d) => (v === null || v === undefined ? "–" : v.toFixed(d === undefined ? 1 : d));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function row(g, hl) {
    return "<tr" + (hl ? ' class="hl"' : "") + "><td>" + esc(g.label) + '<div class="muted small">' + esc(g.factor) + "</div></td>" +
      '<td class="n">' + num(g.off.seriousPer100) + '</td><td class="n">' + num(g.on.seriousPer100) + "</td>" +
      '<td class="n strong">' + pct(g.seriousCut) + ' <span class="muted small">[' + pct(g.seriousCutCI[0]) + "…" + pct(g.seriousCutCI[1]) + "]</span></td>" +
      '<td class="n">' + num(g.off.nearPer100) + " → " + num(g.on.nearPer100) + " (" + pct(g.nearCut) + ")</td>" +
      '<td class="n">' + num(g.off.hitsPer100) + " → " + num(g.on.hitsPer100) + " (" + pct(g.hitCut) + ")</td>" +
      '<td class="n">' + num(g.off.avgKmh, 0) + " → " + num(g.on.avgKmh, 0) + "</td>" +
      '<td class="n">' + (g.lapCostSec === null ? "–" : "+" + num(g.lapCostSec)) + "</td>" +
      '<td class="n">' + num(g.on.lineWaitPerLap) + "</td></tr>";
  }
  const HEAD = "<tr><th>Setting</th><th class=\"n\">OFF serious hits /100</th><th class=\"n\">ON serious hits /100</th>" +
    "<th class=\"n\">Serious-hit cut [95% CI]</th><th class=\"n\">Near misses /100 (cut)</th><th class=\"n\">All hits /100 (cut)</th>" +
    "<th class=\"n\">Avg km/h at animal</th><th class=\"n\">ON lap +s</th><th class=\"n\">Wait at line s/lap</th></tr>";

  function render(r) {
    const out = document.getElementById("results");
    const bySystem = r.grid.slice().sort((a, b) => a.on.seriousPer100 - b.on.seriousPer100);
    const byContrast = r.grid.slice().sort((a, b) => b.seriousCut - a.seriousCut);
    out.innerHTML =
      "<h2>Combined check</h2><p class=\"muted\">" + esc(r.combined.label) + " · " + r.combined.seeds + " seeds each</p>" +
      '<div class="tbox"><table><thead>' + HEAD + "</thead><tbody>" + row(r.baseline20) + row(r.combined, true) + "</tbody></table></div>" +
      "<h2>Goal 1: best system (fewest serious ON hits per 100 crossings)</h2>" +
      '<div class="tbox"><table><thead>' + HEAD + "</thead><tbody>" + bySystem.map((g) => row(g, g.id === "base")).join("") + "</tbody></table></div>" +
      "<h2>Goal 2: clearest contrast (largest serious-hit cut OFF → ON)</h2>" +
      '<canvas id="bars" width="1100" height="' + (28 * byContrast.length + 30) + '"></canvas>' +
      '<div class="tbox"><table><thead>' + HEAD + "</thead><tbody>" + byContrast.map((g) => row(g, g.id === "base")).join("") + "</tbody></table></div>" +
      '<p class="muted small">Per 100 crossings = per 100 animals that reached the road on that side, so busy and quiet settings compare fairly. Serious = the car was faster than ' + S.seriousKmh + " km/h at contact. " +
      r.runs + " runs in " + Math.round(r.seconds) + " s.</p>";
    drawBars(byContrast);
  }

  function drawBars(rows) {
    const c = document.getElementById("bars"), ctx = c.getContext("2d");
    const left = 330, w = c.width - left - 60, rowH = 28;
    ctx.fillStyle = "#121821"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = "12px system-ui, sans-serif"; ctx.textBaseline = "middle";
    rows.forEach((g, i) => {
      const y = 15 + i * rowH;
      ctx.fillStyle = g.id === "base" ? "#ffb020" : "#cfd8e3"; ctx.textAlign = "right";
      ctx.fillText(g.label.length > 44 ? g.label.slice(0, 43) + "…" : g.label, left - 10, y);
      const x0 = left + w * 0.5; // zero in the middle so negative cuts show
      const len = Math.max(-1, Math.min(1, g.seriousCut)) * w * 0.5;
      ctx.fillStyle = g.seriousCut >= 0 ? "#46d17f" : "#ff6a5f";
      ctx.fillRect(Math.min(x0, x0 + len), y - 9, Math.abs(len), 18);
      ctx.strokeStyle = "#7c8aa0"; ctx.lineWidth = 1;
      const lo = x0 + Math.max(-1, g.seriousCutCI[0]) * w * 0.5, hi = x0 + Math.min(1, g.seriousCutCI[1]) * w * 0.5;
      ctx.beginPath(); ctx.moveTo(lo, y); ctx.lineTo(hi, y); ctx.stroke();
      ctx.fillStyle = "#cfd8e3"; ctx.textAlign = "left";
      ctx.fillText(pct(g.seriousCut), Math.max(x0, x0 + len) + 6, y);
    });
    ctx.strokeStyle = "#223042"; ctx.beginPath(); ctx.moveTo(left + w * 0.5, 0); ctx.lineTo(left + w * 0.5, c.height); ctx.stroke();
  }

  function toCSV(r) {
    const head = ["id", "factor", "setting", "seeds", "off_crossings", "off_hits", "off_serious", "off_crawl", "off_near", "off_safe", "off_turned_back", "off_avg_kmh", "off_lap_s",
      "on_crossings", "on_hits", "on_serious", "on_crawl", "on_near", "on_safe", "on_turned_back", "on_avg_kmh", "on_lap_s", "on_wait_at_line_s_per_lap",
      "serious_cut", "serious_cut_lo", "serious_cut_hi", "near_cut", "hit_cut"];
    const sideCols = (s) => [s.crossings, s.hits, s.serious, s.crawl, s.near, s.safe, s.back, s.avgKmh, s.lapSec];
    const rows = r.grid.concat([r.baseline20, r.combined]).map((g) =>
      [g.id, g.factor, g.label, g.seeds].concat(sideCols(g.off), sideCols(g.on), [g.on.lineWaitPerLap, g.seriousCut, g.seriousCutCI[0], g.seriousCutCI[1], g.nearCut, g.hitCut]));
    return [head].concat(rows).map((cols) => cols.map((v) => {
      if (typeof v === "number") v = +v.toFixed(4);
      v = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(",")).join("\n");
  }

  function init() {
    const btn = document.getElementById("run"), bar = document.querySelector("#progress span");
    const label = document.getElementById("progress-label"), status = document.getElementById("status"), csv = document.getElementById("csv");
    document.getElementById("settings").textContent =
      SETTINGS.length + " settings × " + S.seeds.length + " seeds × " + S.minutes + " simulated minutes, both sides; combined check with " +
      S.combinedSeeds.length + " seeds" + (QUICK ? " · QUICK MODE" : "");
    const ui = {
      progress: (f, text) => { bar.style.width = (f * 100).toFixed(1) + "%"; label.textContent = text; },
      status: (text) => { status.textContent = text; },
    };
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await run(ui);
      window.SETTINGS_STUDY = r;
      ui.status("Done.");
      render(r);
      csv.hidden = false;
      csv.onclick = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([toCSV(r)], { type: "text/csv" }));
        a.download = "settings-study.csv";
        document.body.appendChild(a); a.click(); a.remove();
      };
      btn.disabled = false;
    });
  }

  window.SettingsStudy = { S, SETTINGS, run, evaluate, runTwin, toCSV, restore };
  if (window.addEventListener && typeof document !== "undefined") window.addEventListener("DOMContentLoaded", init);
})();
