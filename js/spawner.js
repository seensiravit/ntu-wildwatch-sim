/* spawner.js — when and where animals arrive at the road.
 *
 * Arrivals are a clustered (compound) Poisson process:
 *  - GROUPS arrive as a Poisson process. The gap between groups is a shifted
 *    exponential: minGapSec + Exp(mean = meanGapSec - minGapSec). Exponential
 *    gaps are what "random, independent arrivals" means (a Poisson process);
 *    the small minimum keeps two unrelated groups from landing at the same
 *    moment, which pure exponential gaps make common at demo speed.
 *  - Each group is one species (by spawnWeight) and 1 + Poisson(extra) animals,
 *    capped: macaque troops and wild-boar sounders sometimes cross in a line,
 *    pangolins alone. This clumping is why real roadkill counts are
 *    overdispersed (more variable than a plain Poisson count).
 *  - WHERE: along the road ~ Normal(hotspot, sd); north/south side by share;
 *    heading straight across +/- a little; speed = species speed x ~N(1, sd).
 * Every draw comes from a seeded generator, so a run can be replayed exactly
 * (the research study depends on that). All numbers live in config.spawning
 * and in each species' spawn settings. Exposed as WW.spawner. */
(function () {
  const WW = window.WW || (window.WW = {});

  // Small, fast seeded PRNG: returns a function giving uniform numbers in [0, 1).
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Standard normal (Box-Muller).
  function gauss(rnd) {
    const u = Math.max(1e-12, rnd()), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Poisson-distributed count with the given mean (Knuth's method; fine for small means).
  function poisson(rnd, mean) {
    if (mean <= 0) return 0;
    const limit = Math.exp(-mean);
    let k = 0, p = rnd();
    while (p > limit) { k++; p *= rnd(); }
    return k;
  }

  // Exponential with the given mean (inverse-CDF sampling).
  function exponential(rnd, mean) { return -Math.log(1 - rnd()) * mean; }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function between(rnd, range) { return range[0] + rnd() * (range[1] - range[0]); }

  // y of the road centreline at x (interpolated; assumes the road runs west-east).
  function roadYAt(x) {
    const cl = WW.config.road.centerline;
    for (let i = 0; i < cl.length - 1; i++) {
      const a = cl[i], b = cl[i + 1];
      if ((x >= a.x && x <= b.x) || (x >= b.x && x <= a.x)) {
        const f = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
        return a.y + (b.y - a.y) * f;
      }
    }
    return x < cl[0].x ? cl[0].y : cl[cl.length - 1].y;
  }

  // A stream of spawn events, in time order.
  //   opts.rnd        seeded generator (mulberry32); required
  //   opts.startSec   stream clock at creation (default 0)
  //   opts.firstAtSec time of the first group (default: one random gap after startSec)
  //   opts.meanGapSec function returning the current mean gap (lets a UI knob change it live)
  //   opts.xDist      function(rnd) -> x, replacing the hotspot distribution
  // Event: { t, speciesId, x, y, dirDeg, speedMul, boldness, groupId }
  function createStream(opts) {
    const cfg = WW.config.spawning;
    const rnd = opts.rnd;
    const meanGap = opts.meanGapSec || (() => cfg.meanGapSec);
    const queue = []; // generated but not yet due, sorted by t
    let groupId = 0;
    let nextGroupT = opts.firstAtSec !== undefined ? opts.firstAtSec : (opts.startSec || 0) + gap();

    function gap() {
      const mean = Math.max(0.1, meanGap());
      const min = Math.min(cfg.minGapSec, mean);
      return min + exponential(rnd, mean - min);
    }

    function pickSpecies() {
      const list = WW.config.species;
      const total = list.reduce((s, sp) => s + sp.spawn.weight, 0);
      let r = rnd() * total;
      for (const sp of list) { r -= sp.spawn.weight; if (r < 0) return sp; }
      return list[list.length - 1];
    }

    // Draw one group and queue its members.
    function makeGroup(t) {
      const sp = pickSpecies();
      const size = Math.min(sp.spawn.maxGroup, 1 + poisson(rnd, sp.spawn.extraMean));
      const north = rnd() < cfg.northShare;
      const x = clamp(opts.xDist ? opts.xDist(rnd) : cfg.hotspot.x + gauss(rnd) * cfg.hotspot.sd, cfg.xMin, cfg.xMax);
      const edge = roadYAt(x) + (north ? -1 : 1) * WW.config.road.roadWidth / 2;
      const y = edge + (north ? -1 : 1) * between(rnd, north ? cfg.northStart : cfg.southStart);
      const dirDeg = (north ? 90 : 270) + gauss(rnd) * cfg.headingSdDeg;
      // The group walks together: shared speed and boldness (how readily it
      // crosses in front of a car; see config.crossing / animals.js).
      const speedMul = clamp(1 + gauss(rnd) * cfg.speedSd, cfg.speedMin, cfg.speedMax);
      const boldness = rnd();
      groupId++;
      let tm = t;
      for (let i = 0; i < size; i++) {
        if (i > 0) tm += between(rnd, cfg.followerGapSec);
        queue.push({
          t: tm, speciesId: sp.id, groupId: groupId, speedMul: speedMul, boldness: boldness,
          x: i ? x + gauss(rnd) * cfg.followerSpread : x, y: y, dirDeg: i ? dirDeg + gauss(rnd) * 2 : dirDeg,
        });
      }
      queue.sort((a, b) => a.t - b.t);
    }

    return {
      // Remove and return every event due by `now`.
      due(now) {
        while (nextGroupT <= now) { makeGroup(nextGroupT); nextGroupT += gap(); }
        const out = [];
        while (queue.length && queue[0].t <= now) out.push(queue.shift());
        return out;
      },
      // The first `count` events (for a pre-built research schedule). Events before
      // the next group's start are final: no later group can come earlier.
      take(count) {
        while (queue.filter((e) => e.t < nextGroupT).length < count) { makeGroup(nextGroupT); nextGroupT += gap(); }
        return queue.splice(0, count);
      },
    };
  }

  WW.spawner = { mulberry32, gauss, poisson, exponential, createStream, roadYAt };
})();
