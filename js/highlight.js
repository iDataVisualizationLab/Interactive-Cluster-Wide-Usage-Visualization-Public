/* Highlighting the picked people on the heatmap, and the bar that says who they are.

   There are no outlines any more. The cells that belong to the highlight keep their
   colours and every other cell is drawn in a darkened copy of the same scale, so the
   picked part stands out without anything being laid over it. draw() (heatmap.js) asks
   hlRegion() which cells those are and splits the chart into the two traces.

   With two or more people picked there are three ways to read "their part":
     Union         a cell of any of them
     Intersection  a cell of one of them on a machine that every one of them held in
                   that same hour - the hours they were all on it together
     Exclusive     the union without the intersection (the symmetric difference): the
                   hours one of them was on a machine without all the others
   The same rule holds whichever way the rows are grouped and however many are open,
   because it is decided per machine and hour, not per drawn row. Who is picked, and the
   three modes, are in the bar between the tabs and the heatmap (renderHlMenu).
   Needs: D, NT (config.js), SEL, USERCOL (selection.js), groupKey (rows.js), draw,
   NETPANEL (network-panel.js). */

let HL_MODE = 'union';
const HL_MODES = [
  ['union', 'Union', 'Every hour any of them held a machine'],
  ['inter', 'Intersection', 'Only the hours they all held the same machine together'],
  ['excl', 'Exclusive', 'The union without the intersection (symmetric difference): hours one of them held a machine without all the others']
];
let HL_HRS = null;                       /* row k -> Set of the hours it was held */
let HL_MU = null;                        /* machine key -> Map(user -> [row k]) */
let HL_COUNT = 0;                        /* cells highlighted in the last draw */

function hlPrepare(){
  if(HL_HRS) return;
  HL_HRS = D.rows.map(r => new Set(r.i.concat(r.g || [])));
  HL_MU = new Map();
  D.rows.forEach((r, k) => {
    const mk = groupKey(k, 'node');
    let m = HL_MU.get(mk);
    if(!m){ m = new Map(); HL_MU.set(mk, m); }
    if(!m.has(r.u)) m.set(r.u, []);
    m.get(r.u).push(k);
  });
}
/* did every picked person hold machine mk in hour h? */
function hlAllHold(mk, h){
  const m = HL_MU.get(mk);
  if(!m) return false;
  for(const u of SEL){
    const ks = m.get(u);
    if(!ks || !ks.some(k => HL_HRS[k].has(h))) return false;
  }
  return true;
}
/* the mode in force: the three only mean something with two or more people */
const hlMode = () => SEL.size > 1 ? HL_MODE : 'union';

/* The highlighted cells of the rows as drawn: row index -> Set of hours, or null while
   nobody is picked. */
function hlRegion(meta){
  if(!SEL.size) return null;
  hlPrepare();
  const mode = hlMode(), out = new Map();
  let n = 0;
  for(let i = 0; i < meta.length; i++){
    const ks = meta[i].ks;
    if(!ks) continue;
    const mine = ks.filter(k => SEL.has(D.rows[k].u));   /* the picked people's pairs here */
    if(!mine.length) continue;
    const hrs = new Set();
    for(const k of mine) for(const h of HL_HRS[k]){
      if(hrs.has(h)) continue;
      if(mode === 'union'){ hrs.add(h); continue; }
      const both = mine.some(q => HL_HRS[q].has(h) && hlAllHold(groupKey(q, 'node'), h));
      if((mode === 'inter') === both) hrs.add(h);
    }
    if(hrs.size){ out.set(i, hrs); n += hrs.size; }
  }
  HL_COUNT = n;
  return out;
}

/* the scale for everything outside the highlight: each colour pulled most of the way
   towards the chart's background, so it reads as the same value in the dark */
function hlDarkScale(scale){
  const bg = [16, 26, 38], keep = 0.3;
  const mix = hex => {
    const c = [1, 3, 5].map(j => parseInt(hex.slice(j, j + 2), 16));
    return 'rgb(' + c.map((v, j) => Math.round(bg[j] + (v - bg[j]) * keep)).join(',') + ')';
  };
  return scale.map(([p, c]) => [p, mix(c)]);
}

/* ---- the block between the tabs and the heatmap, flush left with them ----
   The title, Usage Heatmap; under it the three modes, the number of cells highlighted, and
   clear; under them, right above the heatmap, the people picked. The people's line is
   always as tall as all 37 would need at this width, so picking more never pushes the
   heatmap down, and they sit at its foot, against the heatmap; the modes stay locked until
   two or more are picked. */
function hlPick(u){
  if(typeof NETPANEL !== 'undefined' && NETPANEL) NETPANEL.toggle(u);
  else { if(SEL.has(u)) SEL.delete(u); else SEL.add(u); draw(); }
}
function hlChip(u, el){
  const chip = el('span', 'hl-user');
  const sw = el('span', 'sw'); sw.style.background = USERCOL.get(u) || '#8fa6c0';
  const x = el('button', 'hl-x', '\u00d7'); x.type = 'button'; x.title = 'Stop highlighting ' + u;
  x.addEventListener('click', () => hlPick(u));
  chip.append(sw, el('span', 'nm', u), x);
  return chip;
}
/* The people's room: two lines, whoever is picked. Every chip is laid out unseen at the
   line's width, at the largest text size that puts all of them on two lines, and the room
   is made that tall. Only a window too narrow even at the smallest size gets a third line.
   Remembered per width; a resize measures again. */
const HL_SIZES = [10.5, 10, 9.5, 9, 8.5, 8];
let HL_RESERVE = {w:0, h:0, fs:10.5};
function hlReserve(list, el){
  const w = list.clientWidth;
  if(!w) return;
  if(w !== HL_RESERVE.w){
    const probe = el('div', 'hl-list');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:auto;margin:0;width:' + w + 'px';
    for(const u of D.users) probe.append(hlChip(u, el));
    list.parentNode.append(probe);
    let pick = HL_SIZES[HL_SIZES.length - 1];
    for(const fs of HL_SIZES){
      probe.style.setProperty('--hlfs', fs + 'px');
      const lines = new Set([...probe.children].map(c => c.offsetTop)).size;
      if(lines <= 2){ pick = fs; break; }
    }
    probe.style.setProperty('--hlfs', pick + 'px');
    HL_RESERVE = {w:w, h:probe.offsetHeight, fs:pick};
    probe.remove();
  }
  list.style.setProperty('--hlfs', HL_RESERVE.fs + 'px');
  list.style.height = HL_RESERVE.h + 'px';
}
function renderHlMenu(){
  const box = document.getElementById('hlmenu');
  if(!box) return;
  box.innerHTML = '';
  box.style.position = 'relative';
  const el = (tag, cls, txt) => { const e = document.createElement(tag);
    if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; };

  const top = el('div', 'hl-row');
  top.append(el('span', 'hl-title', 'Usage Heatmap'));
  const list = el('div', 'hl-list');
  for(const u of [...SEL].sort()) list.append(hlChip(u, el));

  const low = el('div', 'hl-row');
  const many = SEL.size > 1;
  const seg = el('span', 'hl-modes' + (many ? '' : ' locked'));
  seg.setAttribute('role', 'radiogroup');
  for(const [m, label, title] of HL_MODES){
    const on = hlMode() === m;
    const b = el('button', 'hl-mode' + (on ? ' on' : ''), label);
    b.type = 'button';
    if(many) b.title = title;                 /* what the mode means; no title while locked */
    b.disabled = !many;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.addEventListener('click', () => { if(!many || HL_MODE === m) return; HL_MODE = m; draw(); });
    seg.append(b);
  }
  const n = SEL.size ? HL_COUNT : 0;
  const clr = el('button', 'hl-clear', 'clear');
  clr.type = 'button'; clr.title = 'Highlight nobody'; clr.disabled = !SEL.size;
  clr.addEventListener('click', () => { for(const u of [...SEL]) SEL.delete(u);
    if(typeof NETPANEL !== 'undefined' && NETPANEL && NETPANEL.changed) NETPANEL.changed(); else draw(); });
  low.append(seg, el('span', 'hl-count', n.toLocaleString('en-US') + (n === 1 ? ' cell' : ' cells')), clr);
  box.append(top, low, list);        /* the people last, right above the heatmap */
  hlReserve(list, el);
  if(!box.__resize){
    box.__resize = true;
    window.addEventListener('resize', () => setTimeout(() => {
      const l = box.querySelector('.hl-list'); if(l) hlReserve(l, el); }, 150));
  }
}
