/* run-traffic-study.js — runs the two-way traffic study (research/traffic.js)
 * in Node across all CPU cores and writes research/results/traffic-study.json /
 * .csv (stage "grid") or traffic-placement.json / .csv (stage "placement").
 *
 *   node research/run-traffic-study.js [--stage grid|placement] [--seeds N] [--combined M]
 *                                      [--minutes K] [--workers W] [--out DIR]
 *
 * Defaults: grid stage, 300 seeds per setting, 1,000 for the combined check and
 * its baseline (placement: 100 seeds, no combined check), 20 simulated minutes.
 * Each worker loads the real sim modules into its own vm context and runs a
 * slice of (setting, seeds) jobs; the main thread summarises with the page's own
 * summarise(), so a seed gives the same numbers in the browser and here. */
const fs = require("fs"), vm = require("vm"), path = require("path"), os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const MODULES = ["js/config.js", "js/geometry.js", "js/stats.js", "js/animals.js", "js/spawner.js", "js/car.js", "js/detection.js", "research/traffic.js"];

function loadStudy() {
  const ctx = { console, location: { search: "" }, setTimeout, Date, Math, JSON };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of MODULES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  return { study: ctx.TrafficStudy, CFG: ctx.WW.config };
}
function allSettings(study) { return study.SETTINGS.concat(study.sensitivitySettings(), study.placementSettings(90), study.placementSettings(60)); }

if (!isMainThread) {
  const { study, CFG } = loadStudy();
  const byId = {}; allSettings(study).forEach((s) => { if (!byId[s.id]) byId[s.id] = s; });
  for (const job of workerData.jobs) {
    const parts = job.ids.map((id) => byId[id]);
    // A job applies one or more settings (the combined check applies several).
    const setting = {
      apply: (c) => parts.forEach((p) => p.apply(c)),
      headwayMeanSec: parts.map((p) => p.headwayMeanSec).find((v) => v),
      perDirSigns: !parts.some((p) => p.perDirSigns === false),
      xDist: parts.map((p) => p.xDist).find((v) => v),
    };
    const rows = [];
    for (const seed of job.seeds) {
      study.baseline(); setting.apply(CFG);
      const [off, on] = study.runTwoWay(seed, workerData.minutes, setting);
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
  const STAGE = arg("stage", "policy"), LENS = +arg("lens", 90);
  const SEEDS = +arg("seeds", 300), COMBINED = +arg("combined", 1000), MINUTES = +arg("minutes", 10);
  const WORKERS = +arg("workers", Math.max(1, os.cpus().length - 2));
  const OUT = arg("out", path.join(ROOT, "research", "results"));
  const CHUNK = 5;
  const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);

  const { study } = loadStudy();
  const S = study.S;
  const SETTINGS = STAGE === "placement" ? study.placementSettings(LENS) : STAGE === "sens" ? study.sensitivitySettings() : study.SETTINGS;
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
    const jobs = []; SETTINGS.forEach((s) => jobs.push(...chunks(s.id, [s.id], S.seeds)));
    const grid = await runJobs(jobs, STAGE);
    runs += jobs.reduce((a, j) => a + j.seeds.length, 0);
    const result = { stage: STAGE, settings: S, minutes: MINUTES, grid: SETTINGS.map((s) => study.summarise(s, bySeed(grid[s.id]))), combined: null, baseline: null };

    if (STAGE === "policy") {
      const combined = study.pickCombined(result.grid, SETTINGS);
      process.stderr.write("Combined check (" + S.combinedSeeds.length + " seeds): " + combined.label + "\n");
      const jobs2 = chunks("combined", combined.ids, S.combinedSeeds).concat(chunks("base", [SETTINGS[0].id], S.combinedSeeds));
      const rows2 = await runJobs(jobs2, "combined + baseline");
      runs += jobs2.reduce((a, j) => a + j.seeds.length, 0);
      result.combined = study.summarise(combined, bySeed(rows2.combined));
      result.baseline = study.summarise(SETTINGS[0], bySeed(rows2.base));
    }
    result.seconds = (Date.now() - t0) / 1000;
    result.runs = runs;

    fs.mkdirSync(OUT, { recursive: true });
    const name = STAGE === "placement" ? "traffic-placement-" + LENS : STAGE === "sens" ? "traffic-sens" : "traffic-policy";
    const slim = JSON.parse(JSON.stringify(result, (k, v) => (k === "perSeed" || k === "delays" ? undefined : v)));
    fs.writeFileSync(path.join(OUT, name + ".json"), JSON.stringify(slim, null, 1));
    fs.writeFileSync(path.join(OUT, name + ".csv"), study.toCSV(result) + "\n");

    const p = (v) => Math.round(v * 100) + "%";
    const f = (v, d) => (v === null || v === undefined ? "–" : v.toFixed(d));
    console.log("runs", runs, "seconds", Math.round(result.seconds), "workers", WORKERS, "seeds", SEEDS, "minutes", MINUTES, "stage", STAGE, "lens", LENS);
    console.log("\nON serious/100 | OFF | cut [CI] | near cut | far-lane/100 off→on | delay s/car off→on (p95 on) | driver-s per crossing | driver-s per hit prevented | q max | label");
    result.grid.slice().sort((a, b) => a.on.seriousPer100 - b.on.seriousPer100).slice(0, STAGE === "placement" ? 30 : 100).forEach((g) =>
      console.log(f(g.on.seriousPer100, 2).padStart(5), "| off", f(g.off.seriousPer100, 2).padStart(5), "| cut", p(g.seriousCut).padStart(4), "[", p(g.seriousCutCI[0]), "…", p(g.seriousCutCI[1]), "] | near", p(g.nearCut).padStart(4),
        "| far", f(g.off.farLanePer100, 2), "→", f(g.on.farLanePer100, 2), "| delay", f(g.off.delayMean, 1), "→", f(g.on.delayMean, 1), "(p95", f(g.on.delayP95, 1) + ")", "| s/x", f(g.delayPerCrossing, 0), "| s/hit", f(g.secPerHitPrevented, 0), "| q", g.on.queueMax, "|", g.label));
    if (result.combined) {
      console.log("\nCombined:", result.combined.label);
      for (const g of [result.baseline, result.combined]) console.log(" ", g.id, "serious", f(g.off.seriousPer100, 2), "->", f(g.on.seriousPer100, 2), "cut", p(g.seriousCut), "near cut", p(g.nearCut), "delay", f(g.off.delayMean, 1), "->", f(g.on.delayMean, 1), "s/hit", f(g.secPerHitPrevented, 0));
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
