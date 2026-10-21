/* demo-runs.js — short-run reliability study: does a demo-length run show the
 * system helping?
 *
 * Over long runs the system clearly helps, but a booth demo lasts minutes and
 * hits are rare, so a single short run can show the ON side with MORE hits
 * than OFF (low-speed bumps into a car stopped at the line count the same as a
 * 50 km/h hit on the showcase-day scoreboard). This study runs many 10-minute demos per
 * setting, records every run, and reports how often a run shows ON ahead:
 *   A. by the real benefit: fewer serious hits (> 30 km/h) and fewer near misses;
 *   B. by the showcase-day scoreboard: fewer total hits.
 * Also a run-length sweep at the showcase-day setting. Built on research/settings.js
 * (runTwin, restore). Runs in the browser (single-threaded, with ?quick) and in
 * Node across all cores via research/run-demo-runs.js. */
(function () {
  const WW = window.WW;
  const CFG = WW.config;
  const SS = window.SettingsStudy;
  const QUICK = /[?&]quick\b/.test((window.location && window.location.search) || "");

  const S = {
    seeds: QUICK ? 10 : 200,     // runs per setting (seeds 1001..)
    minutes: QUICK ? 3 : 10,     // demo length
    lengths: QUICK ? [2, 3] : [2, 3, 5, 10, 15, 20], // run-length sweep at the showcase-day setting
    seriousKmh: SS.S.seriousKmh,
  };

  const bold = (k) => (c) => c.species.forEach((sp) => {
    sp.traffic.cross = Math.min(0.95, sp.traffic.cross * k);
    sp.traffic.wait = Math.min(sp.traffic.wait, 1 - sp.traffic.cross);
  });
  const SETTINGS = [
    { id: "today", label: "showcase-day settings", apply: () => {} },
    { id: "gap8", label: "a group every 8 s", apply: (c) => { c.spawning.meanGapSec = 8; } },
    { id: "gap6", label: "a group every 6 s", apply: (c) => { c.spawning.meanGapSec = 6; } },
    { id: "warn30", label: "warned speed 30 km/h", apply: (c) => { c.tuning.warnKmh = 30; } },
    { id: "warn30nostop", label: "warned speed 30, no stop line", apply: (c) => { c.tuning.warnKmh = 30; c.tuning.stopForSign = false; } },
    { id: "fov84", label: "84° camera (previous)", apply: (c) => { c.cameras[0].fovDeg = 84; } },
    { id: "shy", label: "animals half as bold", apply: bold(0.5) },
    { id: "warn30gap8", label: "warned speed 30 + a group every 8 s", apply: (c) => { c.tuning.warnKmh = 30; c.spawning.meanGapSec = 8; } },
  ];

  // ---- One recorded run ----------------------------------------------------------
  // Returns a flat row: setting, minutes, seed, OFF/ON totals, and per-minute
  // cumulative serious / near / hits for both sides.
  function runOne(setting, minutes, seed) {
    SS.restore(); setting.apply(CFG);
    const byMinute = [];
    const [off, on] = SS.runTwin(seed, minutes, {
      xDist: setting.xDist,
      onMinute: (m, snap) => byMinute.push({ m: m, off: pickCounts(snap[0]), on: pickCounts(snap[1]) }),
    });
    SS.restore();
    const row = { setting: setting.id, minutes: minutes, seed: seed, off: off, on: on, byMinute: byMinute };
    row.verdict = verdicts(off, on);
    return row;
  }
  function pickCounts(s) { return { serious: s.serious, near: s.near, hits: s.hits }; }

  // How a single run reads on each scoring rule.
  function verdicts(off, on) {
    const better = (a, b) => (b < a ? "on" : b > a ? "off" : "tie");
    return {
      serious: better(off.serious, on.serious),
      near: better(off.near, on.near),
      seriousNear: better(off.serious + off.near, on.serious + on.near),
      hits: better(off.hits, on.hits),
      // "A": ON no worse on both serious hits and near misses, and better on at least one.
      A: on.serious <= off.serious && on.near <= off.near && (on.serious < off.serious || on.near < off.near) ? "on"
        : on.serious >= off.serious && on.near >= off.near && (on.serious > off.serious || on.near > off.near) ? "off" : "tie",
    };
  }

  // ---- Summaries --------------------------------------------------------------------
  function share(rows, key, who) { return rows.length ? rows.filter((r) => r.verdict[key] === who).length / rows.length : 0; }
  function quantiles(vals) {
    const v = vals.slice().sort((a, b) => a - b), q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    return v.length ? { p10: q(0.1), median: q(0.5), p90: q(0.9), mean: v.reduce((a, b) => a + b, 0) / v.length } : null;
  }
  function summarise(rows) {
    const sumSide = (side, k) => rows.reduce((a, r) => a + r[side][k], 0);
    const per100 = (side, k) => { const c = sumSide(side, "crossings"); return c ? (100 * sumSide(side, k)) / c : 0; };
    const minuteCurve = [];
    const maxM = Math.max.apply(null, rows.map((r) => r.byMinute.length));
    for (let i = 0; i < maxM; i++) {
      const at = rows.filter((r) => r.byMinute[i]).map((r) => ({ verdict: verdicts(r.byMinute[i].off, r.byMinute[i].on) }));
      minuteCurve.push({ minute: i + 1, A: share(at, "A", "on"), hits: share(at, "hits", "on"), hitsWorse: share(at, "hits", "off"), seriousNear: share(at, "seriousNear", "on") });
    }
    const reach80 = minuteCurve.find((c) => c.seriousNear >= 0.8);
    return {
      runs: rows.length,
      A: { on: share(rows, "A", "on"), tie: share(rows, "A", "tie"), off: share(rows, "A", "off") },
      seriousNear: { on: share(rows, "seriousNear", "on"), tie: share(rows, "seriousNear", "tie"), off: share(rows, "seriousNear", "off") },
      serious: { on: share(rows, "serious", "on"), tie: share(rows, "serious", "tie"), off: share(rows, "serious", "off") },
      near: { on: share(rows, "near", "on"), tie: share(rows, "near", "tie"), off: share(rows, "near", "off") },
      hits: { on: share(rows, "hits", "on"), tie: share(rows, "hits", "tie"), off: share(rows, "hits", "off") },
      dist: {
        offSerious: quantiles(rows.map((r) => r.off.serious)), onSerious: quantiles(rows.map((r) => r.on.serious)),
        offNear: quantiles(rows.map((r) => r.off.near)), onNear: quantiles(rows.map((r) => r.on.near)),
        offHits: quantiles(rows.map((r) => r.off.hits)), onHits: quantiles(rows.map((r) => r.on.hits)),
        hitDiff: quantiles(rows.map((r) => r.on.hits - r.off.hits)),
      },
      per100: { offSerious: per100("off", "serious"), onSerious: per100("on", "serious"), offNear: per100("off", "near"), onNear: per100("on", "near"), offHits: per100("off", "hits"), onHits: per100("on", "hits") },
      onLapSec: sumSide("on", "laps") ? sumSide("on", "lapSum") / sumSide("on", "laps") : null,
      offLapSec: sumSide("off", "laps") ? sumSide("off", "lapSum") / sumSide("off", "laps") : null,
      lineWaitPerLap: sumSide("on", "laps") ? sumSide("on", "lineWait") / sumSide("on", "laps") : 0,
      minuteCurve: minuteCurve,
      minutesTo80: reach80 ? reach80.minute : null,
    };
  }

  // The full job list: (setting, minutes, seed) triples. Shared by the page and the
  // Node driver so both produce the same rows.
  function jobs() {
    const out = [];
    const seeds = []; for (let i = 0; i < S.seeds; i++) seeds.push(1001 + i);
    SETTINGS.forEach((st) => seeds.forEach((seed) => out.push({ setting: st.id, minutes: S.minutes, seed: seed })));
    S.lengths.forEach((min) => { if (min !== S.minutes) seeds.forEach((seed) => out.push({ setting: "today", minutes: min, seed: seed })); });
    return out;
  }
  function runJob(job) { return runOne(SETTINGS.find((s) => s.id === job.setting), job.minutes, job.seed); }

  // Group rows into the study result.
  function assemble(rows) {
    const bySetting = SETTINGS.map((st) => ({ id: st.id, label: st.label, minutes: S.minutes, summary: summarise(rows.filter((r) => r.setting === st.id && r.minutes === S.minutes)) }));
    const byLength = S.lengths.map((min) => ({ minutes: min, summary: summarise(rows.filter((r) => r.setting === "today" && r.minutes === min)) }));
    return { settings: S, bySetting: bySetting, byLength: byLength, rows: rows.length };
  }

  async function run(ui) {
    const t0 = Date.now(), list = jobs(), rows = [];
    let lastYield = Date.now();
    for (let i = 0; i < list.length; i++) {
      rows.push(runJob(list[i]));
      if (Date.now() - lastYield > 100) {
        ui.progress((i + 1) / list.length, (i + 1) + " / " + list.length + " runs · " + Math.round((Date.now() - t0) / 1000) + " s");
        ui.status(list[i].setting + " · " + list[i].minutes + " min");
        await new Promise((r) => setTimeout(r, 0));
        lastYield = Date.now();
      }
    }
    const result = assemble(rows);
    result.seconds = (Date.now() - t0) / 1000;
    result.allRows = rows;
    ui.progress(1, rows.length + " runs · " + Math.round(result.seconds) + " s");
    return result;
  }

  // ---- CSV: one row per run ------------------------------------------------------------
  function toCSV(rows) {
    const head = ["setting", "minutes", "seed",
      "off_hits", "off_serious", "off_crawl", "off_near", "off_safe", "off_turned_back", "off_crossings", "off_avg_kmh",
      "on_hits", "on_serious", "on_crawl", "on_near", "on_safe", "on_turned_back", "on_crossings", "on_avg_kmh", "on_line_wait_s",
      "verdict_A", "verdict_serious_near", "verdict_hits"];
    const side = (s) => [s.hits, s.serious, s.crawl, s.near, s.safe, s.back, s.crossings, s.speedCount ? +(s.speedSum / s.speedCount).toFixed(1) : ""];
    const lines = rows.map((r) => [r.setting, r.minutes, r.seed].concat(side(r.off), side(r.on), [+r.on.lineWait.toFixed(1), r.verdict.A, r.verdict.seriousNear, r.verdict.hits]));
    return [head].concat(lines).map((cols) => cols.join(",")).join("\n");
  }

  // ---- Page ---------------------------------------------------------------------------------
  const pct = (v) => Math.round(v * 100) + "%";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function rowHtml(label, s) {
    const d = s.dist;
    return "<tr><td>" + esc(label) + "</td>" +
      '<td class="n strong">' + pct(s.A.on) + '</td><td class="n">' + pct(s.A.tie) + '</td><td class="n bad">' + pct(s.A.off) + "</td>" +
      '<td class="n">' + pct(s.near.on) + '</td>' +
      '<td class="n">' + pct(s.hits.on) + '</td><td class="n">' + pct(s.hits.tie) + '</td><td class="n bad">' + pct(s.hits.off) + "</td>" +
      '<td class="n">' + d.offSerious.median + " / " + d.onSerious.median + '</td><td class="n">' + d.offNear.median + " / " + d.onNear.median + '</td><td class="n">' + d.offHits.median + " / " + d.onHits.median + "</td>" +
      '<td class="n">' + (s.minutesTo80 === null ? "–" : s.minutesTo80) + '</td><td class="n">' + (s.onLapSec && s.offLapSec ? "+" + (s.onLapSec - s.offLapSec).toFixed(1) : "–") + "</td></tr>";
  }
  const HEAD = '<tr><th>Setting</th><th class="n">A: ON better</th><th class="n">tie</th><th class="n">OFF better</th><th class="n">Near misses: ON better</th>' +
    '<th class="n">Hits tile: ON lower</th><th class="n">equal</th><th class="n">ON higher</th><th class="n">Median serious OFF / ON</th><th class="n">Median near OFF / ON</th><th class="n">Median hits OFF / ON</th><th class="n">Min to 80%</th><th class="n">ON lap +s</th></tr>';

  function render(r) {
    const out = document.getElementById("results");
    out.innerHTML =
      "<h2>By setting (" + S.minutes + "-minute runs, " + S.seeds + " each)</h2>" +
      '<div class="tbox"><table><thead>' + HEAD + "</thead><tbody>" + r.bySetting.map((b) => rowHtml(b.label, b.summary)).join("") + "</tbody></table></div>" +
      "<h2>By run length (showcase-day settings)</h2>" +
      '<div class="tbox"><table><thead>' + HEAD + "</thead><tbody>" + r.byLength.map((b) => rowHtml(b.minutes + " min", b.summary)).join("") + "</tbody></table></div>" +
      '<h2>How the verdict builds up over the run</h2><canvas id="curve" width="1100" height="340"></canvas>' +
      '<p class="muted small">A = ON has no more serious hits and no more near misses than OFF, and fewer of at least one. "Hits tile" = total hits as the scoreboard shows showcase day. ' +
      "Serious = contact above " + S.seriousKmh + " km/h. " + r.rows + " runs in " + Math.round(r.seconds) + " s.</p>";
    drawCurve(r);
  }
  function drawCurve(r) {
    const c = document.getElementById("curve"), ctx = c.getContext("2d");
    const L = 50, T = 20, W = c.width - L - 20, H = c.height - T - 50;
    ctx.fillStyle = "#121821"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#223042"; ctx.font = "12px system-ui, sans-serif"; ctx.fillStyle = "#7c8aa0"; ctx.textAlign = "right";
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => { const y = T + H * (1 - v); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + W, y); ctx.stroke(); ctx.fillText(pct(v), L - 6, y + 4); });
    const colors = ["#ffb020", "#46d17f", "#5fb3f9", "#ff6a5f", "#c9a06a", "#9fb0c4", "#ff9f1c", "#e8cf4a"];
    const maxM = Math.max.apply(null, r.bySetting.map((b) => b.summary.minuteCurve.length));
    ctx.textAlign = "center"; for (let m = 1; m <= maxM; m++) ctx.fillText(m + " min", L + (W * (m - 1)) / Math.max(1, maxM - 1), T + H + 16);
    r.bySetting.forEach((b, i) => {
      ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = b.id === "today" ? 3 : 1.5; ctx.beginPath();
      b.summary.minuteCurve.forEach((p, j) => { const x = L + (W * j) / Math.max(1, maxM - 1), y = T + H * (1 - p.seriousNear); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.fillStyle = colors[i % colors.length]; ctx.textAlign = "left"; ctx.fillText(b.label, L + 10 + (i % 4) * 260, T + H + 36 + Math.floor(i / 4) * 14);
    });
    ctx.fillStyle = "#cfd8e3"; ctx.textAlign = "left"; ctx.fillText("share of runs where ON has fewer serious hits + near misses than OFF, by minute", L, 12);
  }

  function init() {
    const btn = document.getElementById("run"), bar = document.querySelector("#progress span");
    const label = document.getElementById("progress-label"), status = document.getElementById("status"), csv = document.getElementById("csv");
    document.getElementById("settings").textContent =
      SETTINGS.length + " settings × " + S.seeds + " runs × " + S.minutes + " min, plus run lengths " + S.lengths.join(" / ") + " min at the showcase-day settings" + (QUICK ? " · QUICK MODE" : "");
    const ui = {
      progress: (f, text) => { bar.style.width = (f * 100).toFixed(1) + "%"; label.textContent = text; },
      status: (text) => { status.textContent = text; },
    };
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const r = await run(ui);
      window.DEMO_RUNS = r;
      ui.status("Done.");
      render(r);
      csv.hidden = false;
      csv.onclick = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([toCSV(r.allRows)], { type: "text/csv" }));
        a.download = "demo-runs.csv";
        document.body.appendChild(a); a.click(); a.remove();
      };
      btn.disabled = false;
    });
  }

  window.DemoRuns = { S, SETTINGS, jobs, runJob, runOne, assemble, summarise, verdicts, toCSV, run };
  if (window.addEventListener && typeof document !== "undefined") window.addEventListener("DOMContentLoaded", init);
})();
