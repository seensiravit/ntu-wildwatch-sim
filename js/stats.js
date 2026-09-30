/* stats.js — impact scoreboard for the before/after story.
 * Counts detections and car–animal encounters, and tallies near-misses
 * (system off) vs near-misses avoided (system on). Exposed as WW.stats. */
(function () {
  const WW = window.WW || (window.WW = {});

  const state = {
    detections: 0,   // animals seen by a camera (system on only)
    nearMiss: 0,     // dangerous encounters (car fast at an un-warned animal)
    avoided: 0,      // encounters where the car had already slowed (safe)
    speedSum: 0,     // sum of car speed at each encounter (for the average)
    speedCount: 0,
    markers: [],     // active "NEAR MISS" map markers: { x, y, bornMs }
  };

  function reset() {
    state.detections = 0;
    state.nearMiss = 0;
    state.avoided = 0;
    state.speedSum = 0;
    state.speedCount = 0;
    state.markers.length = 0;
  }

  // A camera saw an animal (only called while the system is on).
  function onDetection() { state.detections++; }

  // The car reached a walking animal. safe = it had slowed enough in time.
  function onEncounter(safe, x, y, kmh) {
    state.speedSum += kmh;
    state.speedCount++;
    if (safe) {
      state.avoided++;
    } else {
      state.nearMiss++;
      state.markers.push({ x: x, y: y, bornMs: (WW.clock && WW.clock.ms) || 0 });
    }
  }

  function avgCrossingKmh() {
    return state.speedCount ? Math.round(state.speedSum / state.speedCount) : 0;
  }

  // Prune expired markers and return the live ones (for render.js).
  function activeMarkers() {
    const now = (WW.clock && WW.clock.ms) || 0;
    const life = WW.config.nearMiss.markerMs;
    state.markers = state.markers.filter((m) => now - m.bornMs < life);
    return state.markers;
  }

  WW.stats = { state, reset, onDetection, onEncounter, avgCrossingKmh, activeMarkers };
})();
