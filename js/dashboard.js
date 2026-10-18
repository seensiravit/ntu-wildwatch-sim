/* dashboard.js — header tray + one dashboard strip under each map (SPEC §9).
 * Both strips share one layout so they compare at a glance:
 *   [Impact scoreboard] [Camera feed] [Warning signs + detection log]
 * On the OFF side the camera and signs show as "Not installed".
 * Static structure is built from config; update() reflects live state each frame.
 * Exposed as WW.dashboard. */
(function () {
  const WW = window.WW || (window.WW = {});
  const panels = {}; // world id ("off" | "on") -> DOM refs for that strip

  // Deterministic PRNG so thermal noise looks frozen while the sim is paused.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function build() {
    const cfg = WW.config;

    // Brand text (title highlights "Wild"; tagline from config)
    const title = document.getElementById("brand-title");
    if (title) title.innerHTML = cfg.brand.title.replace("Wild", '<span class="wild">Wild</span>');
    const tagline = document.getElementById("brand-tagline");
    if (tagline) tagline.textContent = cfg.brand.tagline;

    // Legend / key overlay
    const legend = document.getElementById("legend");
    if (legend) {
      cfg.legend.forEach((item) => {
        legend.appendChild(el("div", "legend-row",
          '<span class="legend-swatch sw-' + item.kind + '"></span>' + item.label));
      });
    }

    // Tray chips (draggable species) — SPEC §5.1
    const tray = document.getElementById("tray");
    cfg.species.forEach((sp) => {
      const chip = el("div", "tray-chip");
      chip.dataset.species = sp.id;
      chip.draggable = true;
      chip.textContent = sp.label;
      tray.appendChild(chip);
    });

    buildPanel("off", document.getElementById("dash-off"), false);
    buildPanel("on", document.getElementById("dash-on"), true);
  }

  function buildPanel(id, root, systemOn) {
    const cfg = WW.config;
    const p = { root, systemOn, nums: {}, cams: {}, sigs: {}, lastLogLen: -1 };

    // 1) Impact scoreboard
    const stats = el("div", "card stats-card",
      '<div class="card-header">Impact' + (systemOn ? " · with WildWatch" : " · without") + "</div>");
    const grid = el("div", "stats-grid");
    const tile = (key, label, cls) => {
      const t = el("div", "stat",
        '<div class="stat-num ' + cls + '">0</div><div class="stat-label">' + label + "</div>");
      p.nums[key] = t.firstChild;
      grid.appendChild(t);
    };
    tile("nearMiss", "Near-misses", "danger");
    tile("avoided", "Slowed in time", "safe");
    tile("speed", "Avg km/h at the animal", "");
    tile("detections", "Animals detected", "");
    stats.appendChild(grid);
    p.summary = el("div", "stat-summary");
    stats.appendChild(p.summary);
    root.appendChild(stats);

    // 2) Camera feed (thermal view), or an empty "not installed" frame
    cfg.cameras.forEach((cam) => {
      const card = el("div", "card cam-card" + (systemOn ? "" : " offline"));
      card.appendChild(el("div", "card-header",
        "<span>" + cam.name + '</span><span class="pill">' + (systemOn ? "Idle" : "Not installed") + "</span>"));
      const feed = el("canvas", "thermal");
      feed.width = 280; feed.height = 110;
      card.appendChild(feed);
      root.appendChild(card);
      p.cams[cam.id] = { card, pill: card.querySelector(".pill"), feed };
      if (!systemOn) drawNoCamera(feed);
    });

    // 3) Warning signs + detection log
    const sigCard = el("div", "card sig-card" + (systemOn ? "" : " offline"),
      '<div class="card-header">Warning signs</div>');
    cfg.signals.forEach((sig) => {
      const row = el("div", "sig-row",
        '<span class="sig-name">' + sig.name + '</span><span class="pill">' +
        (systemOn ? "Off" : "Not installed") + "</span>");
      sigCard.appendChild(row);
      p.sigs[sig.id] = { row, pill: row.querySelector(".pill") };
    });
    sigCard.appendChild(el("div", "log-title", "Detection log"));
    p.log = el("ul", "log-list");
    if (!systemOn) p.log.appendChild(el("li", "log-empty", "Nothing is watching the road."));
    sigCard.appendChild(p.log);
    root.appendChild(sigCard);

    panels[id] = p;
  }

  // Refresh both strips. Each world's state is selected in turn via WW.useWorld.
  function update() {
    const worlds = WW.worlds;
    if (!worlds) return;
    const offStats = worlds.off.stats;
    ["off", "on"].forEach((id) => {
      WW.useWorld(worlds[id]);
      updatePanel(panels[id], offStats);
    });
    // DED tab card: only while that tab is open (the string compare keeps it cheap).
    if (ded && document.querySelector("#ww-root .ww-dash.ww-open")) updateDed();
  }

  function updatePanel(p, offStats) {
    const cfg = WW.config;
    const det = WW.detection;
    const s = WW.stats.state;
    const avg = WW.stats.avgKmh();

    setText(p.nums.nearMiss, s.nearMiss);
    setText(p.nums.avoided, s.avoided);
    setText(p.nums.speed, avg === null ? "–" : avg);
    setText(p.nums.detections, p.systemOn ? s.detections : "–");

    if (!p.systemOn) {
      setText(p.summary, s.nearMiss || s.avoided
        ? "No early warning: the driver only reacts once an animal is in the headlights."
        : "Same animals as the right side. Watch what the driver does.");
    } else if (offStats.nearMiss === 0 && s.nearMiss === 0) {
      setText(p.summary, cfg.brand.insight);
    } else {
      setText(p.summary, "Near-misses: " + offStats.nearMiss + " without → " + s.nearMiss + " with WildWatch.");
    }

    if (!p.systemOn) return; // nothing installed: the rest stays "Not installed"

    // Camera cards + thermal feeds
    cfg.cameras.forEach((cam) => {
      const ref = p.cams[cam.id];
      const cs = det.camState[cam.id] || { detecting: false, animalsInCone: [] };
      setText(ref.pill, cs.detecting ? "Detecting" : "Idle");
      ref.pill.classList.toggle("pill-active", cs.detecting);
      ref.card.classList.toggle("detecting", cs.detecting);
      drawThermal(cam, cs, ref.feed);
    });

    // Signal rows (pill blinks in sync with the map beacon)
    const flash = det.flashOn();
    cfg.signals.forEach((sig) => {
      const ref = p.sigs[sig.id];
      const active = det.isSignalActive(sig.id);
      setText(ref.pill, active ? "Flashing" : "Off");
      ref.pill.classList.toggle("pill-active", active && flash);
      ref.row.classList.toggle("active", active);
    });

    updateLog(p, det.logEntries);
  }

  function setText(node, v) {
    const t = String(v);
    if (node.textContent !== t) node.textContent = t; // avoid needless DOM writes
  }

  function updateLog(p, entries) {
    if (entries.length === p.lastLogLen) return; // only rebuild on change
    p.lastLogLen = entries.length;
    p.log.innerHTML = "";
    if (!entries.length) p.log.appendChild(el("li", "log-empty", "No detections yet."));
    entries.forEach((e) => {
      p.log.appendChild(el("li", "", e.time + "  " + e.species + "  " + e.confidence + "%"));
    });
  }

  function drawNoCamera(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(160,170,190,0.45)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No camera installed", canvas.width / 2, canvas.height / 2 + 4);
  }

  function drawThermal(cam, cs, canvas) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    // Dark purple/black thermal background
    ctx.fillStyle = "#120a1e";
    ctx.fillRect(0, 0, W, H);

    // Subtle noise (frozen when paused via the sim-clock seed)
    const bucket = Math.floor(((WW.clock && WW.clock.ms) || 0) / 120);
    const rnd = mulberry32(bucket * 131 + cam.x);
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 140; i++) {
      const x = rnd() * W, y = rnd() * H, s = 1 + rnd() * 2;
      ctx.fillStyle = rnd() > 0.5 ? "#3a2a55" : "#241640";
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;

    if (!cs.animalsInCone.length) {
      ctx.fillStyle = "rgba(180,160,210,0.45)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No heat signature", W / 2, H / 2);
      return;
    }

    // Heat blobs: x from angle within FOV, size from distance (closer = bigger).
    cs.animalsInCone.forEach((hit) => {
      const cx = W * (0.5 + Math.max(-0.5, Math.min(0.5, hit.angNorm)));
      const cy = H * 0.55;
      const r = 14 + (1 - hit.distNorm) * 24; // near => bigger
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
      grad.addColorStop(0, "#fff3c0");
      grad.addColorStop(0.4, hit.animal.heatColor);
      grad.addColorStop(1, "rgba(255,120,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Green bounding box + label "Macaque 92%"
      const bw = r * 1.8, bh = r * 1.8;
      ctx.strokeStyle = "#4dff88";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.fillStyle = "#4dff88";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(hit.animal.label + " " + hit.confidence + "%", cx - bw / 2, cy - bh / 2 - 3);
    });
  }

  // ---- DED dashboard tab (wildwatch-dashboard.js): live OFF vs ON card ------
  // The extension builds its page skeleton once and its live refresh only
  // replaces the contents of its own sections, so a card we insert stays put.
  // That keeps the teammate's file untouched. Styled with its classes and
  // colour variables (ww-card, --ww-*), plus a few wwx- rules of our own.
  let ded = null; // { body, last }

  const DED_CSS =
    "#ww-root .wwx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}" +
    "#ww-root .wwx-tile{background:var(--ww-panel2);border:1px solid var(--ww-line);border-radius:10px;padding:10px 12px;min-width:0}" +
    "#ww-root .wwx-k{font-size:12px;color:var(--ww-muted);font-weight:600}" +
    "#ww-root .wwx-v{font-size:24px;font-weight:700;margin:2px 0 6px;font-variant-numeric:tabular-nums;white-space:nowrap}" +
    "#ww-root .wwx-v small{font-size:13px;font-weight:600;color:var(--ww-muted)}" +
    "#ww-root .wwx-off{color:var(--ww-high)}#ww-root .wwx-on{color:var(--ww-ok)}" +
    "#ww-root .wwx-bar{display:grid;grid-template-columns:52px 1fr;align-items:center;gap:6px;font-size:11px;color:var(--ww-muted);margin-top:3px}" +
    "#ww-root .wwx-track{height:7px;background:var(--ww-bg);border-radius:4px;overflow:hidden}" +
    "#ww-root .wwx-track span{display:block;height:100%;border-radius:4px}" +
    "#ww-root .wwx-sub{font-size:12px;color:var(--ww-muted);margin-top:6px}" +
    "#ww-root .wwx-note{margin:12px 0 0;font-size:13px}";

  // Insert the card above the extension's KPI row. Called once its UI exists.
  function buildDed() {
    const kpis = document.querySelector("#ww-root .ww-kpis");
    if (!kpis || ded) return;
    const style = el("style");
    style.textContent = DED_CSS;
    document.head.appendChild(style);

    const cam = WW.config.cameras[0];
    const loc = (WW.config.dashboard.cameraLocations || {})[cam.id];
    const where = loc ? loc.name + " · " + loc.cam : cam.name;
    const card = el("div", "ww-card",
      "<h2>Live simulation: with vs without WildWatch</h2>" +
      '<p class="ww-cap">Same animals on the same road (' + where + "). The Simulation tab runs it twice: " +
      "left map without the system, right map with it. Updates live; Reset in the header starts a new comparison.</p>");
    card.style.marginBottom = "14px";
    const body = el("div");
    card.appendChild(body);
    kpis.parentNode.insertBefore(card, kpis);
    ded = { body, last: "" };
    updateDed();
  }

  function updateDed() {
    if (!ded || !WW.worlds) return;
    const off = WW.worlds.off.stats, on = WW.worlds.on.stats;
    if (!off || !on) return;
    const avg = (s) => (s.speedCount ? Math.round(s.speedSum / s.speedCount) : null);
    const enc = (s) => s.nearMiss + s.avoided;
    const share = (s) => (enc(s) ? Math.round((s.avoided / enc(s)) * 100) : null);
    const dash = (v) => (v === null ? "–" : v);

    // One tile: "without → with", paired bars, and a one-line takeaway.
    const tile = (label, a, b, unit, sub) => {
      const max = Math.max(a || 0, b || 0) || 1;
      const bar = (name, v, color) =>
        '<div class="wwx-bar"><span>' + name + '</span><span class="wwx-track"><span style="width:' +
        (((v || 0) / max) * 100).toFixed(1) + "%;background:" + color + '"></span></span></div>';
      return '<div class="wwx-tile"><div class="wwx-k">' + label + "</div>" +
        '<div class="wwx-v"><span class="wwx-off">' + dash(a) + "</span> → " +
        '<span class="wwx-on">' + dash(b) + "</span>" + (unit ? " <small>" + unit + "</small>" : "") + "</div>" +
        bar("Without", a, "var(--ww-high)") + bar("With", b, "var(--ww-ok)") +
        '<div class="wwx-sub">' + sub + "</div></div>";
    };
    const pctDrop = (a, b) => (a ? Math.round(((a - b) / a) * 100) : null);

    const nmDrop = pctDrop(off.nearMiss, on.nearMiss);
    const offAvg = avg(off), onAvg = avg(on);
    const html =
      '<div class="wwx-grid">' +
      tile("Near-misses", off.nearMiss, on.nearMiss, "",
        nmDrop === null ? "None yet without the system." : nmDrop >= 0 ? nmDrop + "% fewer with WildWatch" : "More with WildWatch so far") +
      tile("Avg speed at the animal", offAvg, onAvg, "km/h",
        offAvg !== null && onAvg !== null ? (offAvg - onAvg) + " km/h slower with WildWatch" : "Waiting for both cars to meet an animal.") +
      tile("Car had slowed in time", share(off), share(on), "%",
        "Share of encounters (" + enc(off) + " without, " + enc(on) + " with)") +
      tile("Animals detected", null, on.detections, "",
        "Each detection flashes both signs. No cameras without the system.") +
      "</div>" +
      '<p class="wwx-note">' +
      (off.nearMiss
        ? "<b>What it means for DED:</b> early warning cut near-misses at this crossing from " + off.nearMiss + " to " +
          on.nearMiss + ". The hotspot map and priority list below show where to install it next."
        : '<span class="ww-muted">Start the simulation (or wait for the auto-demo) to fill in the comparison.</span>') +
      "</p>";
    if (html !== ded.last) { ded.body.innerHTML = html; ded.last = html; } // rebuild only on change
  }

  WW.dashboard = { build, update, buildDed };
})();
