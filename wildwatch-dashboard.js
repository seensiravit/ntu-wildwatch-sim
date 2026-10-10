/* Vendored from the teammate's ntu-wildwatch-dashboard.html (extension part only).
 * Local changes are minimal and marked [host-config]: they let the host app add
 * its own cameras/roads to the campus map via window.WILDWATCH_CONFIG (set from
 * js/config.js -> dashboard). Everything else is unchanged from upstream. */
/*!
 * NTU WildWatch — Monitoring Dashboard, Risk Assessment & Decision-Support extension
 * ---------------------------------------------------------------------------------
 * Drop-in add-on for the WildWatch detection simulator.
 *
 *   1. Include once, after the simulator's own script:
 *        <script src="wildwatch-dashboard.js"><\/script>
 *
 *   2. Wherever the simulator detects an animal, add ONE line:
 *        WildWatch.record({ species: 'Wild boar', location: 'Nanyang Avenue',
 *                           confidence: 0.92, proximity: 'road' });
 *      Every field is optional — anything missing is simulated.
 *      record() returns the assessed event, e.g. ev.riskLevel === 'HIGH'.
 *
 *   If step 2 is never done, the extension falls back to reading new lines that
 *   appear under the page's existing "Detection log" (less precise).
 *
 * PROTOTYPE NOTICE: all detections, confidence values, risk scores and
 * recommendations are SIMULATED for demonstration. The risk model is a
 * conceptual scoring model, not a validated NTU model.
 */
(function () {
  'use strict';
  if (window.WildWatch && window.WildWatch.__loaded) return;

  /* ------------------------------------------------------------------ config */
  var CFG = Object.assign({
    hotspotThreshold: 8,      // detections at one camera within the window before it is flagged a hotspot
    hotspotHighRisk: 4,       // ...or this many HIGH-risk events at that camera within the window
    historyWindowDays: 7,     // look-back window for hotspot status and the "repeat activity" risk factor
    highScore: 70,            // score >= this  -> HIGH  (VMS + beacons)
    mediumScore: 45,          // score >= this  -> MEDIUM (beacons only)
    historySaturation: 30,    // earlier detections at a camera that give the full 20 repeat-activity points
    minConfidence: 0.6,       // below this, no warning: flagged for human review
    autoWatchLog: true,       // read the existing "Detection log" if record() is never called
    simMinutesPerSecond: 3,   // internal clock speed when no time is supplied
    simStartHour: 19,         // internal clock starts at 19:00 (night simulation)
    persist: true,            // keep data across page reloads (localStorage)
    showDock: true,           // roadside-response panel on the Simulation tab
    tabsPosition: 'top-center' // 'top-center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-center'
  }, window.WILDWATCH_CONFIG || {});

  var STORE_KEY = 'ntu-wildwatch-dashboard-v1';

  /* ----------------------------------------------------------------- species */
  var SPECIES = {
    boar:     { name: 'Wild boar',             icon: '🐗', guild: 'terrestrial', severity: 30, why: 'large animal, high vehicle-damage and injury risk', re: /boar|wild ?pig|\bpig\b/ },
    pangolin: { name: 'Sunda pangolin',        icon: '🦔', guild: 'terrestrial', severity: 26, why: 'critically endangered, every loss matters',        re: /pangolin/ },
    otter:    { name: 'Smooth-coated otter',   icon: '🦦', guild: 'terrestrial', severity: 22, why: 'protected, travels in family groups',              re: /otter/ },
    civet:    { name: 'Common palm civet',     icon: '🐾', guild: 'arboreal',    severity: 18, why: 'nocturnal and hard to see at night',               re: /civet/ },
    macaque:  { name: 'Long-tailed macaque',   icon: '🐒', guild: 'arboreal',    severity: 18, why: 'moves in groups, unpredictable on roads',          re: /macaque|monkey/ },
    monitor:  { name: 'Malayan water monitor', icon: '🦎', guild: 'terrestrial', severity: 18, why: 'slow to clear the carriageway',                    re: /monitor|lizard|varanus/ },
    snake:    { name: 'Snake',                 icon: '🐍', guild: 'terrestrial', severity: 12, why: 'low visibility on dark tarmac',                    re: /snake|python|cobra/ },
    squirrel: { name: 'Plantain squirrel',     icon: '🐿️', guild: 'arboreal',    severity: 8,  why: 'small and crosses quickly',                        re: /squirrel/ }
  };

  function matchSpecies(text) {
    var t = String(text || '').toLowerCase();
    for (var k in SPECIES) if (SPECIES[k].re.test(t)) return Object.assign({ key: k }, SPECIES[k]);
    return null;
  }
  function resolveSpecies(input) {
    if (input && typeof input === 'object' && input.name) return Object.assign({ key: 'custom', icon: '🐾', guild: 'terrestrial', severity: 15, why: 'unclassified species' }, input);
    var m = matchSpecies(input);
    if (m) return m;
    if (input) return { key: 'other', name: String(input).trim().slice(0, 40), icon: '🐾', guild: 'terrestrial', severity: 15, why: 'unclassified species' };
    var k = pick(['boar', 'pangolin', 'monitor', 'macaque', 'civet', 'squirrel']);
    return Object.assign({ key: k }, SPECIES[k]);
  }

  /* --------------------------------------------------------------- locations */
  // Positions are on a schematic campus map (viewBox 600 x 400), not to scale.
  var LOCATIONS = [
    { id: 'nanyang-ave', name: 'Nanyang Avenue', cam: 'CAM-01', x: 262, y: 261, weight: 0.45, aliases: ['nanyang ave', 'nanyang avenue', 'cam-01', 'cam 1', 'cam1'] },
    { id: 'hall-11',     name: 'Hall 11',        cam: 'CAM-02', x: 462, y: 94,  weight: 0.12, aliases: ['hall 11', 'hall11', 'cam-02', 'cam 2', 'cam2'] },
    { id: 'saraca',      name: 'Saraca Road',    cam: 'CAM-03', x: 147, y: 147, weight: 0.25, aliases: ['saraca', 'cam-03', 'cam 3', 'cam3'] },
    { id: 'tamarind',    name: 'Tamarind area',  cam: 'CAM-04', x: 422, y: 312, weight: 0.18, aliases: ['tamarind', 'cam-04', 'cam 4', 'cam4'] }
  ];
  var SPARE_SPOTS = [[86, 300], [540, 250], [300, 70], [560, 360], [200, 360], [70, 70]];
  // [host-config] The host app can add its own cameras to the campus map; they
  // are treated exactly like the built-in ones (sample history, persistence).
  (CFG.extraLocations || []).forEach(function (l) {
    LOCATIONS.push(Object.assign({ weight: 0, aliases: [String(l.name).toLowerCase()] }, l));
  });
  var BUILTIN = LOCATIONS.length; // [host-config] replaces the hard-coded 4 below

  function matchLocation(text) {
    var t = String(text || '').toLowerCase();
    if (!t) return null;
    for (var i = 0; i < LOCATIONS.length; i++) {
      var L = LOCATIONS[i];
      if (t.indexOf(L.name.toLowerCase()) >= 0) return L;
      for (var j = 0; j < L.aliases.length; j++) if (t.indexOf(L.aliases[j]) >= 0) return L;
    }
    return null;
  }
  function resolveLocation(name, cam) {
    var L = matchLocation(name) || matchLocation(cam);
    if (L) return L;
    if (name) {
      var spot = SPARE_SPOTS[(LOCATIONS.length - BUILTIN) % SPARE_SPOTS.length]; // [host-config]
      L = { id: 'loc-' + LOCATIONS.length, name: String(name).trim().slice(0, 32), cam: cam || ('CAM-0' + (LOCATIONS.length + 1)), x: spot[0], y: spot[1], weight: 0, aliases: [String(name).toLowerCase().trim()] };
      LOCATIONS.push(L);
      return L;
    }
    return weightedPick(LOCATIONS.filter(function (l) { return l.weight > 0; }), function (l) { return l.weight; });
  }

  /* ------------------------------------------------------------------- utils */
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function weightedPick(items, w) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += w(items[i]);
    var r = Math.random() * total;
    for (i = 0; i < items.length; i++) { r -= w(items[i]); if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function isNight(h) { return h >= 19 || h < 6; }

  /* ------------------------------------------------------------- sim clock */
  var clock = { base: 0, realStart: 0 };
  function startClock(after) {
    var d = new Date(); d.setHours(CFG.simStartHour, 0, 0, 0);
    clock.base = Math.max(d.getTime(), after ? after + 60000 : 0);
    clock.realStart = Date.now();
  }
  function simNow() {
    if (!clock.base) startClock();
    return new Date(clock.base + (Date.now() - clock.realStart) / 1000 * CFG.simMinutesPerSecond * 60000);
  }
  function resolveTime(t) {
    if (t instanceof Date && !isNaN(t)) return t;
    if (typeof t === 'number') return new Date(t);
    if (typeof t === 'string') {
      var m = t.match(/^(\d{1,2}):(\d{2})/);
      if (m) { var d = simNow(); d.setHours(+m[1], +m[2], 0, 0); return d; }
      var p = new Date(t); if (!isNaN(p)) return p;
    }
    return simNow();
  }

  /* ------------------------------------------------------------------- state */
  var events = [];          // all detection events, kept in time order
  var announced = {};       // location id -> true once its hotspot alert has fired
  var seq = 0;
  var apiUsed = false;
  var listeners = [];
  var ui = {};              // DOM refs
  var view = 'sim';
  var selectedLoc = null;

  /* ------------------------------------------------------------ risk model
   * Prototype collision-risk score (0-100). Four transparent factors:
   *   species severity   0-30   size / conservation status
   *   proximity to road  5-25   on carriageway > verge > nearby
   *   time of day        4-20   night > dawn/dusk > day
   *   repeat activity    0-20   earlier detections at this camera in the window (full at 30)
   * The sum (max 95) is rescaled to 100 and weighted by detection confidence.
   */
  var PROX = {
    road:   { pts: 25, label: 'On the roadway' },
    verge:  { pts: 15, label: 'On the road verge' },
    nearby: { pts: 5,  label: 'Near the road (> 5 m)' }
  };
  function priorCount(loc, date, list) {
    var from = date.getTime() - CFG.historyWindowDays * 864e5, to = date.getTime(), n = 0;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.loc === loc && e.date.getTime() >= from && e.date.getTime() < to) n++;
    }
    return n;
  }
  function computeRisk(ev, list) {
    var h = ev.date.getHours();
    var tod = isNight(h) ? { pts: 20, label: 'Night-time, low driver visibility' }
      : (h < 8 || h >= 17) ? { pts: 14, label: 'Dawn/dusk, peak animal movement' }
      : { pts: 4, label: 'Daytime' };
    var prior = priorCount(ev.loc, ev.date, list);
    var factors = [
      { key: 'species', label: ev.sp.name + ': ' + ev.sp.why, pts: ev.sp.severity, max: 30 },
      { key: 'proximity', label: PROX[ev.prox].label, pts: PROX[ev.prox].pts, max: 25 },
      { key: 'time', label: tod.label, pts: tod.pts, max: 20 },
      { key: 'history', label: prior + ' earlier detection' + (prior === 1 ? '' : 's') + ' here in ' + CFG.historyWindowDays + ' days', pts: Math.round(20 * Math.min(1, prior / CFG.historySaturation)), max: 20 }
    ];
    var raw = factors.reduce(function (s, f) { return s + f.pts; }, 0);
    var score = Math.round(clamp(raw / 95 * 100 * (0.75 + 0.25 * ev.conf), 0, 100));
    var level = score >= CFG.highScore ? 'HIGH' : score >= CFG.mediumScore ? 'MEDIUM' : 'LOW';
    return { score: score, level: level, factors: factors };
  }
  function respond(ev) {
    if (ev.conf < CFG.minConfidence) return { code: 'review', label: 'Flagged for review', vms: false, beacon: false };
    if (ev.risk.level === 'HIGH') return { code: 'vms', label: 'VMS + beacons', vms: true, beacon: true };
    if (ev.risk.level === 'MEDIUM') return { code: 'beacon', label: 'Amber beacons', vms: false, beacon: true };
    return { code: 'log', label: 'Logged only', vms: false, beacon: false };
  }
  function recomputeAll() {
    events.sort(function (a, b) { return a.date - b.date; });
    for (var i = 0; i < events.length; i++) {
      events[i].risk = computeRisk(events[i], events);
      events[i].response = respond(events[i]);
    }
  }

  /* ----------------------------------------------------- aggregate analytics */
  function statsFor(locFilter) {
    var ref = refTime(), from = ref - CFG.historyWindowDays * 864e5;
    var s = { count: 0, high: 0, medium: 0, low: 0, warnings: 0, vms: 0, night: 0, recent: 0, recentHigh: 0,
      species: {}, hours: new Array(24).fill(0), guild: { terrestrial: 0, arboreal: 0 }, last: null };
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (locFilter && e.loc !== locFilter) continue;
      s.count++;
      s[e.risk.level.toLowerCase()]++;
      if (e.response.beacon) s.warnings++;
      if (e.response.vms) s.vms++;
      if (isNight(e.date.getHours())) s.night++;
      if (e.date.getTime() > from) { s.recent++; if (e.risk.level === 'HIGH') s.recentHigh++; }
      var sk = e.sp.name;
      if (!s.species[sk]) s.species[sk] = { name: sk, icon: e.sp.icon, guild: e.sp.guild, n: 0, high: 0, medium: 0, low: 0 };
      s.species[sk].n++;
      s.species[sk][e.risk.level.toLowerCase()]++;
      s.hours[e.date.getHours()]++;
      s.guild[e.sp.guild === 'arboreal' ? 'arboreal' : 'terrestrial']++;
      s.last = e;
    }
    s.speciesList = Object.keys(s.species).map(function (k) { return s.species[k]; }).sort(function (a, b) { return b.n - a.n; });
    return s;
  }
  // "now" for the rolling window: the sim clock, or the latest event if that is later
  function refTime() {
    var t = simNow().getTime();
    return events.length ? Math.max(t, events[events.length - 1].date.getTime()) : t;
  }
  // Hotspot status uses recent activity (rolling window), so old activity cools down
  function locLevel(s) {
    if (s.recent >= CFG.hotspotThreshold || s.recentHigh >= CFG.hotspotHighRisk) return 'hotspot';
    if (s.recent >= Math.ceil(CFG.hotspotThreshold / 2)) return 'elevated';
    if (s.count > 0) return 'watch';
    return 'quiet';
  }
  var LEVEL_TEXT = { hotspot: 'Hotspot', elevated: 'Elevated', watch: 'Watch', quiet: 'No activity' };
  function peakWindow(hours) {
    var best = -1, at = 0;
    for (var b = 0; b < 24; b += 3) {
      var n = hours[b] + hours[b + 1] + hours[b + 2];
      if (n > best) { best = n; at = b; }
    }
    return best > 0 ? pad(at) + ':00–' + pad((at + 3) % 24) + ':00' : '—';
  }
  var MEASURES = {
    canopy:  { t: 'Canopy bridge', d: 'Rope or canopy crossing linking the tree lines on both sides of the road, for tree-dwelling species.' },
    culvert: { t: 'Dry wildlife culvert', d: 'Underpass with a dry ledge so ground-dwelling animals can cross beneath the road.' },
    fencing: { t: 'Directional mesh fencing', d: 'Guides animals away from the carriageway and toward the crossing structure.' }
  };
  function recommend(s) {
    if (!s.count) return null;
    var arb = s.guild.arboreal / s.count, ter = s.guild.terrestrial / s.count, list, basis;
    if (arb >= 0.6) { list = [MEASURES.canopy]; basis = pct(arb) + ' of detections are tree-dwelling species'; }
    else if (ter >= 0.6) { list = [MEASURES.culvert, MEASURES.fencing]; basis = pct(ter) + ' of detections are ground-dwelling species'; }
    else { list = [MEASURES.canopy, MEASURES.culvert, MEASURES.fencing]; basis = 'Mixed ground- and tree-dwelling activity (' + pct(ter) + ' / ' + pct(arb) + ')'; }
    var priority = (s.high / s.count >= 0.35 || s.count >= CFG.hotspotThreshold * 2) ? 'HIGH' : 'MEDIUM';
    return { measures: list, basis: basis, priority: priority, summary: list.map(function (m) { return m.t; }).join(' + ') };
  }

  /* ------------------------------------------------------------ recording */
  function normProx(p, onRoad) {
    if (onRoad === true) return 'road';
    var t = String(p || '').toLowerCase();
    if (/road|carriageway|crossing/.test(t)) return 'road';
    if (/verge|edge|kerb|curb|shoulder/.test(t)) return 'verge';
    if (/near|side|forest|tree/.test(t)) return 'nearby';
    return weightedPick(['road', 'verge', 'nearby'], function (k) { return { road: 0.45, verge: 0.35, nearby: 0.2 }[k]; });
  }
  function normConf(c) {
    var n = Number(c);
    if (!isFinite(n) || n <= 0) return Math.round(rand(0.78, 0.98) * 100) / 100;
    if (n > 1) n = n / 100;
    return clamp(n, 0.01, 1);
  }
  function publicEvent(e) {
    return {
      id: e.id, time: e.date, species: e.sp.name, guild: e.sp.guild, location: e.loc.name, camera: e.loc.cam,
      confidence: e.conf, proximity: e.prox, riskScore: e.risk.score, riskLevel: e.risk.level,
      response: e.response.label, vmsActivated: e.response.vms, beaconActivated: e.response.beacon,
      factors: e.risk.factors.map(function (f) { return { factor: f.label, points: f.pts }; })
    };
  }

  function record(input, fromAuto) {
    input = input || {};
    if (!fromAuto) apiUsed = true;
    var ev = {
      id: ++seq,
      date: resolveTime(input.time),
      sp: resolveSpecies(input.species),
      loc: resolveLocation(input.location, input.camera),
      conf: normConf(input.confidence),
      prox: normProx(input.proximity, input.onRoad),
      source: input._source || (fromAuto ? 'log' : 'live')
    };
    ev.risk = computeRisk(ev, events);
    ev.response = respond(ev);
    events.push(ev);
    if (events.length > 1 && events[events.length - 2].date > ev.date) events.sort(function (a, b) { return a.date - b.date; });

    if (!input._silent) {
      checkHotspot(ev.loc);
      showOnDock(ev);
      var pub = publicEvent(ev);
      listeners.forEach(function (fn) { try { fn(pub); } catch (err) { console.error(err); } });
      scheduleRender();
      scheduleSave();
      return pub;
    }
    return ev;
  }

  function checkHotspot(loc) {
    if (announced[loc.id]) return;
    var s = statsFor(loc);
    if (locLevel(s) !== 'hotspot') return;
    announced[loc.id] = true;
    var r = recommend(s);
    toast(
      '<div class="ww-toast-kicker">Hotspot identified</div>' +
      '<div class="ww-toast-title">' + esc(loc.name) + ' <span class="ww-muted">' + esc(loc.cam) + '</span></div>' +
      '<div class="ww-toast-body">' + s.recent + ' detections (' + s.recentHigh + ' high-risk) in ' + CFG.historyWindowDays + ' days. Recommended: <b>' + esc(r.summary) + '</b></div>',
      loc
    );
  }

  /* ------------------------------------------------------------ sample data */
  var SAMPLE_MIX = {
    'nanyang-ave': { pangolin: 0.3, boar: 0.3, monitor: 0.25, civet: 0.15 },
    'saraca':      { macaque: 0.35, squirrel: 0.2, monitor: 0.25, boar: 0.2 },
    'hall-11':     { macaque: 0.3, squirrel: 0.3, civet: 0.2, monitor: 0.2 },
    'tamarind':    { boar: 0.3, monitor: 0.3, pangolin: 0.2, otter: 0.2 }
  };
  // relative activity by hour (night-biased)
  var HOUR_W = [6, 5, 4, 3, 3, 4, 5, 3, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4, 6, 8, 9, 9, 8];
  function seed(days) {
    days = days || 30;
    var end = events.length ? events[0].date.getTime() : simNow().getTime();
    var n = Math.round(days * 4);
    var hourIdx = HOUR_W.map(function (_, i) { return i; });
    for (var i = 0; i < n; i++) {
      var loc = weightedPick(LOCATIONS.slice(0, BUILTIN), function (l) { return l.weight; }); // [host-config]
      var mix = loc.mix || SAMPLE_MIX[loc.id] || SAMPLE_MIX['nanyang-ave'];                  // [host-config]
      var spKey = weightedPick(Object.keys(mix), function (k) { return mix[k]; });
      var d = new Date(end - Math.floor(rand(0.2, days)) * 864e5);
      d.setHours(weightedPick(hourIdx, function (h) { return HOUR_W[h]; }), Math.floor(rand(0, 60)), 0, 0);
      if (d.getTime() >= end) d = new Date(d.getTime() - 864e5);
      record({ species: spKey, location: loc.name, time: d, confidence: rand(0.55, 0.98), _source: 'sample', _silent: true }, true);
    }
    recomputeAll();
    LOCATIONS.forEach(function (l) { if (locLevel(statsFor(l)) === 'hotspot') announced[l.id] = true; });
    scheduleRender(); scheduleSave();
  }
  function clearAll() {
    events = []; announced = {}; selectedLoc = null; seq = 0;
    LOCATIONS.splice(BUILTIN); // [host-config]
    startClock();
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    resetDock();
    scheduleRender();
  }

  /* ------------------------------------------------------------ persistence */
  var saveTimer = null;
  function scheduleSave() {
    if (!CFG.persist || saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          locs: LOCATIONS.slice(BUILTIN).map(/* [host-config] */ function (l) { return { id: l.id, name: l.name, cam: l.cam, x: l.x, y: l.y }; }),
          ev: events.map(function (e) { return [e.date.getTime(), e.sp.key === 'other' || e.sp.key === 'custom' ? '~' + e.sp.name : e.sp.key, e.loc.id, e.conf, e.prox, e.source]; }),
          ann: announced
        }));
      } catch (err) { /* storage unavailable: data lives for this session only */ }
    }, 600);
  }
  function load() {
    if (!CFG.persist) return;
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (err) { return; }
    if (!raw || !raw.ev) return;
    (raw.locs || []).forEach(function (l) { LOCATIONS.push(Object.assign({ weight: 0, aliases: [l.name.toLowerCase()] }, l)); });
    var byId = {}; LOCATIONS.forEach(function (l) { byId[l.id] = l; });
    raw.ev.forEach(function (r) {
      var key = r[1], sp = key.charAt(0) === '~' ? resolveSpecies(key.slice(1)) : Object.assign({ key: key }, SPECIES[key] || {});
      if (!sp.name || !byId[r[2]]) return;
      events.push({ id: ++seq, date: new Date(r[0]), sp: sp, loc: byId[r[2]], conf: r[3], prox: r[4], source: r[5] });
    });
    announced = raw.ann || {};
    recomputeAll();
    if (events.length) startClock(events[events.length - 1].date.getTime());
  }

  /* ------------------------------------------------------------------ styles */
  var CSS = [
    '#ww-root{--ww-bg:#0b1310;--ww-panel:#121d18;--ww-panel2:#17251f;--ww-line:#243630;--ww-text:#e5efe9;--ww-muted:#8ea79b;',
    '--ww-accent:#5fb3f9;--ww-high:#ff5a4f;--ww-med:#ff9f1c;--ww-low:#e8cf4a;--ww-ok:#46c08a;--ww-amber:#ffb020;',
    'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ww-text);font-size:14px;line-height:1.45}',
    '#ww-root *,#ww-root *::before,#ww-root *::after{box-sizing:border-box}',
    '#ww-root button{font:inherit;color:inherit;cursor:pointer}',
    '.ww-muted{color:var(--ww-muted)}',
    '.ww-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
    /* tabs */
    '.ww-tabs{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;gap:2px;padding:3px;border-radius:999px;background:rgba(11,19,16,.92);border:1px solid var(--ww-line);box-shadow:0 6px 24px rgba(0,0,0,.35);backdrop-filter:blur(6px)}',
    '.ww-tabs.ww-pos-top-left{left:12px;transform:none}.ww-tabs.ww-pos-top-right{left:auto;right:12px;transform:none}',
    '.ww-tabs.ww-pos-bottom-left{top:auto;bottom:14px;left:12px;transform:none}.ww-tabs.ww-pos-bottom-center{top:auto;bottom:14px}',
    '.ww-tab{border:0;background:transparent;padding:7px 14px;border-radius:999px;font-weight:600;font-size:13px;color:var(--ww-muted)!important;display:flex;align-items:center;gap:7px}',
    '.ww-tab[aria-selected="true"]{background:var(--ww-panel2);color:var(--ww-text)!important;box-shadow:inset 0 0 0 1px var(--ww-line)}',
    '.ww-count{min-width:20px;padding:1px 6px;border-radius:999px;background:var(--ww-accent);color:#04121f;font-size:11px;font-weight:700;text-align:center}',
    /* dashboard overlay */
    '.ww-dash{position:fixed;inset:0;z-index:2147482000;background:var(--ww-bg);overflow-y:auto;display:none;padding:64px 20px 40px}',
    '.ww-dash.ww-open{display:block}',
    '.ww-wrap{max-width:1180px;margin:0 auto}',
    '.ww-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:18px}',
    '.ww-head h1{margin:0;font-size:22px;letter-spacing:-.01em;font-weight:700}',
    '.ww-head p{margin:4px 0 0;color:var(--ww-muted);font-size:13px}',
    '.ww-actions{display:flex;flex-wrap:wrap;gap:8px}',
    '.ww-btn{border:1px solid var(--ww-line);background:var(--ww-panel);padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600}',
    '.ww-btn:hover{background:var(--ww-panel2)}',
    '.ww-btn.ww-danger{color:#ff8d85!important}',
    '.ww-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.02em;border:1px solid var(--ww-line);color:var(--ww-muted)}',
    '.ww-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '.ww-kpi{background:var(--ww-panel);border:1px solid var(--ww-line);border-radius:12px;padding:12px 14px;min-width:0}',
    '.ww-kpi-label{font-size:12px;color:var(--ww-muted);font-weight:600}',
    '.ww-kpi-val{font-size:28px;font-weight:700;letter-spacing:-.02em;margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ww-kpi-val.ww-small{font-size:18px;padding:7px 0 5px}',
    '.ww-kpi-sub{font-size:12px;color:var(--ww-muted)}',
    '.ww-grid{display:grid;grid-template-columns:1.55fr 1fr;gap:14px;margin-bottom:14px}',
    '.ww-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}',
    '.ww-card{background:var(--ww-panel);border:1px solid var(--ww-line);border-radius:12px;padding:14px 16px;min-width:0}',
    '.ww-card h2{margin:0 0 2px;font-size:14px;font-weight:700}',
    '.ww-card .ww-cap{margin:0 0 12px;font-size:12px;color:var(--ww-muted)}',
    /* map */
    '.ww-map svg{width:100%;height:auto;display:block;border-radius:8px}',
    '.ww-node{cursor:pointer}',
    '.ww-node:focus{outline:none}',
    '.ww-node:focus .ww-node-dot,.ww-node.ww-sel .ww-node-dot{stroke:#fff;stroke-width:3}',
    '.ww-pulse{transform-box:fill-box;transform-origin:center;animation:ww-pulse 1.8s ease-out infinite}',
    '@keyframes ww-pulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.2);opacity:0}}',
    '.ww-legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:12px;color:var(--ww-muted)}',
    '.ww-legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}',
    /* detail */
    '.ww-detail-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}',
    '.ww-detail-title b{font-size:17px}',
    '.ww-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0 0 12px;font-size:13px}',
    '.ww-dl dt{color:var(--ww-muted)}',
    '.ww-dl dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}',
    '.ww-rec{border-radius:10px;padding:12px;background:var(--ww-panel2);border:1px solid var(--ww-line)}',
    '.ww-rec.ww-hot{border-color:rgba(255,90,79,.55);background:rgba(255,90,79,.07)}',
    '.ww-rec-k{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ww-muted);margin-bottom:6px}',
    '.ww-rec ul{margin:6px 0 0;padding-left:18px}',
    '.ww-rec li{margin:3px 0}',
    '.ww-progress{height:6px;border-radius:999px;background:var(--ww-line);overflow:hidden;margin:8px 0 4px}',
    '.ww-progress span{display:block;height:100%;background:var(--ww-med);border-radius:999px}',
    /* badges */
    '.ww-badge{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;letter-spacing:.03em;white-space:nowrap}',
    '.ww-b-high{background:rgba(255,90,79,.16);color:#ff8178}',
    '.ww-b-medium{background:rgba(255,159,28,.16);color:#ffb653}',
    '.ww-b-low{background:rgba(232,207,74,.14);color:#efd86a}',
    '.ww-b-hotspot{background:rgba(255,90,79,.16);color:#ff8178}',
    '.ww-b-elevated{background:rgba(255,159,28,.16);color:#ffb653}',
    '.ww-b-watch{background:rgba(232,207,74,.14);color:#efd86a}',
    '.ww-b-quiet{background:rgba(142,167,155,.14);color:var(--ww-muted)}',
    /* charts */
    '.ww-bars{display:flex;flex-direction:column;gap:9px}',
    '.ww-bar-row{display:grid;grid-template-columns:150px 1fr 34px;gap:10px;align-items:center;font-size:13px}',
    '.ww-bar-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ww-bar-track{height:14px;display:flex;border-radius:4px;overflow:hidden;background:rgba(255,255,255,.03)}',
    '.ww-bar-track span{display:block;height:100%}',
    '.ww-bar-n{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}',
    '.ww-cols{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;align-items:end;height:150px;position:relative}',
    '.ww-col{background:var(--ww-accent);border-radius:3px 3px 0 0;min-height:2px;opacity:.9}',
    '.ww-col.ww-day{opacity:.45}',
    '.ww-col-wrap{height:100%;display:flex;flex-direction:column;justify-content:flex-end}',
    '.ww-axis{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;margin-top:5px;font-size:10px;color:var(--ww-muted)}',
    '.ww-axis span{text-align:left;white-space:nowrap}',
    '.ww-empty{padding:26px 10px;text-align:center;color:var(--ww-muted);font-size:13px}',
    /* priority list */
    '.ww-plist{display:flex;flex-direction:column;gap:8px}',
    '.ww-pitem{display:grid;grid-template-columns:28px 1.1fr 1.6fr auto;gap:12px;align-items:center;padding:10px 12px;border-radius:10px;background:var(--ww-panel2);border:1px solid var(--ww-line);cursor:pointer;text-align:left;width:100%}',
    '.ww-pitem:hover{border-color:#36504a}',
    '.ww-rank{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:12px;background:var(--ww-line)}',
    /* table */
    '.ww-tablebox{max-height:380px;overflow:auto;border:1px solid var(--ww-line);border-radius:8px}',
    '.ww-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}',
    '.ww-table th{position:sticky;top:0;background:var(--ww-panel2);text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--ww-muted);padding:8px 10px;font-weight:700;border-bottom:1px solid var(--ww-line)}',
    '.ww-table td{padding:7px 10px;border-bottom:1px solid rgba(36,54,48,.6);white-space:nowrap}',
    '.ww-table tr.ww-new td{animation:ww-flash 1.6s ease-out}',
    '@keyframes ww-flash{from{background:rgba(95,179,249,.18)}to{background:transparent}}',
    '.ww-filter{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:var(--ww-muted)}',
    '.ww-chip{border:1px solid var(--ww-line);background:var(--ww-panel2);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}',
    /* method */
    '.ww-method{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:8px}',
    '.ww-mf{background:var(--ww-panel2);border:1px solid var(--ww-line);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--ww-muted)}',
    '.ww-mf b{display:block;color:var(--ww-text);font-size:13px;margin-bottom:3px}',
    '.ww-flow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;font-weight:600;margin-top:12px}',
    '.ww-flow span{padding:4px 9px;border-radius:6px;background:var(--ww-panel2);border:1px solid var(--ww-line)}',
    '.ww-flow em{font-style:normal;color:var(--ww-muted)}',
    '.ww-foot{margin-top:16px;font-size:12px;color:var(--ww-muted);border-top:1px solid var(--ww-line);padding-top:12px}',
    /* dock */
    '.ww-dock{position:fixed;right:14px;bottom:14px;z-index:2147481000;width:310px;max-width:calc(100vw - 28px);background:rgba(11,19,16,.96);border:1px solid var(--ww-line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45);overflow:hidden}',
    '.ww-dock-h{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--ww-line);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--ww-muted)}',
    '.ww-dock-h button{border:0;background:transparent;padding:0 4px;font-size:16px;line-height:1;color:var(--ww-muted)!important}',
    '.ww-dock-b{padding:10px 12px 12px}',
    '.ww-dock.ww-min .ww-dock-b{display:none}',
    '.ww-live{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ww-ok);margin-right:7px;box-shadow:0 0 0 0 rgba(70,192,138,.6);animation:ww-live 2s infinite}',
    '@keyframes ww-live{0%{box-shadow:0 0 0 0 rgba(70,192,138,.6)}70%{box-shadow:0 0 0 7px rgba(70,192,138,0)}100%{box-shadow:0 0 0 0 rgba(70,192,138,0)}}',
    '.ww-chain{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:10px}',
    '.ww-step{border:1px solid var(--ww-line);border-radius:8px;padding:6px 6px 5px;text-align:center;transition:background .25s,border-color .25s}',
    '.ww-step-k{font-size:9.5px;font-weight:800;letter-spacing:.06em;color:var(--ww-muted)}',
    '.ww-step-v{font-size:11.5px;font-weight:700;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ww-step.ww-s-ok{border-color:rgba(70,192,138,.45)}',
    '.ww-step.ww-s-ok .ww-step-v{color:var(--ww-ok)}',
    '.ww-step.ww-s-high{border-color:rgba(255,90,79,.6);background:rgba(255,90,79,.1)}',
    '.ww-step.ww-s-high .ww-step-v{color:#ff8178}',
    '.ww-step.ww-s-med{border-color:rgba(255,159,28,.6);background:rgba(255,159,28,.1)}',
    '.ww-step.ww-s-med .ww-step-v{color:#ffb653}',
    '.ww-vms{display:grid;grid-template-columns:18px 1fr 18px;gap:8px;align-items:center;margin-bottom:10px}',
    '.ww-vms-board{background:#050505;border:3px solid #2a2a2a;border-radius:6px;padding:8px 6px;min-height:76px;display:flex;flex-direction:column;justify-content:center;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:800;letter-spacing:.08em;color:#3a3220;font-size:13px;line-height:1.35;text-transform:uppercase;box-shadow:inset 0 0 18px rgba(0,0,0,.9)}',
    '.ww-vms-board.ww-on{color:var(--ww-amber);text-shadow:0 0 6px rgba(255,176,32,.75)}',
    '.ww-vms-board .ww-big{font-size:16px}',
    '.ww-beacon{width:18px;height:18px;border-radius:50%;background:#3d2e0d;border:2px solid #222;justify-self:center}',
    '.ww-beacon.ww-on{animation:ww-beacon .9s steps(1) infinite}',
    '.ww-beacon.ww-on.ww-r{animation-delay:.45s}',
    '@keyframes ww-beacon{0%{background:#ffb020;box-shadow:0 0 14px 4px rgba(255,176,32,.8)}50%{background:#3d2e0d;box-shadow:none}}',
    '.ww-latest{border-top:1px solid var(--ww-line);padding-top:9px;font-size:12.5px}',
    '.ww-latest-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px}',
    '.ww-latest-h b{font-size:14px}',
    '.ww-factors{margin:6px 0 0;padding:0;list-style:none;font-size:11.5px;color:var(--ww-muted)}',
    '.ww-factors li{display:flex;justify-content:space-between;gap:8px;padding:1px 0}',
    '.ww-factors li span:last-child{color:var(--ww-text);font-weight:700;font-variant-numeric:tabular-nums}',
    '.ww-scorebar{height:5px;border-radius:999px;background:var(--ww-line);margin-top:6px;overflow:hidden}',
    '.ww-scorebar span{display:block;height:100%;border-radius:999px;transition:width .4s}',
    /* toasts */
    '.ww-toasts{position:fixed;top:62px;left:50%;transform:translateX(-50%);z-index:2147483001;display:flex;flex-direction:column;gap:8px;width:min(420px,calc(100vw - 24px))}',
    '.ww-toast{background:#1d0f0e;border:1px solid rgba(255,90,79,.6);border-left:4px solid var(--ww-high);border-radius:10px;padding:11px 13px;box-shadow:0 12px 34px rgba(0,0,0,.5);display:flex;gap:10px;align-items:flex-start;animation:ww-in .3s ease-out}',
    '@keyframes ww-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}',
    '.ww-toast-kicker{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#ff8178}',
    '.ww-toast-title{font-weight:700;font-size:15px;margin:1px 0 3px}',
    '.ww-toast-body{font-size:12.5px;color:#d7c9c7}',
    '.ww-toast .ww-btn{flex:none;margin-left:auto}',
    /* responsive */
    '@media (max-width:980px){.ww-kpis{grid-template-columns:repeat(3,1fr)}.ww-grid,.ww-grid2{grid-template-columns:1fr}.ww-method{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:560px){.ww-dash{padding:60px 12px 30px}.ww-kpis{grid-template-columns:repeat(2,1fr)}.ww-bar-row{grid-template-columns:110px 1fr 28px}.ww-pitem{grid-template-columns:26px 1fr auto}.ww-pitem .ww-hide-s{display:none}.ww-tab{padding:6px 10px}}',
    '@media (prefers-reduced-motion:reduce){#ww-root *{animation-duration:0s!important;animation-iteration-count:1!important}.ww-beacon.ww-on{background:#ffb020}}'
  ].join('\n');

  /* --------------------------------------------------------------- map svg */
  var LEVEL_COLOR = { hotspot: '#ff5a4f', elevated: '#ff9f1c', watch: '#e8cf4a', quiet: '#4b6359' };
  function mapSVG() {
    var roads =
      '<path d="M30,330 C180,300 320,230 570,170" class="r"/>' +                    // Nanyang Avenue
      '<path d="M432,207 C420,130 460,70 530,62 C585,56 600,120 570,170" class="r2"/>' + // Nanyang Crescent
      '<path d="M90,60 C120,120 170,160 213,278" class="r2"/>' +                    // Saraca Road
      '<path d="M343,235 C350,300 420,320 560,330" class="r2"/>';                   // towards Tamarind
    // [host-config] extra roads, extra labels and a taller map from the host app
    (CFG.extraRoads || []).forEach(function (r) { roads += '<path d="' + esc(r.d) + '" class="r2"/>'; });
    var MH = CFG.mapHeight || 400;
    var extraLabels = (CFG.extraLabels || []).map(function (t) {
      return '<text x="' + t.x + '" y="' + t.y + '" fill="' + esc(t.color || '#93a59d') + '" font-size="' + (t.size || 11) + '" font-weight="' + (t.weight || 600) + '"' +
        (t.spacing ? ' letter-spacing="' + t.spacing + '"' : '') + (t.rot ? ' transform="rotate(' + t.rot + ' ' + t.x + ' ' + t.y + ')"' : '') + '>' + esc(t.text) + '</text>';
    }).join('');
    var out = '<svg viewBox="0 0 600 ' + MH + '" role="img" aria-label="Schematic NTU campus map with wildlife camera locations">' +
      '<defs><pattern id="ww-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#1f3a2c" stroke-width="3"/></pattern></defs>' +
      '<rect width="600" height="' + MH + '" fill="#0f1a15"/>' +
      '<path d="M0,0 H250 C210,60 150,90 120,210 C100,280 40,300 0,300 Z" fill="url(#ww-hatch)" opacity=".9"/>' +
      '<path d="M600,0 V40 C560,40 520,20 480,0 Z" fill="url(#ww-hatch)"/>' +
      '<path d="M600,250 V400 H460 C500,370 560,350 600,250 Z" fill="url(#ww-hatch)"/>' +
      '<ellipse cx="320" cy="140" rx="70" ry="40" fill="url(#ww-hatch)" opacity=".7"/>' +
      '<text x="18" y="24" fill="#5f8a74" font-size="11" font-weight="700" letter-spacing="1">FORESTED EDGE</text>' +
      '<text x="282" y="144" fill="#5f8a74" font-size="10" font-weight="700" letter-spacing="1">GREEN BUFFER</text>' +
      '<g fill="none" stroke-linecap="round">' +
      roads.replace(/class="r"/g, 'stroke="#2b3a35" stroke-width="16"').replace(/class="r2"/g, 'stroke="#2b3a35" stroke-width="11"') +
      roads.replace(/class="r2?"/g, 'stroke="#5a6b65" stroke-width="1.2" stroke-dasharray="7 7"') +
      '</g>' +
      '<text x="70" y="342" fill="#93a59d" font-size="11" font-weight="600" transform="rotate(-9 70 342)">Nanyang Ave</text>' +
      '<text x="500" y="44" fill="#93a59d" font-size="11" font-weight="600">Nanyang Cres</text>' +
      extraLabels +
      '<text x="584" y="' + (MH - 8) + '" fill="#5f7069" font-size="10" text-anchor="end">Schematic, not to scale</text>';
    var phase = ((Date.now() / 1000) % 1.8).toFixed(2); // keeps the pulse smooth across redraws
    LOCATIONS.forEach(function (L) {
      var s = statsFor(L), lvl = locLevel(s), c = LEVEL_COLOR[lvl];
      var r = 9 + Math.min(16, Math.sqrt(s.count) * 2.6);
      var sel = selectedLoc === L ? ' ww-sel' : '';
      out += '<g class="ww-node' + sel + '" data-loc="' + L.id + '" tabindex="0" role="button" aria-label="' + esc(L.name + ', ' + s.count + ' detections, ' + LEVEL_TEXT[lvl]) + '">' +
        (lvl === 'hotspot' ? '<circle class="ww-pulse" style="animation-delay:-' + phase + 's" cx="' + L.x + '" cy="' + L.y + '" r="' + r + '" fill="' + c + '" opacity=".6"/>' : '') +
        '<circle class="ww-node-dot" cx="' + L.x + '" cy="' + L.y + '" r="' + r + '" fill="' + c + '" fill-opacity="' + (lvl === 'quiet' ? .55 : .9) + '" stroke="#0b1310" stroke-width="2"/>' +
        '<text x="' + L.x + '" y="' + (L.y + 4) + '" text-anchor="middle" font-size="11" font-weight="800" fill="#0b1310">' + s.count + '</text>' +
        '<rect x="' + (L.x - 52) + '" y="' + (L.y + r + 5) + '" width="104" height="30" rx="5" fill="#0b1310" fill-opacity=".85"/>' +
        '<text x="' + L.x + '" y="' + (L.y + r + 18) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#e5efe9">' + esc(L.name) + '</text>' +
        '<text x="' + L.x + '" y="' + (L.y + r + 30) + '" text-anchor="middle" font-size="9.5" fill="#8ea79b">' + esc(L.cam) + ' · ' + LEVEL_TEXT[lvl] + '</text>' +
        '</g>';
    });
    return out + '</svg>';
  }

  /* -------------------------------------------------------------- rendering */
  function badge(level, text) { return '<span class="ww-badge ww-b-' + level.toLowerCase() + '">' + esc(text || level) + '</span>'; }

  function renderKPIs(all) {
    var hotspots = LOCATIONS.map(function (L) { return { L: L, s: statsFor(L) }; }).sort(function (a, b) { return b.s.count - a.s.count; });
    var top = hotspots[0] && hotspots[0].s.count ? hotspots[0] : null;
    var nHot = hotspots.filter(function (h) { return locLevel(h.s) === 'hotspot'; }).length;
    var tile = function (label, val, sub, small) {
      return '<div class="ww-kpi"><div class="ww-kpi-label">' + label + '</div><div class="ww-kpi-val' + (small ? ' ww-small' : '') + '">' + val + '</div><div class="ww-kpi-sub">' + sub + '</div></div>';
    };
    return tile('Total detections', all.count, all.count ? pct(all.night / all.count) + ' at night' : 'none yet') +
      tile('High-risk events', all.high, all.count ? pct(all.high / all.count) + ' of detections' : '&nbsp;') +
      tile('Driver warnings', all.warnings, all.vms + ' VMS, ' + (all.warnings - all.vms) + ' beacon only') +
      tile('Species recorded', all.speciesList.length, all.speciesList[0] ? 'Most: ' + esc(all.speciesList[0].name) : '&nbsp;') +
      tile('Top location', top ? esc(top.L.name) : '—', nHot + ' hotspot' + (nHot === 1 ? '' : 's') + ' flagged', true);
  }

  function renderDetail() {
    if (!selectedLoc) {
      var all = statsFor(null);
      return '<h2>Location details</h2><p class="ww-cap">Select a camera on the map to see its activity and recommended intervention.</p>' +
        '<dl class="ww-dl"><dt>Cameras online</dt><dd>' + LOCATIONS.length + '</dd>' +
        '<dt>Peak period (all)</dt><dd>' + peakWindow(all.hours) + '</dd>' +
        '<dt>Hotspot rule</dt><dd>≥ ' + CFG.hotspotThreshold + ' detections or ≥ ' + CFG.hotspotHighRisk + ' high-risk in ' + CFG.historyWindowDays + ' days</dd>' +
        '<dt>Ground / tree species</dt><dd>' + all.guild.terrestrial + ' / ' + all.guild.arboreal + '</dd></dl>' +
        '<div class="ww-rec"><div class="ww-rec-k">How this connects the two prongs</div>Each camera detection triggers an immediate roadside warning (Prong 1) and is logged here. When a camera keeps recording crossings, it becomes a hotspot and the dashboard recommends permanent infrastructure for that spot (Prong 2).</div>';
    }
    var L = selectedLoc, s = statsFor(L), lvl = locLevel(s), r = recommend(s);
    var html = '<div class="ww-detail-title"><b>' + esc(L.name) + '</b><span class="ww-pill">' + esc(L.cam) + '</span>' + badge(lvl, LEVEL_TEXT[lvl]) +
      '<button class="ww-chip" data-act="deselect" style="margin-left:auto">All locations</button></div>';
    html += '<dl class="ww-dl"><dt>Detections</dt><dd>' + s.count + ' <span class="ww-muted" style="font-weight:400">(' + s.recent + ' in last ' + CFG.historyWindowDays + ' days)</span></dd>' +
      '<dt>High-risk events</dt><dd>' + s.high + '</dd>' +
      '<dt>Warnings triggered</dt><dd>' + s.warnings + ' (' + s.vms + ' VMS)</dd>' +
      '<dt>Most detected</dt><dd>' + (s.speciesList[0] ? s.speciesList[0].icon + ' ' + esc(s.speciesList[0].name) + ' (' + s.speciesList[0].n + ')' : '—') + '</dd>' +
      '<dt>Peak period</dt><dd>' + peakWindow(s.hours) + '</dd>' +
      '<dt>Last detection</dt><dd>' + (s.last ? dayLabel(s.last.date) + ', ' + hhmm(s.last.date) : '—') + '</dd></dl>';
    if (lvl === 'hotspot') {
      html += '<div class="ww-rec ww-hot"><div class="ww-rec-k">Persistent hotspot · recommended long-term intervention</div>' +
        '<div>Priority ' + badge(r.priority) + ' <span class="ww-muted" style="font-size:12px">' + esc(r.basis) + '</span></div><ul>' +
        r.measures.map(function (m) { return '<li><b>' + m.t + '</b>: <span class="ww-muted">' + m.d + '</span></li>'; }).join('') +
        '<li><b>Interim</b>: <span class="ww-muted">keep the camera and VMS active until construction is complete.</span></li></ul></div>';
    } else {
      var need = Math.max(0, CFG.hotspotThreshold - s.recent);
      html += '<div class="ww-rec"><div class="ww-rec-k">Status: monitoring</div>' +
        (s.count ? need + ' more detection' + (need === 1 ? '' : 's') + ' (or ' + Math.max(0, CFG.hotspotHighRisk - s.recentHigh) + ' more high-risk) within ' + CFG.historyWindowDays + ' days before this location is reviewed for permanent infrastructure.' : 'No wildlife recorded at this camera yet.') +
        '<div class="ww-progress"><span style="width:' + Math.min(100, s.recent / CFG.hotspotThreshold * 100) + '%"></span></div>' +
        (r ? '<div class="ww-muted" style="font-size:12px">Likely measure if it becomes a hotspot: ' + esc(r.summary) + '</div>' : '') + '</div>';
    }
    return html;
  }

  function renderSpecies(s) {
    if (!s.count) return '<div class="ww-empty">No detections yet</div>';
    var max = s.speciesList[0].n;
    return '<div class="ww-bars">' + s.speciesList.map(function (sp) {
      var w = function (n) { return (n / max * 100).toFixed(2) + '%'; };
      return '<div class="ww-bar-row" title="' + esc(sp.name + ': ' + sp.high + ' high, ' + sp.medium + ' medium, ' + sp.low + ' low') + '">' +
        '<span class="ww-bar-name">' + sp.icon + ' ' + esc(sp.name) + '</span>' +
        '<span class="ww-bar-track"><span style="width:' + w(sp.high) + ';background:var(--ww-high)"></span><span style="width:' + w(sp.medium) + ';background:var(--ww-med)"></span><span style="width:' + w(sp.low) + ';background:var(--ww-low)"></span></span>' +
        '<span class="ww-bar-n">' + sp.n + '</span></div>';
    }).join('') + '</div>' +
      '<div class="ww-legend"><span><i style="background:var(--ww-high);border-radius:2px"></i>High risk</span><span><i style="background:var(--ww-med);border-radius:2px"></i>Medium</span><span><i style="background:var(--ww-low);border-radius:2px"></i>Low</span></div>';
  }

  function renderHours(s) {
    if (!s.count) return '<div class="ww-empty">No detections yet</div>';
    var max = Math.max.apply(null, s.hours) || 1;
    var cols = s.hours.map(function (n, h) {
      return '<div class="ww-col-wrap" title="' + pad(h) + ':00–' + pad((h + 1) % 24) + ':00 · ' + n + ' detection' + (n === 1 ? '' : 's') + '"><div class="ww-col' + (isNight(h) ? '' : ' ww-day') + '" style="height:' + (n / max * 100) + '%"></div></div>';
    }).join('');
    var axis = s.hours.map(function (_, h) { return '<span>' + (h % 3 === 0 ? pad(h) : '') + '</span>'; }).join('');
    return '<div class="ww-cols">' + cols + '</div><div class="ww-axis">' + axis + '</div>' +
      '<div class="ww-legend"><span><i style="background:var(--ww-accent);border-radius:2px"></i>Night (19:00–06:00)</span><span><i style="background:var(--ww-accent);opacity:.45;border-radius:2px"></i>Day</span><span>Peak: <b style="color:var(--ww-text)">' + peakWindow(s.hours) + '</b></span></div>';
  }

  function renderPriorities() {
    var rows = LOCATIONS.map(function (L) { var s = statsFor(L); return { L: L, s: s, lvl: locLevel(s), r: recommend(s) }; })
      .filter(function (x) { return x.s.count > 0; })
      .sort(function (a, b) {
        var o = { hotspot: 0, elevated: 1, watch: 2, quiet: 3 };
        return (o[a.lvl] - o[b.lvl]) || (b.s.recentHigh - a.s.recentHigh) || (b.s.recent - a.s.recent) || (b.s.count - a.s.count);
      });
    if (!rows.length) return '<div class="ww-empty">Recommendations appear once cameras start recording wildlife.</div>';
    return '<div class="ww-plist">' + rows.map(function (x, i) {
      var action = x.lvl === 'hotspot' ? '<b>' + esc(x.r.summary) + '</b>' : '<span class="ww-muted">Continue monitoring · candidate: ' + esc(x.r.summary) + '</span>';
      return '<button class="ww-pitem" data-loc="' + x.L.id + '"><span class="ww-rank">' + (i + 1) + '</span>' +
        '<span><b>' + esc(x.L.name) + '</b><br><span class="ww-muted" style="font-size:12px">' + x.s.recent + ' in ' + CFG.historyWindowDays + ' days · ' + x.s.count + ' total · ' + x.s.high + ' high-risk</span></span>' +
        '<span class="ww-hide-s" style="font-size:13px">' + action + '</span>' +
        '<span>' + (x.lvl === 'hotspot' ? badge(x.r.priority, x.r.priority + ' priority') : badge(x.lvl, LEVEL_TEXT[x.lvl])) + '</span></button>';
    }).join('') + '</div>';
  }

  var lastRenderedId = 0;
  function renderLog() {
    var list = events.filter(function (e) { return !selectedLoc || e.loc === selectedLoc; });
    var filter = '<div class="ww-filter">' + (selectedLoc ? 'Showing <span class="ww-chip">' + esc(selectedLoc.name) + '</span><button class="ww-chip" data-act="deselect">Show all</button>' : 'Showing all locations · newest first') +
      '<span style="margin-left:auto">' + list.length + ' record' + (list.length === 1 ? '' : 's') + (list.length > 200 ? ' (latest 200 shown)' : '') + '</span></div>';
    if (!list.length) return filter + '<div class="ww-empty">No detections recorded yet. Run the simulation or load sample history.</div>';
    var rows = list.slice(-200).reverse().map(function (e) {
      return '<tr' + (e.id > lastRenderedId && e.source !== 'sample' ? ' class="ww-new"' : '') + '>' +
        '<td>' + dayLabel(e.date) + ' ' + hhmm(e.date) + '</td><td class="ww-mono">' + esc(e.loc.cam) + '</td><td>' + esc(e.loc.name) + '</td>' +
        '<td>' + e.sp.icon + ' ' + esc(e.sp.name) + '</td><td>' + pct(e.conf) + '</td><td>' + esc(PROX[e.prox].label.replace(/^On the |^Near the /, '').replace(/ \(.+\)/, '')) + '</td>' +
        '<td>' + badge(e.risk.level, e.risk.level + ' ' + e.risk.score) + '</td><td>' + esc(e.response.label) + '</td></tr>';
    }).join('');
    return filter + '<div class="ww-tablebox"><table class="ww-table"><thead><tr><th>Time</th><th>Camera</th><th>Location</th><th>Species</th><th>Conf.</th><th>Position</th><th>Risk</th><th>Response</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function renderMethod() {
    return '<div class="ww-method">' +
      '<div class="ww-mf"><b>Species severity · 0–30</b>Size and conservation status. Wild boar 30, pangolin 26, macaque 18, squirrel 8.</div>' +
      '<div class="ww-mf"><b>Proximity · 5–25</b>On the roadway 25, verge 15, nearby 5.</div>' +
      '<div class="ww-mf"><b>Time of day · 4–20</b>Night 20, dawn/dusk 14, day 4. Reflects driver visibility.</div>' +
      '<div class="ww-mf"><b>Repeat activity · 0–20</b>Rises with earlier detections at the same camera in the last ' + CFG.historyWindowDays + ' days, full at ' + CFG.historySaturation + '.</div></div>' +
      '<p class="ww-cap" style="margin:10px 0 0">Score = factor total rescaled to 0–100 and weighted by detection confidence. ' +
      '<b style="color:var(--ww-text)">≥ ' + CFG.highScore + ' HIGH</b>: VMS message + flashing beacons · <b style="color:var(--ww-text)">' + CFG.mediumScore + '–' + (CFG.highScore - 1) + ' MEDIUM</b>: beacons only · <b style="color:var(--ww-text)">below ' + CFG.mediumScore + ' LOW</b>: logged only · confidence below ' + pct(CFG.minConfidence) + ': flagged for human review, no warning.</p>' +
      '<div class="ww-flow"><span>Camera detects</span><em>→</em><span>Risk scored</span><em>→</em><span>VMS / beacon</span><em>→</em><span>Event logged</span><em>→</em><span>Hotspot map</span><em>→</em><span>Fencing · culvert · canopy bridge</span></div>';
  }

  function renderDash() {
    if (!ui.dash) return;
    var all = statsFor(null);
    var hasSample = events.some(function (e) { return e.source === 'sample'; });
    ui.kpis.innerHTML = renderKPIs(all);
    ui.map.innerHTML = mapSVG();
    ui.detail.innerHTML = renderDetail();
    ui.species.innerHTML = renderSpecies(all);
    ui.hours.innerHTML = renderHours(all);
    ui.prio.innerHTML = renderPriorities();
    ui.log.innerHTML = renderLog();
    ui.sampleNote.innerHTML = hasSample ? '<span class="ww-pill">Includes simulated 30-day history</span>' : '';
    ui.seedBtn.disabled = hasSample;
    ui.seedBtn.style.opacity = hasSample ? .5 : 1;
    lastRenderedId = seq;
    lastRender = Date.now();
  }
  // Live detections can arrive many times a second; redraw at most once a second
  // and keep the log's scroll position so the dashboard stays usable while the sim runs.
  var renderTimer = null, lastRender = 0;
  function scheduleRender() {
    if (ui.count) ui.count.textContent = events.length;
    if (view !== 'dash' || renderTimer) return;
    var wait = Math.max(0, 1000 - (Date.now() - lastRender));
    renderTimer = setTimeout(function () {
      renderTimer = null;
      var box = ui.log && ui.log.querySelector('.ww-tablebox'), st = box ? box.scrollTop : 0;
      renderDash();
      box = ui.log.querySelector('.ww-tablebox'); if (box) box.scrollTop = st;
    }, wait);
  }

  /* ------------------------------------------------------------------- dock */
  var dockTimers = [];
  function setStep(el, cls, text) { el.className = 'ww-step' + (cls ? ' ww-s-' + cls : ''); el.querySelector('.ww-step-v').textContent = text; }
  function setVMS(mode) {
    var b = ui.vms;
    ui.bl.classList.toggle('ww-on', mode !== 'idle');
    ui.br.classList.toggle('ww-on', mode !== 'idle');
    b.classList.toggle('ww-on', mode === 'vms');
    if (mode === 'vms') b.innerHTML = '<div>⚠ Wildlife ahead</div><div class="ww-big">Slow down</div><div>20 km/h</div>';
    else b.innerHTML = '<div>NTU WildWatch</div><div>Drive safely</div>';
  }
  function resetDock() {
    if (!ui.dock) return;
    dockTimers.forEach(clearTimeout); dockTimers = [];
    setStep(ui.stCam, 'ok', 'Monitoring');
    setStep(ui.stRisk, '', 'Standby');
    setStep(ui.stVms, '', 'Standby');
    setStep(ui.stDrv, '', 'Normal');
    setVMS('idle');
  }
  function showOnDock(ev) {
    if (!ui.dock) return;
    dockTimers.forEach(clearTimeout); dockTimers = [];
    var lvl = ev.risk.level, resp = ev.response;
    var cls = lvl === 'HIGH' ? 'high' : lvl === 'MEDIUM' ? 'med' : '';
    setStep(ui.stCam, 'high', 'Detected');
    setStep(ui.stRisk, '', '…');
    setStep(ui.stVms, '', 'Standby');
    setStep(ui.stDrv, '', 'Normal');
    setVMS('idle');
    dockTimers.push(setTimeout(function () { setStep(ui.stRisk, cls || 'ok', lvl + ' ' + ev.risk.score); }, 350));
    dockTimers.push(setTimeout(function () {
      if (resp.vms) { setStep(ui.stVms, 'high', 'VMS on'); setVMS('vms'); }
      else if (resp.beacon) { setStep(ui.stVms, 'med', 'Beacons'); setVMS('beacon'); }
      else setStep(ui.stVms, 'ok', resp.code === 'review' ? 'Review' : 'Logged');
    }, 700));
    dockTimers.push(setTimeout(function () {
      setStep(ui.stDrv, resp.vms ? 'high' : resp.beacon ? 'med' : 'ok', resp.vms ? 'Slowing' : resp.beacon ? 'Caution' : 'Normal');
    }, 1100));
    dockTimers.push(setTimeout(resetDock, 7000));

    var col = lvl === 'HIGH' ? 'var(--ww-high)' : lvl === 'MEDIUM' ? 'var(--ww-med)' : 'var(--ww-low)';
    ui.latest.innerHTML = '<div class="ww-latest-h"><b>' + ev.sp.icon + ' ' + esc(ev.sp.name) + '</b>' + badge(lvl, lvl + ' ' + ev.risk.score) + '</div>' +
      '<div class="ww-muted">' + esc(ev.loc.name) + ' · ' + esc(ev.loc.cam) + ' · ' + hhmm(ev.date) + ' · ' + pct(ev.conf) + ' confidence</div>' +
      '<div class="ww-scorebar"><span style="width:' + ev.risk.score + '%;background:' + col + '"></span></div>' +
      '<ul class="ww-factors">' + ev.risk.factors.map(function (f) { return '<li><span>' + esc(f.label) + '</span><span>+' + f.pts + '</span></li>'; }).join('') + '</ul>' +
      '<div class="ww-muted" style="margin-top:5px;font-size:11.5px">Response: <b style="color:var(--ww-text)">' + esc(resp.label) + '</b> · logged to dashboard</div>';
  }

  /* ----------------------------------------------------------------- toasts */
  function toast(html, loc) {
    if (!ui.toasts) return;
    var t = document.createElement('div');
    t.className = 'ww-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = '<div>' + html + '</div><button class="ww-btn">View</button>';
    t.querySelector('button').onclick = function () { selectedLoc = loc; setView('dash'); t.remove(); };
    ui.toasts.appendChild(t);
    setTimeout(function () { t.remove(); }, 7000);
  }

  /* ------------------------------------------------------------------- view */
  function setView(v) {
    view = v;
    ui.tabSim.setAttribute('aria-selected', v === 'sim');
    ui.tabDash.setAttribute('aria-selected', v === 'dash');
    ui.dash.classList.toggle('ww-open', v === 'dash');
    if (ui.dock) ui.dock.style.display = v === 'dash' ? 'none' : '';
    if (v === 'dash') { renderDash(); ui.dash.scrollTop = 0; }
  }

  /* ------------------------------------------------------------- CSV export */
  function exportCSV() {
    var head = ['date', 'time', 'camera', 'location', 'species', 'guild', 'confidence', 'position', 'risk_score', 'risk_level', 'response', 'source'];
    var lines = [head.join(',')].concat(events.map(function (e) {
      var d = e.date;
      return [d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), hhmm(d), e.loc.cam, e.loc.name, e.sp.name, e.sp.guild,
        e.conf.toFixed(2), e.prox, e.risk.score, e.risk.level, e.response.label, e.source]
        .map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }));
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wildwatch-detections.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ------------------------------------------------------------- auto-watch */
  function startAutoWatch() {
    if (!CFG.autoWatchLog) return;
    var heading = null;
    var cands = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div,span,strong,b,summary,label,legend,header');
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (el.closest('#ww-root')) continue;
      // keep the innermost element whose whole text is "Detection log" (the heading itself)
      if (/^\s*detection log\s*$/i.test(el.textContent)) heading = el;
    }
    if (!heading) return;
    var target = heading.parentElement || document.body;
    var seenText = {}, seenNodes = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var obs = new MutationObserver(function (muts) {
      if (apiUsed) { obs.disconnect(); return; }
      muts.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1 && n.nodeType !== 3) return;
          if (n.nodeType === 1 && (n.closest('#ww-root') || n.querySelector && n.querySelector('input,select,button'))) return;
          var text = (n.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || text.length > 240) return;
          if (!matchSpecies(text)) return;
          if (/\d/.test(text)) { if (seenText[text]) return; seenText[text] = 1; }
          else if (seenNodes) { if (seenNodes.has(n)) return; seenNodes.add(n); }
          var conf = text.match(/(\d{2,3}(?:\.\d+)?)\s*%/);
          var loc = matchLocation(text);
          record({ species: text, location: loc ? loc.name : undefined, confidence: conf ? +conf[1] : undefined, proximity: /road|crossing/i.test(text) ? 'road' : undefined, _source: 'log' }, true);
        });
      });
    });
    obs.observe(target, { childList: true, subtree: true });
  }

  /* -------------------------------------------------------------------- build */
  function build() {
    var style = document.createElement('style');
    style.id = 'ww-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var root = document.createElement('div');
    root.id = 'ww-root';
    root.innerHTML =
      '<nav class="ww-tabs ww-pos-' + esc(CFG.tabsPosition) + '" role="tablist" aria-label="WildWatch views">' +
        '<button class="ww-tab" role="tab" data-view="sim" aria-selected="true">Simulation</button>' +
        '<button class="ww-tab" role="tab" data-view="dash" aria-selected="false">DED Dashboard <span class="ww-count">0</span></button>' +
      '</nav>' +
      '<section class="ww-dash" aria-label="WildWatch monitoring dashboard"><div class="ww-wrap">' +
        '<div class="ww-head"><div><h1>WildWatch Monitoring Dashboard</h1>' +
          '<p>Decision support for NTU Development &amp; Estate Department · prototype, all data simulated <span data-ui="sampleNote"></span></p></div>' +
          '<div class="ww-actions"><button class="ww-btn" data-act="seed">Load 30-day sample history</button><button class="ww-btn" data-act="csv">Export CSV</button><button class="ww-btn ww-danger" data-act="clear">Clear data</button></div></div>' +
        '<div class="ww-kpis" data-ui="kpis"></div>' +
        '<div class="ww-grid"><div class="ww-card ww-map"><h2>Wildlife hotspot map</h2><p class="ww-cap">Number and circle size = all detections at each camera. Colour = hotspot status from the last ' + CFG.historyWindowDays + ' days. Select a camera for details.</p><div data-ui="map"></div>' +
          '<div class="ww-legend"><span><i style="background:' + LEVEL_COLOR.hotspot + '"></i>Hotspot (≥ ' + CFG.hotspotThreshold + ' detections or ≥ ' + CFG.hotspotHighRisk + ' high-risk in ' + CFG.historyWindowDays + ' days)</span><span><i style="background:' + LEVEL_COLOR.elevated + '"></i>Elevated</span><span><i style="background:' + LEVEL_COLOR.watch + '"></i>Watch</span><span><i style="background:' + LEVEL_COLOR.quiet + '"></i>No activity</span></div></div>' +
          '<div class="ww-card" data-ui="detail"></div></div>' +
        '<div class="ww-grid2"><div class="ww-card"><h2>Detections by species</h2><p class="ww-cap">Split by assessed collision risk</p><div data-ui="species"></div></div>' +
          '<div class="ww-card"><h2>Detections by time of day</h2><p class="ww-cap">When warnings matter most</p><div data-ui="hours"></div></div></div>' +
        '<div class="ww-card" style="margin-bottom:14px"><h2>Infrastructure priority list</h2><p class="ww-cap">Where to spend first: locations ranked by hotspot status, recent high-risk events, then recent volume</p><div data-ui="prio"></div></div>' +
        '<div class="ww-card" style="margin-bottom:14px"><h2>Detection event log</h2><p class="ww-cap">Every detection is stored with species, location, time, confidence, risk and response</p><div data-ui="log"></div></div>' +
        '<div class="ww-card"><h2>Prototype collision-risk model</h2><p class="ww-cap">Conceptual scoring used to decide when a detection needs a warning, not a validated scientific model</p>' + renderMethod() + '</div>' +
        '<p class="ww-foot">Prototype notice: detections, confidence values, risk scores and recommendations are simulated to demonstrate the information flow. They are not real NTU monitoring data. Field testing with real camera observations would be needed to calibrate the model.</p>' +
      '</div></section>' +
      (CFG.showDock ?
      '<aside class="ww-dock" aria-label="Roadside response"><div class="ww-dock-h"><span><span class="ww-live"></span>Roadside response</span><button data-act="min" aria-label="Minimise">–</button></div><div class="ww-dock-b">' +
        '<div class="ww-chain">' +
          '<div class="ww-step" data-ui="stCam"><div class="ww-step-k">CAMERA</div><div class="ww-step-v">Monitoring</div></div>' +
          '<div class="ww-step" data-ui="stRisk"><div class="ww-step-k">RISK</div><div class="ww-step-v">Standby</div></div>' +
          '<div class="ww-step" data-ui="stVms"><div class="ww-step-k">VMS</div><div class="ww-step-v">Standby</div></div>' +
          '<div class="ww-step" data-ui="stDrv"><div class="ww-step-k">DRIVER</div><div class="ww-step-v">Normal</div></div>' +
        '</div>' +
        '<div class="ww-vms"><span class="ww-beacon" data-ui="bl"></span><div class="ww-vms-board" data-ui="vms" aria-live="polite"></div><span class="ww-beacon ww-r" data-ui="br"></span></div>' +
        '<div class="ww-latest" data-ui="latest"><span class="ww-muted">Waiting for the first detection…</span></div>' +
      '</div></aside>' : '') +
      '<div class="ww-toasts" aria-live="polite"></div>';
    document.body.appendChild(root);

    var q = function (s) { return root.querySelector(s); };
    ui = {
      root: root, dash: q('.ww-dash'), tabSim: q('[data-view="sim"]'), tabDash: q('[data-view="dash"]'), count: q('.ww-count'),
      dock: q('.ww-dock'), toasts: q('.ww-toasts'), seedBtn: q('[data-act="seed"]')
    };
    Array.prototype.forEach.call(root.querySelectorAll('[data-ui]'), function (el) { ui[el.getAttribute('data-ui')] = el; });

    function selectLoc(t) {
      var id = t.getAttribute('data-loc');
      var L = LOCATIONS.filter(function (l) { return l.id === id; })[0];
      selectedLoc = selectedLoc === L ? null : L;
      renderDash();
      if (t.classList.contains('ww-pitem')) ui.detail.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // Locations are selected on pointerdown: the map may be redrawn by a live
    // detection between press and release, which would otherwise lose the click.
    root.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var t = e.target.closest('[data-loc]');
      if (t) selectLoc(t);
    });
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-view],[data-act],[data-loc]');
      if (!t) return;
      if (t.hasAttribute('data-view')) return setView(t.getAttribute('data-view'));
      if (t.hasAttribute('data-loc')) { if (e.detail === 0) selectLoc(t); return; } // keyboard activation

      var act = t.getAttribute('data-act');
      if (act === 'deselect') { selectedLoc = null; renderDash(); }
      else if (act === 'seed') seed(30);
      else if (act === 'csv') exportCSV();
      else if (act === 'clear') { if (confirm('Clear all recorded detections?')) clearAll(); }
      else if (act === 'min') { ui.dock.classList.toggle('ww-min'); t.textContent = ui.dock.classList.contains('ww-min') ? '+' : '–'; }
    });
    root.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ww-node')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    });

    resetDock();
    if (ui.count) ui.count.textContent = events.length;
  }

  function init() {
    load();
    build();
    startAutoWatch();
  }

  /* -------------------------------------------------------------- public API */
  window.WildWatch = {
    __loaded: true,
    record: function (input) { return record(input, false); },
    seed: seed,
    clear: clearAll,
    show: function (v) { setView(v === 'dashboard' ? 'dash' : v || 'dash'); },
    onDetection: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    events: function () { return events.map(publicEvent); },
    config: CFG,
    locations: LOCATIONS,
    species: SPECIES
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
