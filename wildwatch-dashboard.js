/* wildwatch-dashboard.js — PLACEHOLDER for the team's dashboard extension.
 *
 * Replace this whole file with the real wildwatch-dashboard.js (same path) and
 * the dashboard drops straight in — our simulator already reports detections to
 * the shared contract:
 *
 *   const ev = window.WildWatch.record({ species, location, confidence, proximity });
 *   // ev -> { time, riskLevel, beaconActivated }
 *
 * This stub just implements that contract so the page has no missing-script
 * error and the integration hook is live. It renders no UI of its own.
 *
 * Classic script, no deps — loaded via <script src> in index.html (file:// safe).
 */
(function () {
  if (window.WildWatch) return; // the real extension, if present, wins

  function riskLevel(confidence) {
    if (confidence >= 0.9) return "HIGH";
    if (confidence >= 0.8) return "MEDIUM";
    return "LOW";
  }

  window.WildWatch = {
    // Called once per detection by js/detection.js.
    record: function (d) {
      return {
        time: new Date(),
        riskLevel: riskLevel((d && d.confidence) || 0),
        beaconActivated: true,
      };
    },
  };
})();
