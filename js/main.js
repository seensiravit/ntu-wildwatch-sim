/* main.js — bootstrap: two side-by-side worlds, game loop, controls + input.
 *
 * Split-screen before/after: the same scene runs twice, system OFF (left) and
 * ON (right). Every animal arrives on both sides at once as a pair of twins
 * (same id, path and boldness), so both drivers face the same arrivals; each
 * twin then reacts to its own side's car. Each world has its own animals, car,
 * cameras/signs state and scoreboard. The modules keep their per-world state
 * behind a use(world) switch, and WW.useWorld() points them all at one side
 * before it is updated or drawn.
 * Exposed: WW.worlds, WW.world (current), WW.useWorld, WW.clock, WW.system. */
(function () {
  const WW = window.WW || (window.WW = {});

  let paused = false;
  let lastTs = 0;
  let lapWaitSec = 0; // both cars off the map: time until the next shared lap
  // Simulation clock: only advances while running, so flashing + feeds freeze
  // on pause (SPEC §10). Read by render.js / dashboard.js / detection.js.
  WW.clock = { ms: 0 };

  // The two worlds. canvas/ctx/view are filled in by init(); the modules add
  // their own state (car, detection, stats, sigIntensity) on first use.
  WW.worlds = {
    off: { id: "off", systemOn: false },
    on: { id: "on", systemOn: true },
  };
  const WORLDS = [WW.worlds.off, WW.worlds.on];

  // Is the WildWatch system installed in the world being updated/drawn?
  WW.system = { get enabled() { return WW.world ? WW.world.systemOn : true; } };

  WW.useWorld = function (w) {
    WW.world = w;
    WW.animals.use(w);
    WW.stats.use(w);
    WW.car.use(w);
    WW.detection.use(w);
    WW.render.use(w);
  };

  // Attract / auto-demo state (SPEC purpose: read the flow in a few seconds).
  let hintEl = null;
  let idleMs = 0;
  let attractActive = false;
  let attractSec = 0;       // auto-demo clock (real time)
  let arrivals = null;      // WW.spawner stream feeding the auto-demo
  let dragActive = false;   // a tray chip is being dragged over a map

  // installation.html sets <body data-mode="installation">: the research values,
  // the recommended installation (config.installation) and a stream of cars both
  // ways instead of one lap at a time. index.html is the ordinary demo.
  const INSTALLATION = document.body.dataset.mode === "installation";
  let carStreams = null, trafficSec = 0;

  function init() {
    if (INSTALLATION) applyInstallation();
    WORLDS.forEach((w) => {
      w.canvas = document.getElementById("map-" + w.id);
      w.ctx = w.canvas.getContext("2d");
      // View size in CSS pixels (the render coordinate space); the backing store
      // is scaled by devicePixelRatio for crisp output on TVs / high-DPI laptops.
      w.view = { w: 1000, h: 700 };
    });

    hintEl = document.getElementById("hint");
    WW.animals.setWorlds(WORLDS); // every animal gets a twin on each side
    WW.dashboard.build();
    syncTopbarHeight();
    resizeCanvases(); // after build(): the dashboard strips decide how tall the maps can be
    window.addEventListener("resize", () => { syncTopbarHeight(); resizeCanvases(); });

    resetAll();
    wireControls();
    wireInput();
    wireKeyboard();
    // The extension builds its UI in its own DOMContentLoaded handler, which runs
    // after this one — so dock its tabs on the next tick.
    setTimeout(integrateDashboard, 0);

    requestAnimationFrame(loop);
  }

  // ---- Team DED dashboard extension (wildwatch-dashboard.js) ---------------
  // Move its "Simulation | DED Dashboard" tabs into our header so both views share
  // one top bar (CSS keeps the header above its overlay).
  function integrateDashboard() {
    const tabs = document.querySelector("#ww-root .ww-tabs");
    const slot = document.getElementById("ww-tabs-slot");
    if (!tabs || !slot || !window.WildWatch) return; // extension absent: nothing to do
    // Its tab colours come from CSS variables defined on #ww-root; carry them over
    // (read from its own styles, so they follow any palette change upstream).
    const rootStyle = getComputedStyle(document.getElementById("ww-root"));
    for (const name of ["--ww-panel2", "--ww-line", "--ww-text", "--ww-muted", "--ww-accent"]) {
      slot.style.setProperty(name, rootStyle.getPropertyValue(name));
    }
    slot.appendChild(tabs);
    WW.dashboard.buildDed(); // live OFF vs ON comparison card at the top of its page
    // Outside #ww-root its delegated click handler no longer sees the tabs, so
    // drive them through its public API instead.
    slot.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-view]");
      if (btn) window.WildWatch.show(btn.dataset.view === "dash" ? "dashboard" : "sim");
    });
    syncTopbarHeight();
    resizeCanvases(); // the header may have changed height
  }

  // Expose the header height to CSS so the extension's overlay starts below it.
  function syncTopbarHeight() {
    const h = document.getElementById("topbar").offsetHeight;
    document.documentElement.style.setProperty("--topbar-h", h + "px");
  }

  function clearDashboard() {
    try { if (window.WildWatch && typeof window.WildWatch.clear === "function") window.WildWatch.clear(); }
    catch (e) { /* never let the extension break Reset */ }
  }

  // Presenter shortcuts: Space = pause, R = reset, S = play / replay the preset
  // scenario, Esc = leave the scenario and return to the live demo.
  function wireKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.target && e.target.tagName === "INPUT") return; // don't hijack the slider
      // Leave keys alone inside the extension's UI (e.g. Space selects a map node).
      if (e.target && e.target.closest && e.target.closest("#ww-root, #ww-tabs-slot")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts (Ctrl+S, ...) stay theirs
      const k = e.key.toLowerCase();
      if (e.code === "Space" || k === " ") { e.preventDefault(); document.getElementById("btn-pause").click(); }
      else if (k === "r") { document.getElementById("btn-reset").click(); }
      else if (k === "s" && !INSTALLATION) { startScenario(); }
      else if (k === "escape" && WW.scenario.state.active) { leaveScenario(); }
    });
  }

  // ---- Preset scenario (js/scenario.js) ----------------------------------
  // A scripted 3-act comparison with identical animals on both maps. While it
  // plays there is no auto-demo and no random arrivals; the cars are held
  // off-map during each act's caption; at the end the sim freezes on a results
  // card until S (replay) or Esc / Reset (back to the live demo).
  function startScenario() {
    stopAttract();
    resetAll();
    hideScenarioCard();
    idleMs = 0;
    WW.scenario.start(WORLDS);
  }
  function leaveScenario() {
    WW.scenario.stop();
    hideScenarioCard();
    resetAll();
    idleMs = 0;
  }
  function hideScenarioCard() {
    const card = document.getElementById("scenario-card");
    if (card) { card.hidden = true; card.dataset.shown = ""; }
  }
  // Fill and show the results card once (scenario.state.results is set when done).
  function showScenarioCard() {
    const card = document.getElementById("scenario-card");
    const r = WW.scenario.state.results;
    if (!card || !r || card.dataset.shown === "1") return;
    card.dataset.shown = "1";
    const serious = WW.config.scenario.seriousKmh;
    const row = (label, a, b, unit) =>
      "<tr><td>" + label + '</td><td class="n off">' + (a === null ? "–" : a + (unit || "")) + '</td><td class="n on">' + (b === null ? "–" : b + (unit || "")) + "</td></tr>";
    const kmhList = (k) => (k.length ? " (at " + k.join(", ") + " km/h)" : "");
    const plural = (n, word, pl) => n + " " + (n === 1 ? word : pl || word + "s");
    const verdict =
      "<b>Without WildWatch:</b> " + plural(r.off.seriousHits, "serious hit") + kmhList(r.off.hitKmh.filter((v) => v > serious)) +
      " and " + plural(r.off.nearMiss, "near miss", "near misses") +
      (r.off.minorHits ? ", plus " + plural(r.off.minorHits, "low-speed contact") : "") + ". " +
      "<b>With it:</b> " + plural(r.on.seriousHits, "serious hit") + " and " + plural(r.on.nearMiss, "near miss", "near misses") +
      (r.on.minorHits ? ", plus " + plural(r.on.minorHits, "low-speed contact") + kmhList(r.on.hitKmh.filter((v) => v <= serious)) : "") +
      ". The same animals crossed both roads.";
    card.innerHTML =
      "<h2>Scenario complete</h2>" +
      '<p class="sub">Three scripted crossings, identical on both sides. Serious = the car was faster than ' + serious + " km/h when it touched the animal.</p>" +
      '<table><thead><tr><th></th><th style="text-align:right">System OFF</th><th style="text-align:right">System ON</th></tr></thead><tbody>' +
      row("Serious hits (over " + serious + " km/h)", r.off.seriousHits, r.on.seriousHits) +
      row("Low-speed contacts", r.off.minorHits, r.on.minorHits) +
      row("Near misses", r.off.nearMiss, r.on.nearMiss) +
      row("Safe passes", r.off.safe, r.on.safe) +
      row("Average speed at the animal", r.off.avgKmh, r.on.avgKmh, " km/h") +
      "</tbody></table>" +
      '<p class="verdict">' + verdict + "</p>" +
      '<p class="keys"><kbd>S</kbd> replay · <kbd>Esc</kbd> or <kbd>Reset</kbd> back to the live demo</p>';
    card.hidden = false;
  }

  // Match each backing store to its displayed size × DPR, then draw in CSS px.
  function resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    WORLDS.forEach((w) => {
      const rect = w.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      w.canvas.width = Math.round(rect.width * dpr);
      w.canvas.height = Math.round(rect.height * dpr);
      w.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 1 unit = 1 CSS px
      w.view.w = rect.width;
      w.view.h = rect.height;
    });
  }

  function resetAll() {
    WW.animals.clear();
    WORLDS.forEach((w) => {
      WW.useWorld(w);
      WW.car.reset();
      WW.detection.reset();
      WW.stats.reset();
      if (INSTALLATION) {
        w.car.state.visible = false; // the primary car is parked: the stream drives
        w.flow = { cars: 0, delaySum: 0 };
        w.recs = new Map();
        w.entry = {}; WW.car.dirs.forEach((d) => { w.entry[d] = []; });
      }
    });
    lapWaitSec = 0;
    if (INSTALLATION) {
      WW.flow = { off: WW.worlds.off.flow, on: WW.worlds.on.flow };
      const rnd = WW.spawner.mulberry32(Date.now() % 2147483647);
      carStreams = WW.car.dirs.map((d) => ({ dir: d, s: WW.spawner.createCarStream({ rnd: rnd, firstAtSec: 1 }) }));
      trafficSec = 0;
      // Warm the streams up with no animals, so the road already carries traffic
      // when the visitor's first animal arrives; the counters start from zero.
      const h = WW.config.installation.maxStepSec, warm = WW.config.installation.warmupSec || 0;
      for (let s = 0; s < warm; s += h) {
        trafficRelease(h);
        WORLDS.forEach((w) => { WW.useWorld(w); WW.car.update(h); });
        trafficRetire();
      }
      WORLDS.forEach((w) => { w.flow.cars = 0; w.flow.delaySum = 0; });
    }
  }

  // ---- Installation demo: research values, recommended installation, car streams ----
  function applyInstallation() {
    WW.applyResearch(WW.config);
    const inst = WW.config.installation;
    ["spawning", "traffic", "tuning"].forEach((k) => { if (inst[k]) WW.mergeConfig(WW.config[k], inst[k]); });
    if (inst.cameras) WW.config.cameras = JSON.parse(JSON.stringify(inst.cameras));
    // Texts built from the values they describe.
    const fill = (s) => s.replace("{scale}", String(inst.timeScale)).replace("{comply}", String(Math.round(WW.config.tuning.signCompliance * 100)));
    inst.hint = fill(inst.hint);
    const badge = document.getElementById("inst-badge");
    if (badge && inst.badge) badge.textContent = fill(inst.badge);
    // One sign per direction at the cameras' coverage edge, driven by every camera
    // (needs the routes, so build them once here; the dashboard then builds its
    // sign pills from these).
    WW.useWorld(WORLDS[0]);
    WW.car.reset();
    WW.config.signals = WW.car.directionSigns({ kerbOffset: inst.signKerbOffset, onePerDirection: true });
    const sc = document.getElementById("btn-scenario");
    if (sc) sc.hidden = true;
    const subs = document.querySelectorAll(".panel-head .panel-sub");
    if (subs[0] && inst.panelSub) subs[0].textContent = inst.panelSub.off;
    if (subs[1] && inst.panelSub) subs[1].textContent = inst.panelSub.on;
  }
  // Release cars from the per-direction streams into both worlds (twins: same
  // time, speed and compliance), admit those whose entry is clear.
  function trafficRelease(dt) {
    trafficSec += dt;
    carStreams.forEach((st) => st.s.due(trafficSec).forEach((ev) => WORLDS.forEach((w) => w.entry[st.dir].push(ev))));
    WORLDS.forEach((w) => {
      WW.useWorld(w);
      WW.car.dirs.forEach((d) => {
        const q = w.entry[d];
        while (q.length && WW.car.entryClear(d, q[0].cruiseKmh)) {
          const ev = q.shift();
          const car = WW.car.addCar({ dir: d, cruiseKmh: ev.cruiseKmh, complies: ev.complies });
          WW.car.startLap(car);
          w.recs.set(car, { releaseT: ev.t, cruiseKmh: ev.cruiseKmh, dir: d });
        }
      });
    });
  }
  // Retire cars that left the map and record their delay against free flow.
  function trafficRetire() {
    const unitsPerKmh = 1 / WW.config.tuning.unitsPerSecToKmh;
    WORLDS.forEach((w) => {
      WW.useWorld(w);
      for (const car of WW.car.cars.slice()) {
        const rec = w.recs.get(car);
        if (!rec || car.state.visible) continue;
        const free = WW.car.routeOf(rec.dir).total / (rec.cruiseKmh * unitsPerKmh);
        w.flow.cars++; w.flow.delaySum += Math.max(0, trafficSec - rec.releaseT - free);
        w.recs.delete(car); WW.car.removeCar(car);
      }
    });
  }

  // Both cars start each lap together, so they meet the same animals: the
  // OFF car (no slowdown) finishes first and waits off-map for the ON car.
  // `hold` (from the scenario's caption phase) keeps the cars waiting and, once
  // released, starts the lap at once rather than after the respawn delay.
  function syncLaps(dt, hold) {
    if (WORLDS.some((w) => w.car.state.visible)) return;
    if (hold) { lapWaitSec = WW.config.tuning.carRespawnDelaySec; return; }
    lapWaitSec += dt;
    if (lapWaitSec < WW.config.tuning.carRespawnDelaySec) return;
    lapWaitSec = 0;
    WORLDS.forEach((w) => { WW.useWorld(w); WW.car.startLap(); });
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05) || 0; // seconds, clamped
    lastTs = ts;

    // The preset scenario replaces the auto-demo while it plays, and freezes the
    // sim (drawing continues) once it is done, until S (replay) or Esc / Reset.
    const sc = WW.scenario.state;
    if (!paused && sc.phase !== "done") {
      // The installation demo runs fast-forwarded (config.installation.timeScale).
      const scale = INSTALLATION ? WW.config.installation.timeScale : 1;
      if (!sc.active) updateAttract(dt, scale); // idle timing on real time, arrivals on scaled time
      // Slow the whole scene while the user is placing/aiming an animal.
      const placing = dragActive || WORLDS.some((w) => w.animals.some((a) => a.state === "placed"));
      const sdt = dt * scale * (placing ? WW.config.tuning.placingTimeScale : 1);
      WW.clock.ms += sdt * 1000;
      // Order matters, per world: move the animals (they react to that side's
      // car), detect, then the car reacts.
      const step = (h) => WORLDS.forEach((w) => {
        WW.useWorld(w);
        WW.animals.update(h);
        WW.detection.update();
        WW.car.update(h);
      });
      if (INSTALLATION) {
        // Sub-step so the car dynamics stay stable at high speed.
        const n = Math.max(1, Math.ceil(sdt / WW.config.installation.maxStepSec));
        for (let i = 0; i < n; i++) { trafficRelease(sdt / n); step(sdt / n); trafficRetire(); }
      } else {
        step(sdt);
        const hold = sc.active ? WW.scenario.update(sdt) : false;
        syncLaps(sdt, hold);
      }
    }
    if (sc.phase === "done") showScenarioCard();

    // Draw every frame (even when paused, so drag/drop stays responsive).
    WORLDS.forEach((w) => {
      WW.useWorld(w);
      WW.render.frame(w.ctx, w.view.w, w.view.h);
    });
    syncHint();
    WW.dashboard.update();

    requestAnimationFrame(loop);
  }

  // ---- Attract / auto-demo mode -----------------------------------------
  // After a spell of no interaction, the demo plays itself on a loop so a
  // passer-by sees the detect -> warn -> slow chain without touching anything.
  // Animals arrive from WW.spawner: groups as a Poisson process around the
  // crossing hotspot (config.spawning). Each arrival appears on both sides.
  function updateAttract(dt, scale) {
    if (attractActive) {
      attractSec += dt * (scale || 1);
      const onScreen = Math.max.apply(null, WORLDS.map((w) => w.animals.length));
      arrivals.due(attractSec).forEach((ev) => {
        if (onScreen >= WW.config.spawning.maxConcurrent) return; // safety cap
        WW.animals.spawn(Object.assign({}, ev, { state: "walking" }));
      });
    } else {
      idleMs += dt * 1000;
      const empty = WORLDS.every((w) => w.animals.length === 0);
      if (idleMs >= WW.config.attract.idleStartMs && empty) startAttract();
      // An animal left "placed" keeps the scene in slow motion and the auto-demo
      // off; after a long idle spell clear it so the kiosk recovers on its own.
      else if (idleMs >= WW.config.attract.placedTimeoutMs && !dragActive && WORLDS.every((w) => w.animals.every((a) => a.state === "placed"))) resetAll();
    }
  }

  // The hint pill: an invitation during the auto-demo, and how-to while an animal
  // is placed (the scene runs in slow motion until it is released).
  let hintShown = null;
  function syncHint() {
    const placing = WORLDS.some((w) => w.animals.some((a) => a.state === "placed"));
    const sc = WW.scenario.state;
    const text = placing ? "Drag the arrow to aim, then click the animal to let it go"
      : sc.active && sc.phase !== "done" ? sc.title + " — " + sc.caption
      : attractActive ? (INSTALLATION ? WW.config.installation.hint : "Drag an animal onto either road to try it yourself") : null;
    if (text === hintShown || !hintEl) return;
    hintShown = text;
    hintEl.hidden = !text;
    if (text) document.getElementById("hint-text").textContent = text;
  }

  function startAttract() {
    attractActive = true;
    attractSec = 0;
    arrivals = WW.spawner.createStream({
      rnd: WW.spawner.mulberry32(Date.now() % 2147483647),
      firstAtSec: WW.config.attract.firstGroupSec,
      meanGapSec: () => WW.config.spawning.meanGapSec, // follows the knob live
    });
  }

  function stopAttract() {
    attractActive = false;
  }

  // Any real interaction cancels the auto-demo and hands control to the visitor.
  function noteInteraction() {
    idleMs = 0;
    if (attractActive) { stopAttract(); resetAll(); }
  }

  function wireControls() {
    const btnPause = document.getElementById("btn-pause");
    const btnReset = document.getElementById("btn-reset");
    // Pause is a meta-control: it keeps the scoreboard and any running auto-demo.
    btnPause.addEventListener("click", () => {
      idleMs = 0;
      paused = !paused;
      btnPause.textContent = paused ? "▶ Play" : "⏸ Pause";
    });
    // Reset is the only control that clears the scoreboards + scene.
    // (Also wipes the DED dashboard's saved history — kept out of resetAll() so a
    // page load or the first interaction after the auto-demo doesn't erase it.)
    btnReset.addEventListener("click", () => { stopAttract(); WW.scenario.stop(); hideScenarioCard(); resetAll(); idleMs = 0; clearDashboard(); });

    const btnScenario = document.getElementById("btn-scenario");
    if (btnScenario && !INSTALLATION) btnScenario.addEventListener("click", startScenario);

    const btnLegend = document.getElementById("btn-legend");
    btnLegend.addEventListener("click", () => {
      const el = document.getElementById("legend");
      el.hidden = !el.hidden;
    });

    // Animal-activity knob: level 1 (quiet) .. 10 (busy) -> mean gap between
    // arriving groups, knobBaseSec / level (demo: 48 s, so level 4 = one group
    // every 12 s; installation demo: 120 s). Changing it does NOT cancel the
    // demo, so you can tune it live.
    const rate = document.getElementById("rate");
    if (rate) {
      const base = INSTALLATION ? WW.config.installation.knobBaseSec : WW.config.attract.knobBaseSec;
      const gapForLevel = (lvl) => base / lvl;
      rate.value = String(Math.max(1, Math.min(10, Math.round(base / WW.config.spawning.meanGapSec))));
      WW.config.spawning.meanGapSec = gapForLevel(Number(rate.value));
      rate.addEventListener("input", () => {
        WW.config.spawning.meanGapSec = gapForLevel(Number(rate.value));
      });
    }
  }

  // Map canvas coordinates (CSS pixels) -> logical map units. Both maps show
  // the same logical area, so a point means the same spot on either side.
  function toLogical(evt, canvas) {
    const r = canvas.getBoundingClientRect();
    const cx = (evt.clientX - r.left) / r.width;
    const cy = (evt.clientY - r.top) / r.height;
    return { x: cx * WW.config.map.width, y: cy * WW.config.map.height };
  }

  function wireInput() {
    // Drag a species chip from the tray (SPEC §5.2 step 1); drop it on either map.
    document.querySelectorAll(".tray-chip").forEach((chip) => {
      chip.addEventListener("dragstart", (e) => {
        noteInteraction();
        dragActive = true; // slow the scene while dragging
        e.dataTransfer.setData("text/plain", chip.dataset.species);
        e.dataTransfer.effectAllowed = "copy";
      });
      chip.addEventListener("dragend", () => { dragActive = false; });
    });

    // Edits on either map apply to the animal and its twin on the other side.
    WORLDS.forEach((w) => wireCanvas(w.canvas, w));
  }

  function wireCanvas(canvas, world) {
    // Pointer events on the map -> animal drag/rotate/release (SPEC §5.2).
    // Select this map's world first: the render loop switches worlds every frame.
    canvas.addEventListener("pointerdown", (e) => {
      noteInteraction();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {} // keep events past the edge
      const p = toLogical(e, canvas);
      WW.useWorld(world);
      WW.animals.onPointerDown(p.x, p.y, WW.config.map.width / canvas.getBoundingClientRect().width);
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = toLogical(e, canvas);
      WW.useWorld(world);
      WW.animals.onPointerMove(p.x, p.y);
    });
    canvas.addEventListener("pointerup", (e) => {
      const p = toLogical(e, canvas);
      WW.useWorld(world);
      WW.animals.onPointerUp(p.x, p.y);
    });

    canvas.addEventListener("dragover", (e) => {
      e.preventDefault();
      dragActive = true;
      e.dataTransfer.dropEffect = "copy";
    });
    canvas.addEventListener("dragleave", () => { dragActive = false; });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      dragActive = false;
      const speciesId = e.dataTransfer.getData("text/plain");
      if (!speciesId) return;
      const p = toLogical(e, canvas);
      WW.animals.create(speciesId, p.x, p.y);
    });
  }

  window.addEventListener("DOMContentLoaded", init);
})();
