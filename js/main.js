/* main.js — bootstrap: canvas setup, game loop, controls + input wiring.
 * The loop and static render run now; entity updates are wired to the stubs.
 * Exposed side effects only (no global export). */
(function () {
  const WW = window.WW || (window.WW = {});

  let canvas, ctx;
  let paused = false;
  let lastTs = 0;
  // Simulation clock: only advances while running, so flashing + feeds freeze
  // on pause (SPEC §10). Read by render.js / dashboard.js / detection.js.
  WW.clock = { ms: 0 };
  // View size in CSS pixels (the render coordinate space); backing store is
  // scaled by devicePixelRatio for crisp output on TVs / high-DPI laptops.
  WW.view = { w: 1000, h: 700 };
  // Before/after state: is the WildWatch system installed & running?
  WW.system = { enabled: true };

  // Attract / auto-demo state (SPEC purpose: read the flow in a few seconds).
  let hintEl = null;
  let idleMs = 0;
  let attractActive = false;
  let attractSpawnTimer = 0;
  let dragActive = false; // a tray chip is being dragged over the map

  function init() {
    canvas = document.getElementById("map");
    ctx = canvas.getContext("2d");

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    hintEl = document.getElementById("hint");
    WW.system.enabled = WW.config.system.defaultEnabled;
    WW.dashboard.build();
    resetAll();
    wireControls();
    wireInput();
    wireKeyboard();

    requestAnimationFrame(loop);
  }

  // Presenter shortcuts: Space = pause, R = reset, S = toggle system.
  function wireKeyboard() {
    window.addEventListener("keydown", (e) => {
      if (e.target && e.target.tagName === "INPUT") return; // don't hijack the slider
      const k = e.key.toLowerCase();
      if (e.code === "Space" || k === " ") { e.preventDefault(); document.getElementById("btn-pause").click(); }
      else if (k === "r") { document.getElementById("btn-reset").click(); }
      else if (k === "s") { document.getElementById("btn-system").click(); }
    });
  }

  // Match the backing store to the displayed size × DPR, then draw in CSS px.
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 1 unit = 1 CSS px
    WW.view.w = rect.width;
    WW.view.h = rect.height;
  }

  function resetAll() {
    WW.animals.clear();
    WW.car.reset();
    WW.detection.reset();
    WW.stats.reset();
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
      // Order matters: move entities, then detect, then react.
      WW.animals.update(sdt);
      WW.detection.update();
      WW.car.update(sdt);
    }

    // Draw every frame (even when paused, so drag/drop stays responsive).
    WW.render.frame(ctx, WW.view.w, WW.view.h);
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
      // (The System ON/OFF state is left as the user set it — no auto-switching.)
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
    if (hintText) hintText.textContent = "Drag an animal onto the road to try it yourself";
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
    // Pause and System are meta-controls: they keep the scoreboard and any
    // running auto-demo intact (System toggling is how you compare before/after).
    btnPause.addEventListener("click", () => {
      idleMs = 0;
      paused = !paused;
      btnPause.textContent = paused ? "▶ Play" : "⏸ Pause";
    });
    // Reset is the only control that clears the scoreboard + scene.
    btnReset.addEventListener("click", () => { stopAttract(); resetAll(); idleMs = 0; });

    const btnSystem = document.getElementById("btn-system");
    btnSystem.addEventListener("click", () => {
      idleMs = 0;                    // don't let the idle demo interrupt a comparison
      setSystem(!WW.system.enabled); // keep stats + animals so ON vs OFF accumulates
    });

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

  function setSystem(on) {
    WW.system.enabled = on;
    const btn = document.getElementById("btn-system");
    btn.textContent = "System: " + (on ? "ON" : "OFF");
    btn.classList.toggle("toggle-on", on);
    btn.classList.toggle("toggle-off", !on);
  }

  // Map canvas coordinates (CSS pixels) -> logical map units.
  function toLogical(evt) {
    const r = canvas.getBoundingClientRect();
    const cx = (evt.clientX - r.left) / r.width;
    const cy = (evt.clientY - r.top) / r.height;
    return { x: cx * WW.config.map.width, y: cy * WW.config.map.height };
  }

  function wireInput() {
    // Pointer events on the map -> animal drag/rotate/release (SPEC §5.2).
    canvas.addEventListener("pointerdown", (e) => {
      noteInteraction();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {} // keep events past the edge
      const p = toLogical(e);
      WW.animals.onPointerDown(p.x, p.y);
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = toLogical(e);
      WW.animals.onPointerMove(p.x, p.y);
    });
    canvas.addEventListener("pointerup", (e) => {
      const p = toLogical(e);
      WW.animals.onPointerUp(p.x, p.y);
    });

    // Drag a species chip from the tray and drop it on the map (SPEC §5.2 step 1).
    document.querySelectorAll(".tray-chip").forEach((chip) => {
      chip.addEventListener("dragstart", (e) => {
        noteInteraction();
        dragActive = true; // slow the scene while dragging
        e.dataTransfer.setData("text/plain", chip.dataset.species);
        e.dataTransfer.effectAllowed = "copy";
      });
      chip.addEventListener("dragend", () => { dragActive = false; });
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
      const p = toLogical(e);
      WW.animals.create(speciesId, p.x, p.y);
    });
  }

  window.addEventListener("DOMContentLoaded", init);
})();
