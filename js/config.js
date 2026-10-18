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

    // ---- Before/after system state --------------------------------------
    system: { defaultEnabled: true },

    // ---- Near-miss detection (system OFF danger indicator) --------------
    nearMiss: {
      dangerZoneLen: 150,   // how far ahead of the car counts as an encounter
      dangerSpeedKmh: 35,   // above this at the encounter = near-miss, else "avoided"
      markerMs: 1600,       // how long the red NEAR MISS marker stays on the map
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
        fovDeg: 84,          // wide: covers the road plus both verges
        range: 150,
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
    species: [
      { id: "macaque", label: "Macaque",  color: "#c9a06a", radius: 12, speedUnitsPerSec: 40,  heatColor: "#ffd24d", shape: "circle" },
      { id: "boar",    label: "Wild boar", color: "#8a6b52", radius: 18, speedUnitsPerSec: 60,  heatColor: "#ff9a3d", shape: "ellipse" },
      { id: "pangolin",label: "Pangolin", color: "#9a8f70", radius: 11, speedUnitsPerSec: 22,  heatColor: "#ffe08a", shape: "triangle" },
    ],

    // ---- Tuning constants ----------------------------------------------
    tuning: {
      // Speed: map units/sec -> displayed km/h.
      unitsPerSecToKmh: 0.5,
      cruiseKmh: 50,
      warnKmh: 20,
      accelUnitsPerSec2: 120, // smooth speed-up
      decelUnitsPerSec2: 220, // stronger braking
      brakeAheadLen: 120,     // look-ahead rectangle length for animals on road
      signSightDistance: 320, // drivers react once a flashing sign is this far ahead (~ 4x the road width)
      carRespawnDelaySec: 1.5,

      flashHz: 2,             // beacon + message board blink rate
      dragReleaseThreshPx: 5, // pointer move < this on a click = release to Walking
      defaultAnimalDirDeg: 90,// straight down

      confidenceMin: 85,
      confidenceMax: 97,
      logMaxEntries: 50,

      // While the user is placing/aiming an animal (dragging, or an animal is
      // still in the "placed" state), run the sim at this fraction of speed so
      // the scene is easy to arrange. Set to 0 for a full freeze.
      placingTimeScale: 0.15,

      headlight: { fovDeg: 40, range: 170, dimAlpha: 0.4 },
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
    attract: {
      idleStartMs: 6000,   // idle time before the demo auto-plays
      spawnGapMs: 850,     // time between auto-spawned animals (lower = faster)
      maxConcurrent: 5,    // cap on simultaneous auto-demo animals
      // Entry points; each auto-spawn picks one at random and a random species.
      // Animals walk across the road inside the camera's coverage (x ~ 440-590)
      // so the system can warn. Most come off the north verge; one crosses from
      // the Hall 15 side through the gap between buildings. A presenter can still
      // drop one outside the cone to show a coverage gap.
      spawns: [
        { x: 470, y: 190, dirDeg: 92 },
        { x: 510, y: 165, dirDeg: 88 },
        { x: 505, y: 215, dirDeg: 92 }, // (not too close to the camera: its cone is narrow near the tip)
        { x: 485, y: 500, dirDeg: 270 }, // from the Hall 15 side, heading north
      ],
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
