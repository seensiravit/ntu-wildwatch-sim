/* scenario.js — the preset scenario: a scripted with/without comparison.
 *
 * Plays config.scenario's acts on both maps with identical animals (same
 * positions, timing, boldness), so the only difference is the car. Each act
 * starts when both cars begin a lap; its animals are released at scripted
 * times; the act ends when both cars have finished the lap and no scripted
 * animal is left. Between acts the cars wait while the caption shows. At the
 * end the sim freezes on a results card (hits by speed at contact, near misses,
 * average speed at the animal, per side). main.js drives update() and reads
 * state; render.js draws the act banner. Exposed as WW.scenario. */
(function () {
  const WW = window.WW || (window.WW = {});

  const state = {
    active: false,
    phase: "idle",   // "caption" | "act" | "done"
    act: -1,         // index into config.scenario.acts
    caption: "",
    title: "",
    results: null,   // { off: {...}, on: {...}, verdict } once done
  };
  let worlds = [];   // set by main.js: [offWorld, onWorld]
  let timer = 0;     // seconds since the current phase began
  let released = 0;  // scripted animals released in this act
  let lapStarted = false; // the act's lap has begun (both cars on the map)
  let hitKmh = null; // per world id: car speeds at each contact during the scenario
  const orig = { onEncounter: null, upgradeToHit: null };

  function cfg() { return WW.config.scenario; }

  // Record the car's speed at every contact while the scenario runs (the
  // scoreboard counts contacts; the results card splits them by speed).
  function hookStats() {
    orig.onEncounter = WW.stats.onEncounter;
    orig.upgradeToHit = WW.stats.upgradeToHit;
    WW.stats.onEncounter = function (kind) {
      if (kind === "hit" && WW.world) hitKmh[WW.world.id].push(WW.car.currentKmh());
      return orig.onEncounter.apply(this, arguments);
    };
    WW.stats.upgradeToHit = function () {
      if (WW.world) hitKmh[WW.world.id].push(WW.car.currentKmh());
      return orig.upgradeToHit.apply(this, arguments);
    };
  }
  function unhookStats() {
    if (!orig.onEncounter) return;
    WW.stats.onEncounter = orig.onEncounter;
    WW.stats.upgradeToHit = orig.upgradeToHit;
    orig.onEncounter = orig.upgradeToHit = null;
  }

  // main.js calls this with the two worlds after resetAll().
  function start(ws) {
    worlds = ws;
    hitKmh = {};
    worlds.forEach((w) => { hitKmh[w.id] = []; });
    hookStats();
    state.active = true;
    state.results = null;
    state.act = -1;
    nextAct();
  }

  function stop() {
    unhookStats();
    state.active = false;
    state.phase = "idle";
    state.act = -1;
    state.caption = "";
    state.title = "";
  }

  function nextAct() {
    state.act++;
    const acts = cfg().acts;
    if (state.act >= acts.length) { finish(); return; }
    const a = acts[state.act];
    state.title = "Act " + (state.act + 1) + " · " + a.title;
    state.caption = a.caption;
    state.phase = "caption";
    timer = 0;
    released = 0;
    lapStarted = false;
  }

  // Are both cars off the map (between laps)?
  function carsOffMap() { return worlds.every((w) => !w.car.state.visible); }
  function carsOnMap() { return worlds.every((w) => w.car.state.visible); }

  // Called by main.js every simulated step, after the worlds have updated.
  // Returns true while the scenario wants the cars held off-map (caption phase).
  function update(dt) {
    if (!state.active || state.phase === "done") return false;
    timer += dt;
    const act = cfg().acts[state.act];

    if (state.phase === "caption") {
      // Show the caption with the cars waiting. Animals with a negative atSec are
      // released that many seconds before the cars start (e.g. one already in the
      // camera's view, so the sign is flashing as the warned car approaches).
      const pause = cfg().captionPauseSec;
      while (released < act.animals.length && act.animals[released].atSec < 0 && pause + act.animals[released].atSec <= timer) {
        WW.animals.spawn(Object.assign({}, act.animals[released++], { state: "walking" }));
      }
      if (timer >= pause) { state.phase = "act"; timer = 0; }
      return true;
    }

    // "act": wait for the lap to begin, then release animals on schedule.
    if (!lapStarted) {
      if (!carsOnMap()) return false;
      lapStarted = true;
      timer = 0;
    }
    while (released < act.animals.length && act.animals[released].atSec <= timer) {
      const spec = act.animals[released++];
      WW.animals.spawn(Object.assign({}, spec, { state: "walking" }));
    }
    // The act ends once all its animals are released, both cars have left the
    // map, and no scripted animal is still walking on either side.
    const animalsLeft = worlds.some((w) => w.animals.length > 0);
    if (released === act.animals.length && carsOffMap() && !animalsLeft) nextAct();
    return false;
  }

  // Snapshot both sides' stats into the results card.
  function finish() {
    const serious = cfg().seriousKmh;
    const side = (w) => {
      const s = w.stats, k = hitKmh[w.id] || [];
      return {
        hits: s.hits,
        seriousHits: k.filter((v) => v > serious).length,
        minorHits: s.hits - k.filter((v) => v > serious).length,
        nearMiss: s.nearMiss,
        safe: s.safe,
        avgKmh: s.speedCount ? Math.round(s.speedSum / s.speedCount) : null,
        hitKmh: k.map((v) => Math.round(v)),
      };
    };
    const off = side(worlds[0]), on = side(worlds[1]);
    state.results = { off: off, on: on };
    state.phase = "done";
    state.title = "Scenario complete";
    state.caption = "";
    unhookStats();
  }

  WW.scenario = { state, start, stop, update };
})();
