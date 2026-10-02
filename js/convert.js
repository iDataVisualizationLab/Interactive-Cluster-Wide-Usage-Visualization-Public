/* The two raw metric files, turned into the rows the page draws - in the browser, each
   time the page opens, and never saved anywhere.

   convertRaw(h100, zen4) takes the two parsed metric files (from the .zip given on the lock
   screen, lock.js) and returns {ts, rows, order_node, order_user, users}: the same object
   data/usage-2026-06.json holds for June 2026. It is a line-for-line port of the two
   Python builders that made that file (mkcpu.py and mkgpu.py, 12 Sep 2026), and was
   checked to give exactly the same result (1 Oct 2026).

   Who held a node in an hour, decided for every node and every hour:
     A  the hourly snapshot (NodeJobs_Correlation) lists it     -> held; the users and
        their cores come from the snapshot, plus anyone whose job ran during that hour
     B  no snapshot, but a job (Jobs_Info) ran on it and the node's state (Nodes_State)
        is not IDLE or DOWN                                       -> held; equal shares
     C  a job ran on it but the state is IDLE or DOWN             -> not held
     D  nothing claims it                                         -> not held
   CPU rows: the node's CPU_Usage reading (a), each user's share of it (b), split by cores
   in tenths so the shares add back to the reading exactly; a held hour with no reading
   goes in g. GPU rows (H100 only): the mean of the node's GPUs that hour, split equally,
   with the busiest card (mx), cards above 1% (nb) and cards reporting (nc).

   Plain functions with no page access, so the same file can be run and checked outside
   the page. */

/* Python's round(x, 1): the nearest tenth, and on an exact tie the even one (0.25 -> 0.2,
   0.75 -> 0.8). A tie is only possible when x is exactly k/4 with k odd; any other value
   has a single nearest tenth, which toFixed finds from the exact binary value. */
function pyRound1(x){
  const q = x * 4;
  if(Number.isInteger(q) && Math.abs(q % 2) === 1){
    let r = Math.floor(x * 10);                /* x * 10 is exactly r + 0.5 */
    if(r % 2 !== 0) r += 1;
    return r / 10;
  }
  return parseFloat(x.toFixed(1));
}
/* Python's round(x) to a whole number: halves go to the even one */
function pyRoundInt(x){
  const f = Math.floor(x);
  if(x - f === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
/* Python's sum() of floats (3.12 and later): the running total carries the rounding error
   it would lose and adds it back at the end (Neumaier's compensated sum). A plain loop can
   differ in the last bit, which is enough to turn a mean of 15.05 into 15.0 instead of 15.1. */
function pySum(vals){
  if(!vals.length) return 0;
  let s = vals[0], c = 0;
  for(let k = 1; k < vals.length; k++){
    const x = vals[k], t = s + x;
    if(Math.abs(s) >= Math.abs(x)) c += (s - t) + x;
    else c += (x - t) + s;
    s = t;
  }
  return (c && Number.isFinite(c)) ? s + c : s;
}
/* whole-number division rounding down, as Python's // */
const convFloorDiv = (a, b) => (a - (((a % b) + b) % b)) / b;
const convCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/* Share `tenths` out by weight, by largest remainder, so the parts add up exactly; a tie
   goes to the larger weight, then to the name that sorts first. weights: Map user -> w. */
function convSplit(tenths, weights){
  let tot = 0;
  for(const w of weights.values()) tot += w;
  const out = new Map();
  if(tot <= 0){ for(const u of weights.keys()) out.set(u, 0); return out; }
  const raw = new Map();
  for(const [u, c] of weights) raw.set(u, tenths * c / tot);
  let given = 0;
  for(const [u, v] of raw){ const t = Math.trunc(v); out.set(u, t); given += t; }
  const left = tenths - given;
  const order = [...raw.keys()].sort((a, b) => {
    const ra = raw.get(a) - out.get(a), rb = raw.get(b) - out.get(b);
    if(ra !== rb) return rb - ra;
    const wa = weights.get(a), wb = weights.get(b);
    if(wa !== wb) return wb - wa;
    return convCmp(a, b);
  });
  for(const u of order.slice(0, Math.max(0, left))) out.set(u, out.get(u) + 1);
  return out;
}

function convertRaw(h100, zen4){
  const FILES = [['h100', h100], ['zen4', zen4]];
  const TS = h100.timestamps, NT = TS.length, H0 = Date.parse(TS[0]);
  const hourOf = s => convFloorDiv((Date.parse(s) - H0) / 1000, 3600);
  const perNode = (map, n) => { let a = map.get(n); if(!a){ a = new Array(NT); map.set(n, a); } return a; };
  const jobsOf = d => { const m = new Map(); for(const j of d.data.Jobs_Info.jobs) m.set(j.job_id, j); return m; };
  /* each job, over every hour it ran, on every node it ran on; only nodes passing `keep` */
  const addWindows = (win, jobs, keep) => {
    for(const j of jobs.values()){
      if(!j.start_time || !j.end_time) continue;
      const a = hourOf(j.start_time), b = hourOf(j.end_time);
      for(const n of (j.nodes || [])){
        if(keep && !keep(n)) continue;
        const w = perNode(win, n);
        for(let h = Math.max(a, 0); h <= Math.min(b, NT - 1); h++) (w[h] || (w[h] = new Set())).add(j.user_name);
      }
    }
  };
  /* Nodes_State is a change log: each entry holds until the node's next one */
  const addStates = (state, d, TSI) => {
    const ent = new Map();
    for(const e of d.data.Nodes_State.entries){
      const i = TSI.get(e.time);
      if(i === undefined) continue;
      if(!ent.has(e.node)) ent.set(e.node, []);
      ent.get(e.node).push([i, e.state.join('+')]);
    }
    for(const [n, lst] of ent){
      lst.sort((x, y) => (x[0] - y[0]) || convCmp(x[1], y[1]));
      const st = perNode(state, n);
      lst.forEach(([i, s], k) => {
        const end = k + 1 < lst.length ? lst[k + 1][0] : NT;
        for(let h = i; h < end; h++) st[h] = s;
      });
    }
  };
  const usable = st => !!st && !st.includes('IDLE') && !st.includes('DOWN');

  /* ---- CPU (mkcpu.py): both files ---------------------------------------------------- */
  const cluster = new Map(), cpu = new Map();
  const snapU = new Map(), win = new Map(), state = new Map();
  for(const [cname, d] of FILES){
    const TSI = new Map(d.timestamps.map((t, i) => [t, i]));
    for(const n of d.nodes) cluster.set(n, cname);
    for(const [n, s] of Object.entries(d.data.CPU_Usage.series)) cpu.set(n, s);
    const jobs = jobsOf(d);
    for(const s of d.data.NodeJobs_Correlation.snapshots){
      const i = TSI.get(s.time);
      if(i === undefined) continue;
      const u = new Map(), k = Math.min(s.jobs.length, s.cpus.length);
      for(let x = 0; x < k; x++){
        const j = jobs.get(s.jobs[x]);
        if(j) u.set(j.user_name, (u.get(j.user_name) || 0) + Math.max(s.cpus[x], 1));
      }
      if(u.size) perNode(snapU, s.node)[i] = u;
    }
    addWindows(win, jobs);
    addStates(state, d, TSI);
  }

  const key = (u, n) => u + '\u0000' + n;
  const pair = new Map(), gap = new Map();        /* key -> Map(h -> [a, b]) and key -> [h] */
  for(const n of [...cluster.keys()].sort(convCmp)){
    const sn = snapU.get(n), wn = win.get(n), stn = state.get(n), series = cpu.get(n);
    for(let h = 0; h < NT; h++){
      const snap = sn && sn[h], w = wn && wn[h], st = (stn && stn[h]) || '';
      let users, weights;
      if(snap){ users = new Set([...snap.keys(), ...(w || [])]); weights = snap; }
      else if(w && usable(st)){ users = new Set(w); weights = new Map([...w].map(u => [u, 1])); }
      else continue;
      let v = series ? series[h] : null;
      if(v === null || v === undefined){
        for(const u of users){ const k = key(u, n); if(!gap.has(k)) gap.set(k, []); gap.get(k).push(h); }
        continue;
      }
      if(weights.size !== users.size || [...users].some(u => !weights.has(u)))
        weights = new Map([...users].map(u => [u, 1]));
      v = pyRound1(v);
      const parts = convSplit(pyRoundInt(v * 10), weights);
      for(const u of users){
        const k = key(u, n);
        if(!pair.has(k)) pair.set(k, new Map());
        pair.get(k).set(h, [v, parts.get(u) / 10]);
      }
    }
  }
  const byUserNode = keys => [...keys].map(k => k.split('\u0000'))
    .sort((x, y) => convCmp(x[0], y[0]) || convCmp(x[1], y[1]));
  const rows = [];
  for(const [u, n] of byUserNode(new Set([...pair.keys(), ...gap.keys()]))){
    const k = key(u, n), p = pair.get(k) || new Map();
    const idx = [...p.keys()].sort((x, y) => x - y);
    const g = (gap.get(k) || []).slice().sort((x, y) => x - y);
    rows.push({u, n, c:cluster.get(n), m:'cpu', i:idx,
               a:idx.map(h => p.get(h)[0]), b:idx.map(h => p.get(h)[1]),
               g, h:idx.length + g.length});
  }

  /* ---- GPU (mkgpu.py, then folded in as mkcpu.py does): the H100 file only ----------- */
  const G = h100.data.GPU_Usage.series;
  const TSI = new Map(TS.map((t, i) => [t, i]));
  const gjobs = jobsOf(h100);
  const gsnap = new Map(), gwin = new Map(), gstate = new Map();
  for(const s of h100.data.NodeJobs_Correlation.snapshots){
    const i = TSI.get(s.time);
    if(i === undefined) continue;
    const u = new Set();
    for(const j of s.jobs) if(gjobs.has(j)) u.add(gjobs.get(j).user_name);
    if(u.size) perNode(gsnap, s.node)[i] = u;
  }
  addWindows(gwin, gjobs, n => Object.prototype.hasOwnProperty.call(G, n));
  addStates(gstate, h100, TSI);

  const cardv = new Map(), onnode = new Map();    /* node -> per hour: card readings, users */
  const slotNo = sl => parseInt(sl.split('.')[2].split('-')[0], 10);
  for(const n of Object.keys(G).sort(convCmp)){
    const sn = gsnap.get(n), wn = gwin.get(n), stn = gstate.get(n);
    const held = h => {
      const snap = sn && sn[h], w = wn && wn[h], st = (stn && stn[h]) || '';
      if(snap) return new Set([...snap, ...(w || [])]);
      if(w && usable(st)) return new Set(w);
      return null;
    };
    const cv = perNode(cardv, n), on = perNode(onnode, n);
    for(const sl of Object.keys(G[n]).sort((x, y) => slotNo(x) - slotNo(y))){
      const arr = G[n][sl];
      for(let h = 0; h < NT; h++){
        const us = held(h);
        if(!us || !us.size) continue;
        const v = arr[h];
        if(v === null || v === undefined) continue;
        (cv[h] || (cv[h] = [])).push(pyRound1(v));
        const o = on[h] || (on[h] = new Set());
        for(const u of us) o.add(u);
      }
    }
  }
  const gp = new Map();                            /* key -> Map(h -> [a, b, mx, nb, nc]) */
  for(const [n, on] of onnode){
    const cv = cardv.get(n);
    for(let h = 0; h < NT; h++){
      const us = on[h], vals = cv[h];
      if(!us || !vals || !vals.length) continue;
      const mean = pyRound1(pySum(vals) / vals.length);
      const parts = convSplit(pyRoundInt(mean * 10), new Map([...us].map(u => [u, 1])));
      const busy = vals.filter(x => x > 1).length, mx = Math.max(...vals);
      for(const u of us){
        const k = key(u, n);
        if(!gp.has(k)) gp.set(k, new Map());
        gp.get(k).set(h, [mean, parts.get(u) / 10, mx, busy, vals.length]);
      }
    }
  }
  for(const [u, n] of byUserNode(gp.keys())){
    const t = gp.get(key(u, n)), idx = [...t.keys()].sort((x, y) => x - y);
    rows.push({u, n, c:'h100', m:'gpu', i:idx,
               a:idx.map(h => t.get(h)[0]), b:idx.map(h => t.get(h)[1]),
               mx:idx.map(h => t.get(h)[2]), nb:idx.map(h => t.get(h)[3]), nc:idx.map(h => t.get(h)[4]),
               g:[], h:idx.length});
  }

  /* ---- the two row orders the heatmap starts from ------------------------------------ */
  const all = rows.map((_, k) => k);
  const order_user = all.slice().sort((x, y) => convCmp(rows[x].u, rows[y].u) ||
    convCmp(rows[x].m, rows[y].m) || convCmp(rows[x].n, rows[y].n));
  const order_node = all.slice().sort((x, y) =>
    ((rows[x].c !== 'h100') - (rows[y].c !== 'h100')) || convCmp(rows[x].m, rows[y].m) ||
    convCmp(rows[x].n, rows[y].n) || convCmp(rows[x].u, rows[y].u));
  return {ts:TS.slice(), rows, order_node, order_user,
          users:[...new Set(rows.map(r => r.u))].sort(convCmp)};
}

if(typeof module !== 'undefined' && module.exports) module.exports = {convertRaw, pyRound1};
