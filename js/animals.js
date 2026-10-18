/* animals.js — animal entities: create from tray, drag/rotate/release, move,
 * and decide at the roadside whether to cross when a car is near.
 * States: "placed" (setup: semi-transparent, has direction arrow) -> "walking".
 * Only "walking" animals can be detected. Implements SPEC §5.
 *
 * Each world (system OFF / ON side) has its own copy of every animal: a TWIN
 * with the same id, look, path and boldness. Both sides get identical arrivals,
 * but each twin reacts to its own side's car, so they can diverge (one waits,
 * the other crosses). Editing an animal on either map is applied to both twins.
 * main.js calls use(world) to select a side and setWorlds() to list them.
 *
 * Walking animals go through phases:
 *   approach -> (decide, config.crossing.decisionDist before the road edge)
 *            -> cross | wait (then cross, or give up) | retreat (turn back)
 * Exposed as WW.animals. */
(function () {
  const WW = window.WW || (window.WW = {});

  let list = [];       // the current world's animals
  let worlds = null;   // every world that gets twins (null = just the current one)
  let nextId = 1;      // shared by twins
  let drag = null;     // { mode:"body"|"arrow", animal, startX, startY, moved, offX, offY }

  function use(world) { list = world.animals || (world.animals = []); }
  function setWorlds(ws) { worlds = ws; ws.forEach((w) => { if (!w.animals) w.animals = []; }); }
  function allLists() { return worlds ? worlds.map((w) => w.animals) : [list]; }

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

  // Create an animal in every world (twins share the id). props: speciesId, x, y,
  // and optionally dirDeg, state ("placed" by default), speedMul, boldness,
  // noticeRoll, groupId. Returns the current world's twin (or null if the
  // species is unknown).
  function spawn(props) {
    const sp = speciesById(props.speciesId);
    if (!sp) return null;
    const id = nextId++;
    let mine = null;
    const speedMul = props.speedMul || 1;
    // Random traits are drawn once here, so both twins share them.
    // boldness: how readily it crosses in front of a car (0..1, low = bold),
    // shared by its group. noticeRoll: compared with the species' chance of
    // noticing the car at all (high roll = doesn't notice, keeps walking).
    const boldness = props.boldness !== undefined ? props.boldness : Math.random();
    const noticeRoll = props.noticeRoll !== undefined ? props.noticeRoll : Math.random();
    allLists().forEach((l) => {
      const a = {
        id: id,
        speciesId: sp.id,
        label: sp.label,
        color: sp.color,
        heatColor: sp.heatColor,
        radius: sp.radius,
        baseSpeed: sp.speedUnitsPerSec * speedMul,
        speed: sp.speedUnitsPerSec * speedMul,
        x: props.x,
        y: props.y,
        dirDeg: props.dirDeg !== undefined ? props.dirDeg : WW.config.tuning.defaultAnimalDirDeg,
        state: props.state || "placed",
        phase: "approach",
        boldness: boldness,
        noticeRoll: noticeRoll,
        groupId: props.groupId || 0,
        waitSec: 0, clearSec: 0,
        lastRoadDist: Infinity,
      };
      l.push(a);
      if (l === list) mine = a;
    });
    return mine;
  }

  // Tray drop: a placed animal at (x, y), in every world.
  function create(speciesId, x, y) {
    return spawn({ speciesId: speciesId, x: x, y: y });
  }

  // ---- Roadside behaviour ---------------------------------------------------

  // Distance from the animal to the road edge (negative = on the road).
  function roadEdgeDist(a) {
    const road = WW.config.road;
    return WW.geo.distToPolyline(a.x, a.y, road.centerline) - road.roadWidth / 2;
  }

  // Is this world's car a threat to an animal about to cross here? Either
  // approaching within approachRadius of its crossing point, or stopped within
  // stoppedRadius of it (ahead or behind).
  function carThreat(a) {
    if (!WW.car || !WW.car.state || !WW.car.state.visible) return false;
    const cr = WW.config.crossing;
    const ds = WW.car.projectS(a.x, a.y) - WW.car.state.s; // > 0: crossing point is ahead of the car
    if (WW.car.currentKmh() < cr.stoppedKmh) return Math.abs(ds) <= cr.stoppedRadius;
    return ds >= -WW.config.ui.carLen && ds <= cr.approachRadius;
  }

  function startCrossing(a, speedMul) {
    a.phase = "cross";
    a.speed = a.baseSpeed * (speedMul || 1);
  }

  function turnBack(a) {
    a.phase = "retreat";
    a.dirDeg = (a.dirDeg + 180) % 360;
    a.speed = a.baseSpeed;
    if (WW.stats && WW.stats.onTurnedBack) WW.stats.onTurnedBack();
  }

  // The once-only roadside decision (see config.crossing and species.traffic).
  // Some animals never notice the car (traffic.notice is the chance they do) and
  // just keep walking; the rest cross anyway, wait or turn back.
  function decide(a) {
    const tr = speciesById(a.speciesId).traffic;
    if (!carThreat(a) || a.noticeRoll >= tr.notice) { startCrossing(a); return; }
    if (a.boldness < tr.cross) startCrossing(a, tr.crossSpeedMul);
    else if (a.boldness < tr.cross + tr.wait) { a.phase = "wait"; a.waitSec = 0; a.clearSec = 0; a.speed = 0; }
    else turnBack(a);
  }

  function updateBehaviour(a, dt) {
    const cr = WW.config.crossing;
    if (a.phase === "approach") {
      const d = roadEdgeDist(a);
      const heading = d < a.lastRoadDist; // getting closer to the road
      a.lastRoadDist = d;
      if (d <= 0) startCrossing(a);              // already on the road (e.g. released there)
      else if (d <= cr.decisionDist && heading) decide(a);
    } else if (a.phase === "wait") {
      a.waitSec += dt;
      a.clearSec = carThreat(a) ? 0 : a.clearSec + dt;
      if (a.clearSec >= cr.clearSec) startCrossing(a);  // a gap in traffic: go
      else if (a.waitSec >= speciesById(a.speciesId).traffic.maxWaitSec) turnBack(a);
    }
  }

  // Move the current world's animals (call once per world per frame).
  function update(dt) {
    const map = WW.config.map;
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.state !== "walking") continue;
      updateBehaviour(a, dt);
      if (a.phase === "wait") continue;
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

  // Clear every world's animals.
  function clear() {
    allLists().forEach((l) => { l.length = 0; });
    drag = null;
  }

  // Copy a placed animal's edit to its twins in the other worlds.
  function mirror(a) {
    allLists().forEach((l) => {
      if (l === list) return;
      const t = l.find((o) => o.id === a.id);
      if (t) { t.x = a.x; t.y = a.y; t.dirDeg = a.dirDeg; t.state = a.state; t.phase = a.phase; t.lastRoadDist = a.lastRoadDist; }
    });
  }
  function removeEverywhere(id) {
    allLists().forEach((l) => {
      const i = l.findIndex((o) => o.id === id);
      if (i >= 0) l.splice(i, 1);
    });
  }

  // ---- Pointer interaction (logical units), wired from main.js -----------
  // main.js selects the clicked map's world first; edits are mirrored to twins.

  // unitsPerPx: map units per screen pixel for the clicked map, so the click /
  // drag threshold stays the same on screen whatever size the map is drawn at.
  function onPointerDown(x, y, unitsPerPx) {
    drag = null;
    const upp = unitsPerPx || 1;
    const ui = WW.config.ui;
    // Topmost first: prefer the arrow tip, then the body (placed animals only).
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.state !== "placed") continue;
      const tip = arrowTip(a);
      if (WW.geo.dist(x, y, tip.x, tip.y) <= ui.arrowGrabRadius) {
        drag = { mode: "arrow", animal: a, startX: x, startY: y, moved: 0, upp: upp };
        return;
      }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.state !== "placed") continue;
      if (WW.geo.dist(x, y, a.x, a.y) <= a.radius + ui.bodyGrabSlack) {
        drag = {
          mode: "body", animal: a, startX: x, startY: y, moved: 0, upp: upp,
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
    mirror(a);
  }

  function onPointerUp(x, y) {
    if (!drag) return;
    const map = WW.config.map;
    const outOfBounds = x < 0 || x > map.width || y < 0 || y > map.height;
    if (drag.mode === "body" && outOfBounds) {
      // Dragged off the map -> remove it on both sides (tidy the scene).
      removeEverywhere(drag.animal.id);
    } else if (drag.mode === "body" && drag.moved / drag.upp < WW.config.tuning.dragReleaseThreshPx) {
      // A click on the body (little movement) releases it to Walking.
      drag.animal.state = "walking";
      drag.animal.phase = "approach";
      drag.animal.lastRoadDist = Infinity;
      mirror(drag.animal);
    }
    drag = null;
  }

  WW.animals = {
    get list() { return list; },
    use, setWorlds, spawn, create, update, clear, arrowTip,
    onPointerDown, onPointerMove, onPointerUp,
  };
})();
