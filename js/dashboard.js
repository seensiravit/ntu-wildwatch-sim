/* dashboard.js — side panel: tray chips, camera cards (thermal feed + status),
 * signal cards, detection log (SPEC §9). Static structure built from config;
 * update() reflects live simulation state each frame.
 * Exposed as WW.dashboard. */
(function () {
  const WW = window.WW || (window.WW = {});
  const thermalCanvases = {}; // cameraId -> <canvas> for the feed
  const signalCards = {};     // signalId -> { pill, msgEl }
  let logEl = null;
  let lastLogLen = -1;

  // Deterministic PRNG so thermal noise looks frozen while the sim is paused.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build() {
    const cfg = WW.config;

    // Brand text (title highlights "Wild"; tagline + location from config)
    const title = document.getElementById("brand-title");
    if (title) {
      title.innerHTML = cfg.brand.title.replace("Wild", '<span class="wild">Wild</span>');
    }
    const tagline = document.getElementById("brand-tagline");
    if (tagline) tagline.textContent = cfg.brand.tagline;

    // Legend / key overlay
    const legend = document.getElementById("legend");
    if (legend) {
      cfg.legend.forEach((item) => {
        const row = document.createElement("div");
        row.className = "legend-row";
        row.innerHTML = '<span class="legend-swatch sw-' + item.kind + '"></span>' + item.label;
        legend.appendChild(row);
      });
    }

    buildStats();

    // Tray chips (draggable species) — SPEC §5.1
    const tray = document.getElementById("tray");
    cfg.species.forEach((sp) => {
      const chip = document.createElement("div");
      chip.className = "tray-chip";
      chip.dataset.species = sp.id;
      chip.draggable = true;
      chip.textContent = sp.label;
      tray.appendChild(chip);
    });

    // Camera cards with a small thermal feed each — SPEC §9.1
    const camWrap = document.getElementById("camera-cards");
    cfg.cameras.forEach((cam) => {
      const card = document.createElement("div");
      card.className = "card";
      card.id = "card-" + cam.id;
      card.innerHTML =
        '<div class="card-header">' + cam.name +
        '<span class="pill" id="pill-' + cam.id + '">Idle</span></div>';
      const feed = document.createElement("canvas");
      feed.className = "thermal";
      feed.width = 280; feed.height = 120;
      card.appendChild(feed);
      thermalCanvases[cam.id] = feed;
      camWrap.appendChild(card);
    });

    // Signal cards — SPEC §9.2
    const sigWrap = document.getElementById("signal-cards");
    cfg.signals.forEach((sig) => {
      const card = document.createElement("div");
      card.className = "card";
      card.id = "card-" + sig.id;
      card.innerHTML =
        '<div class="card-header">' + sig.name +
        '<span class="pill" id="pill-' + sig.id + '">Off</span></div>' +
        '<div class="sig-msg" id="msg-' + sig.id + '"></div>';
      sigWrap.appendChild(card);
      signalCards[sig.id] = {
        pill: card.querySelector("#pill-" + sig.id),
        msgEl: card.querySelector("#msg-" + sig.id),
      };
    });

    logEl = document.getElementById("log-list");
  }

  function buildStats() {
    const el = document.getElementById("stats-card");
    if (!el) return;
    const tile = (id, label, cls) =>
      '<div class="stat"><div class="stat-num ' + cls + '" id="' + id + '">0</div>' +
      '<div class="stat-label">' + label + '</div></div>';
    el.innerHTML =
      '<div class="card-header">Impact</div>' +
      '<div class="stats-grid">' +
      tile("st-detected", "Animals detected", "") +
      tile("st-avoided", "Near-misses avoided", "safe") +
      tile("st-nearmiss", "Near-misses (system off)", "danger") +
      tile("st-speed", "Avg speed at crossing", "") +
      "</div>";
  }

  function updateStats() {
    const s = WW.stats.state;
    setNum("st-detected", s.detections);
    setNum("st-avoided", s.avoided);
    setNum("st-nearmiss", s.nearMiss);
    const sp = document.getElementById("st-speed");
    if (sp) sp.textContent = WW.stats.avgCrossingKmh() + " km/h";
  }
  function setNum(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

  function update() {
    const cfg = WW.config;
    const det = WW.detection;
    const flashPill = det.flashOn(); // shared phase, freezes on pause
    const systemOn = WW.system.enabled;

    updateStats();

    // Camera cards + thermal feeds
    cfg.cameras.forEach((cam) => {
      const cs = det.camState[cam.id] || { detecting: false, animalsInCone: [] };
      const card = document.getElementById("card-" + cam.id);
      const pill = document.getElementById("pill-" + cam.id);
      card.classList.toggle("offline", !systemOn);
      if (!systemOn) {
        pill.textContent = "Offline";
        pill.classList.remove("pill-active");
        card.classList.remove("detecting");
      } else if (cs.detecting) {
        pill.textContent = "Detecting";
        pill.classList.add("pill-active");
        card.classList.add("detecting");
      } else {
        pill.textContent = "Idle";
        pill.classList.remove("pill-active");
        card.classList.remove("detecting");
      }
      drawThermal(cam, cs);
    });

    // Signal cards
    cfg.signals.forEach((sig) => {
      const ref = signalCards[sig.id];
      const card = document.getElementById("card-" + sig.id);
      card.classList.toggle("offline", !systemOn);
      const active = det.isSignalActive(sig.id);
      if (active) {
        ref.pill.textContent = "Flashing";
        // Blink the pill in sync with the map beacon.
        ref.pill.classList.toggle("pill-active", flashPill);
        ref.msgEl.textContent = sig.message;
        ref.msgEl.style.display = "block";
      } else {
        ref.pill.textContent = "Off";
        ref.pill.classList.remove("pill-active");
        ref.msgEl.textContent = "";
        ref.msgEl.style.display = "none";
      }
    });

    updateLog(det.logEntries);
  }

  function updateLog(entries) {
    if (!logEl || entries.length === lastLogLen) return; // only rebuild on change
    lastLogLen = entries.length;
    logEl.innerHTML = "";
    entries.forEach((e) => {
      const li = document.createElement("li");
      li.textContent =
        e.time + "  " + e.camName + "  " + e.species + "  " + e.confidence + "%";
      logEl.appendChild(li);
    });
  }

  function drawThermal(cam, cs) {
    const canvas = thermalCanvases[cam.id];
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
      const r = 14 + (1 - hit.distNorm) * 26; // near => bigger
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

  WW.dashboard = { build, update, thermalCanvases };
})();
