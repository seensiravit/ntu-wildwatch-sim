/* main.js — bootstrap: two side-by-side worlds, game loop, controls + input.
 *
 * Split-screen before/after: the same scene runs twice, system OFF (left) and
 * ON (right). The animals are SHARED (one list, drawn on both maps), so both
 * drivers meet exactly the same crossings; each world has its own car,
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
    WW.stats.use(w);
    WW.car.use(w);
    WW.detection.use(w);
    WW.render.use(w);
  };

  // Attract / auto-demo state (SPEC purpose: read the flow in a few seconds).
  let hintEl = null;
  let idleMs = 0;
  let attractActive = false;
  let attractSpawnTimer = 0;
  let dragActive = false; // a tray chip is being dragged over a map

  function init() {
    WORLDS.forEach((w) => {
      w.canvas = document.getElementById("map-" + w.id);
      w.ctx = w.canvas.getContext("2d");
      // View size in CSS pixels (the render coordinate space); the backing store
      // is scaled by devicePixelRatio for crisp output on TVs / high-DPI laptops.
      w.view = { w: 1000, h: 700 };
    });

    hintEl = document.getElementById("hint");
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

  // Presenter shortcuts: Space = pause, R = reset.
  function wireKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.target && e.target.tagName === "INPUT") return; // don't hijack the slider
      // Leave keys alone inside the extension's UI (e.g. Space selects a map node).
      if (e.target && e.target.closest && e.target.closest("#ww-root, #ww-tabs-slot")) return;
      const k = e.key.toLowerCase();
      if (e.code === "Space" || k === " ") { e.preventDefault(); document.getElementById("btn-pause").click(); }
      else if (k === "r") { document.getElementById("btn-reset").click(); }
    });
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
    });
    lapWaitSec = 0;
  }

  // Both cars start each lap together, so they meet the same animals: the
  // OFF car (no slowdown) finishes first and waits off-map for the ON car.
  function syncLaps(dt) {
    if (WORLDS.some((w) => w.car.state.visible)) return;
    lapWaitSec += dt;
    if (lapWaitSec < WW.config.tuning.carRespawnDelaySec) return;
    lapWaitSec = 0;
    WORLDS.forEach((w) => { WW.useWorld(w); WW.car.startLap(); });
  }

  function loop(ts) {
    const dt = Math.min((ts - lastTs) / 1000, 0.05) || 0; // seconds, clamped
    lastTs = ts;

    if (!paused) {
      updateAttract(dt); // idle/spawn timing runs on real time
      // Slow the whole scene while the user is placing/aiming an animal.
      const placing = dragActive || WW.animals.list.some((a) => a.state === "placed");
      const sdt = dt * (placing ? WW.config.tuning.placingTimeScale : 1);
      WW.clock.ms += sdt * 1000;
      // Order matters: move the shared animals, then per world detect, then react.
      WW.animals.update(sdt);
      WORLDS.forEach((w) => {
        WW.useWorld(w);
        WW.detection.update();
        WW.car.update(sdt);
      });
      syncLaps(sdt);
    }

    // Draw every frame (even when paused, so drag/drop stays responsive).
    WORLDS.forEach((w) => {
      WW.useWorld(w);
      WW.render.frame(w.ctx, w.view.w, w.view.h);
    });
    WW.dashboard.update();

    requestAnimationFrame(loop);
  }

  // ---- Attract / auto-demo mode -----------------------------------------
  // After a spell of no interaction, the demo plays itself on a loop so a
  // passer-by sees the detect -> warn -> slow chain without touching anything.
  function updateAttract(dt) {
    const cfg = WW.config.attract;
    if (attractActive) {
      // Spawn animals from varied points until the concurrency cap is reached.
      // They are shared, so each one crosses both roads at once.
      attractSpawnTimer -= dt * 1000;
      if (attractSpawnTimer <= 0) {
        if (WW.animals.list.length < cfg.maxConcurrent) spawnAttractAnimal();
        attractSpawnTimer = cfg.spawnGapMs;
      }
    } else {
      idleMs += dt * 1000;
      if (idleMs >= cfg.idleStartMs && WW.animals.list.length === 0) startAttract();
    }
  }

  function startAttract() {
    attractActive = true;
    if (hintEl) hintEl.hidden = false;
    const hintText = document.getElementById("hint-text");
    if (hintText) hintText.textContent = "Drag an animal onto either road to try it yourself";
    attractSpawnTimer = 0;
  }

  function stopAttract() {
    attractActive = false;
    if (hintEl) hintEl.hidden = true;
  }

  // Spawn one auto-demo animal: random entry point + random species.
  function spawnAttractAnimal() {
    const pts = WW.config.attract.spawns;
    const p = pts[Math.floor(Math.random() * pts.length)];
    const sp = WW.config.species[Math.floor(Math.random() * WW.config.species.length)];
    const a = WW.animals.create(sp.id, p.x, p.y);
    if (a) { a.dirDeg = p.dirDeg; a.state = "walking"; }
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
    btnReset.addEventListener("click", () => { stopAttract(); resetAll(); idleMs = 0; clearDashboard(); });

    const btnLegend = document.getElementById("btn-legend");
    btnLegend.addEventListener("click", () => {
      const el = document.getElementById("legend");
      el.hidden = !el.hidden;
    });

    // Spawn-rate knob: level 1 (slow) .. 10 (fast) -> auto-demo spawn gap.
    // Changing it does NOT cancel the demo, so you can tune it live.
    const rate = document.getElementById("rate");
    if (rate) {
      const gapForLevel = (lvl) => Math.round(3000 / lvl); // ms between spawns
      rate.value = String(Math.max(1, Math.min(10,
        Math.round(3000 / WW.config.attract.spawnGapMs))));
      WW.config.attract.spawnGapMs = gapForLevel(Number(rate.value));
      rate.addEventListener("input", () => {
        WW.config.attract.spawnGapMs = gapForLevel(Number(rate.value));
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

    // The animals are shared, so editing them on one map shows on both.
    WORLDS.forEach((w) => wireCanvas(w.canvas));
  }

  function wireCanvas(canvas) {
    // Pointer events on the map -> animal drag/rotate/release (SPEC §5.2).
    canvas.addEventListener("pointerdown", (e) => {
      noteInteraction();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {} // keep events past the edge
      const p = toLogical(e, canvas);
      WW.animals.onPointerDown(p.x, p.y);
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = toLogical(e, canvas);
      WW.animals.onPointerMove(p.x, p.y);
    });
    canvas.addEventListener("pointerup", (e) => {
      const p = toLogical(e, canvas);
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
