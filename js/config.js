/* config.js — ALL map geometry, entities and tuning constants live here.
 *
 * Everything is in LOGICAL MAP UNITS on a 1000 x 700 grid, scaled to the
 * canvas at render time. Nothing about the scene is hard-coded in the render
 * or logic files — to move the road/cameras/signals (e.g. to the real NTU
 * map later), edit ONLY this file.
 *
 * Angle convention: degrees, clockwise from EAST (screen +x), with +y pointing
 * DOWN (canvas convention). So 0=right, 90=down, 180=left, 270=up.
 *
 * Exposed as the global `WW.config` (no ES modules — file:// safe).
 */
(function () {
  const WW = window.WW || (window.WW = {});

  // Nanyang Crescent opposite Hall 15 (Tamarind area): a straight stretch with the
  // green verge and the Sungei Choa Chu Kang canal to the north (wildlife side) and
  // the Hall 15 blocks to the south. Drawn straight across the map, west -> east.
  // This is the road's centre line; the car drives in its lane beside it.
  const NANYANG_CRESCENT = [
    { x: -40, y: 380 },
    { x: 1040, y: 380 },
  ];
  const LANE_WIDTH = 42;

  // Shift a polyline sideways by d units. d > 0 moves it to the LEFT of the
  // direction of travel (screen y points down, so left of (ux, uy) is (uy, -ux)).
  // Each point uses the direction between its neighbours, so bends work too.
  function sidePath(pts, d) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: p.x + (d * (b.y - a.y)) / len, y: p.y - (d * (b.x - a.x)) / len };
    });
  }

  WW.config = {
    // ---- Branding / framing (shown in the header + on the map) -----------
    brand: {
      title: "NTU WildWatch",
      tagline: "Wildlife road-crossing early-warning — live simulation",
      location: "Nanyang Crescent · Opp Hall 15, Tamarind area (simulated) · night",
      insight: "Why it works: cameras detect wildlife beyond the reach of the driver's headlights.",
    },

    // ---- Legend / key (what the on-screen elements mean) ----------------
    legend: [
      { kind: "cone",   label: "Camera coverage (edge-AI detection zone)" },
      { kind: "sign",   label: "Warning sign — flashes when wildlife is detected" },
      { kind: "thermal",label: "Simulated thermal camera view" },
      { kind: "dim",    label: "Dimmed = beyond the driver's headlights" },
    ],

    // ---- Near-miss detection (the before/after scoreboard) ----------------
    // The page shows the scene twice, system OFF (left) and ON (right), with
    // the same animals; these rules score each car's encounters.
    nearMiss: {
      dangerZoneLen: 150,   // an encounter starts when an animal is in the lane this far ahead
      dangerSpeedKmh: 35,   // faster than this then = near miss (or hit, on contact), else safe
      markerMs: 1600,       // how long a HIT / NEAR MISS marker stays on the map
    },

    map: {
      width: 1000,
      height: 700,
    },

    // ---- Road: Nanyang Crescent centerline (a straight line).
    // The renderer draws the surface/edges/centre-line along `centerline`.
    road: {
      centerline: NANYANG_CRESCENT,
      roadWidth: 84,
      laneWidth: LANE_WIDTH,
      dashLen: 24,          // centre-line dash length
      gapLen: 20,
      edgeColor: "#5b6473", // solid lane-edge lines
      crosswalkT: 0.24,     // zebra crossing at 24% along the road, west of the zone
      crosswalkStripes: 5,
    },

    // ---- Car route: west -> east (left to right), in its own lane. Singapore
    // drives on the left, so the car keeps half a lane to the LEFT of the centre
    // line (for eastbound traffic that's the north lane). For westbound use
    // sidePath(NANYANG_CRESCENT.slice().reverse(), LANE_WIDTH / 2) (south lane).
    carPath: sidePath(NANYANG_CRESCENT, LANE_WIDTH / 2),
    // The other lane, westbound. The demo doesn't use it; research/ scores camera
    // layouts in both directions by swapping it into carPath (with carDir "west").
    carPathWest: sidePath(NANYANG_CRESCENT.slice().reverse(), LANE_WIDTH / 2),

    // ---- One overhead camera on the road centreline, looking west along the
    // road toward oncoming (eastbound) traffic. Its wide cone spans the whole
    // carriageway and both verges, so an animal crossing from either side is
    // caught. Cars pass under it. ------------------------------------------
    cameras: [
      {
        id: "cam1",
        name: "Cam 1 · Opp Hall 15",
        x: 590,
        y: 380,              // on the centreline (same y as the road)
        facingAngleDeg: 180, // look west, along the road
        fovDeg: 110,         // wide: covers the road plus both verges (research/settings: 110° cut serious hits most)
        range: 250,          // reaches ~90 units up the wildlife verge at the hotspot, so animals are seen before they step out
      },
    ],

    // ---- Two warning signs flanking the road at the camera (like a gantry),
    // one on each verge, both driven by cam1. Eastbound drivers see them ahead
    // (tuning.signSightDistance) while approaching the detection zone. Signs
    // link to their camera via linkedCameraId; one camera can drive several.
    signals: [
      {
        id: "signal1",
        name: "Signal 1 · North verge",
        x: 554,
        y: 281,              // north of the road; post reaches down to the kerb
        linkedCameraId: "cam1",
        message: "WILDLIFE AHEAD – SLOW DOWN",
      },
      {
        id: "signal2",
        name: "Signal 2 · Hall 15 side",
        x: 569,
        y: 440,              // just south of the road
        linkedCameraId: "cam1",
        message: "WILDLIFE AHEAD – SLOW DOWN",
      },
    ],

    // ---- Species (drives the tray + animal entities) --------------------
    // spawn:   how often each species turns up and in what group sizes
    //          (weight = share of groups; size = 1 + Poisson(extraMean), capped).
    //          Boar weighted highest: they were 68% of crossings on a forest-edge
    //          road in Singapore (Ecosphere 2024). Pangolins are solitary.
    // traffic: what it does at the roadside when a car is near (see `crossing`).
    //          Response types from Jacobson et al. 2016 (Ecosphere): avoiders
    //          hold back, speeders dash across, pausers freeze. The probabilities
    //          are assumptions chosen to match those types, not measured values.
    //          notice = chance it notices a nearby car at all (else it just keeps
    //          walking); then cross / wait = chance to cross anyway / to wait (else turn back),
    //          decided by the animal's boldness; maxWaitSec = then it gives up.
    species: [
      { id: "macaque", label: "Macaque",  color: "#c9a06a", radius: 12, speedUnitsPerSec: 40,  heatColor: "#ffd24d", shape: "circle",
        spawn: { weight: 0.40, extraMean: 1.0, maxGroup: 4 },  // troops cross in a line
        traffic: { type: "avoider", notice: 0.95, cross: 0.25, wait: 0.50, maxWaitSec: 10, crossSpeedMul: 1 } },
      { id: "boar",    label: "Wild boar", color: "#8a6b52", radius: 18, speedUnitsPerSec: 60,  heatColor: "#ff9a3d", shape: "ellipse",
        spawn: { weight: 0.45, extraMean: 0.6, maxGroup: 4 },  // sounders
        traffic: { type: "speeder", notice: 0.90, cross: 0.50, wait: 0.35, maxWaitSec: 6, crossSpeedMul: 1.6 } },
      { id: "pangolin",label: "Pangolin", color: "#9a8f70", radius: 11, speedUnitsPerSec: 22,  heatColor: "#ffe08a", shape: "triangle",
        spawn: { weight: 0.15, extraMean: 0, maxGroup: 1 },    // solitary
        traffic: { type: "pauser", notice: 0.75, cross: 0.30, wait: 0.60, maxWaitSec: 12, crossSpeedMul: 1 } },  // poor eyesight; curls up when threatened
    ],

    // ---- When and where animals arrive (js/spawner.js) -------------------
    // Groups arrive as a Poisson process: gaps are minGapSec + exponential, with
    // an average of one group every meanGapSec (demo time is compressed; the
    // "Animal activity" knob changes it). Crossing points cluster around the
    // Tamarind verge hotspot.
    spawning: {
      meanGapSec: 12,            // average time between groups (knob level 4)
      minGapSec: 3,              // no two unrelated groups closer than this
      maxConcurrent: 12,         // safety cap on animals on screen
      followerGapSec: [0.8, 1.8], // time between members of a group
      followerSpread: 8,         // sideways scatter of followers (units)
      hotspot: { x: 490, sd: 60 }, // crossing point along the road ~ Normal(x, sd)
      xMin: 20, xMax: 980,
      northShare: 0.75,          // share of groups from the wildlife verge (north)
      northStart: [100, 140],    // start this far north of the road edge
      southStart: [50, 80],      // ...or this far south of it (Hall 15 side)
      headingSdDeg: 8,           // spread around straight across
      speedSd: 0.12, speedMin: 0.7, speedMax: 1.3, // speed multiplier ~ N(1, sd), limited
    },

    // ---- Roadside behaviour near a car (js/animals.js) -------------------
    // An animal decides once, decisionDist before the road edge. A car is a
    // threat if it is approaching within approachRadius of the animal's
    // crossing point (it sees and hears it coming), or stopped within
    // stoppedRadius of it. With no threat the animal crosses; otherwise its
    // species' traffic settings decide. A waiting animal crosses once the threat
    // has been gone for clearSec (a gap in traffic, as deer studies describe).
    crossing: {
      decisionDist: 25,
      approachRadius: 170,
      stoppedRadius: 70,
      stoppedKmh: 1,
      clearSec: 1,
    },

    // ---- Tuning constants ----------------------------------------------
    tuning: {
      // Speed: map units/sec -> displayed km/h.
      unitsPerSecToKmh: 0.5,
      cruiseKmh: 50,
      warnKmh: 20,
      // ---- Driver model (js/car.js; values from driving research, see README
      // "Driver model"). 1 unit ≈ 0.139 m, so 1 m/s² ≈ 7.2 units/s².
      // Perception-reaction time before the driver starts braking. Set to a quick
      // 0.5 s for the demo (an attentive driver; research means are 1.1-1.3 s,
      // Green 2000 / SHRP2) so the car visibly stops for animals it has seen.
      driverReactionSec: 0.5,
      alertReactionSec: 0.35,  // expected hazard: warned by a sign, or already watching the animal
      footMoveSec: 0.2,        // last part of the reaction: foot off the accelerator, onto the brake
      coastDecelUnitsPerSec2: 3.6,      // the car coasts meanwhile (≈ 0.5 m/s²)
      // Braking builds up at ≈ 2.5 / 6 / 12 m/s³ (gentle below 18 units/s² of braking,
      // firm below 36, emergency above); letting off the brake takes < 1 s (release);
      // pressing the accelerator is gentle. Units/s³.
      jerk: { gentle: 18, firm: 43, emergency: 86, release: 86, firmAbove: 18, emergencyAbove: 36 },
      stopFrontLoad: 1.3,      // stopping for an animal: brake 1.3x harder than strictly needed, easing into the stop
      finishSpeedUnits: 11,    // below ≈ 5.5 km/h, brake exactly as needed to land on the stop point
      maxDecelUnitsPerSec2: 57.6,       // emergency limit ≈ 8 m/s² (≈ 0.8 g)
      stopGap: 15,             // aim to halt this far short of the animal (units)
      clearHoldSec: 0.5,       // once the animal has cleared, wait this long before driving off
      accelUnitsPerSec2: 10.8, // then speed up at ≈ 1.5 m/s² (normal driving)
      signDecelUnitsPerSec2: 24,        // slowing for a flashing sign ≈ 3.4 m/s² (AASHTO design value)
      // A flashing sign means an animal is in the crossing area: the driver stops
      // before the area (the camera's coverage) and waits for the sign to go off.
      stopForSign: true,       // false = a warned driver only slows to warnKmh (no stop line); used by research/settings
      stopBeforeArea: 20,      // stop line: this far before the camera's coverage starts (units); with range 250 that is x 320, clear of the hotspot
      signStopMaxDecelUnitsPerSec2: 45, // stop for the sign only if it needs ≤ ≈ 6 m/s²; else go through slowly
      signClearSec: 1.0,       // drive on once the sign has been off this long
      signMaxWaitSec: 20,      // ...or after waiting this long at the line (then go through slowly)
      otherLaneDecelUnitsPerSec2: 18,   // animal in the other lane: slow at ≈ 2.5 m/s² (up to 5 if needed) ...
      otherLaneStopDecelUnitsPerSec2: 36, // ...to a speed it could still stop from at ≈ 5 m/s² if it steps across
      otherLaneMinKmh: 20,     // ...but passes it no slower than this
      vergeCautionKmh: 40,     // animal on the verge, lit by the headlights: ease off to this...
      vergeCautionDist: 40,    // ...if it is within this distance of the kerb
      vergeDecelUnitsPerSec2: 9,        // ...at ≈ 1.25 m/s²
      signSightDistance: 480, // drivers see a flashing sign from this far ahead (≈ 67 m; far enough to stop at the line at ≈ 3.5 m/s²)
      carRespawnDelaySec: 1.5, // pause before the next lap (both cars start it together)

      flashHz: 2,             // beacon + message board blink rate
      dragReleaseThreshPx: 6, // a click on a placed animal moving < this many screen px releases it to Walking
      defaultAnimalDirDeg: 90,// straight down

      confidenceMin: 85,
      confidenceMax: 97,
      logMaxEntries: 50,

      // While the user is placing/aiming an animal (dragging, or an animal is
      // still in the "placed" state), run the sim at this fraction of speed so
      // the scene is easy to arrange. Set to 0 for a full freeze.
      placingTimeScale: 0.15,

      // The driver spots an animal on the road up to `range` ahead (≈ 21 m: an
      // unalerted driver sees a dark animal under low beams at roughly half the
      // ~34 m an alerted one does), and one on the verge only inside this beam.
      // At 50 km/h that is just short of the distance needed to stop for an animal
      // first seen at the edge of the light ("outdriving the headlights").
      headlight: { fovDeg: 40, range: 150, dimAlpha: 0.4 },
    },

    // ---- UI / interaction affordance sizes (logical map units) ----------
    ui: {
      arrowLen: 46,        // direction arrow length beyond the body edge
      arrowHead: 10,       // arrowhead size
      arrowGrabRadius: 16, // how close a pointer must be to grab the arrow tip
      bodyGrabSlack: 6,    // extra pick radius beyond the body edge
      carLen: 36,          // car body length (along travel)
      carWidth: 18,        // car body width
      carColor: "#e8e2d0",
    },

    // ---- Attract / auto-demo mode ---------------------------------------
    // After this much idle time the demo plays itself, with animals arriving as
    // described in `spawning`.
    attract: {
      idleStartMs: 6000,
      firstGroupSec: 1,    // the first group appears this soon after the demo starts
    },

    // ---- Palettes (night is the only active mode in v1; day kept for later)
    palettes: {
      night: {
        grass: "#0d1a12",
        road: "#20262e",
        marking: "#4a4230",
        tree: "#122b1c",
        sky: "#05070b",
        verge: "#12271a",    // green verge (a touch lighter than grass)
        water: "#0f2740",    // Sungei Choa Chu Kang canal
        building: "#1b222b", // Hall 15 blocks
      },
      day: {
        grass: "#2f6b3a",
        road: "#565b61",
        marking: "#d8d2b0",
        tree: "#2e7d46",
        sky: "#cfe6ff",
      },
    },

    // ---- Scene around the road (drawn under it). Every part is optional. ----
    scene: {
      // Green verge between the canal and the road (the wildlife side).
      greenArea: [
        { x: -40, y: 96 }, { x: 1040, y: 88 }, { x: 1040, y: 338 }, { x: -40, y: 338 },
      ],
      // Sungei Choa Chu Kang canal along the top edge.
      water: [
        { x: -40, y: 30 }, { x: 1040, y: 22 }, { x: 1040, y: 88 }, { x: -40, y: 96 },
      ],
      // Hall 15 blocks south of the road (x, y = top-left corner).
      buildings: [
        { x: 90, y: 505, w: 170, h: 110 },
        { x: 320, y: 530, w: 130, h: 125 },
        { x: 520, y: 560, w: 150, h: 95 },
        { x: 740, y: 510, w: 180, h: 110 },
      ],
      labels: [
        { text: "SUNGEI CHOA CHU KANG", x: 500, y: 60, size: 12, color: "rgba(150,190,220,0.6)" },
        { text: "GREEN VERGE (OPPOSITE HALL 15)", x: 250, y: 300, size: 11, color: "rgba(150,200,160,0.5)" },
        { text: "NANYANG CRESCENT", x: 860, y: 405, size: 12, color: "rgba(200,208,220,0.45)" },
        { text: "HALL 15", x: 830, y: 568, size: 16, color: "rgba(200,208,220,0.5)" },
      ],
    },

    // Trees and bushes, mostly on the verge; purely cosmetic.
    decor: [
      { x: 70, y: 170 }, { x: 190, y: 250 }, { x: 330, y: 150 },
      { x: 450, y: 280 }, { x: 520, y: 130 }, { x: 760, y: 160 },
      { x: 880, y: 250 }, { x: 960, y: 140 }, { x: 40, y: 300 },
      { x: 720, y: 300 }, { x: 300, y: 480 }, { x: 960, y: 470 },
    ],

    // ---- Team DED dashboard extension (wildwatch-dashboard.js) ------------
    // Its campus map already has a "Tamarind area" camera, so our one camera
    // reports there — no extra map node needed.
    dashboard: {
      // Which dashboard location each sim camera reports as. The name must match
      // one of the extension's locations (its own four, or extraLocations below).
      cameraLocations: {
        cam1: { name: "Tamarind area", cam: "CAM-04" },
      },
      // Optional extra cameras/roads/labels for its map (see [host-config] there).
      extraLocations: [],
      extraRoads: [],
      extraLabels: [],
      showDock: false,  // our in-map sign + signal card already show the response
    },
  };

  // Hand the dashboard settings to the extension (it reads them when it loads,
  // which is after this file — see the script order in index.html).
  const dash = WW.config.dashboard;
  window.WILDWATCH_CONFIG = Object.assign({}, window.WILDWATCH_CONFIG, {
    extraLocations: dash.extraLocations,
    extraRoads: dash.extraRoads,
    extraLabels: dash.extraLabels,
    showDock: dash.showDock,
    autoWatchLog: false, // we always call WildWatch.record(), so skip log scraping
  });
})();
