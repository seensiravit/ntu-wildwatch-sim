/* stats.js — impact scoreboard for the before/after story.
 * Counts detections and car–animal encounters, and tallies near-misses vs
 * encounters the car had already slowed for ("avoided").
 * The state is per world (system OFF / ON side): main.js calls use(world) to
 * point this module at one side before updating or drawing it.
 * Exposed as WW.stats. */
(function () {
  const WW = window.WW || (window.WW = {});

  function fresh() {
    return {
      detections: 0,   // animals seen by a camera (system on only)
      nearMiss: 0,     // dangerous encounters (car fast at an un-warned animal)
      avoided: 0,      // encounters where the car had already slowed (safe)
      speedSum: 0, speedCount: 0, // car speed at each encounter, for the average
      markers: [],     // active "NEAR MISS" map markers: { x, y, bornMs }
    };
  }
  let state = fresh();

  // Switch to a world's scoreboard (created on first use).
  function use(world) { state = world.stats || (world.stats = fresh()); }

  function reset() {
    state.detections = 0;
    state.nearMiss = 0;
    state.avoided = 0;
    state.speedSum = 0; state.speedCount = 0;
    state.markers.length = 0;
  }

  // A camera saw an animal (only called while the system is on).
  function onDetection() { state.detections++; }

  // The car reached a walking animal. safe = it had slowed enough in time.
  function onEncounter(safe, x, y, kmh) {
    state.speedSum += kmh; state.speedCount++;
    if (safe) {
      state.avoided++;
    } else {
      state.nearMiss++;
      state.markers.push({ x: x, y: y, bornMs: (WW.clock && WW.clock.ms) || 0 });
    }
  }

  // Average car speed at the crossing (null when no data yet).
  function avgKmh() { return state.speedCount ? Math.round(state.speedSum / state.speedCount) : null; }

  // Prune expired markers and return the live ones (for render.js).
  function activeMarkers() {
    const now = (WW.clock && WW.clock.ms) || 0;
    const life = WW.config.nearMiss.markerMs;
    // Keep only markers within their lifetime (0 <= age < life): a negative age would
    // give drawNearMiss a negative arc radius, and that exception stops the render loop.
    state.markers = state.markers.filter((m) => { const age = now - m.bornMs; return age >= 0 && age < life; });
    return state.markers;
  }

  WW.stats = {
    get state() { return state; },
    use, reset, onDetection, onEncounter, avgKmh, activeMarkers,
  };
})();
