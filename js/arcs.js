/* Time arcs: the band above the heatmap.

   Every machine and every person has a line on the vertical axis, and the month
   runs left to right. Wherever a person held a machine on a day, an arc runs from
   that person's line to that machine's line above that day, with an arrowhead
   landing on the machine. Each arc carries its person's colour; while someone is
   picked, their arcs stay solid and the rest fade back.

   It shares the heatmap's hours. The left and right margins are taken from the
   heatmap's rendered x axis on every draw, so a day here stands exactly above the
   same day's columns below, and the dates under the heatmap (js/timeaxis.js) are
   the dates for both charts. That is also why zooming only works up and down: the
   time axis belongs to the page now, not to this drawing.

   A name is written just before that machine's or person's first arc, not in a column
   down the side, and its line runs from there to its last arc - so the name says when
   they first appear as well as who they are. Each name carries the shape the panel uses:
   a circle for a person, a square for a CPU machine, a triangle for a GPU machine.

   The lines are ordered by how many arcs they have, whatever their kind: the
   busiest line sits in the middle, the next just above it, the next just below,
   and so on outwards, so the quiet lines end up at the top and bottom edges.

   The band is drawn at its own height - every line gets its own room - and the window's
   scrollbar moves the page past it, as it does past the heatmap. + and - stretch the
   lines (so does Ctrl and the wheel) and Fit brings them back. Clicking a person's name, their shape or one of their arcs picks
   them, just as clicking their circle in the network chart does.

   Needs: D, NT (config.js), SEL, USERCOL (selection.js), NETPANEL (network-panel.js),
   the heatmap's x axis (heatmap.js). */

const ARC_NS = 'http://www.w3.org/2000/svg';
const ARC_L = 76;        /* the names' column, when the heatmap cannot be measured */
const ARC_PAD = 6;       /* from the left edge of the band to the first name */
const ARC_NAMEW = 96;    /* how much room the names get before their leader line */
const ARC_R = 16;
const ARC_TOP = 10;
const ARC_BOT = 12;
const ARC_PITCH = 13;    /* room per line before zooming: enough for every name */
const ARC_MAXZOOM = 8;
const ARC_ARROW = 7;     /* the arrowhead, in pixels on screen whatever the zoom */
const ARC_COLOUR = '#7ea3cc';        /* an arc whose person has no colour of their own */
const ARC_MACHINE = '#93a7bc';       /* one machine's name, inside an opened group */
const ARC_GROUP = '#c6d4e4';         /* a group's name: GPU, rpc-91 ... rpc-97 */

let ARCS = null;              /* everything there is, worked out on first use */
let ARC_OPEN = new Set();     /* the groups opened out into their own machines */
let ARC_VIEW = null;          /* what is on screen now: geometry, zoom helpers, hover box */
let ARC_Z = {k:1, tx:0};      /* how far in the drawing is zoomed, up and down only */
let ARC_FIX = 0;              /* how many times in a row the margins have been corrected */

/* One pass over the rows, gathered per day.

   An H100 node is measured twice - once for its cards and once for its cores - and the
   heatmap gives each of those a row of its own. The arcs follow it: a machine is keyed the
   way the heatmap keys it, with groupKey() from rows.js, so rpg-93-1 held as a GPU and the
   same node held as a CPU are two lines with their own arcs, one under H100 GPU and one
   under H100 CPU. Everything else has one row and one line as before. Taking the key from
   the heatmap's own function, rather than writing the rule out again here, is what keeps
   the two from drifting apart.

   Machines belong to groups - H100 GPU, H100 CPU, and rpc-91 to rpc-97 for the rest - and
   a folded group stands in for its machines: every arc to one of them lands on the group's
   line instead, and arcs from one person to several machines of that group on the same day
   become a single arc. Opening a group puts its machines on lines of their own, with their
   own arcs. */
function arcGroupOf(name, gpu){
  if(name.indexOf('rpg-') === 0) return gpu ? 'H100 GPU' : 'H100 CPU';
  return gpu ? 'H100 GPU' : name.replace(/-[0-9]+$/, '');
}
/* rpg-93-1#gpu -> 'rpg-93-1 GPU', its twin -> 'rpg-93-1 CPU', everything else its own name */
function arcLabelOf(id, gpu){
  const plain = plainName(id);
  return plain.indexOf('rpg-') === 0 ? plain + (gpu ? ' GPU' : ' CPU') : plain;
}

function buildArcs(){
  const people = new Set(), machines = new Map();
  D.rows.forEach((r, k) => {
    people.add(r.u);
    const id = groupKey(k, 'node');          /* rpg-93-1#gpu for a GPU row, else the name */
    if(!machines.has(id)){
      const gpu = r.m === 'gpu';
      machines.set(id, {gpu:gpu, group:arcGroupOf(r.n, gpu), label:arcLabelOf(id, gpu)});
    }
  });
  const inGroup = new Map();
  for(const [n, m] of machines){
    if(!inGroup.has(m.group)) inGroup.set(m.group, []);
    inGroup.get(m.group).push(n);
  }
  for(const list of inGroup.values()) list.sort(arcByName);
  /* the two H100 groups first, the rpc ones after them by name */
  const rank = g => g === 'H100 GPU' ? 0 : g === 'H100 CPU' ? 1 : 2;
  const groups = [...inGroup.keys()].sort((x, y) => (rank(x) - rank(y)) || arcByName(x, y));

  /* the days come from config.js: a day's line is drawn where the day starts, the same
     place its date is written under the heatmap */
  const dayAt = new Map(DAY_ISO.map((d, i) => [d, i]));
  const held = new Map();                  /* 'user|machine' -> the hours they held it */
  D.rows.forEach((r, k) => {
    const key = r.u + '|' + groupKey(k, 'node');
    let hs = held.get(key);
    if(!hs){ hs = new Set(); held.set(key, hs); }
    for(const h of r.i) hs.add(h);
    for(const h of (r.g || [])) hs.add(h);
  });
  const pairs = [];                        /* one per person, machine and day */
  for(const [k, hs] of held){
    const cut = k.indexOf('|'), u = k.slice(0, cut), n = k.slice(cut + 1);
    const perDay = new Map();
    for(const h of hs){
      const d = dayAt.get(D.ts[h].slice(0, 10));
      perDay.set(d, (perDay.get(d) || 0) + 1);
    }
    for(const [d, hrs] of perDay) pairs.push({u:u, n:n, d:d, hrs:hrs});
  }
  pairs.sort((p, q) => p.d - q.d || p.u.localeCompare(q.u));
  return {pairs:pairs, machines:machines, groups:groups, inGroup:inGroup,
          people:[...people].sort(arcByName), days:DAY_ISO, dayMid:DAY_MID, dayLo:DAY_LO};
}

const arcByName = (a, b) => String(a).localeCompare(String(b), undefined, {numeric:true});

/* The order of the lines, and the one thing it has to get right: a name is written just
   before that line's first arc, so a name can only be run over by an arc whose day is
   earlier than the name's own first day. Ordering every line by the day it first appears
   rules that out - between the two ends of an arc drawn on day d there is then nothing
   whose first day is later than d, so every name in between is already to the left of it.
   Ties go to people first, then by name. */
function arcLines(ents){
  const lines = ents.slice().sort((p, q) =>
    p.from - q.from || (p.kind === q.kind ? 0 : p.kind === 'u' ? -1 : 1) || arcByName(p.name, q.name));
  lines.forEach((l, i) => { l.i = i; });
  return lines;
}

/* What to draw right now: the people, the groups, the machines of any group that has been
   opened, and the arcs between them - narrowed to the Filter menu when it is set. */
function arcView(){
  if(!ARCS) ARCS = buildArcs();
  const A = ARCS;
  const open = new Set(ARC_OPEN);
  const merged = new Map();
  for(const p of A.pairs){
    const g = A.machines.get(p.n).group;
    const key = open.has(g) ? 'm ' + p.n : 'g ' + g;
    const id = p.u + '\u0000' + key + '\u0000' + p.d;
    let a = merged.get(id);
    if(!a){
      const show = open.has(g) ? A.machines.get(p.n).label : g;
      a = {u:p.u, key:key, n:show, d:p.d, hrs:0, held:new Set()};
      merged.set(id, a);
    }
    a.hrs += p.hrs;
    a.held.add(p.n);
  }
  const arcs = [...merged.values()].sort((x, y) => x.d - y.d || arcByName(x.u, y.u));

  /* how much each line carries, and the first and last day it takes part in */
  const seen = new Map();
  const note = (key, d) => {
    let e = seen.get(key);
    if(!e){ e = {count:0, from:Infinity, to:-Infinity}; seen.set(key, e); }
    e.count++;
    if(d < e.from) e.from = d;
    if(d > e.to) e.to = d;
  };
  for(const a of arcs){ note('u ' + a.u, a.d); note(a.key, a.d); }

  const ents = [];
  const add = (kind, name, key, extra) => {
    const e = seen.get(key) || {count:0, from:Infinity, to:-Infinity};
    if(!(e.from <= e.to)) return;           /* nothing to draw for this one */
    ents.push(Object.assign({kind:kind, name:name, key:key, count:e.count,
                             from:e.from, to:e.to}, extra || {}));
  };
  for(const u of A.people) add('u', u, 'u ' + u);
  for(const g of A.groups){
    const members = A.inGroup.get(g);
    if(open.has(g)){
      /* the group keeps its line, opened out, spanning whatever its machines take part in */
      let from = Infinity, to = -Infinity, count = 0;
      for(const n of members){
        const e = seen.get('m ' + n);
        if(!e) continue;
        count += e.count;
        if(e.from < from) from = e.from;
        if(e.to > to) to = e.to;
      }
      if(from <= to) ents.push({kind:'g', name:g, key:'g ' + g, count:count, from:from, to:to,
                                open:true, size:members.length});
      for(const n of members) add('m', A.machines.get(n).label, 'm ' + n, {group:g});
    } else add('g', g, 'g ' + g, {open:false, size:members.length});
  }

  const lines = arcLines(ents);
  const at = new Map();
  lines.forEach((l, i) => at.set(l.key, i));
  for(const a of arcs){ a.a = at.get(a.key); a.b = at.get('u ' + a.u); }
  return {lines:lines, arcs:arcs, days:A.days, dayMid:A.dayMid, dayLo:A.dayLo, filtered:false,
          filteredOut:false,
          people:lines.filter(l => l.kind === 'u').length,
          groups:lines.filter(l => l.kind === 'g').length,
          machines:lines.filter(l => l.kind === 'm').length,
          opened:[...open]};
}

function arcsSummary(){
  const V = arcView();
  return {people:V.people, groups:V.groups, machines:V.machines, arcs:V.arcs.length,
          days:V.days.length, filtered:V.filtered, opened:V.opened.length};
}

/* The band and the heatmap share one set of hours: the left and right margins here
   are read off the heatmap's rendered x axis, so the middle of a day sits exactly
   above that day's columns. Before the heatmap has drawn once - or if it is not on
   the page at all - the names get a plain 76 pixels. */
function arcMargins(svg, W){
  const gd = document.getElementById('heat');
  const r = svg.getBoundingClientRect();
  if(gd && gd._fullLayout && gd._fullLayout.xaxis && r.width > 0){
    const ax = gd._fullLayout.xaxis, g = gd.getBoundingClientRect();
    const L = Math.round(g.left + ax._offset - r.left);
    const R = Math.round(r.right - (g.left + ax._offset + ax._length));
    if(L > 24 && R >= 0 && W - L - R > 40) return {L:L, R:R};
  }
  return {L:ARC_L, R:ARC_R};
}

const ARC_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function arcDay(iso){                      /* 2026-06-04 -> 4 Jun */
  const d = new Date(iso + 'T00:00:00Z');
  return d.getUTCDate() + ' ' + ARC_MON[d.getUTCMonth()];
}

/* Draw the tab into the panel's svg. opt.tip is the hover box and opt.place puts
   it on screen inside the panel; opt.toggle picks a person the same way clicking
   their circle does on the other tabs; opt.tally refreshes the line underneath. */
function drawArcs(svg, opt){
  const V = arcView();
  while(svg.firstChild) svg.removeChild(svg.firstChild);

  const wrap = svg.parentNode, scroller = wrap && wrap.parentNode;
  const W = svg.clientWidth || 336;
  const M = arcMargins(svg, W);            /* the same hours as the heatmap below */
  const L = M.L, R = M.R;
  ARC_Z.k = Math.max(1, Math.min(ARC_MAXZOOM, ARC_Z.k));
  /* Every line gets at least ARC_PITCH, and the band is as tall as that comes to, inside
     a box as tall as the other tabs. + and - stretch it further, Fit brings it back. */
  const nLines = Math.max(1, V.lines.length);
  /* the band's box is as tall as the other tabs: with few lines they are spread to fill
     it, with many they keep ARC_PITCH and the box scrolls */
  const fill = scroller && scroller.clientHeight ? (scroller.clientHeight - 8 - ARC_TOP - ARC_BOT) / nLines : 0;
  const pitch = Math.max(ARC_PITCH, fill);
  const H0 = ARC_TOP + nLines * pitch + ARC_BOT;
  if(wrap) wrap.style.height = (H0 * ARC_Z.k) + 'px';
  /* one hour of the heatmap, in pixels: the axis below spans NT hours, hour h sitting
     at (h + 0.5) / NT of the way across */
  const hourW = (W - L - R) / NT;
  const colW = 24 * hourW;                           /* a whole day, for the arcs' bulge */
  /* Where a day starts. Its line, its arcs and its date under the heatmap all sit here,
     so a day is one place on the page, not three. The arcs used to hang halfway through
     the day, which stood them half a day - about 20 pixels - right of their own date. */
  const bx = d => L + (V.dayLo[d] - 0.5) * hourW;
  const dx = bx;
  const by = i => ARC_TOP + (i + 0.5) * pitch;
  const sx = v => v;                                 /* the days never move: see the header */
  const sy = v => ARC_Z.k * v;

  /* ---- what the drawing is made of ---- */
  const defs = document.createElementNS(ARC_NS, 'defs');
  const clip = document.createElementNS(ARC_NS, 'clipPath');
  clip.setAttribute('id', 'arcclip');
  const box = document.createElementNS(ARC_NS, 'rect');
  box.setAttribute('x', L); box.setAttribute('y', 0);
  box.setAttribute('width', Math.max(10, W - L - R));
  box.setAttribute('height', H0 * ARC_Z.k);
  clip.append(box);
  /* the arrowhead sits at the far end of the arc, on the machine's line */
  const marker = document.createElementNS(ARC_NS, 'marker');
  marker.setAttribute('id', 'arcarrow');
  marker.setAttribute('viewBox', '0 0 6 6');
  marker.setAttribute('refX', '5.5'); marker.setAttribute('refY', '3');   /* tip on the line */
  marker.setAttribute('orient', 'auto'); marker.setAttribute('markerUnits', 'userSpaceOnUse');
  const head = document.createElementNS(ARC_NS, 'path');
  head.setAttribute('d', 'M0.5,0.8 L5.5,3 L0.5,5.2 Z');
  head.setAttribute('fill', 'context-stroke');      /* the colour of the arc it sits on */
  marker.append(head);
  defs.append(clip, marker);
  const gClip = document.createElementNS(ARC_NS, 'g');
  gClip.setAttribute('clip-path', 'url(#arcclip)');
  const plot = document.createElementNS(ARC_NS, 'g');     /* stretched as one piece */
  plot.setAttribute('transform', 'scale(1,' + ARC_Z.k + ')');
  gClip.append(plot);
  const gNames = document.createElementNS(ARC_NS, 'g');
  svg.append(defs, gClip, gNames);

  /* ---- a faint line along each machine and person, from its first day to its last ---- */
  V.lines.forEach((l, i) => {
    if(!(l.from <= l.to)) return;          /* nothing to join up */
    const g = document.createElementNS(ARC_NS, 'line');
    g.setAttribute('x1', bx(l.from)); g.setAttribute('x2', bx(l.to));
    g.setAttribute('y1', by(i)); g.setAttribute('y2', by(i));
    g.setAttribute('stroke', 'rgba(255,255,255,.07)');
    g.setAttribute('vector-effect', 'non-scaling-stroke');
    plot.append(g);
  });
  V.days.forEach((d, i) => {
    const g = document.createElementNS(ARC_NS, 'line');
    g.setAttribute('class', 'dayline');    /* the one line per day, where that day begins */
    g.setAttribute('x1', dx(i)); g.setAttribute('x2', dx(i));
    g.setAttribute('y1', ARC_TOP - 4); g.setAttribute('y2', H0 - ARC_BOT);
    g.setAttribute('stroke', 'rgba(255,255,255,.05)');
    g.setAttribute('vector-effect', 'non-scaling-stroke');
    plot.append(g);
  });

  /* ---- an arc per person, machine and day, running person -> machine ---- */
  const picked = SEL.size > 0, arcPaths = [];
  for(const a of V.arcs){
    if(a.a === undefined || a.b === undefined) continue;
    const yU = by(a.b), yM = by(a.a), x = bx(a.d);        /* from the person to the machine */
    /* how far the curve swings out to the right of its day. The wider the gap it has to
       cross the rounder it goes, up to a stop, so a long arc reads as one sweep rather
       than a straight line and short ones still show their bow. */
    const bulge = Math.min(2.2 * colW, 0.42 * Math.abs(yM - yU) + 7, 150);
    /* one curve from the person to the machine; the arrowhead is at the far end,
       its tip on the machine's line */
    const p = document.createElementNS(ARC_NS, 'path');
    p.setAttribute('d', 'M' + x + ',' + yU + ' Q' + (x + bulge) + ',' + ((yU + yM) / 2) +
                        ' ' + x + ',' + yM);
    p.setAttribute('fill', 'none');
    /* the person's own colour, the same one their rows and polygons carry */
    p.setAttribute('stroke', USERCOL.get(a.u) || ARC_COLOUR);
    p.setAttribute('stroke-width', (0.6 + 1.1 * Math.sqrt(a.hrs / 24)).toFixed(2));
    p.setAttribute('stroke-opacity', picked ? (SEL.has(a.u) ? 0.95 : 0.05) : 0.4);
    p.setAttribute('vector-effect', 'non-scaling-stroke');     /* lines stay thin when zoomed */
    p.setAttribute('class', 'arc');
    p.__a = a;
    arcPaths.push(p);
    plot.append(p);
  }
  /* The arrowheads would be a thicket at the whole-month size, so they appear
     once there is room. Their size is divided by the zoom, so they stay the same
     on screen, and while someone is picked only their arcs carry them - a faded
     arc with a solid head would shout louder than the arc itself. */
  let arrowed = [];
  const applyArrows = () => {
    const z = ARC_Z.k, on = z >= 1.6;
    marker.setAttribute('markerWidth', (ARC_ARROW / z).toFixed(2));
    marker.setAttribute('markerHeight', (ARC_ARROW / z).toFixed(2));
    plot.removeAttribute('marker-end');
    for(const p of arrowed) p.removeAttribute('marker-end');
    arrowed = [];
    if(!on) return;
    if(!SEL.size){ plot.setAttribute('marker-end', 'url(#arcarrow)'); return; }
    for(const p of arcPaths) if(SEL.has(p.__a.u)){
      p.setAttribute('marker-end', 'url(#arcarrow)');
      arrowed.push(p);
    }
  };

  /* ---- the names: each one just before its line's first connection ----
     No shape beside a name any more: the name itself is the line's label, in that
     person's colour, and a group carries a folding mark instead. */
  const names = [];
  V.lines.forEach(l => {
    if(!(l.from <= l.to)) return;
    const person = l.kind === 'u', group = l.kind === 'g';
    const col = person ? (USERCOL.get(l.name) || '#8fa6c0')
                       : (group ? ARC_GROUP : ARC_MACHINE);
    const g = document.createElementNS(ARC_NS, 'g');
    g.setAttribute('transform', 'translate(0,' + sy(by(l.i)).toFixed(1) + ')');
    const head = bx(l.from);               /* where this one first appears */
    const t = document.createElementNS(ARC_NS, 'text');
    t.textContent = group ? (l.open ? '▾ ' : '▸ ') + l.name + ' (' + l.size + ')' : l.name;
    t.setAttribute('x', head - 7); t.setAttribute('y', 3.3);
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('fill', col);
    if(l.kind === 'm') t.setAttribute('class', 'sm');
    if(group) t.setAttribute('font-weight', '700');
    if(person){
      t.setAttribute('font-weight', SEL.has(l.name) ? '700' : '400');
      t.__u = l.name;
    }
    if(person || group) g.setAttribute('cursor', 'pointer');
    if(group) t.__group = l.name;
    t.__line = l;
    g.append(t);
    g.__line = l;
    gNames.append(g);
    names.push(g);
  });

  applyArrows();

  /* ---- zooming, up and down only ----------------------------------------------
     The dates belong to the page, so the drawing may not slide sideways: zooming
     stretches it vertically, the names follow, and the drawing's height - what the
     scrollbar measures - follows too. Nothing is built again. */
  const applyZoom = () => {
    const z = ARC_Z.k;
    if(wrap) wrap.style.height = (H0 * z) + 'px';
    box.setAttribute('height', H0 * z);
    plot.setAttribute('transform', 'scale(1,' + z + ')');
    for(const g of names) g.setAttribute('transform', 'translate(0,' + sy(by(g.__line.i)).toFixed(1) + ')');
    applyArrows();
    if(ARC_VIEW) ARC_VIEW.H = H0 * z;
  };
  /* Stretching the lines makes the drawing taller, so its box scrolls to keep whatever
     was at that height where it was. py is measured from the top of the drawing. The box
     is as tall as the other tabs (css/network.css) and scrolls on its own. */
  const zoomAt = (px, py, f) => {
    const k0 = ARC_Z.k, k1 = Math.max(1, Math.min(ARC_MAXZOOM, k0 * f));
    if(k1 === k0) return;
    ARC_Z.k = k1;
    applyZoom();
    if(scroller) scroller.scrollTop += py * (k1 / k0 - 1);
  };
  const fit = () => { ARC_Z.k = 1; applyZoom(); };
  /* the middle of whatever part of the band is in its box */
  const middle = () => {
    const r = svg.getBoundingClientRect();
    const mid = scroller ? scroller.scrollTop + scroller.clientHeight / 2
                         : window.innerHeight / 2 - r.top;
    return [(L + W - R) / 2, Math.max(0, Math.min(r.height, mid))];
  };

  /* ---- the zoom buttons, in the band's own bar ---- */
  const bar = document.getElementById('arcTools');
  if(bar && !bar.firstChild){
    const button = (label, title, act) => {
      const b = document.createElement('button');
      b.className = 'netstep'; b.type = 'button'; b.textContent = label; b.title = title;
      b.addEventListener('click', ev => { ev.stopPropagation(); if(ARC_VIEW) ARC_VIEW[act](); });
      bar.append(b);
    };
    button('−', 'Shorter lines', 'zoomOut');
    button('+', 'Taller lines (or use the mouse wheel)', 'zoomIn');
    button('Fit', 'Every line in view again', 'fit');
  }

  ARC_VIEW = {svg:svg, opt:opt, W:W, H:H0 * ARC_Z.k, scroller:scroller, L:L, R:R,
              tip:opt && opt.tip, toggle:opt && opt.toggle, place:opt && opt.place,
              days:V.days, sx:sx, sy:sy, bx:bx, by:by, zoomAt:zoomAt, fit:fit,
              zoomIn:() => { const m = middle(); zoomAt(m[0], m[1], 1.6); },
              zoomOut:() => { const m = middle(); zoomAt(m[0], m[1], 1 / 1.6); },
              dragged:false};

  /* The heatmap may settle into a different place a frame after this drawing was made -
     on a window resize its box is measured before Plotly has laid it out again, and the
     margins taken from it are then out of date by a hundred pixels or more. So look once
     more on the next frame and draw again if they have moved; a handful of corrections in
     a row is enough for any resize, and the count stops it ever running away. */
  setTimeout(() => {                       /* a timer, not a frame: see watchHeatmap */
    if(!ARC_VIEW || ARC_VIEW.svg !== svg) return;
    const M2 = arcMargins(svg, svg.clientWidth || 0);
    if(Math.abs(M2.L - ARC_VIEW.L) < 0.5 && Math.abs(M2.R - ARC_VIEW.R) < 0.5){ ARC_FIX = 0; return; }
    if(ARC_FIX++ > 4) return;
    drawArcs(svg, opt);
  });

  /* ---- hovering, picking, wheel and drag - wired once for the svg ---- */
  if(!svg.__arcwired){
    svg.__arcwired = true;
    /* the panel changed size (its width dragged, the window resized): draw again
       to fit, keeping the zoom */
    if(window.ResizeObserver && scroller){
      let soon = 0, was = [scroller.clientWidth, scroller.clientHeight];
      new ResizeObserver(() => {
        if(!ARC_VIEW || soon) return;
        soon = setTimeout(() => {
          soon = 0;
          const now = [scroller.clientWidth, scroller.clientHeight];
          if(ARC_VIEW && (Math.abs(now[0] - was[0]) > 1 || Math.abs(now[1] - was[1]) > 1)){
            was = now;
            drawArcs(svg, ARC_VIEW.opt);
          }
        });
      }).observe(scroller);
    }
    const tipBox = () => ARC_VIEW && ARC_VIEW.tip;
    const hide = () => { const t = tipBox(); if(t) t.style.display = 'none'; };
    /* the hover box goes by the pointer - the middle of an arc can be far off
       screen when zoomed in - and is kept inside the panel */
    const show = (text, px, py) => {
      const t = tipBox(); if(!t) return;
      t.textContent = text;
      if(ARC_VIEW.place) ARC_VIEW.place(t, px, py);
      else { t.style.left = px + 'px'; t.style.top = py + 'px'; t.style.display = 'block'; }
    };
    const local = ev => { const r = svg.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    let pan = null;

    /* the wheel scrolls the band's box; hold Ctrl to stretch the lines instead, which is
       what the + and - buttons do */
    svg.addEventListener('wheel', ev => {
      if(!ARC_VIEW || !(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      ARC_VIEW.zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0015));
    }, {passive:false});

    /* A press starts a possible drag. The pointer is only captured once it has
       really moved: capturing at once would make the browser treat the click as a
       click on the whole drawing, and the name under it would never be picked. */
    svg.addEventListener('pointerdown', ev => {
      if(!ARC_VIEW || ev.button !== 0) return;
      ARC_VIEW.dragged = false;
      const sc = ARC_VIEW.scroller;
      pan = {x:ev.clientX, y:ev.clientY, id:ev.pointerId, on:ev.target, top:sc ? sc.scrollTop : 0};
    });
    svg.addEventListener('pointermove', ev => {
      if(!ARC_VIEW) return;
      if(pan && ev.buttons === 0) pan = null;          /* released somewhere else */
      if(pan){
        const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
        if(!ARC_VIEW.dragged && Math.abs(dx) + Math.abs(dy) > 4){
          ARC_VIEW.dragged = true;
          try { svg.setPointerCapture(pan.id); } catch(e) {}
          hide();
        }
        if(ARC_VIEW.dragged){                /* dragging scrolls the band up and down */
          if(ARC_VIEW.scroller) ARC_VIEW.scroller.scrollTop = pan.top - dy;
          return;
        }
      }
      const [px, py] = local(ev);
      const a = ev.target && ev.target.__a;
      if(a){
        show(a.u + ' · ' + a.n + (a.held && a.held.size > 1 ? ' (' + a.held.size + ' machines)' : '') +
             ' · ' + a.hrs + (a.hrs === 1 ? ' hour' : ' hours') +
             ' on ' + arcDay(ARC_VIEW.days[a.d]), px, py);
        return;
      }
      const l = ev.target && ev.target.__line;
      if(l){
        const kind = l.kind === 'u' ? 'person'
                   : l.kind === 'g' ? l.size + ' machines'
                   : 'machine';
        show(l.name + ' · ' + kind + ' · ' + l.count + (l.count === 1 ? ' arc' : ' arcs'), px, py);
        return;
      }
      hide();
    });
    /* letting go without having dragged is a click: pick the person under the press */
    svg.addEventListener('pointerup', () => {
      const p = pan;
      pan = null;
      if(!ARC_VIEW) return;
          if(!p || ARC_VIEW.dragged || !ARC_VIEW.toggle) return;
      /* a group's name folds it open or shut; a person's picks them */
      const grp = p.on && p.on.__group;
      if(grp){
        if(ARC_OPEN.has(grp)) ARC_OPEN.delete(grp); else ARC_OPEN.add(grp);
        ARC_Z.k = 1;
        drawTimeArcs();
        return;
      }
      const who = p.on && (p.on.__u || (p.on.__a && p.on.__a.u));
      if(who) ARC_VIEW.toggle(who);
    });
    svg.addEventListener('pointercancel', () => { pan = null; });
    svg.addEventListener('pointerleave', () => { if(!pan) hide(); });
    svg.addEventListener('dblclick', ev => { if(ARC_VIEW){ ev.preventDefault(); ARC_VIEW.fit(); } });
  }
  return V;
}

/* ---- the band on the page ------------------------------------------------------
   drawTimeArcs() is called after every heatmap draw, so the arcs follow the hours,
   the selection and the width of the window without being asked twice. */
function arcTip(){ return document.getElementById('arctip'); }

/* the hover box follows the pointer and is kept inside the band */
function arcPlaceTip(t, px, py){
  const box = document.getElementById('arcscroll');
  t.style.display = 'block';
  if(!box) { t.style.left = px + 'px'; t.style.top = py + 'px'; return; }
  const w = t.offsetWidth || 160, x = Math.max(6, Math.min(box.clientWidth - w - 6, px + 12));
  t.style.left = x + 'px';
  t.style.top = (py - 10) + 'px';
}

/* The band's bar carries its label and the zoom buttons, and nothing else: what it holds
   is in the drawing. Kept as a function because the drawing calls it when it redraws. */
function arcTally(){}

function drawTimeArcs(){
  const svg = document.getElementById('arcsvg');
  if(!svg || typeof D === 'undefined' || !D.rows) return;
  /* its tab is not up: there is nothing to measure against, so leave it until it is */
  if(!svg.clientWidth) return;
  drawArcs(svg, {tip:arcTip(), place:arcPlaceTip, tally:arcTally,
                 toggle:u => { if(typeof NETPANEL !== 'undefined' && NETPANEL) NETPANEL.toggle(u);
                               else { if(SEL.has(u)) SEL.delete(u); else SEL.add(u); draw(); } }});
  arcTally();
  watchHeatmap();
}

/* The band takes its margins from the heatmap's rendered axis, so it has to be drawn
   again whenever that axis moves. The waiting is done with timers rather than animation
   frames: a page that is not being painted - a background tab, or a headless browser
   taking a picture - never runs a frame, and the two charts would stay out of step. On a window resize the band's own box changes size
   first and Plotly lays the heatmap out a moment later, so a band drawn at that point
   holds margins that are already out of date - by 160 pixels and more. Watching the
   heatmap itself, and redrawing when the margins it implies have really changed, is what
   keeps the two charts on the same hours. */
function watchHeatmap(){
  const gd = document.getElementById('heat');
  if(!gd || gd.__arcwatch) return;
  gd.__arcwatch = true;
  /* The window changing size is the usual reason the heatmap moves. Plotly answers the
     same event and lays it out again, so this waits a moment and then draws the band to
     match. It is a plain event, not an observer: observers are delivered while the page
     is being painted, and a page that is not being painted would never hear them. */
  let late = 0;
  window.addEventListener('resize', () => {
    clearTimeout(late);
    late = setTimeout(() => { alignTimeAxis(); drawTimeArcs(); }, 260);
  });
  const check = () => {
    const svg = document.getElementById('arcsvg');
    if(!svg || !ARC_VIEW) return;
    const M = arcMargins(svg, svg.clientWidth || 0);
    if(Math.abs(M.L - ARC_VIEW.L) > 0.5 || Math.abs(M.R - ARC_VIEW.R) > 0.5) drawTimeArcs();
  };
  if(window.ResizeObserver){
    let soon = 0;
    new ResizeObserver(() => {
      if(soon) return;
      soon = setTimeout(() => { soon = 0; check(); }, 30);
    }).observe(gd);
  }
  if(typeof gd.on === 'function') gd.on('plotly_afterplot', check);
}

function initTimeArcs(){
  if(document.getElementById('arcsvg')) drawTimeArcs();
}
