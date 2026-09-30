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

  WW.config = {
    map: {
      width: 1000,
      height: 700,
    },

    // ---- Road: L-shape. Horizontal (left edge -> corner), then vertical
    // (corner -> top edge). roadWidth spans both lanes. -------------------
    road: {
      corner: { x: 750, y: 450 },
      roadWidth: 90,
      laneWidth: 45,
      dashLen: 24, // centre-line dash length
      gapLen: 20,
    },

    // ---- Car route: polyline the (single) car follows, in its lane.
    // Enter left -> along the horizontal -> turn at corner -> up -> exit top.
    carPath: [
      { x: -40, y: 472 }, // spawn just off the left edge, lower lane
      { x: 772, y: 472 }, // approach corner along horizontal
      { x: 772, y: -40 }, // turn up, exit off the top edge
    ],

    // ---- Cameras (fixed in v1). Cone derived from facingAngle/fov/range. --
    cameras: [
      {
        id: "cam1",
        name: "Cam 1",
        x: 850,
        y: 470,
        facingAngleDeg: 175, // look west, toward the corner
        fovDeg: 60,
        range: 260,
        linkedSignalId: "signal1",
      },
      {
        id: "cam2",
        name: "Cam 2",
        x: 850,
        y: 200,
        facingAngleDeg: 185, // look west, across the upper vertical stretch
        fovDeg: 55,
        range: 220,
        linkedSignalId: "signal2",
      },
    ],

    // ---- Signals (fixed in v1). Each sits UPSTREAM of its camera's zone
    // along the car path, and owns a warning zone the car uses to slow. ----
    signals: [
      {
        id: "signal1",
        name: "Signal 1",
        x: 480,
        y: 415,
        linkedCameraId: "cam1",
        message: "WILDLIFE AHEAD – SLOW DOWN",
      },
      {
        id: "signal2",
        name: "Signal 2",
        x: 715,
        y: 360,
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

    // ---- Palettes (night is the only active mode in v1; day kept for later)
    palettes: {
      night: {
        grass: "#0d1a12",
        road: "#20262e",
        marking: "#4a4230",
        tree: "#122b1c",
        sky: "#05070b",
      },
      day: {
        grass: "#2f6b3a",
        road: "#565b61",
        marking: "#d8d2b0",
        tree: "#2e7d46",
        sky: "#cfe6ff",
      },
    },

    // Simple decoration (trees/bushes), off-road, purely cosmetic.
    decor: [
      { x: 120, y: 120 }, { x: 300, y: 180 }, { x: 560, y: 110 },
      { x: 180, y: 600 }, { x: 420, y: 640 }, { x: 900, y: 560 },
      { x: 620, y: 250 }, { x: 900, y: 90 },
    ],
  };
})();
