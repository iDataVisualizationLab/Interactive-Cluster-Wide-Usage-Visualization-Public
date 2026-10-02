/* Summarization, the first tab of the chart box, in three zones:
     Stats            (top left)   the month in numbers
     Rankings         (top right)  a ranking with four mini tabs - CPU device Usage Ranking
                                   (every CPU device by hours in use), GPU device Usage
                                   Ranking (every GPU device by hours in use), Users Ranking
                                   (every person by machine-hours) and Busy Days Ranking
                                   (every day by machine-hours) - that scrolls to show all
     Hours used per day (bottom)   the strip (strip.js), on the same hours as the dates at
                                   the foot of the window
   Only the mini tabs can be clicked; hovering a bar shows its figures, and nothing here
   changes the heatmap.
   Needs: D, NT, DAY_ISO, DAY_LO, RAINBOW, T, TMAX (config.js), HOURS, DAYS, drawStrip,
   alignStrip (strip.js), USERCOL (selection.js). */

const SUM_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const RANK_ROW = 22;                     /* the height of one entry in a ranking, px */
let SUM = null;                          /* the numbers, worked out once */
let RANK = 'cpu';                        /* the ranking on show */

function summaryNumbers(){
  if(SUM) return SUM;
  const cpu = D.rows.filter(r => r.m !== 'gpu');   /* a GPU row repeats its node's CPU row */
  const zen = new Set(), h100 = new Set();
  const perUser = new Map();
  D.rows.forEach((r, k) => {
    if(r.m === 'gpu') return;
    (r.c === 'h100' ? h100 : zen).add(r.n);
    perUser.set(r.u, (perUser.get(r.u) || 0) + r.h);
  });
  /* who was on the cluster, hour by hour and day by day */
  const hourUsers = [], dayUsers = DAY_ISO.map(() => new Set());
  for(let h = 0; h < NT; h++) hourUsers.push(new Set());
  const dayOf = new Array(NT);
  for(let d = 0; d < DAY_ISO.length; d++)
    for(let h = DAY_LO[d]; h < (d + 1 < DAY_ISO.length ? DAY_LO[d + 1] : NT); h++) dayOf[h] = d;
  for(const r of cpu) for(const h of r.i.concat(r.g || [])){
    hourUsers[h].add(r.u); dayUsers[dayOf[h]].add(r.u);
  }
  /* every device: the hours it was held by anyone, and its usage while held - counted as
     the strip counts them (a held hour with no reading as 0%). A CPU device is a Zen4 node
     or the CPU side of an H100 node (its CPU rows, with CPU readings); a GPU device is the
     GPU side of an H100 node (its GPU rows, with GPU readings). The two sides of an H100
     node are held for the same hours, but they are busy very differently. */
  const devices = rows => {
    const per = new Map();                          /* node -> Map(hour -> reading) */
    for(const r of rows){
      if(!per.has(r.n)) per.set(r.n, new Map());
      const m = per.get(r.n);
      for(let j = 0; j < r.i.length; j++) m.set(r.i[j], r.a[j]);
      for(const h of (r.g || [])) if(!m.has(h)) m.set(h, 0);
    }
    return [...per].map(([n, m]) => {
      let s = 0; m.forEach(v => { s += v; });
      return {name:n, hrs:m.size, mean:m.size ? s / m.size : 0};
    }).sort((a, b) => (b.hrs - a.hrs) || a.name.localeCompare(b.name, undefined, {numeric:true}));
  };
  const cpuDevices = devices(cpu), gpuDevices = devices(D.rows.filter(r => r.m === 'gpu'));
  let held = 0;
  for(const x of HOURS) held += x.cells;
  let peakU = 0, peakUh = 0, peakM = 0, peakMh = 0;
  for(let h = 0; h < NT; h++){
    if(hourUsers[h].size > peakU){ peakU = hourUsers[h].size; peakUh = h; }
    if(HOURS[h].cells > peakM){ peakM = HOURS[h].cells; peakMh = h; }
  }
  const users = [...perUser].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  const days = DAYS.map((d, i) => ({day:d.day, cells:d.cells, mean:d.mean, users:dayUsers[i].size}))
                   .sort((a, b) => (b.cells - a.cells) || a.day.localeCompare(b.day));
  SUM = {users:D.users.length, zen:zen.size, h100:h100.size, held:held,
         peakU:peakU, peakUh:peakUh, peakM:peakM,
         peakMh:peakMh, rankUsers:users, rankCPU:cpuDevices, rankGPU:gpuDevices, rankDays:days};
  return SUM;
}

const sumFmt = n => Math.round(n).toLocaleString('en-US');
function sumDay(iso){                    /* 2026-06-04 -> 4 Jun */
  const d = new Date(iso + 'T00:00:00Z');
  return d.getUTCDate() + ' ' + SUM_MON[d.getUTCMonth()];
}
function sumHour(h){                     /* 2026-06-04T13:00 -> 4 Jun 13:00 UTC */
  const t = D.ts[h];
  return sumDay(t.slice(0, 10)) + ' ' + t.slice(11, 16) + ' UTC';
}

/* Stats: a vertical list of rectangles, each a name and its value, written once - they do
   not change with anything on the page */
function paintSummaryStats(){
  const box = document.getElementById('sumstats');
  if(!box) return;
  const S = summaryNumbers();
  const tile = (label, value) =>
    '<div class="sumtile"><div class="st-l">' + label + '</div><div class="st-v">' + value + '</div></div>';
  box.innerHTML =
    tile('Number of users', S.users) +
    tile('Number of machines', S.zen + S.h100) +
    tile('Total machine-hours', sumFmt(S.held)) +
    tile('Hours covered', sumFmt(NT)) +
    tile('Most users at one hour', S.peakU) +
    tile('Most machines at one hour', S.peakM);
}

/* Rankings: every entry of the chosen list as one horizontal bar, the biggest at the top,
   in a box that scrolls. Hovering a bar shows its value and nothing else. Devices are
   coloured by their average usage (CPU devices by CPU usage, GPU devices by GPU usage) and
   days by theirs, on the heatmap's colour scale; people by their own colour. */
const RANKS = {
  cpu:     {xt:'Hours in use', yt:'CPU device',
            rows:S => S.rankCPU.map(m => ({x:m.name, y:m.hrs, mean:m.mean})),
            hover:'%{x:,}<extra></extra>'},
  gpu:     {xt:'Hours in use', yt:'GPU device',
            rows:S => S.rankGPU.map(m => ({x:m.name, y:m.hrs, mean:m.mean})),
            hover:'%{x:,}<extra></extra>'},
  users:   {xt:'Machine-hours', yt:'User',
            rows:S => S.rankUsers.map(([u, h]) => ({x:u, y:h, col:USERCOL.get(u) || '#8fa6c0'})),
            hover:'%{x:,}<extra></extra>'},
  days:    {xt:'Machine-hours', yt:'Day',
            rows:S => S.rankDays.map(d => ({x:sumDay(d.day), y:d.cells, mean:d.mean})),
            hover:'%{x:,}<extra></extra>'}
};
function drawRanking(){
  const box = document.getElementById('rankchart'), el = document.getElementById('rankplot');
  /* its tab is not up, or the zone has not been laid out yet: nothing to measure */
  if(!box || !el || typeof Plotly === 'undefined' || !box.clientWidth || box.clientHeight < 60) return;
  const S = summaryNumbers(), R = RANKS[RANK], rows = R.rows(S);
  const ylab = document.getElementById('rankYLab');
  if(ylab) ylab.textContent = R.yt;
  const byUsage = rows.length && rows[0].col === undefined;
  /* as wide as the box inside its scroll bar, as tall as all the entries need */
  /* every entry the same height, whatever the list: a short list (8 GPU devices) leaves room
     below it rather than stretching its bars */
  const w = box.clientWidth, h = 32 + RANK_ROW * rows.length;
  const was = RANK_DRAWN.split(' ')[1];
  RANK_DRAWN = w + 'x' + box.clientHeight + ' ' + RANK;
  Plotly.react(el, [{
    type:'bar', orientation:'h', y:rows.map(r => r.x), x:rows.map(r => r.y),
    marker:byUsage ? {color:rows.map(r => T(r.mean)), colorscale:RAINBOW, cmin:0, cmax:TMAX, line:{width:0}}
                   : {color:rows.map(r => r.col), line:{width:0}},
    hovertemplate:R.hover                       /* the bar's value, nothing else */
  }], {
    width:w, height:h, autosize:false,
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    font:{color:'#a6b4c4', size:10.5}, margin:{l:104, r:16, t:48, b:6}, bargap:0.3,
    dragmode:false, hovermode:'closest',
    hoverlabel:{bgcolor:'#0d1520', bordercolor:'#35485f', font:{color:'#e7edf4', size:11.5}},
    /* #1 at the top */
    /* what is measured is named along the top; what is listed is named on the left, turned
       on its side, by the page (#rankYLab) - a Plotly title there would sit halfway down the
       whole list, far below the part in view */
    yaxis:{type:'category', autorange:'reversed', tickfont:{size:10.5, family:'SFMono-Regular,Consolas,monospace'},
           linecolor:'#2a3a4d', ticks:'', fixedrange:true, automargin:false},
    /* the scale along the top, where the list starts */
    xaxis:{title:{text:R.xt, font:{size:11, color:'#cfe0f5'}, standoff:8},
           side:'top', gridcolor:'#22303f', zerolinecolor:'#2a3a4d', tickfont:{size:10},
           rangemode:'tozero', fixedrange:true, separatethousands:true}
  }, {displayModeBar:false, responsive:false, scrollZoom:false, doubleClick:false});
  if(was !== RANK) box.scrollTop = 0;            /* a new list starts at its top */
  for(const b of document.querySelectorAll('#rankTabs .netstep')){
    const on = b.getAttribute('data-rank') === RANK;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

/* the tab has come up: the strip and the ranking are drawn again, now that they have a
   width to measure */
function drawSummary(){
  drawStrip();
  alignStrip();
  drawRanking();
}

/* The chart is drawn to the exact size of its box, so it is drawn again whenever that box
   changes: a window resize, and (in a browser that paints) an observer on the box itself.
   The box's size never depends on the chart inside it (flex-basis 0, its scroll bar always
   there), so drawing again cannot make it grow or change width. */
let RANK_DRAWN = '';
function rankCheck(){
  const box = document.getElementById('rankchart');
  if(box && box.clientWidth && (box.clientWidth + 'x' + box.clientHeight + ' ' + RANK) !== RANK_DRAWN) drawRanking();
}
function initSummary(){
  paintSummaryStats();
  for(const b of document.querySelectorAll('#rankTabs .netstep'))
    b.addEventListener('click', () => { RANK = b.getAttribute('data-rank'); drawRanking(); });
  drawRanking();
  window.addEventListener('resize', () => setTimeout(rankCheck, 120));
  const el = document.getElementById('rankchart');
  if(el && window.ResizeObserver){
    let soon = 0;
    new ResizeObserver(() => { clearTimeout(soon); soon = setTimeout(rankCheck, 40); }).observe(el);
  }
}
