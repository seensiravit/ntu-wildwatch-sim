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
    WW.dashboard.build();
    resetAll();
    wireControls();
    wireInput();

    requestAnimationFrame(loop);
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
    if (attractActive) {
      if (WW.animals.list.length === 0) {
        attractSpawnTimer -= dt * 1000;
        if (attractSpawnTimer <= 0) {
          spawnAttractAnimal();
          attractSpawnTimer = WW.config.attract.spawnGapMs;
        }
      }
    } else {
      idleMs += dt * 1000;
      if (idleMs >= WW.config.attract.idleStartMs && WW.animals.list.length === 0) {
        startAttract();
      }
    }
  }

  function startAttract() {
    attractActive = true;
    if (hintEl) hintEl.hidden = false;
    attractSpawnTimer = 0;
    spawnAttractAnimal();
  }

  function stopAttract() {
    attractActive = false;
    if (hintEl) hintEl.hidden = true;
  }

  function spawnAttractAnimal() {
    const s = WW.config.attract.spawn;
    const a = WW.animals.create(s.speciesId, s.x, s.y);
    if (a) { a.dirDeg = s.dirDeg; a.state = "walking"; }
  }

  // Any real interaction cancels the auto-demo and hands control to the visitor.
  function noteInteraction() {
    idleMs = 0;
    if (attractActive) { stopAttract(); resetAll(); }
  }

  function wireControls() {
    const btnPause = document.getElementById("btn-pause");
    const btnReset = document.getElementById("btn-reset");
    btnPause.addEventListener("click", () => {
      noteInteraction();
      paused = !paused;
      btnPause.textContent = paused ? "▶ Play" : "⏸ Pause";
    });
    btnReset.addEventListener("click", () => { noteInteraction(); resetAll(); });
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
