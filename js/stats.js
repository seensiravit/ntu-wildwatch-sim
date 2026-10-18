/* stats.js — impact scoreboard for the before/after story.
 * Counts detections and sorts each car–animal encounter into one of three
 * outcomes: hit (contact), near miss (fast, no contact) or safe (slowed in time).
 * The state is per world (system OFF / ON side): main.js calls use(world) to
 * point this module at one side before updating or drawing it.
 * Exposed as WW.stats. */
(function () {
  const WW = window.WW || (window.WW = {});

  function fresh() {
    return {
      detections: 0,   // animals seen by a camera (system on only)
      hits: 0,         // the car and an animal touched
      nearMiss: 0,     // the car came at an animal fast but didn't touch it
      safe: 0,         // the car had already slowed down, no contact
      speedSum: 0, speedCount: 0, // car speed at each encounter, for the average
      markers: [],     // active "HIT" / "NEAR MISS" map markers: { x, y, bornMs, kind }
    };
  }
  let state = fresh();

  // Switch to a world's scoreboard (created on first use).
  function use(world) { state = world.stats || (world.stats = fresh()); }

  function reset() {
    state.detections = 0;
    state.hits = 0;
    state.nearMiss = 0;
    state.safe = 0;
    state.speedSum = 0; state.speedCount = 0;
    state.markers.length = 0;
  }

  // A camera saw an animal (only called while the system is on).
  function onDetection() { state.detections++; }

  // One car–animal encounter ended. kind: "hit" | "near" | "safe" (see car.js).
  function onEncounter(kind, x, y, kmh) {
    state.speedSum += kmh; state.speedCount++;
    if (kind === "safe") { state.safe++; return; }
    if (kind === "hit") state.hits++;
    else state.nearMiss++;
    state.markers.push({ x: x, y: y, bornMs: (WW.clock && WW.clock.ms) || 0, kind: kind });
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
