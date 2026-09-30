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

  function init() {
    canvas = document.getElementById("map");
    ctx = canvas.getContext("2d");

    WW.dashboard.build();
    resetAll();
    wireControls();
    wireInput();

    requestAnimationFrame(loop);
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
      WW.clock.ms += dt * 1000;
      // Order matters: move entities, then detect, then react.
      WW.animals.update(dt);
      WW.detection.update();
      WW.car.update(dt);
    }

    // Draw every frame (even when paused, so drag/drop stays responsive).
    WW.render.frame(ctx, canvas.width, canvas.height);
    WW.dashboard.update();

    requestAnimationFrame(loop);
  }

  function wireControls() {
    const btnPause = document.getElementById("btn-pause");
    const btnReset = document.getElementById("btn-reset");
    btnPause.addEventListener("click", () => {
      paused = !paused;
      btnPause.textContent = paused ? "▶ Play" : "⏸ Pause";
    });
    btnReset.addEventListener("click", resetAll);
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
        e.dataTransfer.setData("text/plain", chip.dataset.species);
        e.dataTransfer.effectAllowed = "copy";
      });
    });
    canvas.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const speciesId = e.dataTransfer.getData("text/plain");
      if (!speciesId) return;
      const p = toLogical(e);
      WW.animals.create(speciesId, p.x, p.y);
    });
  }

  window.addEventListener("DOMContentLoaded", init);
})();
