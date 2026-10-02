/* Hours used per day: hour and day totals, the bar chart, and lining the bars up above
   the heatmap's hours.
   Needs: D, NT, RAINBOW, T, TMAX, DAY_ISO, DAY_LO, hourTime (config.js),
   dayTicks (timeaxis.js).

   The strip was switched off on 2026-09-22 and came back on 2026-09-27 as the chart of the
   Summarization tab. It no longer zooms: a bar is hovered, never clicked, and the heatmap
   is left alone. (The zoom code - DAYSEL, applyDay - is kept; nothing sets DAYSEL now.)
   Each bar spans exactly its day's hours and the dates are ticked where the dates at the
   foot of the window are, so a day's bar, its date down there and its columns in the
   heatmap all start at the same x. */

let SYNCING = false;                     /* guards against relayout feeding itself */
let DAYSEL = null;                       /* the day the chart is zoomed to, or null */

const DAYMS = 86400000, HOURMS = 3600000, HALFH = 1800000;
let HOURS = [], DAYS = [], XFULL = null;
/* the strip's height: the bottom zone of the Summarization tab (126 px when it sat on top) */
const STRIP_H = 250;

/* the per-hour and per-day totals the bars are drawn from, and the full time
   range of the chart, worked out once the data has been read */
function prepareStrip(){
  HOURS = (() => {
    const per = new Array(NT).fill(null);          /* hour -> Map(node -> cpu), deduped */
    for(const r of D.rows){
      if(r.m === 'gpu') continue;   /* a GPU row repeats a machine its CPU row already counts */
      for(let j = 0; j < r.i.length; j++){
        const h = r.i[j];
        if(!per[h]) per[h] = new Map();
        per[h].set(r.n, r.a[j]);
      }
      for(const h of r.g){
        if(!per[h]) per[h] = new Map();
        if(!per[h].has(r.n)) per[h].set(r.n, 0);
      }
    }
    return per.map((m, h) => {
      let s = 0; if(m) m.forEach(v => s += v);
      return {t:D.ts[h], work:s / 100, mean:(m && m.size) ? s / m.size : 0, cells:m ? m.size : 0};
    });
  })();

  DAYS = (() => {
    const g = new Map();
    for(const x of HOURS){
      const k = x.t.slice(0, 10);
      if(!g.has(k)) g.set(k, {day:k, work:0, sum:0, cells:0});
      const e = g.get(k);
      e.work += x.work; e.sum += x.mean * x.cells; e.cells += x.cells;
    }
    return [...g.values()].map(e =>
      ({day:e.day, work:e.work, mean:e.cells ? e.sum / e.cells : 0, cells:e.cells}));
  })();
  XFULL = [new Date(Date.parse(D.ts[0]) - HALFH).toISOString(),
           new Date(Date.parse(D.ts[NT - 1]) + HALFH).toISOString()];
}

const xWindow = () => DAYSEL
  ? [DAYSEL + 'T00:00:00Z', DAYSEL + 'T23:59:59Z']
  : XFULL;

function drawStrip(){
  if(!document.getElementById('strip')) return;      /* the strip is switched off */
  const zoom = !!DAYSEL;
  const src  = zoom ? HOURS.filter(x => x.t.slice(0, 10) === DAYSEL) : DAYS;
  /* a day's bar runs from the edge where its first hour's column begins to the edge where
     its last one ends - the part days at either end of the month are narrower */
  const end  = i => (i + 1 < DAY_LO.length ? DAY_LO[i + 1] : NT);
  const xs   = zoom ? src.map(x => x.t) : src.map((d, i) => hourTime((DAY_LO[i] + end(i) - 1) / 2));
  const wid  = zoom ? src.map(() => HOURMS) : src.map((d, i) => (end(i) - DAY_LO[i]) * HOURMS);
  document.getElementById('stripLbl').textContent = zoom ? 'Hours used per hour' : 'Hours used per day';
  const tk = dayTicks();

  Plotly.react('strip', [{
    type:'bar', x:xs,
    y:src.map(d => d.cells), width:wid,
    marker:{color:src.map(d => T(d.mean)), colorscale:RAINBOW, cmin:0, cmax:TMAX,
            line:{width:src.map(d => (!zoom && d.day === DAYSEL) ? 2 : 0), color:'#e7edf4'}},
    hovertemplate:'%{y:,}<extra></extra>'      /* hovering a bar shows its value, nothing else */
  }], {
    height:STRIP_H, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    font:{color:'#a6b4c4', size:10}, margin:{l:STRIPM.l, r:STRIPM.r, t:4, b:34},
    dragmode:false,                       /* a bar is hovered, never clicked or dragged */
    /* the same ticks as the dates at the foot of the window (timeaxis.js) */
    xaxis:{type:'date', range:xWindow(), tickfont:{size:9.5}, linecolor:'#2a3a4d',
           showticklabels:true, ticks:'outside', tickcolor:'#2a3a4d', ticklen:3,
           tickmode:'array', tickvals:tk.at, ticktext:tk.text,
           gridcolor:'rgba(0,0,0,0)', tickangle:0, fixedrange:true},
    yaxis:{title:{text:'hours used', font:{size:10}}, gridcolor:'#22303f',
           zerolinecolor:'#2a3a4d', rangemode:'tozero', fixedrange:true}
  }, CFG).then(alignStrip);
}

/* line each strip's plotting area up with the heatmap's, so a bar sits directly
   above the hours it is made of */
const STRIPM = {l:146, r:26};             /* first guess only: the y title and label gutter */
function alignStrip(){
  const gd = document.getElementById('heat');
  if(!gd._fullLayout) return;
  const ax = gd._fullLayout.xaxis, g = gd.getBoundingClientRect();
  for(const id of ['strip']){
    const sd = document.getElementById(id);
    if(!sd || !sd._fullLayout || !sd.clientWidth) continue;   /* its tab is not up */
    const t = sd.getBoundingClientRect();
    /* the width is given too: once the page grows a scrollbar Plotly can still be laying
       the chart out for the wider box, which left the last bar 15 px past the heatmap */
    const w = Math.round(t.width);
    const l = Math.max(0, Math.round(g.left + ax._offset - t.left));
    const r = Math.max(0, w - Math.round(g.left + ax._offset + ax._length - t.left));
    const f = sd._fullLayout, m = f.margin;
    if(Math.abs(m.l - l) < 1 && Math.abs(m.r - r) < 1 && Math.abs((f.width || 0) - w) < 1) continue;
    STRIPM.l = l; STRIPM.r = r;
    Plotly.relayout(sd, {width:w, 'margin.l':l, 'margin.r':r});
  }
}

function applyDay(){
  const gd = document.getElementById('heat'), sd = document.getElementById('strip');
  if(!gd.layout) return;
  const r = xWindow();
  Plotly.relayout(gd, {'xaxis.range': r, 'xaxis.autorange': false});
  if(sd && sd.layout) Plotly.relayout(sd, {'xaxis.range': r});
  const sel = document.getElementById('stripSel');
  if(sel) sel.textContent = DAYSEL || 'whole month';
  alignStrip();
}

/* Hovering only: no click handler, no Reset view. The strip is on the Summarization tab,
   so it is drawn again whenever that tab comes up (network-panel.js) and on resize. */
function initStrip(){
  if(!document.getElementById('strip')) return;      /* the strip is switched off */
  drawStrip();
  window.addEventListener('resize', () => setTimeout(alignStrip, 260));
}
