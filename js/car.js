/* car.js — the car: path following + speed logic (SPEC §6).
 * Position is tracked as distance `s` along the config.carPath polyline.
 * Each world (system OFF / ON side) has its own car; main.js calls use(world)
 * to select one, and starts every lap on both sides together (startLap).
 * Exposed as WW.car. */
(function () {
  const WW = window.WW || (window.WW = {});

  function fresh() {
    return {
      state: {
        x: 0, y: 0,
        headingDeg: 0,
        speedUnitsPerSec: 0,
        s: 0,           // distance travelled along the path
        visible: true,  // false once it has left the map (waiting for the next lap)
        braking: false,
      },
      scored: new Set(),  // animal ids whose encounter is already counted
      pending: new Map(), // animal id -> { kmh, x, y }: encounter open until the car passes
      seen: new Map(),    // animal id -> seconds it has been in the path ahead (driver reaction)
    };
  }
  let state, scored, pending, seen;
  // Switch to a world's car (created on first use).
  function use(world) {
    const c = world.car || (world.car = fresh());
    state = c.state; scored = c.scored; pending = c.pending; seen = c.seen;
  }
  use({});

  // The path and warning zones come from config only, so both worlds share them.
  let segs = [];        // [{ax,ay,bx,by,len,ux,uy}]
  let total = 0;        // total path length
  let warnZones = [];   // [{signalId, start, end}] in path distance

  function kmhToUnits(kmh) {
    return kmh / WW.config.tuning.unitsPerSecToKmh;
  }

  function buildPath() {
    const pts = WW.config.carPath;
    segs = [];
    total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, len, ux: dx / len, uy: dy / len });
      total += len;
    }
  }

  // Point + heading at path distance s (clamped to the path).
  function posAt(s) {
    s = Math.max(0, Math.min(total, s));
    let acc = 0;
    for (const seg of segs) {
      if (s <= acc + seg.len) {
        const t = s - acc;
        return {
          x: seg.ax + seg.ux * t,
          y: seg.ay + seg.uy * t,
          headingDeg: (Math.atan2(seg.uy, seg.ux) * 180) / Math.PI,
        };
      }
      acc += seg.len;
    }
    const last = segs[segs.length - 1];
    return { x: last.bx, y: last.by, headingDeg: (Math.atan2(last.uy, last.ux) * 180) / Math.PI };
  }

  // Nearest path distance s to an arbitrary point (used to place warning zones).
  function projectS(px, py) {
    let best = { d: Infinity, s: 0 }, acc = 0;
    for (const seg of segs) {
      const t = Math.max(0, Math.min(seg.len, (px - seg.ax) * seg.ux + (py - seg.ay) * seg.uy));
      const cx = seg.ax + seg.ux * t, cy = seg.ay + seg.uy * t;
      const d = Math.hypot(px - cx, py - cy);
      if (d < best.d) best = { d, s: acc + t };
      acc += seg.len;
    }
    return best.s;
  }

  // Stretch of the path [start, end] alongside a camera's view: its cone
  // footprint (apex + arc) projected onto the path. Using the whole footprint,
  // not just path points inside the cone, means a verge camera that watches the
  // crossing but not the lane itself still covers that stretch of road.
  function coverage(cam) {
    const poly = WW.geo.conePolygon(cam.x, cam.y, cam.facingAngleDeg, cam.fovDeg, cam.range);
    let start = Infinity, end = -Infinity;
    poly.forEach((p) => { const s = projectS(p.x, p.y); start = Math.min(start, s); end = Math.max(end, s); });
    return { start, end };
  }

  // A signal's warning zone: from where drivers can first SEE the sign
  // (tuning.signSightDistance upstream of it) to the far end of its linked
  // camera's coverage along the path. (SPEC §4.3 started the zone at the sign
  // itself; the sight distance lets a sign placed right at the camera still
  // warn drivers before the crossing.) A signal with a `dir` ("east"/"west")
  // only warns traffic going that way (config.carDir); the demo's signs have none.
  function buildWarnZones() {
    warnZones = [];
    const sight = WW.config.tuning.signSightDistance || 0;
    const carDir = WW.config.carDir;
    WW.config.signals.forEach((sig) => {
      if (sig.dir && carDir && sig.dir !== carDir) return;
      const cam = WW.config.cameras.find((c) => c.id === sig.linkedCameraId);
      const sSignal = projectS(sig.x, sig.y);
      const coneEnd = cam ? coverage(cam).end : sSignal;
      warnZones.push({ signalId: sig.id, start: Math.max(0, sSignal - sight), end: Math.max(coneEnd, sSignal) });
    });
  }

  function reset() {
    buildPath(); // config.carPath may have changed (research/ runs both directions)
    buildWarnZones();
    scored.clear();
    startLap();
  }

  // Put the car back at the start of the route at standstill.
  function startLap() {
    state.s = 0;
    state.speedUnitsPerSec = 0;
    state.visible = true;
    state.braking = false;
    const p = posAt(0);
    state.x = p.x; state.y = p.y; state.headingDeg = p.headingDeg;
  }

  // Is walking animal `a` in the lane within `len` ahead of the car?
  function inPathAhead(a, len) {
    const halfLane = WW.config.road.laneWidth / 2;
    for (let ahead = 0; ahead <= len; ahead += halfLane) {
      const p = posAt(state.s + ahead);
      if (WW.geo.dist(p.x, p.y, a.x, a.y) <= halfLane + a.radius) return true;
    }
    return false;
  }

  // How should the driver react to animals on the road ahead? (SPEC §6.2.1)
  //   "stop" — an animal in the car's own lane within brakeAheadLen;
  //   "slow" — an animal elsewhere on the road surface (e.g. the other lane) that close;
  //   null   — nothing to react to (yet).
  // The driver needs a reaction time after first noticing an animal, so one that
  // steps out close in front of a fast car can be hit. A driver warned by a
  // flashing sign is expecting animals, so reacts faster (tuning.alertReactionSec),
  // and is already slower, so stops sooner.
  function animalAhead(dt) {
    const t = WW.config.tuning;
    const road = WW.config.road;
    const react = inActiveWarnZone() ? t.alertReactionSec : t.driverReactionSec;
    const now = new Map(); // animal id -> "stop" | "slow"
    for (const a of WW.animals.list) {
      if (a.state !== "walking") continue;
      if (inPathAhead(a, t.brakeAheadLen)) { now.set(a.id, "stop"); continue; }
      const ahead = projectS(a.x, a.y) - state.s;
      if (ahead >= 0 && ahead <= t.brakeAheadLen &&
          WW.geo.distToPolyline(a.x, a.y, road.centerline) <= road.roadWidth / 2) now.set(a.id, "slow");
    }
    seen.forEach((secs, id) => { if (!now.has(id)) seen.delete(id); });
    let action = null;
    now.forEach((kind, id) => {
      const secs = (seen.get(id) || 0) + dt;
      seen.set(id, secs);
      if (secs >= react && action !== "stop") action = kind;
    });
    return action;
  }

  // Is animal `a` hit by the car right now? It touches the car body (rectangle
  // from config.ui; the animal a circle slightly smaller than its radius) and
  // either the car's front runs into it while moving (> nearMiss.hitMinKmh), or
  // it runs into the side of a car still going faster than dangerSpeedKmh.
  // Our animals can't see cars (both maps share them), so an animal walking into
  // the side of a slow car isn't counted: a real one would stop.
  function isHit(a, kmh) {
    const ui = WW.config.ui, nm = WW.config.nearMiss;
    const h = WW.geo.degToRad(state.headingDeg);
    const ux = Math.cos(h), uy = Math.sin(h);
    const dx = a.x - state.x, dy = a.y - state.y;
    const along = dx * ux + dy * uy, across = -dx * uy + dy * ux;
    const r = a.radius * 0.8;
    if (Math.abs(along) > ui.carLen / 2 + r || Math.abs(across) > ui.carWidth / 2 + r) return false;
    const front = along > ui.carLen / 4;
    return front ? kmh > nm.hitMinKmh : kmh > nm.dangerSpeedKmh;
  }

  // Score each car-animal encounter once, as one of:
  //   "hit"  - the car hit the animal or the animal ran into the car (isHit);
  //   "near" - the car came at it faster than nearMiss.dangerSpeedKmh, no hit;
  //   "safe" - the car had already slowed to that speed or less, no hit.
  // An encounter opens when the animal is first in the lane within
  // nearMiss.dangerZoneLen ahead (the car's speed then is the one scored) and
  // stays open until the animal is no longer ahead, so a near miss can still
  // become a hit.
  function detectEncounters() {
    if (!WW.stats) return;
    const nm = WW.config.nearMiss;
    const kmh = currentKmh();
    const present = new Set();
    for (const a of WW.animals.list) {
      if (a.state !== "walking") continue;
      present.add(a.id);
      if (scored.has(a.id)) continue;
      const open = pending.get(a.id);
      if (isHit(a, kmh)) {
        scored.add(a.id);
        pending.delete(a.id);
        WW.stats.onEncounter("hit", a.x, a.y, open ? open.kmh : kmh);
        continue;
      }
      const near = inPathAhead(a, nm.dangerZoneLen);
      if (near && !open) pending.set(a.id, { kmh: kmh, x: a.x, y: a.y });
      else if (near) { open.x = a.x; open.y = a.y; }
      else if (open) closeEncounter(a.id);
    }
    // Animals that left the map close their encounter; forget gone animals.
    pending.forEach((e, id) => { if (!present.has(id)) closeEncounter(id); });
    scored.forEach((id) => { if (!present.has(id)) scored.delete(id); });
  }

  function closeEncounter(id) {
    const e = pending.get(id);
    pending.delete(id);
    scored.add(id);
    WW.stats.onEncounter(e.kmh > WW.config.nearMiss.dangerSpeedKmh ? "near" : "safe", e.x, e.y, e.kmh);
  }

  function inActiveWarnZone() {
    for (const z of warnZones) {
      if (state.s >= z.start && state.s <= z.end && WW.detection.isSignalActive(z.signalId)) {
        return true;
      }
    }
    return false;
  }

  function update(dt) {
    const t = WW.config.tuning;

    if (!state.visible) return; // off the map: main.js starts the next lap

    // Target speed by priority: brake (0) > warning slowdown > cruise.
    let targetUnits = kmhToUnits(t.cruiseKmh);
    if (inActiveWarnZone()) targetUnits = kmhToUnits(t.warnKmh);
    const react = animalAhead(dt);
    if (react === "slow") targetUnits = Math.min(targetUnits, kmhToUnits(t.warnKmh));
    if (react === "stop") targetUnits = 0;

    // Brake lights: on when stopping for an animal or actively slowing down.
    state.braking = targetUnits === 0 || state.speedUnitsPerSec > targetUnits + 0.5;

    // Score hits / near misses / safe passes (an encounter opens at the CURRENT speed).
    detectEncounters();

    // Ease speed toward target with separate accel/decel.
    if (state.speedUnitsPerSec < targetUnits) {
      state.speedUnitsPerSec = Math.min(targetUnits, state.speedUnitsPerSec + t.accelUnitsPerSec2 * dt);
    } else {
      state.speedUnitsPerSec = Math.max(targetUnits, state.speedUnitsPerSec - t.decelUnitsPerSec2 * dt);
    }

    state.s += state.speedUnitsPerSec * dt;

    if (state.s >= total) {
      // Left the map: hide until main.js starts the next lap.
      state.visible = false;
      state.braking = false;
      pending.forEach((e, id) => closeEncounter(id));
      seen.clear();
      return;
    }

    const p = posAt(state.s);
    state.x = p.x; state.y = p.y; state.headingDeg = p.headingDeg;
  }

  function currentKmh() {
    return state.speedUnitsPerSec * WW.config.tuning.unitsPerSecToKmh;
  }

  WW.car = {
    get state() { return state; },
    get warnZones() { return warnZones; },
    get pathLength() { return total; },
    use, reset, startLap, update, currentKmh,
    posAt, projectS, coverage, inActiveWarnZone,
  };
})();
