/* run-demo-runs.js — runs the demo-run reliability study (research/demo-runs.js)
 * in Node across all CPU cores, and writes research/results/demo-runs.csv
 * (one row per run) and demo-runs-summary.json.
 *
 *   node research/run-demo-runs.js [--quick] [--workers N] [--out DIR]
 *
 * Each worker loads the real sim modules into its own vm context (window =
 * the context) and runs a slice of the job list; the main thread assembles the
 * rows exactly as the browser page does, so a seed gives the same row either way. */
const fs = require("fs"), vm = require("vm"), path = require("path"), os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const MODULES = ["js/config.js", "js/geometry.js", "js/stats.js", "js/animals.js", "js/spawner.js", "js/car.js", "js/detection.js", "research/settings.js", "research/demo-runs.js"];

function loadStudy(quick) {
  const ctx = { console, location: { search: quick ? "?quick" : "" }, setTimeout, Date, Math, JSON };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of MODULES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  return ctx.DemoRuns;
}

if (!isMainThread) {
  const study = loadStudy(workerData.quick);
  const rows = [];
  workerData.jobs.forEach((job, i) => {
    rows.push(study.runJob(job));
    if (i % 10 === 9) parentPort.postMessage({ progress: 10 });
  });
  parentPort.postMessage({ progress: workerData.jobs.length % 10, rows: rows });
  return;
}

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const workers = Number((args[args.indexOf("--workers") + 1] || 0)) || Math.max(1, os.cpus().length - 1);
const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(ROOT, "research", "results");

const study = loadStudy(quick);
const jobs = study.jobs();
const t0 = Date.now();
console.error(jobs.length + " runs across " + workers + " workers" + (quick ? " (quick)" : ""));

// Deal jobs round-robin so every worker gets a mix of settings and lengths.
const slices = Array.from({ length: workers }, () => []);
jobs.forEach((j, i) => slices[i % workers].push(j));

let done = 0;
const allRows = [];
let pending = 0;
slices.forEach((slice) => {
  if (!slice.length) return;
  pending++;
  const w = new Worker(__filename, { workerData: { jobs: slice, quick: quick } });
  w.on("message", (msg) => {
    done += msg.progress || 0;
    if (msg.rows) allRows.push(...msg.rows);
    process.stderr.write("\r" + done + " / " + jobs.length + " runs · " + Math.round((Date.now() - t0) / 1000) + " s   ");
  });
  w.on("error", (e) => { console.error("\nworker error:", e); process.exit(1); });
  w.on("exit", () => { if (--pending === 0) finish(); });
});

function finish() {
  process.stderr.write("\n");
  // Deterministic order: by setting, minutes, seed.
  const order = study.SETTINGS.map((s) => s.id);
  allRows.sort((a, b) => order.indexOf(a.setting) - order.indexOf(b.setting) || a.minutes - b.minutes || a.seed - b.seed);
  const result = study.assemble(allRows);
  result.seconds = (Date.now() - t0) / 1000;
  fs.mkdirSync(outDir, { recursive: true });
  const suffix = quick ? "-quick" : "";
  fs.writeFileSync(path.join(outDir, "demo-runs" + suffix + ".csv"), study.toCSV(allRows) + "\n");
  fs.writeFileSync(path.join(outDir, "demo-runs-summary" + suffix + ".json"), JSON.stringify(result, null, 1));
  const pct = (v) => Math.round(v * 100) + "%";
  console.log("runs", allRows.length, "seconds", Math.round(result.seconds));
  console.log("\nBy setting (" + study.S.minutes + " min): A=ON better on serious+near | hits tile ON lower / equal / higher | median serious OFF/ON | median near OFF/ON | min to 80%");
  result.bySetting.forEach((b) => { const s = b.summary; console.log(
    pct(s.A.on).padStart(4), "(off", pct(s.A.off).padStart(4) + ")", "| hits", pct(s.hits.on).padStart(4), pct(s.hits.tie).padStart(4), pct(s.hits.off).padStart(4),
    "|", s.dist.offSerious.median + "/" + s.dist.onSerious.median, "|", s.dist.offNear.median + "/" + s.dist.onNear.median, "|", s.minutesTo80 === null ? "–" : s.minutesTo80, "|", b.label); });
  console.log("\nBy run length (today):");
  result.byLength.forEach((b) => { const s = b.summary; console.log(
    String(b.minutes).padStart(3), "min | A", pct(s.A.on).padStart(4), "(off", pct(s.A.off).padStart(4) + ")", "| near", pct(s.near.on).padStart(4), "| hits", pct(s.hits.on).padStart(4), pct(s.hits.tie).padStart(4), pct(s.hits.off).padStart(4)); });
}
