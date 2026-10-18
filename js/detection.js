/* detection.js — camera<->animal detection and signal state (SPEC §7).
 * Exposed as WW.detection. */
(function () {
  const WW = window.WW || (window.WW = {});

  // Per-camera runtime status, keyed by camera id:
  //   { detecting, animalsInCone: [{animal, confidence, angNorm, distNorm}],
  //     episodes: Map<animalId, confidence> }
  const camState = {};
  // Per-signal runtime status, keyed by signal id: { flashing }
  const sigState = {};
  const logEntries = []; // newest first; { time, camName, species, confidence }

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function timeStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function reset() {
    WW.config.cameras.forEach((cam) => {
      camState[cam.id] = { detecting: false, animalsInCone: [], episodes: new Map() };
    });
    WW.config.signals.forEach((sig) => {
      sigState[sig.id] = { flashing: false };
    });
    logEntries.length = 0;
  }

  function addLog(cam, animal, confidence) {
    logEntries.unshift({
      time: timeStamp(),
      camName: cam.name,
      species: animal.label,
      confidence: confidence,
    });
    const max = WW.config.tuning.logMaxEntries;
    if (logEntries.length > max) logEntries.length = max;
  }

  // Report each detection to the WildWatch dashboard extension, if loaded.
  // Contract (shared with the team's wildwatch-dashboard.js):
  //   WildWatch.record({ species, location, confidence: 0..1, proximity })
  //   -> { time, riskLevel, beaconActivated }
  // Our own signal/beacon logic stays authoritative; this is fire-and-forget
  // reporting so the extension's panel populates. Never let it break the sim.
  function reportToDashboard(cam, animal, confidencePct) {
    const WWx = window.WildWatch;
    if (!WWx || typeof WWx.record !== "function") return;
    // Report under the dashboard's own location name (config.dashboard), not our
    // "Cam 1 · …" label — the extension would alias "cam 1" to its Nanyang Ave camera.
    const map = (WW.config.dashboard && WW.config.dashboard.cameraLocations) || {};
    const loc = map[cam.id];
    try {
      WWx.record({
        species: animal.label,
        location: loc ? loc.name : cam.name,
        camera: loc ? loc.cam : undefined,
        confidence: confidencePct / 100,
        proximity: "road",
      });
    } catch (e) { /* extension errors must not affect the simulation */ }
  }

  function update() {
    if (!camState[WW.config.cameras[0].id]) reset(); // lazy init safety
    const t = WW.config.tuning;

    // System OFF: the cameras/signs aren't installed — nothing detects or warns.
    if (WW.system && !WW.system.enabled) {
      WW.config.cameras.forEach((cam) => {
        const cs = camState[cam.id];
        cs.detecting = false;
        cs.animalsInCone = [];
        cs.episodes.clear();
      });
      WW.config.signals.forEach((sig) => { sigState[sig.id].flashing = false; });
      return;
    }

    WW.config.cameras.forEach((cam) => {
      const cs = camState[cam.id];
      const nowInCone = [];
      const seen = new Set();

      WW.animals.list.forEach((a) => {
        if (a.state !== "walking") return;                 // only Walking (SPEC §5)
        if (!WW.geo.pointInCone(a.x, a.y, cam)) return;
        seen.add(a.id);

        // Confidence is fixed for the whole animal-in-cone episode.
        let conf = cs.episodes.get(a.id);
        if (conf === undefined) {
          conf = randInt(t.confidenceMin, t.confidenceMax);
          cs.episodes.set(a.id, conf);
          addLog(cam, a, conf);                            // ENTER event
          if (WW.stats) WW.stats.onDetection();
          reportToDashboard(cam, a, conf);                 // -> WildWatch extension
        }

        const d = WW.geo.dist(cam.x, cam.y, a.x, a.y);
        let ang = (Math.atan2(a.y - cam.y, a.x - cam.x) * 180) / Math.PI;
        const rel = ((ang - cam.facingAngleDeg + 540) % 360) - 180; // -fov/2..fov/2
        nowInCone.push({
          animal: a,
          confidence: conf,
          angNorm: rel / cam.fovDeg,          // ~ -0.5..0.5 across the FOV
          distNorm: Math.min(1, d / cam.range) // 0 (near) .. 1 (far)
        });
      });

      // Drop episodes for animals that left the cone (re-entry => new confidence).
      cs.episodes.forEach((_, id) => { if (!seen.has(id)) cs.episodes.delete(id); });

      cs.animalsInCone = nowInCone;
      cs.detecting = nowInCone.length > 0;
      // Linked signal flashes exactly while its camera is detecting (no hold time).
      if (sigState[cam.linkedSignalId]) {
        sigState[cam.linkedSignalId].flashing = cs.detecting;
      }
    });
  }

  function isSignalActive(signalId) {
    return !!(sigState[signalId] && sigState[signalId].flashing);
  }

  // Shared flash phase (true = "on") driven by the simulation clock, so it
  // freezes when the sim is paused. flashHz full on/off cycles per second.
  function flashOn() {
    const ms = (WW.clock && WW.clock.ms) || 0;
    return Math.sin((ms / 1000) * Math.PI * 2 * WW.config.tuning.flashHz) >= 0;
  }

  WW.detection = { camState, sigState, logEntries, reset, update, isSignalActive, flashOn };
})();
