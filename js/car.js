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
        accel: 0,       // current acceleration (units/s², negative = braking); changes at a limited jerk
        holdSec: 0,     // > 0: stopped, waiting this much longer before driving off
        signTimer: -1,  // >= 0: time since the driver first saw a flashing sign for the zone ahead
        signZoneEnd: -1, // end (path distance) of that sign's warning zone
        warnedUntil: -1, // the driver is warned (slow, alert) until the car passes this path distance
        signOffSec: 99,  // time since the sign for the zone the car is in last flashed
        lineWaitSec: 0,  // time spent stopped at the stop line waiting for the sign to go off
      },
      scored: new Map(),  // animal id -> outcome already counted this lap ("hit" | "near" | "safe")
      pending: new Map(), // animal id -> { kmh, x, y }: encounter open until the car passes
      seen: new Map(),    // animal id -> { sec, laneSec }: animals the driver has noticed (see perceive)
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
      const cov = cam ? coverage(cam) : { start: sSignal, end: sSignal };
      // stopS: where a driver who sees the sign flashing stops to wait, just before
      // the camera's coverage (the crossing area) begins along the path.
      warnZones.push({
        signalId: sig.id, start: Math.max(0, sSignal - sight), end: Math.max(cov.end, sSignal),
        stopS: Math.max(0, cov.start - WW.config.tuning.stopBeforeArea),
      });
    });
  }

  function reset() {
    buildPath(); // config.carPath may have changed (research/ runs both directions)
    buildWarnZones();
    startLap();
  }

  // Put the car back at the start of the route, entering the map at cruising
  // speed. Each lap scores its own encounters, so an animal still on the road
  // meets the new car afresh.
  function startLap() {
    scored.clear();
    pending.clear();
    seen.clear();
    state.s = 0;
    state.speedUnitsPerSec = kmhToUnits(WW.config.tuning.cruiseKmh);
    state.accel = 0;
    state.holdSec = 0;
    state.signTimer = -1;
    state.signZoneEnd = -1;
    state.warnedUntil = -1;
    state.signOffSec = 99;
    state.lineWaitSec = 0;
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

  // ---- Driver model (SPEC §6.2; parameters in config.tuning) ----------------
  // Based on driving research (README "Driver model"): no change in speed during
  // the perception-reaction time, the last part of which is the foot moving to
  // the brake (a slight coast); braking force that builds up at a limited jerk;
  // stopping that brakes a bit harder than needed at first and eases into the
  // stop; a short pause once the animal has cleared; gentle re-acceleration.

  // What the driver has noticed. An animal is NOTICED once it is on the road
  // ahead within headlight range (drivers watch the road) or lit by the
  // headlight beam on the verge, and stays noticed (the driver remembers it)
  // until the car has passed it. The reaction clock starts when it is noticed.
  // Returns [{ a, ahead, where: "lane" | "road" | "verge", fromKerb, n }], where
  // n = { sec: time since noticed, laneSec: time in the car's lane (-1 if not) }.
  function perceive(dt) {
    const t = WW.config.tuning, road = WW.config.road;
    const beam = { x: state.x, y: state.y, facingAngleDeg: state.headingDeg, fovDeg: t.headlight.fovDeg, range: t.headlight.range };
    const sight = t.headlight.range;
    const out = [], present = new Set();
    for (const a of WW.animals.list) {
      if (a.state !== "walking") continue;
      const ahead = projectS(a.x, a.y) - state.s;
      if (ahead < -(WW.config.ui.carLen / 2 + a.radius)) continue; // passed it: forgotten below
      const fromKerb = WW.geo.distToPolyline(a.x, a.y, road.centerline) - road.roadWidth / 2;
      const where = inPathAhead(a, sight) ? "lane" : fromKerb <= 0 ? "road" : "verge";
      let n = seen.get(a.id);
      if (!n) {
        const visible = ahead >= 0 && ahead <= sight && (where !== "verge" || WW.geo.pointInCone(a.x, a.y, beam));
        if (!visible) continue;
        n = { sec: 0, laneSec: -1 };
        seen.set(a.id, n);
      }
      present.add(a.id);
      n.sec += dt;
      n.laneSec = where === "lane" ? (n.laneSec < 0 ? 0 : n.laneSec + dt) : -1;
      out.push({ a: a, ahead: ahead, where: where, fromKerb: fromKerb, n: n });
    }
    seen.forEach((n, id) => { if (!present.has(id)) seen.delete(id); });
    return out;
  }

  // What the driver wants to do this frame: the speed to aim for (targetV), the
  // strongest braking wanted to get there (decel, units/s²), whether the foot is
  // on its way to the brake (coast) and whether the car is stopping for an animal.
  function plan(noticed) {
    const t = WW.config.tuning;
    const v = state.speedUnitsPerSec;
    // Warned: the driver saw a flashing sign and has reacted to it (see update()).
    const warned = state.s <= state.warnedUntil;
    const rt = warned ? t.alertReactionSec : t.driverReactionSec;
    const cap = t.maxDecelUnitsPerSec2;
    const p = { targetV: kmhToUnits(t.cruiseKmh), decel: 0, coast: false, stopping: false };
    // Aim for speed vt at braking `rate`. Easing toward a non-zero target, the
    // driver lets off the brake in time to arrive smoothly (limited jerk).
    const want = (vt, rate) => {
      if (vt < p.targetV) p.targetV = vt;
      if (v <= vt + 0.01) return;
      if (vt > 0) rate = Math.min(rate, Math.sqrt(2 * t.jerk.release * (v - vt)));
      p.decel = Math.max(p.decel, rate);
    };
    // Gap from the car's front to the animal, less the stop margin.
    const roomTo = (o) => o.ahead - WW.config.ui.carLen / 2 - o.a.radius - t.stopGap;

    // Animal on the road but not (yet, as far as the driver has registered) in
    // the car's lane: slow to a speed it could still stop from if it steps
    // across, v = a·(−t_r + √(t_r² + 2d/a)) with t_r = alert reaction, braking at
    // 2.5–5 m/s², never below otherLaneMinKmh (drivers pass a watched animal slowly).
    const slowFor = (o) => {
      const d = Math.max(0, roomTo(o));
      const af = t.otherLaneStopDecelUnitsPerSec2, tr = t.alertReactionSec;
      const vSafe = Math.max(kmhToUnits(t.otherLaneMinKmh), af * (-tr + Math.sqrt(tr * tr + (2 * d) / af)));
      const needed = (v * v - vSafe * vSafe) / (2 * Math.max(1, d));
      want(vSafe, Math.min(af, Math.max(t.otherLaneDecelUnitsPerSec2, needed)));
    };

    if (warned) {
      // The sign is flashing (or only just went off): an animal is in the crossing
      // area, so stop at the stop line before it and wait. If the car can't stop
      // there without braking harder than signStopMaxDecel (it saw the sign too
      // late), or has already passed the line, or has waited long enough, go
      // through slowly at warnKmh instead.
      const z = zoneHere();
      const busy = z && (WW.detection.isSignalActive(z.signalId) || state.signOffSec < t.signClearSec) &&
        state.lineWaitSec < t.signMaxWaitSec;
      const room = z ? z.stopS - state.s - WW.config.ui.carLen / 2 : -Infinity;
      const need = room > 0.5 ? (v * v) / (2 * room) : Infinity;
      if (busy && room > -1 && (need <= t.signStopMaxDecelUnitsPerSec2 || v < t.finishSpeedUnits)) {
        // A planned stop at a known line: brake steadily at what is needed (no front-loading).
        want(0, Math.min(cap, v < t.finishSpeedUnits ? Math.max(need, t.signDecelUnitsPerSec2) : need));
        p.stopping = true;
        p.atLine = true;
      } else {
        want(kmhToUnits(t.warnKmh), t.signDecelUnitsPerSec2);
      }
    }

    noticed.forEach((o) => {
      const n = o.n;
      // Reaction: nothing changes until rt after noticing it (the foot moves to
      // the brake in the last footMoveSec, coasting).
      const left = rt - n.sec;
      if (left > 0) { if (left <= t.footMoveSec) p.coast = true; return; }

      if (o.where === "lane") {
        // Registering that it is in the lane takes alertReactionSec from when it
        // entered; until then, keep slowing for it as for an animal on the road.
        if (n.laneSec < t.alertReactionSec) { slowFor(o); return; }
        // Stop stopGap short of it: v² = 2·a·d, braking front-loaded (1.3x what
        // is needed, easing off as it goes), exactly as needed at crawling speed
        // to land on the stop point, never beyond the emergency limit.
        const room = roomTo(o);
        const need = room > 0.5 ? (v * v) / (2 * room) : Infinity;
        const rate = v < t.finishSpeedUnits ? need : t.stopFrontLoad * need;
        want(0, Math.min(cap, rate));
        p.stopping = true;
      } else if (o.where === "road") {
        slowFor(o);
      } else if (o.fromKerb <= t.vergeCautionDist) {
        want(kmhToUnits(t.vergeCautionKmh), t.vergeDecelUnitsPerSec2);
      }
    });
    return p;
  }

  // Move the car's acceleration toward `aCmd` at a limited jerk: braking builds
  // up faster the harder it is (gentle / firm / emergency); letting off the
  // brake is quick (release); pressing the accelerator is gentle.
  function applyJerk(aCmd, dt) {
    const j = WW.config.tuning.jerk;
    let rate;
    if (aCmd < state.accel) rate = -aCmd > j.emergencyAbove ? j.emergency : -aCmd > j.firmAbove ? j.firm : j.gentle;
    else rate = state.accel < 0 ? j.release : j.gentle;
    const da = aCmd - state.accel;
    state.accel += Math.sign(da) * Math.min(Math.abs(da), rate * dt);
  }

  // Does animal `a` touch the car body? (Rectangle from config.ui; the animal
  // counts as a circle slightly smaller than its radius.) Any contact is a hit,
  // whoever moved into whom, even with the car standing still: a car stopped in
  // an animal's path is in the wrong place.
  function touches(a) {
    const ui = WW.config.ui;
    const h = WW.geo.degToRad(state.headingDeg);
    const ux = Math.cos(h), uy = Math.sin(h);
    const dx = a.x - state.x, dy = a.y - state.y;
    const along = dx * ux + dy * uy, across = -dx * uy + dy * ux;
    const r = a.radius * 0.8;
    return Math.abs(along) <= ui.carLen / 2 + r && Math.abs(across) <= ui.carWidth / 2 + r;
  }

  // Score each car-animal encounter once per lap, as one of:
  //   "hit"  - the car and the animal touched (touches), at any speed;
  //   "near" - the car was faster than nearMiss.dangerSpeedKmh at its closest
  //            approach to the animal, but didn't touch it;
  //   "safe" - the car was at that speed or slower by then, no contact.
  // An encounter opens when the animal is first in the lane within
  // nearMiss.dangerZoneLen ahead and closes when it is no longer ahead. The
  // speed scored is the car's speed when it got closest (for a hit: at
  // contact), so a car that brakes in time scores the speed it actually reached
  // the animal at. If the animal touches the car later in the lap (e.g. walks
  // into it after it stopped), a near miss or safe pass already counted becomes a hit.
  function detectEncounters() {
    if (!WW.stats) return;
    const nm = WW.config.nearMiss;
    const kmh = currentKmh();
    const present = new Set();
    for (const a of WW.animals.list) {
      if (a.state !== "walking") continue;
      present.add(a.id);
      const done = scored.get(a.id);
      if (done === "hit") continue;
      const open = pending.get(a.id);
      if (touches(a)) {
        scored.set(a.id, "hit");
        pending.delete(a.id);
        if (done) WW.stats.upgradeToHit(done, a.x, a.y);
        else WW.stats.onEncounter("hit", a.x, a.y, kmh);
        continue;
      }
      if (done) continue;
      const near = inPathAhead(a, nm.dangerZoneLen);
      const d = WW.geo.dist(state.x, state.y, a.x, a.y);
      if (near && !open) pending.set(a.id, { dist: d, kmh: kmh, x: a.x, y: a.y });
      else if (near && d < open.dist) { open.dist = d; open.kmh = kmh; open.x = a.x; open.y = a.y; }
      else if (!near && open) closeEncounter(a.id);
    }
    // Animals that left the map close their encounter; forget gone animals.
    pending.forEach((e, id) => { if (!present.has(id)) closeEncounter(id); });
    scored.forEach((kind, id) => { if (!present.has(id)) scored.delete(id); });
  }

  function closeEncounter(id) {
    const e = pending.get(id);
    const kind = e.kmh > WW.config.nearMiss.dangerSpeedKmh ? "near" : "safe";
    pending.delete(id);
    scored.set(id, kind);
    WW.stats.onEncounter(kind, e.x, e.y, e.kmh);
  }

  // The warning zone the car is in whose sign is flashing right now (or null).
  function activeZone() {
    for (const z of warnZones) {
      if (state.s >= z.start && state.s <= z.end && WW.detection.isSignalActive(z.signalId)) return z;
    }
    return null;
  }
  function inActiveWarnZone() { return !!activeZone(); }
  // The zone the car is in: the one whose sign is flashing if any, else the first.
  function zoneHere() {
    return activeZone() || warnZones.find((z) => state.s >= z.start && state.s <= z.end) || null;
  }

  // The driver and the signs. Seeing a flashing sign starts a reaction time
  // (driverReactionSec); after it the driver is warned (slows to warnKmh and
  // reacts faster to animals) until the end of that sign's zone, even if the
  // sign stops flashing meanwhile: a driver who has read "WILDLIFE AHEAD – SLOW
  // DOWN" stays careful through the area.
  function watchSigns(dt) {
    const z = activeZone();
    if (z && state.signTimer < 0) { state.signTimer = 0; state.signZoneEnd = z.end; }
    if (state.signTimer < 0) return;
    state.signTimer += dt;
    if (state.signTimer >= WW.config.tuning.driverReactionSec) state.warnedUntil = Math.max(state.warnedUntil, state.signZoneEnd);
    if (state.s > state.signZoneEnd) state.signTimer = -1; // past that zone: a new sign starts afresh
    const here = zoneHere();
    state.signOffSec = here && WW.detection.isSignalActive(here.signalId) ? 0 : state.signOffSec + dt;
  }

  function update(dt) {
    const t = WW.config.tuning;

    if (!state.visible) return; // off the map: main.js starts the next lap

    watchSigns(dt);
    const want = plan(perceive(dt));
    const v = state.speedUnitsPerSec;

    // Stopped for an animal or at the stop line: once clear, wait a moment before driving off.
    if (want.stopping && v < 0.5) state.holdSec = t.clearHoldSec;
    else if (state.holdSec > 0) state.holdSec -= dt;
    state.lineWaitSec = want.atLine && v < 0.5 ? state.lineWaitSec + dt : (want.atLine ? state.lineWaitSec : 0);

    // Wanted acceleration: brake > coast (foot moving to the brake) > hold >
    // speed up (easing in as the target nears) > drift down to the target.
    let aCmd = 0;
    if (want.decel > 0) aCmd = -want.decel;
    else if (want.coast) aCmd = -t.coastDecelUnitsPerSec2;
    else if (state.holdSec > 0 && v < 0.5) aCmd = 0;
    else if (v < want.targetV) aCmd = Math.min(t.accelUnitsPerSec2, Math.sqrt(2 * t.jerk.gentle * (want.targetV - v)));
    else if (v > want.targetV + 0.3) aCmd = -t.coastDecelUnitsPerSec2;
    applyJerk(aCmd, dt);

    // Brake lights: on while braking harder than a coast, or held stopped.
    state.braking = state.accel < -(t.coastDecelUnitsPerSec2 + 1) || (v < 0.5 && (want.stopping || state.holdSec > 0));

    // Score hits / near misses / safe passes.
    detectEncounters();

    state.speedUnitsPerSec = Math.max(0, v + state.accel * dt);
    if (state.speedUnitsPerSec === 0 && state.accel < 0) state.accel = 0;
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
