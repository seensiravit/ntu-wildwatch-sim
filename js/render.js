/* render.js — draws the map + night scene (SPEC §4, §8).
 * Refined v1.1: DPR-crisp, atmospheric night, recognizable animal silhouettes,
 * camera->signal link lines, detection ripples, car brake lights, walk bob.
 * Exposed as WW.render. */
(function () {
  const WW = window.WW || (window.WW = {});

  // Per-signal eased on/off (for a soft board fade), kept per world so the
  // OFF and ON maps fade independently. use(world) is called by main.js.
  let sigIntensity = {};
  function use(world) { sigIntensity = world.sigIntensity || (world.sigIntensity = {}); }

  function clockMs() { return (WW.clock && WW.clock.ms) || 0; }

  // Is this animal currently inside any camera cone (for the detection ripple)?
  function isDetected(a) {
    const cs = WW.detection.camState;
    for (const id in cs) {
      if (cs[id].animalsInCone.some((h) => h.animal.id === a.id)) return true;
    }
    return false;
  }

  function frame(ctx, W, H) {
    const cfg = WW.config;
    const pal = cfg.palettes.night;
    const sx = W / cfg.map.width;
    const sy = H / cfg.map.height;
    const P = (p) => ({ x: p.x * sx, y: p.y * sy });

    // Night ground with a soft glow toward the centre of the scene.
    ctx.fillStyle = pal.grass;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(30,52,40,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawScene(ctx, cfg, P, sx);
    drawDecor(ctx, cfg, P, sx);
    drawRoad(ctx, cfg, sx, P);
    drawLabels(ctx, cfg, P, sx);
    drawLinks(ctx, cfg, P, sx);
    drawCones(ctx, cfg, P, sx);
    drawSignals(ctx, cfg, P, sx);
    drawCar(ctx, cfg, P, sx);
    drawAnimals(ctx, cfg, P, sx);
    drawNearMiss(ctx, P, sx);
    if (!WW.system.enabled) drawSystemOff(ctx, W, H);

    // Vignette for depth (darkens the edges only).
    const v = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.max(W, H) * 0.62);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.34)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    // Location label (bottom-right)
    ctx.fillStyle = "rgba(207,216,227,0.45)";
    ctx.font = Math.round(12 * sx) + "px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(cfg.brand.location, W - 14, H - 12);
    ctx.textAlign = "left";
  }

  function headlightCam() {
    const c = WW.car.state, h = WW.config.tuning.headlight;
    return { x: c.x, y: c.y, facingAngleDeg: c.headingDeg, fovDeg: h.fovDeg, range: h.range };
  }

  // Faint link from each signal to the camera that drives it: makes the
  // "this camera drives that sign" relationship visible; brightens on detect.
  function drawLinks(ctx, cfg, P, sx) {
    if (!WW.system.enabled) return; // no camera->sign relationship without the system
    cfg.signals.forEach((sig) => {
      const cam = cfg.cameras.find((c) => c.id === sig.linkedCameraId);
      if (!cam) return;
      const a = P(cam), b = P(sig);
      const active = WW.detection.isSignalActive(sig.id);
      ctx.save();
      ctx.setLineDash([2 * sx, 6 * sx]);
      ctx.lineWidth = Math.max(1, 1.2 * sx);
      ctx.strokeStyle = active ? "rgba(255,176,32,0.55)" : "rgba(159,176,196,0.16)";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawCar(ctx, cfg, P, sx) {
    const c = WW.car.state;
    if (!c.visible) return;
    const h = cfg.tuning.headlight;
    const rad = WW.geo.degToRad(c.headingDeg);
    const cp = P(c);

    // Headlight cone
    const poly = WW.geo.conePolygon(c.x, c.y, c.headingDeg, h.fovDeg, h.range);
    ctx.beginPath();
    poly.forEach((pt, i) => { const s = P(pt); i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y); });
    ctx.closePath();
    const tip = P({ x: c.x + Math.cos(rad) * h.range, y: c.y + Math.sin(rad) * h.range });
    const grad = ctx.createLinearGradient(cp.x, cp.y, tip.x, tip.y);
    grad.addColorStop(0, "rgba(255,244,200,0.38)");
    grad.addColorStop(1, "rgba(255,244,200,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    // Body oriented along heading, with rounded ends.
    ctx.save();
    ctx.translate(cp.x, cp.y);
    ctx.rotate(rad);
    const L = cfg.ui.carLen * sx, Wd = cfg.ui.carWidth * sx, rr = Wd * 0.28;
    roundRect(ctx, -L / 2, -Wd / 2, L, Wd, rr);
    ctx.fillStyle = cfg.ui.carColor;
    ctx.fill();
    // Windscreen
    ctx.fillStyle = "rgba(40,60,90,0.85)";
    roundRect(ctx, L * 0.08, -Wd / 2 + 2 * sx, L * 0.22, Wd - 4 * sx, rr * 0.6);
    ctx.fill();
    // Headlight dots (front)
    ctx.fillStyle = "#fff6cf";
    dot(ctx, L / 2 - 2 * sx, -Wd / 2 + 3 * sx, 1.6 * sx);
    dot(ctx, L / 2 - 2 * sx, Wd / 2 - 3 * sx, 1.6 * sx);
    // Brake lights (rear) — bright red while braking.
    ctx.fillStyle = c.braking ? "#ff3b30" : "#5a1512";
    if (c.braking) { ctx.shadowColor = "#ff3b30"; ctx.shadowBlur = 8 * sx; }
    dot(ctx, -L / 2 + 2 * sx, -Wd / 2 + 3 * sx, 1.8 * sx);
    dot(ctx, -L / 2 + 2 * sx, Wd / 2 - 3 * sx, 1.8 * sx);
    ctx.shadowBlur = 0;
    ctx.restore();

    // km/h label
    ctx.fillStyle = "#eef3fa";
    ctx.font = "600 " + Math.round(12 * sx) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(Math.round(WW.car.currentKmh()) + " km/h", cp.x, cp.y - Wd - 5 * sx);
  }

  // Road follows the centerline polyline (config.road.centerline).
  function drawRoad(ctx, cfg, sx, P) {
    const pal = cfg.palettes.night;
    const cl = cfg.road.centerline.map(P);
    const w = cfg.road.roadWidth * sx;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Soft shoulder, then the road surface.
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = w + 8 * sx;
    strokePath(ctx, cl);
    ctx.strokeStyle = pal.road;
    ctx.lineWidth = w;
    strokePath(ctx, cl);

    // Solid lane-edge lines (offset both sides of each segment).
    ctx.strokeStyle = cfg.road.edgeColor;
    ctx.lineWidth = Math.max(1, 1.5 * sx);
    for (let i = 0; i < cl.length - 1; i++) {
      const a = cl[i], b = cl[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * (w / 2), ny = dx / len * (w / 2);
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(a.x + nx * s, a.y + ny * s);
        ctx.lineTo(b.x + nx * s, b.y + ny * s);
        ctx.stroke();
      }
    }

    drawCrosswalk(ctx, cl, w, cfg.road.crosswalkT, cfg.road.crosswalkStripes, sx);

    // Dashed centre line
    ctx.strokeStyle = pal.marking;
    ctx.lineWidth = Math.max(1, 2 * sx);
    ctx.setLineDash([cfg.road.dashLen * sx, cfg.road.gapLen * sx]);
    strokePath(ctx, cl);
    ctx.setLineDash([]);
  }

  function strokePath(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }

  // Point + unit direction at fraction t along a canvas-space polyline.
  function alongPath(cl, t) {
    let total = 0;
    for (let i = 0; i < cl.length - 1; i++) total += Math.hypot(cl[i + 1].x - cl[i].x, cl[i + 1].y - cl[i].y);
    let target = t * total, acc = 0;
    for (let i = 0; i < cl.length - 1; i++) {
      const a = cl[i], b = cl[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      if (target <= acc + len) {
        const f = (target - acc) / len;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len };
      }
      acc += len;
    }
    const a = cl[cl.length - 2], b = cl[cl.length - 1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: b.x, y: b.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len };
  }

  function drawCrosswalk(ctx, cl, w, t, stripes, sx) {
    const p = alongPath(cl, t);
    const nx = -p.uy, ny = p.ux;          // across the road
    const hw = w / 2, barHalf = 3 * sx, spacing = 12 * sx;
    ctx.fillStyle = "rgba(214,214,200,0.5)";
    for (let j = 0; j < stripes; j++) {
      const o = (j - (stripes - 1) / 2) * spacing;
      const cx = p.x + p.ux * o, cy = p.y + p.uy * o;
      ctx.beginPath();
      ctx.moveTo(cx + nx * hw + p.ux * barHalf, cy + ny * hw + p.uy * barHalf);
      ctx.lineTo(cx + nx * hw - p.ux * barHalf, cy + ny * hw - p.uy * barHalf);
      ctx.lineTo(cx - nx * hw - p.ux * barHalf, cy - ny * hw - p.uy * barHalf);
      ctx.lineTo(cx - nx * hw + p.ux * barHalf, cy - ny * hw + p.uy * barHalf);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Scene under the road (config.scene): green area, water, buildings. Each optional.
  function drawScene(ctx, cfg, P, sx) {
    const pal = cfg.palettes.night, S = cfg.scene;
    if (S.greenArea) fillPoly(ctx, S.greenArea.map(P), pal.verge);
    if (S.water) fillPoly(ctx, S.water.map(P), pal.water);
    (S.buildings || []).forEach((b) => {
      const p = P(b);
      roundRect(ctx, p.x, p.y, b.w * sx, b.h * sx, 4 * sx);
      ctx.fillStyle = pal.building;
      ctx.fill();
      ctx.strokeStyle = "rgba(160,176,196,0.18)";
      ctx.lineWidth = Math.max(1, 1 * sx);
      ctx.stroke();
    });
  }

  function drawLabels(ctx, cfg, P, sx) {
    cfg.scene.labels.forEach((l) => {
      const p = P({ x: l.x, y: l.y });
      ctx.save();
      ctx.translate(p.x, p.y);
      if (l.angle) ctx.rotate(WW.geo.degToRad(l.angle));
      ctx.fillStyle = l.color;
      ctx.font = Math.round(l.size * sx) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    });
    ctx.textBaseline = "alphabetic";
  }

  function fillPoly(ctx, pts, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }

  function drawCones(ctx, cfg, P, sx) {
    if (!WW.system.enabled) return; // system OFF side: no camera installed
    cfg.cameras.forEach((cam) => {
      const cs = WW.detection.camState[cam.id];
      const detecting = cs && cs.detecting;
      const poly = WW.geo.conePolygon(cam.x, cam.y, cam.facingAngleDeg, cam.fovDeg, cam.range);
      ctx.beginPath();
      poly.forEach((pt, i) => { const s = P(pt); i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y); });
      ctx.closePath();
      ctx.fillStyle = detecting ? "rgba(255,176,32,0.22)" : "rgba(255,176,32,0.07)";
      ctx.fill();
      const cp = P(cam);
      if (detecting) { // active "seeing" halo
        ctx.strokeStyle = "rgba(255,176,32,0.6)"; ctx.lineWidth = 2 * sx;
        ctx.beginPath(); ctx.arc(cp.x, cp.y, 11 * sx, 0, Math.PI * 2); ctx.stroke();
      }
      drawCamera(ctx, cp, cam.facingAngleDeg, sx, detecting);
    });
  }

  // Small pole-mounted camera pointing along its facing angle.
  function drawCamera(ctx, cp, facingDeg, sx, detecting) {
    ctx.save();
    ctx.translate(cp.x, cp.y);
    ctx.rotate(WW.geo.degToRad(facingDeg));
    ctx.fillStyle = "#3a4655";                          // mount arm
    ctx.fillRect(-9 * sx, -1.5 * sx, 9 * sx, 3 * sx);
    ctx.fillStyle = detecting ? "#ffb020" : "#aeb9c8";  // body
    roundRect(ctx, -3 * sx, -5 * sx, 12 * sx, 10 * sx, 2 * sx); ctx.fill();
    ctx.fillStyle = "#0c0f14";                          // lens (front)
    dot(ctx, 7 * sx, 0, 2.4 * sx);
    ctx.restore();
  }

  function drawSignals(ctx, cfg, P, sx) {
    if (!WW.system.enabled) return; // system OFF side: no warning signs installed
    const on = WW.detection.flashOn();
    cfg.signals.forEach((sig) => {
      const s = P(sig);
      const active = WW.detection.isSignalActive(sig.id);
      // Ease a 0..1 intensity for a soft board fade-in/out.
      const target = active ? 1 : 0;
      sigIntensity[sig.id] = (sigIntensity[sig.id] || 0) + (target - (sigIntensity[sig.id] || 0)) * 0.25;
      const inten = sigIntensity[sig.id];
      const lit = active && on;

      // Beacon
      if (lit) {
        ctx.save();
        ctx.shadowColor = "#ffb020";
        ctx.shadowBlur = 20 * sx;
        ctx.fillStyle = "#ffd24d";
        dot(ctx, s.x, s.y, 8 * sx);
        ctx.restore();
      } else {
        ctx.fillStyle = active ? "#6b4c10" : "#3a3320";
        dot(ctx, s.x, s.y, 7 * sx);
      }

      // Mounting post (drawn under the beacon/board so it reads as a roadside sign)
      const bw = 82 * sx, bh = 18 * sx, bx = s.x - bw / 2, by = s.y + 10 * sx;
      ctx.strokeStyle = "#59636f";
      ctx.lineWidth = 2.5 * sx;
      ctx.beginPath();
      ctx.moveTo(s.x, by + bh);
      ctx.lineTo(s.x, by + bh + 16 * sx);
      ctx.stroke();

      // LED message board (fades with intensity)
      ctx.fillStyle = "#0c0f14";
      ctx.strokeStyle = "rgba(255,176,32," + (0.25 + 0.6 * inten).toFixed(3) + ")";
      ctx.lineWidth = Math.max(1, 1 * sx);
      roundRect(ctx, bx, by, bw, bh, 3 * sx); ctx.fill(); ctx.stroke();
      if (inten > 0.05) {
        ctx.save();
        ctx.globalAlpha = inten;
        ctx.fillStyle = "#ffb020";
        ctx.font = Math.round(7.5 * sx) + "px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sig.message, s.x, by + bh / 2);
        ctx.restore();
        ctx.textBaseline = "alphabetic";
      }
    });
  }

  function drawAnimals(ctx, cfg, P, sx) {
    const hl = headlightCam();
    const dim = cfg.tuning.headlight.dimAlpha;
    WW.animals.list.forEach((a) => {
      const s = P(a);
      const r = a.radius * sx;
      const sp = cfg.species.find((x) => x.id === a.speciesId);
      const placed = a.state === "placed";

      // Detection ripple (behind the body)
      if (!placed && isDetected(a)) {
        const period = 900;
        const ph = (clockMs() % period) / period;
        ctx.save();
        ctx.strokeStyle = "rgba(255,176,32," + (0.5 * (1 - ph)).toFixed(3) + ")";
        ctx.lineWidth = 2 * sx;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 4 * sx + ph * r * 2.2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      if (placed) ctx.globalAlpha = 0.5;
      else {
        const lit = WW.car.state.visible && WW.geo.pointInCone(a.x, a.y, hl);
        ctx.globalAlpha = lit ? 1 : dim;
      }

      // Walk bob (subtle vertical motion while walking). Side-view silhouettes
      // stay upright and just mirror left/right to face travel direction.
      const bob = placed ? 0 : Math.sin(clockMs() / 150 + a.id) * r * 0.12;
      ctx.translate(s.x, s.y + bob);
      if (Math.cos(WW.geo.degToRad(a.dirDeg)) < 0) ctx.scale(-1, 1);
      drawCreature(ctx, sp.shape, r, sp.color);
      ctx.restore();

      // Label (unrotated) above the body
      ctx.save();
      if (placed) ctx.globalAlpha = 0.7;
      ctx.fillStyle = "#e6edf6";
      ctx.font = Math.round(11 * sx) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(a.label, s.x, s.y - r - 7 * sx);
      ctx.restore();

      if (placed) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([4 * sx, 3 * sx]);
        ctx.strokeStyle = a.color;
        ctx.lineWidth = Math.max(1, 1.5 * sx);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 4 * sx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        drawArrow(ctx, cfg, a, P, sx);
      }
    });
  }

  // Creatures drawn in local space, facing +x (east). Simple, readable silhouettes.
  function drawCreature(ctx, shape, r, color) {
    ctx.fillStyle = color;
    const darker = shade(color, -0.35);
    if (shape === "ellipse") {           // wild boar: bulky, snout + tusk + ridge
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.4, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 1.2, -r * 0.25); ctx.lineTo(r * 1.9, 0); ctx.lineTo(r * 1.2, r * 0.25); ctx.closePath(); ctx.fill(); // snout
      ctx.fillStyle = "#f2ead6"; ctx.beginPath(); ctx.moveTo(r * 1.55, r * 0.05); ctx.lineTo(r * 1.8, -r * 0.18); ctx.lineTo(r * 1.6, r * 0.18); ctx.closePath(); ctx.fill(); // tusk
      ctx.strokeStyle = darker; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.55); ctx.lineTo(r * 0.4, -r * 0.7); ctx.stroke(); // back ridge
      legs(ctx, r, darker, [-0.7, -0.1, 0.5]);
    } else if (shape === "triangle") {   // pangolin: scaly back, pointed head, tail
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.25, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 1.1, -r * 0.2); ctx.lineTo(r * 1.7, 0); ctx.lineTo(r * 1.1, r * 0.2); ctx.closePath(); ctx.fill(); // head
      ctx.beginPath(); ctx.moveTo(-r * 1.1, -r * 0.15); ctx.lineTo(-r * 2.0, 0); ctx.lineTo(-r * 1.1, r * 0.15); ctx.closePath(); ctx.fill(); // tail
      ctx.strokeStyle = darker; ctx.lineWidth = r * 0.12;                    // scale arcs
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * r * 0.5, r * 0.1, r * 0.5, Math.PI, 0); ctx.stroke(); }
    } else {                             // macaque: body + head + tail + ear
      ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 1.05, r * 0.75, 0, 0, Math.PI * 2); ctx.fill(); // body
      ctx.beginPath(); ctx.arc(r * 0.95, -r * 0.15, r * 0.55, 0, Math.PI * 2); ctx.fill();          // head
      ctx.fillStyle = darker; ctx.beginPath(); ctx.arc(r * 0.75, -r * 0.55, r * 0.2, 0, Math.PI * 2); ctx.fill(); // ear
      ctx.strokeStyle = color; ctx.lineWidth = r * 0.22; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-r * 1.0, r * 0.1); ctx.quadraticCurveTo(-r * 1.8, -r * 0.2, -r * 1.5, -r * 0.9); ctx.stroke(); // tail
      legs(ctx, r, darker, [-0.5, 0.3]);
    }
  }

  function legs(ctx, r, color, xs) {
    ctx.strokeStyle = color; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
    xs.forEach((x) => { ctx.beginPath(); ctx.moveTo(x * r, r * 0.5); ctx.lineTo(x * r, r * 0.95); ctx.stroke(); });
  }

  function drawArrow(ctx, cfg, a, P, sx) {
    const ui = cfg.ui;
    const rad = WW.geo.degToRad(a.dirDeg);
    const base = P({ x: a.x + Math.cos(rad) * a.radius, y: a.y + Math.sin(rad) * a.radius });
    const tip = P(WW.animals.arrowTip(a));
    ctx.strokeStyle = a.color; ctx.fillStyle = a.color;
    ctx.lineWidth = Math.max(1.5, 2 * sx);
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    const h = ui.arrowHead * sx;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(rad - 0.4) * h, tip.y - Math.sin(rad - 0.4) * h);
    ctx.lineTo(tip.x - Math.cos(rad + 0.4) * h, tip.y - Math.sin(rad + 0.4) * h);
    ctx.closePath(); ctx.fill();
  }

  function drawDecor(ctx, cfg, P, sx) {
    cfg.decor.forEach((d) => {
      const s = P(d);
      const r = 13 * sx;
      ctx.fillStyle = "rgba(0,0,0,0.3)";              // ground shadow
      ctx.beginPath(); ctx.ellipse(s.x, s.y + r * 0.7, r * 0.9, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = cfg.palettes.night.tree;         // canopy (two blobs)
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(s.x - r * 0.5, s.y + r * 0.2, r * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(120,180,140,0.10)";        // faint moonlit highlight
      ctx.beginPath(); ctx.arc(s.x + r * 0.3, s.y - r * 0.3, r * 0.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  // Red "NEAR MISS" markers where the car reached an un-warned animal.
  function drawNearMiss(ctx, P, sx) {
    const markers = WW.stats.activeMarkers();
    const life = WW.config.nearMiss.markerMs;
    const now = clockMs();
    markers.forEach((m) => {
      const s = P(m);
      const age = (now - m.bornMs) / life; // 0..1
      const rad = (8 + age * 26) * sx;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age);
      ctx.strokeStyle = "#ff3b30";
      ctx.lineWidth = 3 * sx;
      ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ff5148";
      ctx.font = "700 " + Math.round(12 * sx) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NEAR MISS", s.x, s.y - rad - 4 * sx);
      ctx.restore();
    });
  }

  // Watermark shown while the system is switched off.
  function drawSystemOff(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = "rgba(255,90,80,0.16)";
    ctx.font = "800 " + Math.round(H * 0.09) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SYSTEM OFF", W / 2, H * 0.16);
    ctx.restore();
    ctx.textBaseline = "alphabetic";
  }

  // ---- small canvas helpers ----
  function dot(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r + r * amt)));
    g = Math.max(0, Math.min(255, Math.round(g + g * amt)));
    b = Math.max(0, Math.min(255, Math.round(b + b * amt)));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  WW.render = { use, frame };
})();
