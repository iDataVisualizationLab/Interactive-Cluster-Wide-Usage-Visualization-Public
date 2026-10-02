/* The row-sorting methods behind "Group highlighted rows" - the five that did best in
   the benchmark (row_sorting_bench/02_RESULTS.md), ported unchanged from its code:

     C18 iterated local search       C17 simulated annealing
     C19 seriation + search          AI1 bandit-guided search
     C15 one climb + sides

   No page access: this file runs inside the sorting workers (sort-worker.js), and in
   Node for the tests. It only plans the order; sort.js makes the final choice with the
   page's own outline code.

   A problem is {NT, R, keys, sections, persons}:
     keys      every machine row drawn, in the order "Order rows by" gives
     sections  [{offset, ids}] - the row where each section's first machine sits and its
               machines (indexes into keys), with every machine closed
     persons   [{u, ids, hours}] - each highlighted person's machines and, per machine,
               the sorted hours they have a cell in
   The answer is a full order of keys: in each section the machines carrying a
   highlighted person form one block, at the top or the bottom of the section, and the
   others keep their order. */

(function(){
  const now = () => performance.now();
  const MOVES = ['relocate', 'swap', 'reverse', 'block'];

  /* the most hours two cells d rows apart may differ by and still link (radius R) */
  const tolerance = (R, d) => Math.floor(Math.sqrt(R * R - d * d) + 1e-9);

  /* ---- one person: runs of hours per machine, and the floor ------------------------ */
  function personData(p, R, NT){
    const runLo = [], runHi = [], runBase = [], pres = [];
    let nRuns = 0, cells = 0;
    for(const hs of p.hours){
      const lo = [], hi = [];
      for(let t = 0; t < hs.length; t++){
        if(t && hs[t] - hs[t - 1] <= R) hi[hi.length - 1] = hs[t];
        else { lo.push(hs[t]); hi.push(hs[t]); }
      }
      runBase.push(nRuns); nRuns += lo.length; cells += hs.length;
      runLo.push(Int32Array.from(lo)); runHi.push(Int32Array.from(hi));
      const pr = new Uint8Array(NT); for(const h of hs) pr[h] = 1; pres.push(pr);
    }
    const person = {u:p.u, keys:Int32Array.from(p.ids), hours:p.hours.map(h => Int32Array.from(h)),
                    runLo, runHi, runBase, pres, nRuns, cells, area:0,
                    order:new Int32Array(p.ids.length), par:new Int32Array(nRuns),
                    /* scratch for the area tie-break: each cluster's first and last row and hour */
                    y0:new Int32Array(nRuns), y1:new Int32Array(nRuns),
                    x0:new Int32Array(nRuns), x1:new Int32Array(nRuns)};
    person.floor = floorOf(person, R);
    return person;
  }
  /* the fewest outlines any order could give: runs projected onto the hour axis,
     joined when they come within the widest link any two rows allow */
  function floorOf(person, R){
    const near = Math.max(tolerance(R, 1), 1);
    const iv = [];
    person.runLo.forEach((lo, t) => { for(let q = 0; q < lo.length; q++) iv.push([lo[q], person.runHi[t][q]]); });
    iv.sort((a, b) => a[0] - b[0]);
    let groups = 0, hi = -Infinity;
    for(const [l, h] of iv){ if(l > hi + near) groups++; if(h > hi) hi = h; }
    return groups;
  }
  /* the floor straight from a person's hours per machine (used by sort.js) */
  function floorOfHours(hours, R, NT){ return personData({u:'', ids:hours.map((_, i) => i), hours}, R, NT).floor; }

  /* ---- the stand-in: clusters of cells, counted on runs ---------------------------
     Returns the number of clusters. With `wantArea`, it also works out how much room
     each cluster takes: the rows it reaches across times the hours it reaches across,
     summed. That is not the drawn polygon's area - a polygon is a staircase, not a
     rectangle - but it rises and falls with it (measured: 0.49 to 0.78 correlation, at
     a fortieth of the cost), which is all a tie-break needs. Read from person.area. */
  function standin(person, pos, R, wantArea){
    const ks = person.keys, m = ks.length, ord = person.order, par = person.par;
    for(let t = 0; t < m; t++) ord[t] = t;
    ord.sort((a, b) => pos[ks[a]] - pos[ks[b]]);
    for(let i = 0; i < person.nRuns; i++) par[i] = i;
    let comps = person.nRuns;
    const y0 = person.y0, y1 = person.y1, x0 = person.x0, x1 = person.x1;
    if(wantArea) for(let t = 0; t < m; t++){
      const y = pos[ks[t]], lo = person.runLo[t], hi = person.runHi[t], b = person.runBase[t];
      for(let q = 0; q < lo.length; q++){ y0[b + q] = y1[b + q] = y; x0[b + q] = lo[q]; x1[b + q] = hi[q]; }
    }
    const find = a => { while(par[a] !== a){ par[a] = par[par[a]]; a = par[a]; } return a; };
    const join = wantArea
      ? (a, b) => { a = find(a); b = find(b); if(a === b) return;
          par[a] = b; comps--;
          if(y0[a] < y0[b]) y0[b] = y0[a]; if(y1[a] > y1[b]) y1[b] = y1[a];
          if(x0[a] < x0[b]) x0[b] = x0[a]; if(x1[a] > x1[b]) x1[b] = x1[a]; }
      : (a, b) => { a = find(a); b = find(b); if(a !== b){ par[a] = b; comps--; } };
    for(let t = 0; t < m; t++){
      const a = ord[t], pa = pos[ks[a]];
      for(let t2 = t + 1; t2 < m; t2++){
        const b = ord[t2], d = pos[ks[b]] - pa;
        if(d > R) break;
        const tol = tolerance(R, d);
        const la = person.runLo[a], ha = person.runHi[a], lb = person.runLo[b], hb = person.runHi[b];
        const ba = person.runBase[a], bb = person.runBase[b];
        let i = 0, j = 0;
        if(tol > 0){
          while(i < la.length && j < lb.length){
            if(ha[i] + tol < lb[j]) i++;
            else if(hb[j] + tol < la[i]) j++;
            else { join(ba + i, bb + j); if(ha[i] < hb[j]) i++; else j++; }
          }
        } else {
          const pA = person.pres[a], pB = person.pres[b];
          while(i < la.length && j < lb.length){
            if(ha[i] < lb[j]) i++;
            else if(hb[j] < la[i]) j++;
            else {
              const s = Math.max(la[i], lb[j]), e = Math.min(ha[i], hb[j]);
              for(let h = s; h <= e; h++) if(pA[h] && pB[h]){ join(ba + i, bb + j); break; }
              if(ha[i] < hb[j]) i++; else j++;
            }
          }
        }
      }
    }
    if(wantArea){
      let a = 0;
      for(let i = 0; i < person.nRuns; i++) if(find(i) === i) a += (y1[i] - y0[i] + 1) * (x1[i] - x0[i] + 1);
      person.area = a;
    }
    return comps;
  }

  /* ---- a selection: sections, blocks, positions, the score ---------------------------- */
  function makeContext(problem){
    const R = problem.R, NT = problem.NT, nKeys = problem.keys.length;
    const persons = problem.persons.map(p => personData(p, R, NT));
    const relevant = new Set();
    for(const p of persons) for(const id of p.keys) relevant.add(id);
    const secOf = new Int32Array(nKeys);
    const secs = problem.sections.map((s, si) => {
      for(const id of s.ids) secOf[id] = si;
      return {offset:s.offset, ids:s.ids.slice(), rel:s.ids.filter(i => relevant.has(i)),
              non:s.ids.filter(i => !relevant.has(i))};
    });
    const personsBySec = secs.map(() => []);
    persons.forEach((p, pi) => {
      const seen = new Set();
      for(const id of p.keys) seen.add(secOf[id]);
      for(const s of seen) personsBySec[s].push(pi);
    });
    const ctx = {R, NT, nKeys, persons, secs, personsBySec, keys:problem.keys};
    ctx.seed = () => ({rel:secs.map(s => s.rel.slice()), side:secs.map(() => 0)});
    ctx.clone = a => ({rel:a.rel.map(r => r.slice()), side:a.side.slice()});
    ctx.place = (a, pos, only) => {
      for(let s = 0; s < secs.length; s++){
        if(only !== undefined && s !== only) continue;
        const sec = secs[s], base = sec.offset + (a.side[s] ? sec.non.length : 0), r = a.rel[s];
        for(let i = 0; i < r.length; i++) pos[r[i]] = base + i;
      }
    };
    ctx.fullKeys = a => {
      const out = [];
      secs.forEach((sec, s) => {
        const rel = a.rel[s].map(id => problem.keys[id]), non = sec.non.map(id => problem.keys[id]);
        out.push(...(a.side[s] ? non.concat(rel) : rel.concat(non)));
      });
      return out;
    };
    /* one person: their excess over the floor; several: the worst-off first, then the total.
       E decides; A (the stand-in's room, summed over everyone) only separates orders that
       tie on E, so the polygon count always comes first. */
    ctx.energyOf = (counts, areas) => {
      let max = 0, total = 0, A = 0;
      for(let i = 0; i < persons.length; i++){
        const e = counts[i] - persons[i].floor;
        total += e; if(e > max) max = e;
        if(areas) A += areas[i];
      }
      return {max, total, A, E:persons.length === 1 ? total : 1e4 * max + total};
    };
    /* bigger than any A, so E and A can be compared as one number where that is handy */
    ctx.areaCap = nKeys * NT * persons.length + 1;
    return ctx;
  }

  /* ---- the search machinery ------------------------------------------------------------ */
  class Searcher {
    constructor(ctx, rng){
      this.ctx = ctx; this.rng = rng;
      this.pos = new Int32Array(ctx.nKeys).fill(-1);
      this.counts = new Float64Array(ctx.persons.length);
      this.areas = new Float64Array(ctx.persons.length);
      this.useArea = false;
      this.evals = 0;
    }
    /* areas are only worked out once useArea is on: measuring them costs about a third
       of the speed, and during the hunt for polygons nothing looks at them */
    count(p, i){
      const c = standin(p, this.pos, this.ctx.R, this.useArea);
      this.areas[i] = this.useArea ? p.area : 0;
      return c;
    }
    set(arr){ this.arr = this.ctx.clone(arr); this.ctx.place(this.arr, this.pos); this.recountAll(); }
    recountAll(){
      const ps = this.ctx.persons;
      for(let i = 0; i < ps.length; i++) this.counts[i] = this.count(ps[i], i);
      this.evals++;
      this.en = this.ctx.energyOf(this.counts, this.areas);
    }
    recountSec(s){
      const ps = this.ctx.persons;
      for(const i of this.ctx.personsBySec[s]) this.counts[i] = this.count(ps[i], i);
      this.evals++;
      this.en = this.ctx.energyOf(this.counts, this.areas);
    }
    get E(){ return this.en.E; }
    get A(){ return this.en.A; }
    /* one number for both, area never outweighing a polygon: used where a single
       value is easier to work with than a pair */
    get EA(){ return this.en.E * this.ctx.areaCap + this.en.A; }
    snapshot(){ return this.ctx.clone(this.arr); }
    movable(){ return this.arr.rel.map((r, s) => r.length >= 2 ? s : -1).filter(s => s >= 0); }
    randInt(n){ return Math.floor(this.rng() * n); }
    pickSection(){
      const m = this.movable();
      if(!m.length) return -1;
      let tot = 0; for(const s of m) tot += this.arr.rel[s].length;
      let x = this.rng() * tot;
      for(const s of m){ x -= this.arr.rel[s].length; if(x < 0) return s; }
      return m[m.length - 1];
    }
    propose(kind, s){
      const r = this.arr.rel[s], lo = 0, hi = r.length, n = hi - lo;
      if(n < 2) return null;
      const backup = {s, rel:r.slice(), counts:this.ctx.personsBySec[s].map(i => this.counts[i]),
                      areas:this.ctx.personsBySec[s].map(i => this.areas[i]), en:this.en};
      const ri = k => lo + this.randInt(k);
      if(kind === 'block' && n < 3) kind = 'swap';
      if(kind === 'relocate'){
        const i = ri(n); let j = ri(n - 1); if(j >= i) j++;
        const v = r.splice(i, 1)[0]; r.splice(j, 0, v);
      } else if(kind === 'swap'){
        const i = ri(n); let j = ri(n - 1); if(j >= i) j++;
        const t = r[i]; r[i] = r[j]; r[j] = t;
      } else if(kind === 'reverse'){
        let i = ri(n), j = ri(n - 1); if(j >= i) j++;
        if(i > j){ const t = i; i = j; j = t; }
        for(; i < j; i++, j--){ const t = r[i]; r[i] = r[j]; r[j] = t; }
      } else {
        const len = 2 + this.randInt(Math.min(8, n - 1) - 1);
        const i = lo + this.randInt(n - len + 1);
        const blk = r.splice(i, len);
        let j = lo + this.randInt(n - len); if(j >= i) j++;
        j = Math.min(j, lo + n - len);
        r.splice(j, 0, ...blk);
      }
      this.ctx.place(this.arr, this.pos, s);
      this.recountSec(s);
      return backup;
    }
    undo(b){
      this.arr.rel[b.s] = b.rel;
      this.ctx.place(this.arr, this.pos, b.s);
      this.ctx.personsBySec[b.s].forEach((i, q) => { this.counts[i] = b.counts[q]; this.areas[i] = b.areas[q]; });
      this.en = b.en;
    }
  }

  /* top or bottom for each section's block: every combination, fewest moved to the bottom on a tie */
  function chooseSides(Sr){
    const a = Sr.arr, act = a.rel.map((r, s) => r.length ? s : -1).filter(s => s >= 0);
    if(!act.length) return;
    let best = null;
    for(let mask = 0; mask < (1 << act.length); mask++){
      act.forEach((s, q) => { a.side[s] = (mask >> q) & 1; });
      Sr.ctx.place(a, Sr.pos);
      Sr.recountAll();
      const pop = act.reduce((c, s, q) => c + ((mask >> q) & 1), 0);
      if(!best || Sr.EA < best.EA || (Sr.EA === best.EA && pop < best.pop)) best = {EA:Sr.EA, mask, pop};
    }
    act.forEach((s, q) => { a.side[s] = (best.mask >> q) & 1; });
    Sr.ctx.place(a, Sr.pos);
    Sr.recountAll();
  }

  function uniformPicker(Sr){ return {pick:() => MOVES[Sr.randInt(MOVES.length)], feedback(){}}; }
  /* AI1: discounted UCB1 over the four kinds of move; reward 1 for a strict improvement */
  function banditPicker(Sr, gamma = 0.995, c = Math.SQRT2){
    const n = new Float64Array(MOVES.length), sum = new Float64Array(MOVES.length);
    return {
      pick(){
        let total = 0; for(const x of n) total += x;
        for(let a = 0; a < MOVES.length; a++) if(n[a] < 1e-9) return MOVES[a];
        let best = 0, bv = -Infinity;
        for(let a = 0; a < MOVES.length; a++){
          const v = sum[a] / n[a] + c * Math.sqrt(Math.log(total) / n[a]);
          if(v > bv){ bv = v; best = a; }
        }
        return MOVES[best];
      },
      feedback(kind, improved){
        for(let a = 0; a < MOVES.length; a++){ n[a] *= gamma; sum[a] *= gamma; }
        const a = MOVES.indexOf(kind); n[a] += 1; sum[a] += improved ? 1 : 0;
      }
    };
  }

  /* Hill climbing that walks across plateaus: any move that is not worse is kept. Not
     worse now means the polygon count did not rise and, where it is unchanged, the room
     the person takes did not grow - so the walk across a plateau drifts towards the
     tighter orders instead of wandering at random. */
  function climb(Sr, deadline, {stall = Infinity, picker} = {}){
    picker = picker || uniformPicker(Sr);
    let since = 0;
    while(since < stall && Sr.E > 0 && now() < deadline){
      const before = Sr.EA, kind = picker.pick(), s = Sr.pickSection();
      if(s < 0) break;
      const b = Sr.propose(kind, s);
      if(b === null){ since++; continue; }
      if(Sr.EA <= before){
        const improved = Sr.EA < before;
        picker.feedback(kind, improved);
        since = improved ? 0 : since + 1;
      } else { Sr.undo(b); picker.feedback(kind, false); since++; }
    }
  }
  /* iterated local search: climb until stuck, keep the best, shake it, climb again */
  function ils(Sr, deadline, {sides = false, picker} = {}){
    const nRel = Sr.arr.rel.reduce((c, r) => c + r.length, 0);
    const stall = Math.max(300, 30 * nRel);
    if(sides) chooseSides(Sr);
    let best = Sr.snapshot(), bestE = Sr.EA;
    while(now() < deadline && Sr.E > 0){
      climb(Sr, deadline, {stall, picker});
      if(sides) chooseSides(Sr);
      if(Sr.EA < bestE){ bestE = Sr.EA; best = Sr.snapshot(); }
      if(now() >= deadline) break;
      Sr.set(best);
      const kick = Math.max(2, Math.round(0.1 * nRel));
      for(let q = 0; q < kick; q++){ const s = Sr.pickSection(); if(s < 0) break; Sr.propose('relocate', s); }
    }
    Sr.set(best);
  }
  /* simulated annealing: one person - Metropolis on the excess; several - a worse
     worst-off is never taken, a better one always, otherwise Metropolis on the total.
     A move that leaves the count alone is judged on the room it takes, as a fraction of
     a polygon, so shrinking is always taken and growing is taken less and less as the
     temperature falls. */
  function anneal(Sr, t0, deadline, {sides = true, T0 = 2.0, T1 = 0.02} = {}){
    if(sides) chooseSides(Sr);
    let best = Sr.snapshot(), bestE = Sr.EA;
    const single = Sr.ctx.persons.length === 1, span = deadline - t0, cap = Sr.ctx.areaCap;
    while(Sr.E > 0){
      const t = now();
      if(t >= deadline) break;
      const T = T0 * Math.pow(T1 / T0, (t - t0) / span);
      const s = Sr.pickSection();
      if(s < 0) break;
      const was = Sr.en;
      const b = Sr.propose(MOVES[Sr.randInt(MOVES.length)], s);
      if(b === null) continue;
      const en = Sr.en;
      const da = (en.A - was.A) / cap;                 /* the area, in polygons */
      let ok;
      if(single){ const d = en.total - was.total + da; ok = d <= 0 || Sr.rng() < Math.exp(-d / T); }
      else if(en.max !== was.max) ok = en.max < was.max;
      else { const d = en.total - was.total + da; ok = d <= 0 || Sr.rng() < Math.exp(-d / T); }
      if(!ok) Sr.undo(b);
      else if(Sr.EA < bestE){ bestE = Sr.EA; best = Sr.snapshot(); }
    }
    Sr.set(best);
    if(sides) chooseSides(Sr);
  }

  /* The last slice of the time: the polygon count is now settled, so walk on with the
     area switched on. Every move that would cost a polygon is refused, and among the
     orders that keep the same polygons the tighter one is taken - which is how the
     stripes inside a polygon get squeezed out. Measured: orders tying on count differ
     in area by 9 % on average and by as much as 51 %, so there is real room here. */
  function polish(Sr, deadline){
    Sr.useArea = true;
    Sr.recountAll();
    let best = Sr.snapshot(), bestEA = Sr.EA;
    while(now() < deadline){
      const before = Sr.EA, s = Sr.pickSection();
      if(s < 0) break;
      const b = Sr.propose(MOVES[Sr.randInt(MOVES.length)], s);
      if(b === null) continue;
      if(Sr.EA > before) Sr.undo(b);
      else if(Sr.EA < bestEA){ bestEA = Sr.EA; best = Sr.snapshot(); }
    }
    Sr.set(best);
  }

  /* ---- C19's starting order: ChatGPT S1's radius-aware seriation ------------------------ */
  const W = [4, 3, 2, 1, 0], RW = [1, 0.67, 0.33];
  function nearDist(pres, NT){
    const d = new Uint8Array(NT);
    let last = -1e9;
    for(let h = 0; h < NT; h++){ if(pres[h]) last = h; d[h] = Math.min(4, h - last); }
    last = 1e9;
    for(let h = NT - 1; h >= 0; h--){ if(pres[h]) last = h; const v = Math.min(4, last - h); if(v < d[h]) d[h] = v; }
    return d;
  }
  function simMatrix(ctx, s){
    const ids = ctx.secs[s].rel, n = ids.length, NT = ctx.NT;
    const at = new Map(ids.map((id, i) => [id, i]));
    const M = new Float64Array(n * n);
    for(const p of ctx.persons){
      const mine = [];
      for(let t = 0; t < p.keys.length; t++) if(at.has(p.keys[t])) mine.push(t);
      if(mine.length < 2) continue;
      const dn = mine.map(t => nearDist(p.pres[t], NT));
      for(let x = 0; x < mine.length; x++)
        for(let y = x + 1; y < mine.length; y++){
          let v = 0;
          for(const h of p.hours[mine[x]]) v += W[dn[y][h]];
          for(const h of p.hours[mine[y]]) v += W[dn[x][h]];
          if(!v) continue;
          const i = at.get(p.keys[mine[x]]), j = at.get(p.keys[mine[y]]);
          M[i * n + j] += v; M[j * n + i] += v;
        }
    }
    return {ids, n, M};
  }
  function greedyChain(sim){
    const {n, M} = sim;
    if(n <= 2) return [...Array(n).keys()];
    let best = null, bestV = -1;
    for(let s0 = 0; s0 < n; s0++){
      const used = new Uint8Array(n), ord = [s0];
      used[s0] = 1;
      let v = 0, last = s0;
      for(let step = 1; step < n; step++){
        let bj = -1, bv = -1;
        for(let j = 0; j < n; j++) if(!used[j] && M[last * n + j] > bv){ bv = M[last * n + j]; bj = j; }
        used[bj] = 1; ord.push(bj); v += bv; last = bj;
      }
      if(v > bestV){ bestV = v; best = ord; }
    }
    return best;
  }
  function twoOpt(sim, ord, deadline){
    const {n, M} = sim, a = ord.slice();
    const S = (x, y) => M[a[x] * n + a[y]];
    let improved = true;
    while(improved && now() < deadline){
      improved = false;
      for(let i = 0; i < n - 1; i++)
        for(let j = i + 1; j < n; j++){
          const before = (i > 0 ? S(i - 1, i) : 0) + (j < n - 1 ? S(j, j + 1) : 0);
          const after  = (i > 0 ? S(i - 1, j) : 0) + (j < n - 1 ? S(i, j + 1) : 0);
          if(after > before + 1e-9){
            for(let x = i, y = j; x < y; x++, y--){ const t = a[x]; a[x] = a[y]; a[y] = t; }
            improved = true;
          }
        }
    }
    return a;
  }
  function radiusScore(sim, a){
    const {n, M} = sim;
    let v = 0;
    for(let i = 0; i < n; i++)
      for(let d = 1; d <= 3 && i + d < n; d++) v += RW[d - 1] * M[a[i] * n + a[i + d]];
    return v;
  }
  function radiusSeriation(sim, ord, deadline){
    const n = sim.n;
    let a = ord.slice(), cur = radiusScore(sim, a), improved = true;
    while(improved && now() < deadline){
      improved = false;
      for(let i = 0; i < n && now() < deadline; i++)
        for(let j = 0; j < n; j++){
          if(i === j) continue;
          const b = a.slice(), v = b.splice(i, 1)[0];
          b.splice(j, 0, v);
          const sc = radiusScore(sim, b);
          if(sc > cur + 1e-9){ a = b; cur = sc; improved = true; }
        }
      for(let i = 0; i < n - 1 && now() < deadline; i++)
        for(let j = i + 1; j < n; j++){
          const b = a.slice(); const t = b[i]; b[i] = b[j]; b[j] = t;
          const sc = radiusScore(sim, b);
          if(sc > cur + 1e-9){ a = b; cur = sc; improved = true; }
        }
    }
    return a;
  }
  function seriationStart(ctx, deadline){
    const arr = ctx.seed();
    ctx.secs.forEach((sec, s) => {
      if(sec.rel.length < 2) return;
      const sim = simMatrix(ctx, s);
      const ord = radiusSeriation(sim, twoOpt(sim, greedyChain(sim), deadline), deadline);
      arr.rel[s] = ord.map(i => sim.ids[i]);
    });
    return arr;
  }

  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s){
    let h = 2166136261;
    for(let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  const METHODS = [
    ['C18', 'iterated local search'],
    ['C17', 'simulated annealing'],
    ['C19', 'seriation + search'],
    ['AI1', 'bandit-guided search'],
    ['C15', 'one climb + sides'],
  ];

  /* Run one method on one problem: `budget` ms hunting polygons, then `polishMs` ms
     squeezing the area at that polygon count. The polish is extra time, not a share of
     the budget - taking a quarter of the hunt away cost the hardest selection (everyone
     highlighted) 57 polygons, while the polish itself can never cost one. */
  function run(problem, method, seed, budget, polishMs){
    const t0 = now(), hunt = t0 + budget, deadline = hunt + (polishMs || 0);
    const ctx = makeContext(problem);
    const Sr = new Searcher(ctx, mulberry32(seed));
    if(method === 'C19') Sr.set(seriationStart(ctx, hunt));
    else Sr.set(ctx.seed());
    if(method === 'C18') ils(Sr, hunt, {sides:true});
    else if(method === 'AI1') ils(Sr, hunt, {sides:true, picker:banditPicker(Sr)});
    else if(method === 'C19') ils(Sr, hunt, {sides:true});
    else if(method === 'C17') anneal(Sr, t0, hunt, {sides:true});
    else if(method === 'C15'){ chooseSides(Sr); climb(Sr, hunt); chooseSides(Sr); }
    else throw new Error('unknown method ' + method);
    /* Both orders go back. The polish holds the stand-in's count fixed, but the stand-in
       counts a little high - two of its clusters can be drawn as one polygon when their
       shapes touch - so a tighter order can cost a real polygon. sort.js counts both with
       the page's own code and keeps whichever is really better. */
    const raw = ctx.fullKeys(Sr.snapshot());
    if(!polishMs) return {order:raw, evals:Sr.evals, E:Sr.E};
    polish(Sr, deadline);
    return {order:raw, tight:ctx.fullKeys(Sr.snapshot()), evals:Sr.evals, E:Sr.E};
  }

  const G = typeof self !== 'undefined' ? self : globalThis;
  G.SORTCORE = {METHODS, run, makeContext, standin, floorOf, floorOfHours, personData, hashStr, mulberry32};
})();
