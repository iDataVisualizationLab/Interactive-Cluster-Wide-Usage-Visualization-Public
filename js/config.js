/* Settings and view state that the other files share: the colour scale, row
   sizes, and which groups are open or folded.
   Needs: D (js/data.js). */

let NT = 0;                              /* hours in the month, once the data is in */

/* 0% is a bright violet so an allocated-but-idle hour is clearly visible
   against the dark background, which means "not allocated at all". */
const RAINBOW = [
  [0.000,'#3b6fe0'], [0.111,'#2f9fe0'], [0.222,'#1fc0c4'], [0.333,'#2ecf80'],
  [0.444,'#8ade38'], [0.556,'#f0d63e'], [0.667,'#fba832'], [0.778,'#f4712a'],
  [0.889,'#e8442a'], [1.000,'#c81f2a']
];
const C_OUT = '#0f1822';                 /* filtered out: darker than anything on the scale */
/* No zooming on the heatmap: dragging a box, double clicking and the wheel left
   the chart and the day strip on different time ranges, with no way back short
   of reloading. A day is chosen by clicking its bar on the strip instead. */
const CFG = {responsive:true, displayModeBar:false, scrollZoom:false, doubleClick:false};
const ROWH = 15, TOP = 10, BOT = 8;   /* the dates sit outside the chart now (timeaxis.js) */
/* linear: equal distance for equal percentage, so 0-50 spans as much as 50-100 */
const T = v => v;
const TMAX = 100;
const open = new Set();
const shut = new Set();                  /* partition sections folded away */

/* The days of the month: where each one starts, and where its middle is. Everything that
   speaks of a day uses these, so the two charts mark days in the same places.
     DAY_LO   the day's first hour - where a date is written under the heatmap, and where
              the Time arcs draw that day's line. A date therefore stands at the start of
              its day, with all of that day's columns to the right of it.
     DAY_MID  halfway through the day, where the Time arcs hang that day's arcs, so they
              sit in the middle of the block their date opens.
   The two end days are part days - the month runs 05:00 on the 1st to 04:00 on the 1st of
   next month - so the 1st starts at 05:00 and its middle is not midday. */
let DAY_ISO = [];                        /* '2026-06-07', one per day in the data */
let DAY_LO = [];                         /* the hour index that day starts at */
let DAY_MID = [];                        /* the hour index halfway through that day */

function prepareDays(){
  DAY_ISO = []; DAY_LO = []; DAY_MID = [];
  const hi = [], at = new Map();
  for(let h = 0; h < NT; h++){
    const d = D.ts[h].slice(0, 10);
    if(!at.has(d)){ at.set(d, DAY_ISO.length); DAY_ISO.push(d); DAY_LO.push(h); }
    hi[at.get(d)] = h;
  }
  DAY_MID = DAY_ISO.map((_, i) => (DAY_LO[i] + hi[i]) / 2);
}
/* The time at an hour index, and between hours too: -0.5 is the left edge of the first
   column, 3.5 the edge between the fourth and fifth. */
function hourTime(m){
  const a = Math.max(0, Math.min(NT - 1, Math.floor(m)));
  return new Date(Date.parse(D.ts[a]) + (m - a) * 3600000).toISOString();
}

/* what these settings take from the data, worked out once it has been read */
function prepareConfig(){
  NT = D.ts.length;
  prepareDays();
}
