/* animals.js — animal entities: create from tray, drag/rotate/release, move.
 * States: "placed" (setup: semi-transparent, has direction arrow) -> "walking".
 * Only "walking" animals can be detected. Implements SPEC §5.
 * Exposed as WW.animals. */
(function () {
  const WW = window.WW || (window.WW = {});

  const list = []; // active animal entities
  let nextId = 1;
  let drag = null; // { mode:"body"|"arrow", animal, startX, startY, moved, offX, offY }

  function speciesById(id) {
    return WW.config.species.find((s) => s.id === id) || null;
  }

  // The direction-arrow tip position (logical units) for a placed animal.
  function arrowTip(a) {
    const ui = WW.config.ui;
    const len = a.radius + ui.arrowLen;
    const rad = WW.geo.degToRad(a.dirDeg);
    return { x: a.x + Math.cos(rad) * len, y: a.y + Math.sin(rad) * len };
  }

  // Create a Placed animal at (x,y). Returns the entity (or null if unknown).
  function create(speciesId, x, y) {
    const sp = speciesById(speciesId);
    if (!sp) return null;
    const a = {
      id: nextId++,
      speciesId: sp.id,
      label: sp.label,
      color: sp.color,
      heatColor: sp.heatColor,
      radius: sp.radius,
      speed: sp.speedUnitsPerSec,
      x: x,
      y: y,
      dirDeg: WW.config.tuning.defaultAnimalDirDeg, // straight down by default
      state: "placed",
    };
    list.push(a);
    return a;
  }

  function update(dt) {
    const map = WW.config.map;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.state !== "walking") continue;
      const rad = WW.geo.degToRad(a.dirDeg);
      a.x += Math.cos(rad) * a.speed * dt;
      a.y += Math.sin(rad) * a.speed * dt;
      // Remove once fully off the map bounds (with a small margin).
      const m = a.radius + 4;
      if (a.x < -m || a.x > map.width + m || a.y < -m || a.y > map.height + m) {
        list.splice(i, 1);
      }
    }
  }

  function clear() {
    list.length = 0;
    drag = null;
  }

  // ---- Pointer interaction (logical units), wired from main.js -----------

  function onPointerDown(x, y) {
    drag = null;
    const ui = WW.config.ui;
    // Topmost first: prefer the arrow tip, then the body (placed animals only).
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.state !== "placed") continue;
      const tip = arrowTip(a);
      if (WW.geo.dist(x, y, tip.x, tip.y) <= ui.arrowGrabRadius) {
        drag = { mode: "arrow", animal: a, startX: x, startY: y, moved: 0 };
        return;
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.state !== "placed") continue;
      if (WW.geo.dist(x, y, a.x, a.y) <= a.radius + ui.bodyGrabSlack) {
        drag = {
          mode: "body", animal: a, startX: x, startY: y, moved: 0,
          offX: a.x - x, offY: a.y - y,
        };
        return;
      }
    }
  }

  function onPointerMove(x, y) {
    if (!drag) return;
    const a = drag.animal;
    if (drag.mode === "arrow") {
      a.dirDeg = (Math.atan2(y - a.y, x - a.x) * 180) / Math.PI;
    } else {
      a.x = x + drag.offX;
      a.y = y + drag.offY;
    }
    drag.moved = Math.max(drag.moved, WW.geo.dist(x, y, drag.startX, drag.startY));
  }

  function onPointerUp(x, y) {
    if (!drag) return;
    // A click on the body (little movement) releases it to Walking.
    if (drag.mode === "body" && drag.moved < WW.config.tuning.dragReleaseThreshPx) {
      drag.animal.state = "walking";
    }
    drag = null;
  }

  WW.animals = {
    list, create, update, clear, arrowTip,
    onPointerDown, onPointerMove, onPointerUp,
  };
})();
