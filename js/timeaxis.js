/* The dates along the bottom of the heatmap.

   They used to be the heatmap's own x axis, at the foot of a chart 2000 pixels tall,
   so they were only on screen when the rows were scrolled to the very bottom. They are
   now a chart of their own, below the charts: the page scrolls, the dates stay.
   The chart holds no data - only the axis - and its margins are set from the heatmap's
   rendered axis, so a column here sits exactly under its column up there.

   A date is written where its day starts (DAY_LO): every column of that day is to the
   right of it, and the Time arcs draw that day's line in the same place. Plotly's own
   date ticks would fall at midnight, which for the 1st is before the data begins, and
   putting them at the middle of the day instead left ten columns of 1 June standing to
   the left of "1 Jun".
   Needs: D, NT, DAY_ISO, DAY_LO, hourTime, CFG (config.js), xWindow (strip.js). */

const TAXIS_H = 31;                      /* the strip: the dates and nothing else */
/* month names as the user wrote them ('Jun', 'July') */
const TAXIS_MON = ['Jan','Feb','Mar','Apr','May','Jun','July','Aug','Sept','Oct','Nov','Dec'];

/* A tick at the start of every day, with just the day's number (1, 2, ... 30, 1). The month
   is written once where it begins (monthMarks), not beside every date. */
function dayTicks(){
  const at = [], text = [];
  for(let i = 0; i < DAY_ISO.length; i++){
    at.push(hourTime(DAY_LO[i] - 0.5));      /* the edge where the day begins */
    text.push(String(new Date(DAY_ISO[i] + 'T00:00:00Z').getUTCDate()));
  }
  return {at:at, text:text};
}
/* The month names: the first month to the left of the first date, and every month that
   begins later to the right of its "1" - June 2026: "Jun" before the first 1 and "July"
   after the last one. As annotations on the dates' own row. */
function monthMarks(t){
  const out = [];
  DAY_ISO.forEach((iso, i) => {
    const d = new Date(iso + 'T00:00:00Z');
    if(i > 0 && d.getUTCDate() !== 1) return;
    out.push({x:t.at[i], xref:'x', y:0, yref:'paper', yanchor:'top', yshift:-5,
              xanchor:i === 0 ? 'right' : 'left', xshift:i === 0 ? -9 : 9,
              text:TAXIS_MON[d.getUTCMonth()], showarrow:false,
              font:{size:11, color:'#c3cfdc'}});
  });
  return out;
}

function drawTimeAxis(){
  const el = document.getElementById('timeaxis');
  if(!el || typeof Plotly === 'undefined') return;
  const t = dayTicks();
  Plotly.react('timeaxis', [{
    type:'scatter', mode:'none', hoverinfo:'skip', showlegend:false,
    x:[D.ts[0], D.ts[NT - 1]], y:[0, 0]
  }], {
    height:TAXIS_H, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    margin:{l:1, r:16, t:1, b:20},
    font:{color:'#a6b4c4', family:'-apple-system,Segoe UI,Roboto,sans-serif', size:11},
    /* no axis title: the dates say what this is */
    xaxis:{type:'date', range:xWindow(), tickmode:'array', tickvals:t.at, ticktext:t.text,
           gridcolor:'rgba(0,0,0,0)', linecolor:'#2a3a4d', tickfont:{size:11, color:'#c3cfdc'},
           ticks:'outside', tickcolor:'#2a3a4d', ticklen:4, fixedrange:true, zeroline:false},
    yaxis:{visible:false, range:[0, 1], fixedrange:true},
    annotations:monthMarks(t)
  }, {responsive:true, displayModeBar:false, staticPlot:true}).then(alignTimeAxis);
}

/* Line the axis up with the heatmap above: its first and last column sit at the same
   place on screen, whatever the label gutter and the scrollbar are doing. The width is
   given every time, not left to Plotly: this chart is a staticPlot, which is never
   resized on its own, so after the page grows a scrollbar it would still be laying
   itself out for the wider box and every date would sit a few pixels out. */
function alignTimeAxis(){
  const gd = document.getElementById('heat'), ad = document.getElementById('timeaxis');
  if(typeof alignHourRow === 'function') alignHourRow();
  if(!gd || !gd._fullLayout || !ad || !ad._fullLayout) return;
  const ax = gd._fullLayout.xaxis, g = gd.getBoundingClientRect(), t = ad.getBoundingClientRect();
  if(!t.width) return;
  const w = Math.round(t.width);
  const l = Math.max(0, Math.round(g.left + ax._offset - t.left));
  const r = Math.max(0, w - Math.round(g.left + ax._offset + ax._length - t.left));
  const f = ad._fullLayout, m = f.margin;
  if(Math.abs(m.l - l) < 1 && Math.abs(m.r - r) < 1 && Math.abs((f.width || 0) - w) < 1) return;
  Plotly.relayout(ad, {width:w, 'margin.l':l, 'margin.r':r});
  if(typeof alignHourRow === 'function') alignHourRow();   /* the hour slider runs on the same hours */
}

function initTimeAxis(){
  drawTimeAxis();
  window.addEventListener('resize', () => setTimeout(alignTimeAxis, 120));
  /* Plotly re-lays both charts out on its own when the window changes - and the page's
     scrollbar appearing is such a change - so watch the heatmap's box and line up again
     whenever it moves or resizes. A timer, not an animation frame: a page that is not
     being painted never runs a frame. */
  const gd = document.getElementById('heat');
  if(gd && window.ResizeObserver){
    let soon = 0;
    new ResizeObserver(() => {
      if(soon) return;
      soon = setTimeout(() => { soon = 0; alignTimeAxis(); }, 30);
    }).observe(gd);
  }
}
