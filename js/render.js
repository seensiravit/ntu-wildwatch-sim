/* render.js — draws the map + night scene onto the canvas.
 * The STATIC scene (road, cones, signals, decor) is implemented so the shell
 * is visibly runnable. Dynamic entities (animals, car, headlights, detection
 * tint) are left as TODO. Implement the rest per SPEC §4 and §8.
 * Exposed as WW.render. */
(function () {
  const WW = window.WW || (window.WW = {});

  function frame(ctx, W, H) {
    const cfg = WW.config;
    const pal = cfg.palettes.night;
    const sx = W / cfg.map.width;   // logical -> canvas scale x
    const sy = H / cfg.map.height;  // logical -> canvas scale y
    const P = (p) => ({ x: p.x * sx, y: p.y * sy }); // scale a logical point

    // Background grass
    ctx.fillStyle = pal.grass;
    ctx.fillRect(0, 0, W, H);

    drawDecor(ctx, cfg, P);
    drawRoad(ctx, cfg, sx, sy, P);
    drawCones(ctx, cfg, P, sx);
    drawSignals(ctx, cfg, P, sx);
    drawCar(ctx, cfg, P, sx);
    drawAnimals(ctx, cfg, P, sx);
  }

  // A cam-like object for the car's headlight cone (for point-in-cone tests).
  function headlightCam() {
    const c = WW.car.state, h = WW.config.tuning.headlight;
    return { x: c.x, y: c.y, facingAngleDeg: c.headingDeg, fovDeg: h.fovDeg, range: h.range };
  }

  function drawCar(ctx, cfg, P, sx) {
    const c = WW.car.state;
    if (!c.visible) return;
    const h = cfg.tuning.headlight;

    // Headlight cone (short, bright cone ahead of the car).
    const poly = WW.geo.conePolygon(c.x, c.y, c.headingDeg, h.fovDeg, h.range);
    ctx.beginPath();
    poly.forEach((pt, i) => {
      const s = P(pt);
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    const cp = P(c);
    const tip = P({ x: c.x + Math.cos(WW.geo.degToRad(c.headingDeg)) * h.range,
                    y: c.y + Math.sin(WW.geo.degToRad(c.headingDeg)) * h.range });
    const grad = ctx.createLinearGradient(cp.x, cp.y, tip.x, tip.y);
    grad.addColorStop(0, "rgba(255,244,200,0.35)");
    grad.addColorStop(1, "rgba(255,244,200,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    // Car body (rectangle oriented along heading).
    ctx.save();
    ctx.translate(cp.x, cp.y);
    ctx.rotate(WW.geo.degToRad(c.headingDeg));
    const L = cfg.ui.carLen * sx, Wd = cfg.ui.carWidth * sx;
    ctx.fillStyle = cfg.ui.carColor;
    ctx.fillRect(-L / 2, -Wd / 2, L, Wd);
    // Windscreen hint (front third)
    ctx.fillStyle = "rgba(40,60,90,0.8)";
    ctx.fillRect(L / 6, -Wd / 2 + 2, L / 4, Wd - 4);
    ctx.restore();

    // Floating km/h label above the car.
    ctx.fillStyle = "#eef3fa";
    ctx.font = Math.round(12 * sx) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(Math.round(WW.car.currentKmh()) + " km/h", cp.x, cp.y - Wd - 4 * sx);
  }

  function drawRoad(ctx, cfg, sx, sy, P) {
    const pal = cfg.palettes.night;
    const c = P(cfg.road.corner);
    const w = cfg.road.roadWidth * sx;
    ctx.strokeStyle = pal.road;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, c.y);           // left edge, horizontal
    ctx.lineTo(c.x, c.y);         // to corner
    ctx.lineTo(c.x, 0);           // up to top edge
    ctx.stroke();

    // Dashed centre line
    ctx.strokeStyle = pal.marking;
    ctx.lineWidth = Math.max(1, 2 * sx);
    ctx.setLineDash([cfg.road.dashLen * sx, cfg.road.gapLen * sx]);
    ctx.beginPath();
    ctx.moveTo(0, c.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(c.x, 0);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCones(ctx, cfg, P, sx) {
    cfg.cameras.forEach((cam) => {
      const cs = WW.detection.camState[cam.id];
      const detecting = cs && cs.detecting;
      const poly = WW.geo.conePolygon(cam.x, cam.y, cam.facingAngleDeg, cam.fovDeg, cam.range);
      ctx.beginPath();
      poly.forEach((pt, i) => {
        const s = P(pt);
        i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      // Faint coverage always; tint amber while detecting.
      ctx.fillStyle = detecting ? "rgba(255, 176, 32, 0.22)" : "rgba(255, 176, 32, 0.08)";
      ctx.fill();
      // Camera body
      const cp = P(cam);
      ctx.fillStyle = detecting ? "#ffb020" : "#9fb0c4";
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 6 * sx, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawSignals(ctx, cfg, P, sx) {
    const on = WW.detection.flashOn(); // shared blink phase (freezes on pause)
    cfg.signals.forEach((sig) => {
      const s = P(sig);
      const active = WW.detection.isSignalActive(sig.id);
      const lit = active && on;

      // Amber beacon: glows + blinks while active, dim when off.
      if (lit) {
        ctx.save();
        ctx.shadowColor = "#ffb020";
        ctx.shadowBlur = 18 * sx;
        ctx.fillStyle = "#ffd24d";
        ctx.beginPath();
        ctx.arc(s.x, s.y, 8 * sx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = active ? "#6b4c10" : "#3a3320"; // dark between blinks / off
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7 * sx, 0, Math.PI * 2);
        ctx.fill();
      }

      // LED message board: amber text while active, blank when off.
      const bw = 78 * sx, bh = 18 * sx;
      const bx = s.x - bw / 2, by = s.y + 10 * sx;
      ctx.fillStyle = "#0c0f14";
      ctx.strokeStyle = active ? "#ffb020" : "#2a3646";
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      if (active) {
        ctx.fillStyle = "#ffb020";
        ctx.font = Math.round(7 * sx) + "px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sig.message, s.x, by + bh / 2);
        ctx.textBaseline = "alphabetic";
      }
    });
  }

  // Body shape for a species (drawn centred at canvas point s, radius r px).
  function drawBody(ctx, shape, s, r) {
    ctx.beginPath();
    if (shape === "ellipse") {
      ctx.ellipse(s.x, s.y, r * 1.35, r * 0.85, 0, 0, Math.PI * 2);
    } else if (shape === "triangle") {
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r * 0.9, s.y + r * 0.8);
      ctx.lineTo(s.x - r * 0.9, s.y + r * 0.8);
      ctx.closePath();
    } else {
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    }
  }

  function drawArrow(ctx, cfg, a, P, sx) {
    const ui = cfg.ui;
    const rad = WW.geo.degToRad(a.dirDeg);
    const base = P({ x: a.x + Math.cos(rad) * a.radius, y: a.y + Math.sin(rad) * a.radius });
    const tip = P(WW.animals.arrowTip(a));
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineWidth = Math.max(1.5, 2 * sx);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    // Arrowhead
    const h = ui.arrowHead * sx;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(rad - 0.4) * h, tip.y - Math.sin(rad - 0.4) * h);
    ctx.lineTo(tip.x - Math.cos(rad + 0.4) * h, tip.y - Math.sin(rad + 0.4) * h);
    ctx.closePath();
    ctx.fill();
  }

  function drawAnimals(ctx, cfg, P, sx) {
    const hl = headlightCam();
    const dim = cfg.tuning.headlight.dimAlpha;
    WW.animals.list.forEach((a) => {
      const s = P(a);
      const r = a.radius * sx;
      ctx.save();
      if (a.state === "placed") {
        ctx.globalAlpha = 0.5;
      } else {
        // Walking: fully lit inside the headlight cone, dimmed outside it,
        // so the audience sees what the driver cannot (SPEC §8).
        const lit = WW.car.state.visible && WW.geo.pointInCone(a.x, a.y, hl);
        ctx.globalAlpha = lit ? 1 : dim;
      }
      ctx.fillStyle = a.color;
      drawBody(ctx, cfg.species.find((sp) => sp.id === a.speciesId).shape, s, r);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label above the body
      ctx.fillStyle = "#dfe7f0";
      ctx.font = Math.round(12 * sx) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(a.label, s.x, s.y - r - 6 * sx);

      if (a.state === "placed") {
        ctx.setLineDash([4 * sx, 3 * sx]);
        ctx.strokeStyle = a.color;
        ctx.lineWidth = Math.max(1, 1.5 * sx);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 3 * sx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        drawArrow(ctx, cfg, a, P, sx);
      }
      ctx.restore();
    });
  }

  function drawDecor(ctx, cfg, P) {
    ctx.fillStyle = cfg.palettes.night.tree;
    cfg.decor.forEach((d) => {
      const s = P(d);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  WW.render = { frame };
})();
