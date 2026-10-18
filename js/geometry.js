/* geometry.js — pure, stateless helpers (path, cone, point-in-polygon).
 * These are real (deterministic math, unlikely to change) so the render
 * shell can draw meaningful cones/paths from day one.
 * Exposed as WW.geo. */
(function () {
  const WW = window.WW || (window.WW = {});

  const degToRad = (d) => (d * Math.PI) / 180;

  function dist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
  }

  // Triangle-fan polygon approximating a camera view cone.
  // Returns [{x,y}, ...] with the apex first, then arc points.
  function conePolygon(x, y, facingAngleDeg, fovDeg, range, steps) {
    steps = steps || 12;
    const pts = [{ x, y }];
    const start = degToRad(facingAngleDeg - fovDeg / 2);
    const end = degToRad(facingAngleDeg + fovDeg / 2);
    for (let i = 0; i <= steps; i++) {
      const a = start + ((end - start) * i) / steps;
      pts.push({ x: x + Math.cos(a) * range, y: y + Math.sin(a) * range });
    }
    return pts;
  }

  // Ray-casting point-in-polygon. poly = [{x,y}, ...].
  function pointInPolygon(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect =
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Whether a point is inside a cone (cheap: angle + range test).
  function pointInCone(px, py, cam) {
    const d = dist(cam.x, cam.y, px, py);
    if (d > cam.range) return false;
    let ang = (Math.atan2(py - cam.y, px - cam.x) * 180) / Math.PI;
    let diff = Math.abs(((ang - cam.facingAngleDeg + 540) % 360) - 180);
    return diff <= cam.fovDeg / 2;
  }

  // Shortest distance from a point to a polyline (e.g. the road centreline).
  function distToPolyline(px, py, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
      best = Math.min(best, Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t)));
    }
    return best;
  }

  WW.geo = { degToRad, dist, conePolygon, pointInPolygon, pointInCone, distToPolyline };
})();
