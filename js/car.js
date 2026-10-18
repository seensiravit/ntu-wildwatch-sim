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
      scored: new Set(), // animal ids already counted as an encounter
    };
  }
  let state, scored;
  // Switch to a world's car (created on first use).
  function use(world) {
    const c = world.car || (world.car = fresh());
    state = c.state; scored = c.scored;
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

  // A signal's warning zone: from where drivers can first SEE the sign
  // (tuning.signSightDistance upstream of it) to the far end of its linked
  // camera's coverage along the path. (SPEC §4.3 started the zone at the sign
  // itself; the sight distance lets a sign placed right at the camera still
  // warn drivers before the crossing.)
  function buildWarnZones() {
    warnZones = [];
    const sight = WW.config.tuning.signSightDistance || 0;
    WW.config.signals.forEach((sig) => {
      const cam = WW.config.cameras.find((c) => c.id === sig.linkedCameraId);
      const sSignal = projectS(sig.x, sig.y);
      let coneEnd = sSignal;
      for (let s = 0; s <= total; s += 8) {
        const p = posAt(s);
        if (cam && WW.geo.pointInCone(p.x, p.y, cam)) coneEnd = Math.max(coneEnd, s);
      }
      warnZones.push({ signalId: sig.id, start: Math.max(0, sSignal - sight), end: Math.max(coneEnd, sSignal) });
    });
  }

  function reset() {
    if (!segs.length) buildPath();
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

  // Is a Walking animal inside the braking look-ahead rectangle? (SPEC §6.2.1)
  function animalAhead() {
    const t = WW.config.tuning;
    const halfLane = WW.config.road.laneWidth / 2;
    for (let ahead = 0; ahead <= t.brakeAheadLen; ahead += halfLane) {
      const p = posAt(state.s + ahead);
      for (const a of WW.animals.list) {
        if (a.state !== "walking") continue;
        if (WW.geo.dist(p.x, p.y, a.x, a.y) <= halfLane + a.radius) return true;
      }
    }
    return false;
  }

  // Score each car–animal encounter once: "avoided" if the car had slowed in
  // time (system on), a "near-miss" if it was still fast (system off).
  function detectEncounters() {
    if (!WW.stats) return;
    const nm = WW.config.nearMiss;
    const halfLane = WW.config.road.laneWidth / 2;
    const kmh = currentKmh();
    const present = new Set();
    for (const a of WW.animals.list) {
      if (a.state !== "walking") continue;
      present.add(a.id);
      if (scored.has(a.id)) continue;
      let near = false;
      for (let ahead = 0; ahead <= nm.dangerZoneLen && !near; ahead += halfLane) {
        const p = posAt(state.s + ahead);
        if (WW.geo.dist(p.x, p.y, a.x, a.y) <= halfLane + a.radius) near = true;
      }
      if (near) {
        scored.add(a.id);
        WW.stats.onEncounter(kmh <= nm.dangerSpeedKmh, a.x, a.y, kmh);
      }
    }
    // Forget animals that are gone so a fresh one can be scored later.
    scored.forEach((id) => { if (!present.has(id)) scored.delete(id); });
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
    if (animalAhead()) targetUnits = 0;

    // Brake lights: on when stopping for an animal or actively slowing down.
    state.braking = targetUnits === 0 || state.speedUnitsPerSec > targetUnits + 0.5;

    // Score near-misses / avoided encounters against the CURRENT speed.
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
    use, reset, startLap, update, currentKmh,
  };
})();
