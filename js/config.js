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

  // Nanyang Drive as it bends around the SW corner of Yunnan Garden: enters from
  // the top (north) along the garden's west edge, curves at the corner, then runs
  // diagonally along the south edge (parallel to the PIE) and exits east.
  // Shared by both the road surface and the car's path (single-lane demo).
  const NANYANG_DRIVE = [
    { x: 232, y: -40 },
    { x: 236, y: 150 },
    { x: 248, y: 280 },
    { x: 272, y: 372 },
    { x: 322, y: 446 },
    { x: 420, y: 500 },
    { x: 580, y: 536 },
    { x: 800, y: 562 },
    { x: 1050, y: 588 },
  ];

  WW.config = {
    // ---- Branding / framing (shown in the header + on the map) -----------
    brand: {
      title: "NTU WildWatch",
      tagline: "Wildlife road-crossing early-warning — live simulation",
      location: "Nanyang Drive · Yunnan Garden (simulated) · night",
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

    // ---- Road: Nanyang Drive centerline polyline (bends around Yunnan Garden).
    // The renderer draws the surface/edges/centre-line along `centerline`.
    road: {
      centerline: NANYANG_DRIVE,
      roadWidth: 84,
      laneWidth: 42,
      dashLen: 24,          // centre-line dash length
      gapLen: 20,
      edgeColor: "#5b6473", // solid lane-edge lines
      crosswalkT: 0.62,     // zebra crossing at 62% along the road
      crosswalkStripes: 5,
    },

    // ---- Car route = the road centerline (single-lane demo). Enters top,
    // rounds the bend, exits east.
    carPath: NANYANG_DRIVE,

    // ---- Cameras at the Yunnan Garden crossing hotspots. Each sits on the
    // outer side of Nanyang Drive, looking back toward the garden edge so
    // wildlife emerging from the park is caught as it reaches the road. ------
    cameras: [
      {
        id: "cam1",
        name: "Cam 1 · West edge",
        x: 148,
        y: 250,
        facingAngleDeg: 18,  // look east, across the west stretch into the garden
        fovDeg: 58,
        range: 215,
        linkedSignalId: "signal1",
      },
      {
        id: "cam2",
        name: "Cam 2 · South bend",
        x: 660,
        y: 614,
        facingAngleDeg: 286, // look north, across the south stretch into the garden
        fovDeg: 62,
        range: 240,
        linkedSignalId: "signal2",
      },
    ],

    // ---- Warning signs, each UPSTREAM of its camera's zone along the car path.
    signals: [
      {
        id: "signal1",
        name: "Signal 1 · West",
        x: 262,
        y: 120,
        linkedCameraId: "cam1",
        message: "WILDLIFE AHEAD – SLOW DOWN",
      },
      {
        id: "signal2",
        name: "Signal 2 · Bend",
        x: 330,
        y: 428,
        linkedCameraId: "cam2",
        message: "WILDLIFE AHEAD – SLOW DOWN",
      },
    ],

    // ---- Species (drives the tray + animal entities) --------------------
    species: [
      { id: "macaque", label: "Macaque",  color: "#c9a06a", radius: 12, speedUnitsPerSec: 70,  heatColor: "#ffd24d", shape: "circle" },
      { id: "boar",    label: "Wild boar", color: "#8a6b52", radius: 18, speedUnitsPerSec: 110, heatColor: "#ff9a3d", shape: "ellipse" },
      { id: "pangolin",label: "Pangolin", color: "#9a8f70", radius: 11, speedUnitsPerSec: 40,  heatColor: "#ffe08a", shape: "triangle" },
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
      // Entry points around the verge; each auto-spawn picks one at random and a
      // random species. dirDeg sends the animal across / toward the road.
      // Animals emerge from Yunnan Garden and cross Nanyang Drive within the
      // camera-covered stretches (so the system can warn). A presenter can still
      // drop one in an uncovered spot to show a coverage gap.
      spawns: [
        { x: 430, y: 235, dirDeg: 182 }, // garden -> west stretch (cam 1)
        { x: 430, y: 320, dirDeg: 178 }, // garden -> west stretch (cam 1)
        { x: 610, y: 460, dirDeg: 104 }, // garden -> south bend (cam 2)
        { x: 720, y: 455, dirDeg: 110 }, // garden -> south stretch (cam 2)
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
        garden: "#12271a",  // Yunnan Garden park fill (a touch lighter than grass)
        water: "#0f2740",   // Nanyang Lake
        pie: "#242a24",     // Pan-Island Expressway asphalt
      },
      day: {
        grass: "#2f6b3a",
        road: "#565b61",
        marking: "#d8d2b0",
        tree: "#2e7d46",
        sky: "#cfe6ff",
      },
    },

    // ---- Yunnan Garden scene (drawn under the road) ---------------------
    scene: {
      // Park area filling the inside of the road bend (upper-right).
      gardenArea: [
        { x: 300, y: -40 }, { x: 1050, y: -40 }, { x: 1050, y: 560 },
        { x: 800, y: 536 }, { x: 580, y: 508 }, { x: 420, y: 470 },
        { x: 330, y: 414 }, { x: 292, y: 300 }, { x: 286, y: -40 },
      ],
      // Nanyang Lake (irregular blob inside the garden).
      lake: [
        { x: 470, y: 150 }, { x: 600, y: 120 }, { x: 700, y: 165 },
        { x: 720, y: 250 }, { x: 640, y: 315 }, { x: 520, y: 300 },
        { x: 452, y: 225 },
      ],
      pagoda: { x: 560, y: 380 }, // Nanyang University Memorial Pagoda
      // Pan-Island Expressway: faint diagonal band beyond the south edge.
      pie: { a: { x: 360, y: 735 }, b: { x: 1080, y: 505 }, width: 78 },
      labels: [
        { text: "YUNNAN GARDEN", x: 830, y: 250, size: 20, color: "rgba(150,200,160,0.55)" },
        { text: "Nanyang Lake", x: 585, y: 232, size: 13, color: "rgba(150,190,220,0.7)" },
        { text: "NANYANG DRIVE", x: 150, y: 360, size: 12, color: "rgba(200,208,220,0.45)", angle: 90 },
        { text: "PAN-ISLAND EXPRESSWAY", x: 720, y: 640, size: 12, color: "rgba(200,208,220,0.4)", angle: -17 },
      ],
    },

    // Garden trees/bushes (denser along the road edge), purely cosmetic.
    decor: [
      { x: 340, y: 170 }, { x: 360, y: 380 }, { x: 300, y: 470 },
      { x: 470, y: 430 }, { x: 640, y: 470 }, { x: 820, y: 480 },
      { x: 940, y: 430 }, { x: 900, y: 150 }, { x: 780, y: 90 },
      { x: 470, y: 360 }, { x: 700, y: 400 }, { x: 990, y: 300 },
    ],

    // ---- Team DED dashboard extension (wildwatch-dashboard.js) ------------
    // Its map is campus-wide (4 cameras of its own, coordinates on its 600-wide
    // schematic). Our two live Yunnan Garden cameras are added to it; detections
    // from the sim are reported under these names (detection.js).
    dashboard: {
      locations: [
        { simCamera: "cam1", id: "yunnan-west", name: "Yunnan Garden West", cam: "CAM-05",
          x: 182, y: 346, weight: 0.3, aliases: ["yunnan garden west", "cam-05"],
          mix: { macaque: 0.35, pangolin: 0.25, boar: 0.25, monitor: 0.15 } },
        { simCamera: "cam2", id: "yunnan-south", name: "Yunnan Garden South", cam: "CAM-06",
          x: 322, y: 394, weight: 0.25, aliases: ["yunnan garden south", "cam-06"],
          mix: { boar: 0.3, pangolin: 0.25, monitor: 0.25, macaque: 0.2 } },
      ],
      // Nanyang Drive branching off Nanyang Ave and bending around the garden.
      roads: [{ d: "M148,300 C150,345 165,385 225,400 C290,415 380,412 480,432" }],
      labels: [
        { text: "YUNNAN GARDEN", x: 238, y: 352, size: 10, weight: 700, spacing: 1, color: "#5f8a74" },
        { text: "Nanyang Dr", x: 392, y: 432, rot: 8 },
      ],
      mapHeight: 460,   // taller than its default 400 to fit the south edge
      showDock: false,  // our in-map signs + signal cards already show the response
    },
  };

  // Hand the dashboard settings to the extension (it reads them when it loads,
  // which is after this file — see the script order in index.html).
  const dash = WW.config.dashboard;
  window.WILDWATCH_CONFIG = Object.assign({}, window.WILDWATCH_CONFIG, {
    extraLocations: dash.locations,
    extraRoads: dash.roads,
    extraLabels: dash.labels,
    mapHeight: dash.mapHeight,
    showDock: dash.showDock,
    autoWatchLog: false, // we always call WildWatch.record(), so skip log scraping
  });
})();
