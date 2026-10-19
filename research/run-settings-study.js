/* run-settings-study.js — runs the settings study (research/settings.js) in Node
 * across all CPU cores, with many more seeds than the browser page uses, and
 * writes research/results/settings-study.json / .csv in the same shape.
 *
 *   node research/run-settings-study.js [--seeds N] [--combined M] [--minutes K] [--workers W] [--out DIR]
 *
 * Defaults: 300 seeds per setting, 500 for the combined check and its baseline,
 * 20 simulated minutes per run. Each worker loads the real sim modules into its
 * own vm context and runs a slice of (setting, seeds) jobs; the main thread
 * summarises with the page's own summarise(), so a seed gives the same numbers
 * either way. */
const fs = require("fs"), vm = require("vm"), path = require("path"), os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const MODULES = ["js/config.js", "js/geometry.js", "js/stats.js", "js/animals.js", "js/spawner.js", "js/car.js", "js/detection.js", "research/settings.js"];

function loadStudy() {
  const ctx = { console, location: { search: "" }, setTimeout, Date, Math, JSON };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of MODULES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  return { study: ctx.SettingsStudy, CFG: ctx.WW.config };
}

if (!isMainThread) {
  const { study, CFG } = loadStudy();
  const byId = {}; study.SETTINGS.forEach((s) => { byId[s.id] = s; });
  for (const job of workerData.jobs) {
    // A job applies one or more settings (the combined check applies several).
    const parts = job.ids.map((id) => byId[id]);
    const opts = parts.find((p) => p.xDist) || {};
    const rows = [];
    for (const seed of job.seeds) {
      study.restore(); parts.forEach((p) => p.apply(CFG));
      const [off, on] = study.runTwin(seed, workerData.minutes, opts);
      rows.push({ seed, off, on });
    }
    study.restore();
    parentPort.postMessage({ key: job.key, rows });
  }
  parentPort.postMessage({ done: true });
} else {
  main();
}

function main() {
  const arg = (name, def) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : def; };
  const SEEDS = +arg("seeds", 300), COMBINED = +arg("combined", 500), MINUTES = +arg("minutes", 20);
  const WORKERS = +arg("workers", Math.max(1, os.cpus().length - 2));
  const OUT = arg("out", path.join(ROOT, "research", "results"));
  const CHUNK = 5;
  const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);

  const { study } = loadStudy();
  const S = study.S, SETTINGS = study.SETTINGS;
  S.minutes = MINUTES; S.seeds = range(101, SEEDS); S.combinedSeeds = range(101, COMBINED);

  function chunks(key, ids, seeds) {
    const out = [];
    for (let i = 0; i < seeds.length; i += CHUNK) out.push({ key, ids, seeds: seeds.slice(i, i + CHUNK) });
    return out;
  }
  function runJobs(jobs, label) {
    return new Promise((resolve, reject) => {
      const rows = {}; jobs.forEach((j) => { rows[j.key] = rows[j.key] || []; });
      const total = jobs.reduce((a, j) => a + j.seeds.length, 0);
      let done = 0, finished = 0; const t0 = Date.now();
      const n = Math.min(WORKERS, jobs.length);
      // Round-robin so every worker gets a similar mix of settings.
      const slices = range(0, n).map((i) => jobs.filter((_, j) => j % n === i));
      slices.forEach((slice) => {
        const w = new Worker(__filename, { workerData: { jobs: slice, minutes: MINUTES } });
        w.on("message", (m) => {
          if (m.done) { if (++finished === n) { process.stderr.write("\n"); resolve(rows); } return; }
          rows[m.key].push(...m.rows); done += m.rows.length;
          process.stderr.write("\r" + label + ": " + done + " / " + total + " runs · " + Math.round((Date.now() - t0) / 1000) + " s   ");
        });
        w.on("error", reject);
      });
    });
  }
  const bySeed = (rows) => rows.slice().sort((a, b) => a.seed - b.seed);

  (async () => {
    const t0 = Date.now();
    let runs = 0;
    // Phase 1: the grid.
    const jobs = []; SETTINGS.forEach((s) => jobs.push(...chunks(s.id, [s.id], S.seeds)));
    const grid = await runJobs(jobs, "grid");
    runs += jobs.reduce((a, j) => a + j.seeds.length, 0);
    const result = { settings: S, minutes: MINUTES, grid: SETTINGS.map((s) => study.summarise(s, bySeed(grid[s.id]))), combined: null, baseline20: null };

    // Phase 2: the combined check, chosen exactly as settings.js run() does: per
    // system-controlled factor, the level with the fewest serious ON hits per 100
    // crossings (the baseline level counts too).
    const base = result.grid.find((g) => g.id === "base");
    const factors = {};
    result.grid.filter((g) => g.system).forEach((g) => { (factors[g.factor] = factors[g.factor] || []).push(g); });
    const picks = [];
    Object.keys(factors).forEach((f) => {
      const best = factors[f].concat([Object.assign({}, base, { factor: f })]).sort((a, b) => a.on.seriousPer100 - b.on.seriousPer100)[0];
      if (best.id !== "base") picks.push(SETTINGS.find((s) => s.id === best.id));
    });
    const combined = {
      id: "combined", factor: "combined", system: true,
      label: picks.length ? "best per factor: " + picks.map((p) => p.label).join(" + ") : "baseline (no factor beat it)",
    };
    process.stderr.write("Combined check (" + S.combinedSeeds.length + " seeds): " + combined.label + "\n");
    const jobs2 = chunks("combined", picks.map((p) => p.id), S.combinedSeeds).concat(chunks("base", ["base"], S.combinedSeeds));
    const rows2 = await runJobs(jobs2, "combined + baseline");
    runs += jobs2.reduce((a, j) => a + j.seeds.length, 0);
    result.combined = study.summarise(combined, bySeed(rows2.combined));
    result.baseline20 = study.summarise(SETTINGS[0], bySeed(rows2.base));
    result.seconds = (Date.now() - t0) / 1000;
    result.runs = runs;

    fs.mkdirSync(OUT, { recursive: true });
    const slim = JSON.parse(JSON.stringify(result, (k, v) => (k === "perSeed" ? undefined : v)));
    fs.writeFileSync(path.join(OUT, "settings-study.json"), JSON.stringify(slim, null, 1));
    fs.writeFileSync(path.join(OUT, "settings-study.csv"), study.toCSV(result) + "\n");

    const p = (v) => Math.round(v * 100) + "%";
    console.log("runs", runs, "seconds", Math.round(result.seconds), "workers", WORKERS, "seeds", SEEDS, "combined", COMBINED, "minutes", MINUTES);
    console.log("\nON serious hits per 100 crossings (ascending):");
    result.grid.slice().sort((a, b) => a.on.seriousPer100 - b.on.seriousPer100).forEach((g) =>
      console.log(g.on.seriousPer100.toFixed(2).padStart(6), "on |", g.off.seriousPer100.toFixed(2).padStart(6), "off | cut", p(g.seriousCut).padStart(5), "[", p(g.seriousCutCI[0]), "…", p(g.seriousCutCI[1]), "] | near", p(g.nearCut).padStart(5), "| hits", p(g.hitCut).padStart(5), "| ON lap +" + (g.lapCostSec || 0).toFixed(1) + "s |", g.label));
    console.log("\nCombined:", result.combined.label);
    for (const g of [result.baseline20, result.combined]) console.log(" ", g.id, "serious", g.off.seriousPer100.toFixed(2), "->", g.on.seriousPer100.toFixed(2), "cut", p(g.seriousCut), "[", p(g.seriousCutCI[0]), "…", p(g.seriousCutCI[1]), "] near cut", p(g.nearCut), "hits cut", p(g.hitCut), "ON lap +" + (g.lapCostSec || 0).toFixed(1) + "s");
  })().catch((e) => { console.error(e); process.exit(1); });
}
