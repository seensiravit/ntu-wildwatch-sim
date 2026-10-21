/* dashboard.js — header tray + one dashboard strip under each map (SPEC §9).
 * Both strips share one layout so they compare at a glance:
 *   [Impact scoreboard] [Camera feed] [Warning signs + detection log]
 * On the OFF side the camera and signs show as "Not installed".
 * Static structure is built from config; update() reflects live state each frame.
 * Exposed as WW.dashboard. */
(function () {
  const WW = window.WW || (window.WW = {});
  const panels = {}; // world id ("off" | "on") -> DOM refs for that strip


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
    // The three encounter outcomes (see car.js detectEncounters), worst first.
    // Serious = contact above config.scenario.seriousKmh; low-speed contacts are
    // mostly animals walking into a car that has stopped or is creeping.
    tile("serious", "Serious hits", "danger");
    tile("minor", "Low-speed contacts", "");
    tile("nearMiss", "Near misses", "warn");
    tile("safe", "Safe passes", "safe");
    stats.appendChild(grid);
    p.foot = el("div", "stat-foot");
    stats.appendChild(p.foot);
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

    setText(p.nums.serious, s.seriousHits);
    setText(p.nums.minor, s.hits - s.seriousHits);
    setText(p.nums.nearMiss, s.nearMiss);
    setText(p.nums.safe, s.safe);
    const flow = WW.flow && WW.flow[p.systemOn ? "on" : "off"];
    setText(p.foot, "Avg " + (avg === null ? "–" : avg) + " km/h at the animal · " +
      (p.systemOn ? s.detections + " detected by camera" : "no camera") +
      " · " + s.turnedBack + " turned back" +
      (flow ? " · " + flow.cars + " cars through, avg delay " + (flow.cars ? (flow.delaySum / flow.cars).toFixed(1) : "–") + " s" : ""));

    if (!p.systemOn) {
      setText(p.summary, s.hits + s.nearMiss + s.safe
        ? "No early warning: the driver only reacts once an animal is in the headlights."
        : "Same animals as the right side. Watch what the driver does.");
    } else if (offStats.seriousHits + offStats.nearMiss === 0 && s.seriousHits + s.nearMiss === 0) {
      setText(p.summary, cfg.brand.insight);
    } else {
      setText(p.summary, "Serious hits: " + offStats.seriousHits + " without → " + s.seriousHits + " with WildWatch. " +
        "Near misses: " + offStats.nearMiss + " → " + s.nearMiss + ".");
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
      if (!ref) return; // a sign added after the panel was built
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
    const rnd = WW.spawner.mulberry32(bucket * 131 + cam.x);
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
    const labels = []; // label boxes already drawn this frame, to keep them from overlapping
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
      // Two animals at a similar angle would print their labels on top of each
      // other, so each label moves up a line until it overlaps none drawn before it.
      const text = hit.animal.label + " " + hit.confidence + "%";
      const lw = ctx.measureText(text).width, lh = 12;
      let lx = cx - bw / 2, ly = cy - bh / 2 - 3;
      if (lx + lw > W - 2) lx = W - 2 - lw;
      while (labels.some((b) => lx < b.x + b.w && lx + lw > b.x && ly - lh < b.y && ly > b.y - lh)) ly -= lh;
      labels.push({ x: lx, y: ly, w: lw });
      ctx.fillText(text, lx, ly);
    });
  }

  // ---- DED dashboard tab (wildwatch-dashboard.js): live OFF vs ON card ------
  // The extension builds its page skeleton once and its live refresh only
  // replaces the contents of its own sections, so a card we insert stays put.
  // That keeps the teammate's file untouched. Styled with its classes and
  // colour variables (ww-card, --ww-*), plus a few wwx- rules of our own.
  let ded = null; // { body, last }

  const DED_CSS =
    "#ww-root .wwx-off{color:var(--ww-high);font-weight:700}" +
    "#ww-root .wwx-on{color:var(--ww-ok);font-weight:700}" +
    "#ww-root .wwx-table td:first-child{color:var(--ww-text);font-weight:600}" +
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
    const enc = (s) => s.hits + s.nearMiss + s.safe;
    const pctDrop = (a, b) => (a ? Math.round(((a - b) / a) * 100) : null);
    const fewer = (a, b) => { const d = pctDrop(a, b); return d === null ? (b ? "more so far" : "none on either side") : d >= 0 ? d + "% fewer" : "more so far"; };
    const offAvg = avg(off), onAvg = avg(on);
    const unit = (v, u) => (v === null ? "–" : v + u);
    // A count with its share of all encounters on that side.
    const ofEnc = (n, s) => n + (enc(s) ? ' <span class="ww-muted">(' + Math.round((n / enc(s)) * 100) + "% of " + enc(s) + ")</span>" : "");

    // Measure | without | with | difference
    const row = (label, a, b, diff) =>
      "<tr><td>" + label + '</td><td class="wwx-off">' + a + '</td><td class="wwx-on">' + b + "</td><td>" + diff + "</td></tr>";
    const html =
      '<div class="ww-tablebox"><table class="ww-table wwx-table"><thead><tr>' +
      "<th>Measure</th><th>Without WildWatch</th><th>With WildWatch</th><th>Difference</th></tr></thead><tbody>" +
      row("Serious hits (over " + ((WW.config.scenario && WW.config.scenario.seriousKmh) || 30) + " km/h)", ofEnc(off.seriousHits, off), ofEnc(on.seriousHits, on), fewer(off.seriousHits, on.seriousHits)) +
      row("Low-speed contacts", ofEnc(off.hits - off.seriousHits, off), ofEnc(on.hits - on.seriousHits, on), "mostly animals walking into a stopped or creeping car") +
      row("Near misses", ofEnc(off.nearMiss, off), ofEnc(on.nearMiss, on), fewer(off.nearMiss, on.nearMiss)) +
      row("Safe passes", ofEnc(off.safe, off), ofEnc(on.safe, on), "car had slowed down in time") +
      row("Avg speed at the animal", unit(offAvg, " km/h"), unit(onAvg, " km/h"),
        offAvg !== null && onAvg !== null ? (offAvg - onAvg) + " km/h slower" : "–") +
      row("Animals detected", '– <span class="ww-muted">(no cameras)</span>', on.detections,
        "each detection flashes both signs") +
      "</tbody></table></div>" +
      '<p class="wwx-note">' +
      (off.seriousHits + off.nearMiss
        ? "<b>What it means for DED:</b> at this crossing, early warning cut serious hits from " + off.seriousHits + " to " + on.seriousHits +
          " and near misses from " + off.nearMiss + " to " + on.nearMiss +
          ". The hotspot map and priority list below show where to install it next."
        : '<span class="ww-muted">Start the simulation (or wait for the auto-demo) to fill in the comparison.</span>') +
      "</p>";
    if (html !== ded.last) { ded.body.innerHTML = html; ded.last = html; } // rebuild only on change
  }

  WW.dashboard = { build, update, buildDed };
})();
