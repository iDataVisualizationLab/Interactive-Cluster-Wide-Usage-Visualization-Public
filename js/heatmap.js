/* The heatmap. draw() reads the controls and redraws the chart and its label
   gutter; initHeatmapEvents() keeps the day strip on the same time range as the
   heatmap.
   Needs: config.js, selection.js, highlight.js, rows.js, legend.js (inLim),
   strip.js (xWindow, alignStrip, SYNCING). */

function draw(){
  const mode = document.getElementById('group').value;
  const pos = +document.getElementById('minh').value;
  const minh = Math.round(Math.pow(pos / 100, 2) * MAXH);
  document.getElementById('minhTxt').textContent = minh + ' h';
  const order = mode === 'user' ? D.order_user : D.order_node;
  const keep = new Set(order.filter(k => {
    const r = D.rows[k];
    return r.h >= Math.max(minh, 1);
  }));

  const ordMode = document.getElementById('order').value;
  const gmap = new Map();
  for(const k of order){
    if(!keep.has(k)) continue;
    const key = groupKey(k, mode);
    if(!gmap.has(key)) gmap.set(key, []);
    gmap.get(key).push(k);
  }
  /* Activity is judged on two things at once: how little of the month the row sat
     unused, and how much CPU work it did. Both are scaled 0-1 against the best row
     on show and multiplied, so a row has to score on both to rank highly. */
  const pairWork  = k => { const r = D.rows[k]; let s = 0; for(const v of r.b) s += v; return s / 100; };
  const pairHours = k => D.rows[k].h;
  const groupStats = key => {
    const ms = gmap.get(key);
    if(mode === 'node'){
      /* the node's own record: every user on it reports the same hourly reading,
         so each hour counts once and the users inside are ignored */
      const per = new Map();
      for(const k of ms){ const r = D.rows[k];
        for(let j = 0; j < r.i.length; j++) per.set(r.i[j], r.a[j]);
        for(const h of r.g) if(!per.has(h)) per.set(h, 0); }
      let s = 0; per.forEach(v => s += v);
      return [per.size, s / 100];
    }
    const hs = new Set(); let s = 0;
    for(const k of ms){ const r = D.rows[k];
      for(const h of r.i) hs.add(h);
      for(const h of r.g) hs.add(h);
      for(const v of r.b) s += v; }
    return [hs.size, s / 100];
  };
  const rank = (items, stat) => {
    const st = new Map(items.map(k => [k, stat(k)]));
    const mh = Math.max(1,    ...items.map(k => st.get(k)[0]));
    const mw = Math.max(1e-9, ...items.map(k => st.get(k)[1]));
    const sc = k => (st.get(k)[0] / mh) * (st.get(k)[1] / mw);
    return items.slice().sort((a, b) => ordMode === 'most' ? sc(b) - sc(a) : sc(a) - sc(b));
  };

  const byName = (a, b) => String(a).localeCompare(String(b), undefined, {numeric:true});
  let keys = groupOrder(mode).filter(k => gmap.has(k));
  /* D.order_user is sorted by total usage, so name order has to be asked for */
  keys = (ordMode !== 'default') ? rank(keys, groupStats) : keys.slice().sort(byName);

  /* Build every group first. A partition heading is only worth emitting once we
     know its section actually has something in it. */
  const makeGroup = key => {
    const labelOf = k => mode === 'user' ? D.rows[k].n : D.rows[k].u;
    let mem = gmap.get(key);
    mem = (ordMode !== 'default')
      ? rank(mem, k => [pairHours(k), pairWork(k)])        /* same rule, inside the group */
      : mem.slice().sort((a, b) => byName(labelOf(a), labelOf(b)));
    /* build each member row first, applying the window */
    const built = mem.map(k => {
      const r = D.rows[k];
      const rr = new Array(NT).fill(null), cc = new Array(NT).fill(null);
      const bb = new Array(NT).fill(0);
      let live = 0;
      const na = new Array(NT).fill(null);   /* the machine's own reading, kept for the group row */
      const gi = new Array(NT).fill(null);   /* GPU only: busiest card, cards busy, cards reporting */
      const isGpu = r.m === 'gpu';
      for(let j = 0; j < r.i.length; j++){
        const v = r.b[j], nd = r.a[j];        /* v is this person's share of the machine's nd */
        na[r.i[j]] = nd;
        if(isGpu) gi[r.i[j]] = [r.mx[j], r.nb[j], r.nc[j]];
        if(inLim(v)){
          rr[r.i[j]] = T(v);
          cc[r.i[j]] = [v, isGpu
            ? (v === nd ? ' GPU' : ' GPU, an equal share of the node’s ' + nd.toFixed(1) + '%')
            : (v === nd ? ' CPU' : ' CPU of the machine’s ' + nd.toFixed(1) + '%')];
          live++;
        } else bb[r.i[j]] = 1;
      }
      for(const h of r.g){ na[h] = 0;
        if(inLim(0)){ rr[h] = 0; cc[h] = [0, ' CPU']; live++; } else bb[h] = 1; }
      return {k:k, rr:rr, cc:cc, bb:bb, na:na, gi:gi, live:live, label:(mode === 'user' ? r.n : r.u)};
    }).filter(m => m.live > 0);          /* a row with nothing left is dropped */
    if(!built.length) return null;       /* and so is a group with nothing left */

    /* The collapsed row. Grouping by node, the members are the people sharing one
       machine and their shares add back to that machine's reading, so the group row
       is that reading. Grouping by user, the members are different machines, so
       adding them would run past one machine's worth - there the mean is meant. */
    const sum = new Float64Array(NT), cnt = new Uint16Array(NT);
    const mx  = new Float64Array(NT);     /* their busiest machine in that hour */
    const nod = new Array(NT).fill(null);
    const ginf = new Array(NT).fill(null);
    for(const m of built)
      for(let h = 0; h < NT; h++){
        if(m.na[h] !== null) nod[h] = m.na[h];
        if(m.gi && m.gi[h]) ginf[h] = m.gi[h];
        if(m.rr[h] !== null){ const v = m.cc[h][0];
          sum[h] += v; cnt[h]++; if(v > mx[h]) mx[h] = v; }
      }
    const row = new Array(NT).fill(null), cd = new Array(NT).fill(null);
    const bg  = new Array(NT).fill(0);
    for(const m of built) for(let h = 0; h < NT; h++) if(m.bb[h]) bg[h] = 1;
    for(let h = 0; h < NT; h++)
      if(cnt[h]){
        const g = (mode === 'node') ? nod[h] : sum[h] / cnt[h];
        row[h] = T(g);
        const gpuNode = mode === 'node' && D.rows[built[0].k].m === 'gpu';
        cd[h]  = [g, (mode === 'node')
          ? (gpuNode
              ? (ginf[h]
                  ? ' GPU · average of ' + ginf[h][2] + (ginf[h][2] === 1 ? ' GPU' : ' GPUs') +
                    ' · busiest ' + ginf[h][0].toFixed(1) + '% · ' +
                    ginf[h][1] + ' of ' + ginf[h][2] + ' busy'
                  : ' GPU')
              : (built.length > 1 ? ' CPU · the whole machine, ' + built.length + ' people' : ' CPU'))
          : (cnt[h] > 1
              ? ' average share per machine · ' + cnt[h] +
                ' machines · busiest ' + mx[h].toFixed(1) + '%'
              : ' CPU · 1 machine')];
        bg[h] = 0;
      }
    return {key:key, built:built, row:row, cd:cd, bg:bg};
  };

  const groupOf = new Map();
  for(const key of keys){ const g = makeGroup(key); if(g) groupOf.set(key, g); }

  /* A partition heading has no data of its own: its row in the grid is entirely
     empty, so nothing is drawn on it and nothing hovers. It is a divider. */
  const PARTS   = [['h100', 'H100'], ['zen4', 'Zen4']];
  /* GPU first inside H100; this is the section order and is independent of
     the Order rows by control, which sorts the rows within each section */
  const METRICS = [['gpu', 'GPU'], ['cpu', 'CPU']];
  const metricOf = g => D.rows[g.built[0].k].m || 'cpu';

  /* the drawn rows for one order of the groups */
  const emit = (orderOf, closed) => {
    const z = [], meta = [], custom = [], back = [];
    let shownPairs = 0;
    const groups = orderOf.filter(k => groupOf.has(k)).map(k => groupOf.get(k));
    const isOpen = key => !closed && open.has(key);
    const push  = (zz, cc, bb, m) => { z.push(zz); custom.push(cc); back.push(bb); meta.push(m); };
    const pushHead = (label, pk, cnt, pad) =>
      push(new Array(NT).fill(null), new Array(NT).fill(null), new Array(NT).fill(0),
           {type:'p', label:label, pk:pk, n:cnt, shut:shut.has(pk), pad:pad});
    const pushGroup = (g, pad) => {
      shownPairs += g.built.length;
      push(g.row, g.cd, g.bg,
           {type:'g', key:g.key, label:plainName(g.key), n:g.built.length, open:isOpen(g.key), pad:pad,
            ks:g.built.map(m => m.k)});
    };
    const pushMems = (g, ms, pad) => {
      for(const m of ms) push(m.rr, m.cc, m.bb,
                              {type:'m', key:g.key, label:m.label, pad:pad, ks:[m.k]});
    };

    if(mode === 'node'){
      /* partition, then CPU or GPU, then the machine, then the people on it.
         The metric heading only appears where a partition actually has both. */
      for(const [cl, plabel] of PARTS){
        const sect = groups.filter(g => D.rows[g.built[0].k].c === cl);
        if(!sect.length) continue;
        const pk = 'p|' + cl;
        pushHead(plabel, pk, sect.length, 2);
        if(shut.has(pk)) continue;
        const mets = METRICS.filter(([mk]) => sect.some(g => metricOf(g) === mk));
        const two  = mets.length > 1;
        for(const [mk, mlabel] of mets){
          const sub = sect.filter(g => metricOf(g) === mk);
          if(two){
            const mpk = pk + '|' + mk;
            pushHead(mlabel, mpk, sub.length, 14);
            if(shut.has(mpk)) continue;
          }
          for(const g of sub){
            pushGroup(g, two ? 26 : 17);
            if(isOpen(g.key)) pushMems(g, g.built, two ? 40 : 32);
          }
        }
      }
    } else {
      /* person, then partition, then CPU or GPU, then what they held */
      for(const g of groups){
        pushGroup(g, 9);
        if(!isOpen(g.key)) continue;
        for(const [cl, plabel] of PARTS){
          const inCl = g.built.filter(m => D.rows[m.k].c === cl);
          if(!inCl.length) continue;
          const pk = 'p|' + g.key + '|' + cl;
          pushHead(plabel, pk, inCl.length, 22);
          if(shut.has(pk)) continue;
          const mets = METRICS.filter(([mk]) =>
            inCl.some(m => (D.rows[m.k].m || 'cpu') === mk));
          const two = mets.length > 1;
          for(const [mk, mlabel] of mets){
            const ms = inCl.filter(m => (D.rows[m.k].m || 'cpu') === mk);
            if(two){
              const mpk = pk + '|' + mk;
              pushHead(mlabel, mpk, ms.length, 34);
              if(shut.has(mpk)) continue;
            }
            pushMems(g, ms, two ? 48 : 38);
          }
        }
      }
    }
    return {z, meta, custom, back, shownPairs};
  };

  const {z, meta, custom, back, shownPairs} = emit(keys, false);

  const shapes = [];
  for(let a = 1; a < meta.length; a++){
    const t = meta[a].type;
    if(t === 'g' || t === 'p')
      shapes.push({type:'line', xref:'paper', x0:0, x1:1, y0:a - 0.5, y1:a - 0.5,
                   line:{color:t === 'p' ? '#55708c' : '#3d5064',
                         width:t === 'p' ? 1.4 : 0.8}});
  }

  /* Someone picked: their part keeps its colours, and every other cell moves to a
     darkened copy of the scale (highlight.js). Nothing is drawn over the cells. */
  const HL = hlRegion(meta);
  let zDim = null, cDim = null;
  if(HL){
    zDim = []; cDim = []; HL_COUNT = 0;
    for(let i = 0; i < z.length; i++){
      const on = HL.get(i), zr = z[i], cr = custom[i];
      const dz = new Array(NT).fill(null), dc = new Array(NT).fill(null);
      for(let h = 0; h < NT; h++){
        if(zr[h] === null) continue;
        if(on && on.has(h)){ HL_COUNT++; continue; }
        dz[h] = zr[h]; dc[h] = cr[h]; zr[h] = null; cr[h] = null;
      }
      zDim.push(dz); cDim.push(dc);
    }
  }
  const HOVER = '%{x|%d %b %H:%M} UTC &nbsp; <b>%{customdata[0]:.1f}%</b>%{customdata[1]}<extra></extra>';
  const cellTrace = (zz, cc, scale) => ({
    type:'heatmap', z:zz, x:D.ts, y:zz.map((_, i) => i), customdata:cc,
    colorscale:scale, zmin:0, zmax:TMAX, zsmooth:false, hoverongaps:false, showscale:false,
    hovertemplate:HOVER});
  const H = z.length * ROWH + TOP + BOT;
  Plotly.react('heat', [{
    type:'heatmap', z:back, x:D.ts, y:back.map((_, i) => i),
    colorscale:[[0,'rgba(0,0,0,0)'], [0.5,'rgba(0,0,0,0)'],
                [0.5, C_OUT], [1, C_OUT]], zmin:0, zmax:1, zsmooth:false, showscale:false, hoverinfo:'skip'
  }].concat(zDim ? [cellTrace(zDim, cDim, hlDarkScale(RAINBOW))] : [],
            [cellTrace(z, custom, RAINBOW)]), {
    height:H, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    dragmode:false,                       /* the chart itself does not zoom or pan */
    font:{color:'#a6b4c4', family:'-apple-system,Segoe UI,Roboto,sans-serif', size:11},
    margin:{l:1, r:16, t:TOP, b:BOT}, shapes:shapes,
    /* no dates here: they are drawn once below the scrolling box, by js/timeaxis.js,
       so they stay on screen wherever the rows have been scrolled to */
    xaxis:{showticklabels:false, ticks:'', gridcolor:'rgba(0,0,0,0)', linecolor:'#2a3a4d',
           range:xWindow(), fixedrange:true, zeroline:false},
    /* pin the row axis, so the rows always fill it exactly */
    yaxis:{gridcolor:'rgba(0,0,0,0)', linecolor:'#2a3a4d', showticklabels:false,
           range:[z.length - 0.5, -0.5], ticks:'', fixedrange:true, zeroline:false}
  }, CFG).then(() => { buildGutter(); alignStrip(); alignTimeAxis(); drawTimeArcs(); refreshExpand();
                       placePins(); });
  renderHlMenu();

  function buildGutter(){
  /* label gutter: one clickable div per row, positioned from the rendered y axis
     so it stays aligned no matter how Plotly sizes the rows */
  const gd = document.getElementById('heat');
  const ya = gd._fullLayout && gd._fullLayout.yaxis;
  const off = ya ? ya._offset : TOP;
  const pitch = ya ? Math.abs(ya.l2p(1) - ya.l2p(0)) : ROWH;
  const rowTop = i => ya ? (off + ya.l2p(i) - pitch / 2) : (TOP + i * ROWH);
  const gut = document.getElementById('gutter');
  gut.innerHTML = '';
  gut.style.height = H + 'px';
  meta.forEach((m, i) => {
    const d = document.createElement('div');
    d.className = 'r ' + m.type + (HL && m.type !== 'p' && !HL.has(i) ? ' dim' : '');
    /* indent is decided at emission time, since the depth now varies:
       H100 gains a CPU/GPU level that Zen4 does not have */
    d.style.paddingLeft = (m.pad != null ? m.pad : 9) + 'px';
    d.style.top = rowTop(i) + 'px';
    d.style.height = pitch + 'px';
    if(m.type === 'g'){
      d.innerHTML = '<span class="tw">' + (m.open ? '\u25be' : '\u25b8') + '</span><b>' +
                    (m.label || m.key) + '</b><span class="ct">' + m.n + '</span>';
      d.addEventListener('click', () => {
        if(open.has(m.key)) open.delete(m.key); else open.add(m.key);
        draw();
      });
    } else if(m.type === 'p'){
      d.innerHTML = '<span class="tw">' + (m.shut ? '▸' : '▾') + '</span>' +
                    m.label + '<span class="ct">' + m.n + '</span>';
      d.addEventListener('click', () => {
        if(shut.has(m.pk)) shut.delete(m.pk); else shut.add(m.pk);
        draw();
      });
    } else {
      d.textContent = m.label;
    }
    gut.append(d);
  });
  document.getElementById('inner').style.height = H + 'px';
  document.getElementById('ytxt').textContent =
    mode === 'user' ? 'User \u00b7 node pair' : 'Node \u00b7 user pair';

  }

  const us = new Set(), nd = new Set();
  let gpuRows = 0;
  keep.forEach(k => { const r = D.rows[k];
    us.add(r.u);
    if(r.m === 'gpu') gpuRows++; else nd.add(r.n); });
  /* a line at the foot of the heatmap controls box: what is on screen */
  const shownRows = meta.reduce((c, m) => c + (m.type === 'p' ? 0 : 1), 0);
  const st = document.getElementById('stat');
  st.innerHTML = '<b>' + shownRows + '</b> rows &middot; <b>' + shownPairs + '</b> pairs';
  st.title = shownPairs + ' pairs, ' + us.size + ' users, ' + nd.size + ' nodes, ' +
             gpuRows + ' GPU rows, ' + shownRows + ' rows shown';
}

function initHeatmapEvents(){
  /* the chart no longer zooms on its own, but choosing a day still moves it, so
     keep the day strip on the same range */
  document.getElementById('heat').on('plotly_relayout', () => {
    if(SYNCING) return;
    const gd = document.getElementById('heat'), sd = document.getElementById('strip');
    if(!sd || !sd.layout || !gd._fullLayout) return;
    /* read whatever range the heatmap ended up on - covers drag, pan, and reset alike */
    const r = gd._fullLayout.xaxis.range.slice();
    SYNCING = true;
    Plotly.relayout(sd, {'xaxis.range': r}).then(() => { SYNCING = false; alignStrip(); });
  });
}
