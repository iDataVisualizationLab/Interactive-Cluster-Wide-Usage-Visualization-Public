/* "Group highlighted rows", grouping by machine. The five best sorting methods from the
   benchmark (row_sorting_bench/02_RESULTS.md) run side by side in background workers,
   5 seconds each; then their five orders and the unsorted one are compared with the
   page's own outline code, on exactly the rows drawn (machines opened included), and the
   best is kept:
     one person highlighted   the fewest outlines; then bigger outlines; then cleaner ones
     several people           the worst-off person first (outlines above the fewest they
                              could get), then the total, then cleaner outlines
   The unsorted order is always one of the six, so the button never makes things worse.
   Answers are remembered, so going back to a selection is instant.
   Needs: D, SEL, NT, HL_R, TIDY, open (config.js, selection.js), hlCells (overlay.js),
   runsOf / spansOf / mergeTouching (polygons.js), SORTCORE (sort-core.js), BUILD
   (version.js), draw (heatmap.js). */

const SORT = (() => {
  const BUDGET = 5000;           /* each method's time (the benchmark measured 2 s) */
  const POLISH_MS = 1000;        /* extra time each method spends tightening its own order */
  const WAIT = 250;              /* let a burst of clicks settle before starting */
  const KEEP = 60;               /* how many answers to remember */
  const found = new Map();       /* problem -> {state:'running'} or {state:'done', candidates, ms} */
  const chosen = new Map();      /* problem + machines opened -> the final choice */
  let job = null, timer = 0;

  /* ---- the problem: what is drawn, with every machine closed ------------------------ */
  function problemFor(keys, groupOf, emit){
    const meta = emit(keys, true).meta;
    const drawn = [], sections = [];
    let cur = null;
    meta.forEach((m, i) => {
      if(m.type !== 'g') return;
      const r = D.rows[groupOf.get(m.key).built[0].k];
      const sid = r.c + '|' + (r.m || 'cpu');
      if(!cur || cur.sid !== sid){ cur = {sid, offset:i, ids:[]}; sections.push(cur); }
      cur.ids.push(drawn.length);
      drawn.push(m.key);
    });
    const persons = [];
    for(const u of [...SEL].sort()){
      const ids = [], hours = [];
      drawn.forEach((key, id) => {
        let hs = null;
        for(const mem of groupOf.get(key).built){
          const r = D.rows[mem.k];
          if(r.u !== u) continue;
          hs = hs || new Set();
          for(const h of r.i) hs.add(h);
          for(const h of (r.g || [])) hs.add(h);
        }
        if(hs){ ids.push(id); hours.push([...hs].sort((a, b) => a - b)); }
      });
      if(ids.length) persons.push({u, ids, hours});
    }
    const sig = persons.map(p => p.u).join(',') + '#' +
                sections.map(s => s.offset + ':' + s.ids.map(i => drawn[i]).join(',')).join('|');
    return {sig, problem:{NT, R:HL_R, keys:drawn,
                          sections:sections.map(s => ({offset:s.offset, ids:s.ids})), persons}};
  }

  /* ---- the workers ---------------------------------------------------------------------- */
  function cancel(){
    clearTimeout(timer); timer = 0;
    if(job){ job.workers.forEach(w => w.terminate()); clearTimeout(job.guard); job = null; }
    for(const [k, v] of found) if(v.state === 'running') found.delete(k);
  }
  function schedule(sig, problem){
    const f = found.get(sig);
    if(f && f.state === 'running') return;
    cancel();
    found.set(sig, {state:'running'});
    timer = setTimeout(() => start(sig, problem), WAIT);
  }
  function start(sig, problem){
    timer = 0;
    const me = {sig, t0:performance.now(), workers:[], results:new Map()};
    job = me;
    const v = '?v=' + encodeURIComponent(typeof BUILD === 'undefined' ? 'dev' : BUILD);
    for(const [id] of SORTCORE.METHODS){
      let w;
      try { w = new Worker('js/sort-worker.js' + v); }
      catch(e){ me.results.set(id, {ok:false, error:String(e)}); continue; }
      me.workers.push(w);
      w.onmessage = ev => { me.results.set(id, ev.data); settle(me); };
      w.onerror = ev => { ev.preventDefault(); me.results.set(id, {ok:false, error:ev.message || 'the worker failed'}); settle(me); };
      w.postMessage({problem, method:id, seed:SORTCORE.hashStr(sig + '|' + id), budget:BUDGET, polishMs:api.polishMs});
    }
    me.guard = setTimeout(() => {
      for(const [id] of SORTCORE.METHODS) if(!me.results.has(id)) me.results.set(id, {ok:false, error:'no answer in time'});
      settle(me);
    }, BUDGET + 8000);
    settle(me);
  }
  function settle(me){
    if(job !== me || me.results.size < SORTCORE.METHODS.length) return;
    clearTimeout(me.guard);
    me.workers.forEach(w => w.terminate());
    job = null;
    const candidates = SORTCORE.METHODS.map(([id, name]) => {
      const r = me.results.get(id);
      return r && r.ok ? {id, name, order:r.order, tight:r.tight, evals:r.evals, ms:r.ms} : {id, name, error:r ? r.error : 'missing'};
    });
    found.set(me.sig, {state:'done', candidates, ms:performance.now() - me.t0});
    while(found.size > KEEP) found.delete(found.keys().next().value);
    if(TIDY) draw();
  }

  /* ---- the final choice, with the page's own outline code -------------------------------- */
  function score(meta, floors){
    const cells = hlCells(meta);
    const per = {};
    let rings = 0, area = 0, own = 0, worst = 0;
    for(const [u, floor] of floors){
      const set = cells.get(u);
      if(!set) continue;
      const shapes = mergeTouching(runsOf(set).map(cl => spansOf(cl, set)));
      for(const s of shapes) for(let j = 0; j < s.L.length; j++) area += s.R[j] - s.L[j] + 1;
      rings += shapes.length; own += set.size;
      per[u] = shapes.length;
      worst = Math.max(worst, shapes.length - floor);
    }
    return {rings, area, own, worst, avg:rings ? area / rings : 0, fill:area ? own / area : 1, per};
  }
  /* Fewest polygons first. On a tie the fuller one wins - the same cells inside less
     polygon, which is what removes the empty stripes. (It used to be the bigger average
     polygon that won a tie, which rewarded exactly those stripes: same cells, more room
     around them.) */
  const compare = (a, b, single) => single
    ? (a.rings - b.rings) || (b.fill - a.fill) || (a.avg - b.avg)
    : (a.worst - b.worst) || (a.rings - b.rings) || (b.fill - a.fill);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function choose(keys, emit, problem, f){
    const floors = new Map(problem.persons.map(p => [p.u, SORTCORE.floorOfHours(p.hours, HL_R, NT)]));
    const single = problem.persons.length === 1;
    const full = order => { const seen = new Set(order); return order.concat(keys.filter(k => !seen.has(k))); };
    /* every method sends two orders: the one it found, and the same one tightened. Both
       are counted with the page's own code, and the method keeps whichever wins by the
       rule, so tightening can never cost a polygon. */
    const cands = [{id:'unsorted', name:'unsorted', order:keys}];
    for(const c of f.candidates){
      if(!c.order) continue;
      const one = {id:c.id, name:c.name, order:full(c.order)};
      one.score = score(emit(one.order, false).meta, floors);
      if(c.tight){
        const two = full(c.tight), s2 = score(emit(two, false).meta, floors);
        if(compare(s2, one.score, single) < 0){ one.order = two; one.score = s2; }
      }
      cands.push(one);
    }
    cands[0].score = score(emit(cands[0].order, false).meta, floors);
    /* all six ranked by the rule; a tie keeps the order listed, so the unsorted order
       wins every tie and nothing moves unless something is actually better */
    const ranked = cands.slice().sort((a, b) => compare(a.score, b.score, single));
    const best = ranked[0];
    const u = cands[0].score, b = best.score;
    const failed = f.candidates.filter(c => !c.order);
    const text = failed.length === f.candidates.length ? 'Sorting failed, order kept · ' + plural(b.rings, 'outline')
      : best === cands[0] ? 'Nothing beat the order before sorting, kept · ' + plural(b.rings, 'outline')
      : 'Best of ' + cands.length + ': ' + LABEL[best.id].charAt(0).toLowerCase() + LABEL[best.id].slice(1) + ' · ' + plural(b.rings, 'outline') +
        ' (before sorting ' + u.rings + ')';
    const line = c => (c === best ? '▶ ' : '   ') + c.name + ': ' + plural(c.score.rings, 'outline') +
      (single ? '' : ', worst-off person ' + c.score.worst + ' above their fewest possible') +
      ', fill ' + c.score.fill.toFixed(2);
    const title = (single ? 'Fewest outlines wins' : 'The worst-off person wins first, then the fewest outlines') + '\n' +
      cands.map(line).join('\n') +
      failed.map(c => '\n   ' + c.name + ': no answer (' + c.error + ')').join('') +
      '\n5 methods, 5 s each, side by side; took ' + (f.ms / 1000).toFixed(1) + ' s';
    return {order:best.order, text, title, winner:best.id, single, people:problem.persons.length, ms:f.ms,
            ranked:ranked.map(c => c.id), failed:failed.map(c => ({id:c.id, name:c.name, error:c.error})),
            scores:cands.map(c => ({id:c.id, name:c.name, ...c.score}))};
  }

  /* ---- the (i) next to the button: how each of the six orders did ------------------------ */
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'})[ch]);
  const LABEL = {unsorted:'Before sorting', C15:'Local shuffle', C18:'Iterated local shuffle',
                 C17:'Cooling shuffle', C19:'Seriation search', AI1:'Learning shuffle'};
  /* the panel: a title and one table, the chosen order highlighted */
  function why(c){
    const byId = new Map(c.scores.map(r => [r.id, r]));
    const before = byId.get('unsorted');
    const maxRings = Math.max(1, ...c.scores.map(r => r.rings));
    const methods = c.ranked.filter(id => id !== 'unsorted').map(id => byId.get(id));
    const row = (r, rank) => {
      const cls = (r.id === 'unsorted' ? 'sw-before' : '') + (r.id === c.winner ? ' sw-win' : '');
      return '<tr class="' + cls.trim() + '">' +
        '<td class="sw-rank">' + (rank || '') + '</td>' +
        '<td class="sw-name">' + esc(LABEL[r.id] || r.name) + (r.id === 'unsorted' ? '' : '<span class="sw-id">' + esc(r.id) + '</span>') + '</td>' +
        (c.single ? '' : '<td>+' + r.worst + '</td>') +
        '<td class="sw-rings"><span class="sw-barbox"><span class="sw-bar" style="width:' + (100 * r.rings / maxRings).toFixed(1) + '%"></span></span>' +
          '<span class="sw-val">' + r.rings + '</span></td>' +
        '<td>' + Math.round(r.avg) + '</td></tr>';
    };
    return '<div class="sw-title">Sorting report</div>' +
      '<table class="sw-table"><thead><tr><th></th><th class="sw-l">Order</th>' +
        (c.single ? '' : '<th class="sw-key">Worst-off</th>') +
        '<th class="' + (c.single ? 'sw-key ' : '') + 'sw-l">Polygons</th><th>Avg size</th></tr></thead><tbody>' +
        row(before, '') + methods.map((r, i) => row(r, i + 1)).join('') +
        c.failed.map(x => '<tr class="sw-fail"><td></td><td class="sw-name">' + esc(LABEL[x.id] || x.name) +
          '</td><td colspan="' + (c.single ? 2 : 3) + '">no answer</td></tr>').join('') +
      '</tbody></table>';
  }
  let wired = false;
  function wire(wrap){
    if(wired) return;
    wired = true;
    const btn = document.getElementById('sortWhyBtn');
    btn.addEventListener('click', ev => { ev.stopPropagation(); wrap.classList.toggle('open'); });
    document.addEventListener('click', ev => { if(!wrap.contains(ev.target)) wrap.classList.remove('open'); });
    document.addEventListener('keydown', ev => { if(ev.key === 'Escape') wrap.classList.remove('open'); });
  }

  /* ---- what draw() asks, and what it shows ------------------------------------------------ */
  const info = {text:'', title:'', state:'idle', last:null};
  function show(text, title, state, c){
    info.text = text; info.title = title; info.state = state;
    const el = document.getElementById('sortInfo');
    if(el){
      el.textContent = text;
      /* the line is kept short in the menu, so the whole of it is on the tooltip */
      el.title = state === 'done' ? text + ' - hover the (i) to see how every order did' : text;
      el.classList.toggle('busy', state === 'running');
    }
    const wrap = document.getElementById('sortWhy'), panel = document.getElementById('sortWhyPanel');
    if(!wrap || !panel) return;
    wire(wrap);
    const on = state === 'done' && !!c;
    wrap.hidden = !on;
    if(!on){ wrap.classList.remove('open'); wrap.dataset.shown = ''; return; }
    if(wrap.dataset.shown !== c.key){ panel.innerHTML = why(c); wrap.dataset.shown = c.key; }
  }
  /* the order to draw for the button, or null while the methods are still working */
  function orderFor(keys, groupOf, emit){
    const {sig, problem} = problemFor(keys, groupOf, emit);
    if(!problem.persons.length){ show('', '', 'idle'); return null; }
    const f = found.get(sig);
    if(!f || f.state === 'running'){
      schedule(sig, problem);
      show('Sorting… 5 methods, about 5 s', 'Five sorting methods are running side by side', 'running');
      return null;
    }
    const opened = [...open].filter(k => groupOf.has(k)).sort().join(',');
    const ck = sig + '#' + opened;
    let c = chosen.get(ck);
    if(!c){
      c = choose(keys, emit, problem, f);
      c.key = ck;
      chosen.set(ck, c);
      while(chosen.size > KEEP) chosen.delete(chosen.keys().next().value);
    }
    info.last = c;
    show(c.text, c.title, 'done', c);
    return c.order;
  }
  function idle(){ cancel(); show('', '', 'idle'); }
  /* polishMs and forget() exist so a comparison shot can be taken with the tightening
     off and with the answers thrown away; the page itself never changes them. */
  const api = {orderFor, idle, info, polishMs:POLISH_MS, forget:() => { chosen.clear(); found.clear(); }};
  return api;
})();
