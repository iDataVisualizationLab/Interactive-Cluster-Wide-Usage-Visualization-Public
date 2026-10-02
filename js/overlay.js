/* The polygons as Plotly traces, with name chips, the hover emphasis, and HL_COVER:
   the cells the polygons cover, which draw() uses to hide everything else.
   Needs: D, SEL, USERCOL, hx2t (selection.js), polygons.js. */

/* the cells each ticked person occupies in the grid as it is drawn now.
   Returns filled outlines plus a name chip on the roomier shapes, so a polygon
   can be traced back to a person without relying on the colour alone. */
const HL_MAXLAB = 90;                    /* cap the chips so a big pick stays readable */
const HL_W = 1.8;                        /* the outline; hover thickens it */
/* Outline only: nothing is laid over the cells, so their colours are read as they are.
   The shapes still need a fill for Plotly to hover on their inside, so it is a clear
   one. Hovering then shows by thickening one person's outlines and fading the rest. */
const HL_CLEAR = 'rgba(0,0,0,0)';
const HL_DIM = 0.3;                      /* how far the other people's outlines fade */
let HL_ORDER = [];                       /* user for each overlay trace, in order */
let HL_COVER = null;   /* row index -> hours inside some polygon; null while nobody is selected */

/* hovering a shape lifts every shape of the same person and fades the others */
function emphasise(u){
  if(!HL_ORDER.length) return;
  const idx = [], w = [], lc = [];
  HL_ORDER.forEach((name, i) => {
    const col = USERCOL.get(name) || '#ffffff';
    const on  = u === null || name === u;
    idx.push(3 + i);
    w.push(u === null ? HL_W : (on ? HL_W + 1.8 : 0.9));
    lc.push(on ? col : col.replace('hsl(', 'hsla(').replace(')', ',' + HL_DIM + ')'));
  });
  Plotly.restyle('heat', {'line.width':w, 'line.color':lc}, idx);
}
/* each ticked person's cells in the rows as drawn: person -> Set of 'hour|row'.
   overlayTraces() outlines these; the sort button (sort.js) counts their outlines */
function hlCells(meta){
  const byUser = new Map();
  for(let i = 0; i < meta.length; i++){
    const m = meta[i];
    if(!m.ks) continue;
    if(m.type === 'g' && m.open) continue;      /* its members carry it instead */
    for(const k of m.ks){
      const r = D.rows[k];
      if(!SEL.has(r.u)) continue;
      let set = byUser.get(r.u);
      if(!set){ set = new Set(); byUser.set(r.u, set); }
      for(const h of r.i) set.add(h + '|' + i);
      for(const h of (r.g || [])) set.add(h + '|' + i);   /* GPU rows have no gaps */
    }
  }
  return byUser;
}
function overlayTraces(meta){
  HL_COVER = null;
  if(!SEL.size) return {traces:[], ann:[]};
  HL_COVER = new Map();
  const byUser = hlCells(meta);
  const hx = [], hy = [], lines = [], chips = [], order = [];
  for(const [u, set] of byUser){
    const col = USERCOL.get(u) || '#ffffff';
    const xs = [], ys = [];
    const shapes = mergeTouching(runsOf(set).map(cl => spansOf(cl, set)));
    for(const sh of shapes){
      for(let j = 0; j < sh.L.length; j++){        /* remember what this polygon covers */
        let hrs = HL_COVER.get(sh.y0 + j);
        if(!hrs){ hrs = new Set(); HL_COVER.set(sh.y0 + j, hrs); }
        for(let x = sh.L[j]; x <= sh.R[j]; x++) hrs.add(x);
      }
      const poly = outline(sh);
      for(const [x, y] of poly){
        const px = hx2t(x);
        xs.push(px); ys.push(y); hx.push(px); hy.push(y);
      }
      const fx = hx2t(poly[0][0]);
      xs.push(fx); ys.push(poly[0][1]); hx.push(fx); hy.push(poly[0][1]);
      xs.push(null); ys.push(null); hx.push(null); hy.push(null);
      /* the chip sits on the middle row of the shape, just inside its left edge,
         so it stays on the shape even where the outline steps inwards */
      const mid = (sh.L.length - 1) >> 1;
      let area = 0;
      for(let j = 0; j < sh.L.length; j++) area += sh.R[j] - sh.L[j] + 1;
      chips.push({u:u, col:col, x:hx2t(sh.L[mid] - 0.5), y:sh.y0 + mid, area:area});
    }
    if(!xs.length) continue;
    lines.push({type:'scatter', mode:'lines', x:xs, y:ys, fill:'toself',
                fillcolor:HL_CLEAR,
                line:{color:col, width:HL_W, shape:'linear'},
                hoveron:'fills', hoverlabel:{bgcolor:col, font:{color:'#0b1119', size:11}},
                hovertemplate:'<b>' + u + '</b><extra></extra>',
                showlegend:false, name:u});
    order.push(u);
  }
  /* one dark stroke under everything, so a bright outline stays visible even
     on top of a yellow or orange cell */
  const halo = hx.length ? [{type:'scatter', mode:'lines', x:hx, y:hy,
                             line:{color:'rgba(6,11,17,0.85)', width:HL_W + 1.6},
                             hoverinfo:'skip', showlegend:false}] : [];
  /* every ticked person gets named at least once - their biggest shape first -
     then the remaining budget goes to the next largest shapes overall */
  chips.sort((a, b) => b.area - a.area);
  const first = new Map(), rest = [];
  for(const c of chips){
    if(first.has(c.u)) rest.push(c); else first.set(c.u, c);
  }
  const pick = [...first.values()]
    .concat(rest.slice(0, Math.max(0, HL_MAXLAB - first.size)));
  const ann = pick.map(c => ({
    x:c.x, y:c.y, text:c.u, showarrow:false, xanchor:'left', yanchor:'middle',
    xshift:3, bgcolor:'rgba(8,13,20,0.88)', bordercolor:c.col, borderwidth:1,
    borderpad:2, font:{color:c.col, size:9.5, family:'var(--mono)'}
  }));
  HL_ORDER = order;                 /* trace 2 is the halo, then one per user */
  return {traces:halo.concat(lines), ann:ann};
}
