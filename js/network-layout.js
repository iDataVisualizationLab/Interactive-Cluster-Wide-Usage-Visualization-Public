/* Force layout for the network panel. Plain functions with no page access, so
   they can also be run and checked outside the page. */

/* ---- the network panel: where the circles and squares go ---------------
   A small force layout. Links pull their two ends together, every node
   pushes every other away, a weak pull holds the picture to the middle, and
   nothing may leave the box. After each step no two shapes are left on top
   of each other, and user circles are kept a clear distance apart that suits the
   room the panel gives each person. Kept as plain functions so the same code can
   be run outside the page and checked. */
const NET_PAD = 26;
const NET_USER_GAP = 46;   /* least distance between the centres of two user circles */
const NET_NODE_GAP = 12;   /* least distance between the centres of any other two shapes */
const NET_USER_FILL = 0.8;   /* how close to an even spread over the panel the people are kept */
const NET_USER_PUSH = 4;     /* how much harder people push each other than the machines do */
const NET_NODE_FILL = 0.5;   /* the same idea for the machines, so they use the panel too */
/* Machines held by one person only hang off that person on a ring, all at the same
   distance and evenly spread, so each person's own machines read as one sunburst.
   NET_SPOKE is the room one machine takes along the ring; when there are more than a
   ring holds, the next ones go on another ring outside it. */
const NET_SPOKE = 21;        /* room along the ring for one machine */
const NET_RING_MIN = 34;
const NET_PAIR_GAP = 19;     /* room between two machines held by the same two people */
const NET_HUB_GAP = 15;      /* room between machines held by the same three or more */
const NET_TIE = 0.0016;      /* how hard two people who share machines pull together */

/* ---- extra layout rules, from the deleted Test Network Diagram trials (2026-09-27) ----
   No tab passes these any more: every tab passes nothing and runs the plain by-hour rules.
   They are kept only so a trial can be repeated; the rules they switch on:
     main       a machine one person held for at least this share of its hours hangs on
                that person's ring, as if it were theirs; the others keep their lines to it
     weighted   a machine three or more share sits at their middle weighted by the hours
                each held it, so it leans towards whoever used it most
     untangle   groups of such machines are kept apart from each other and from people,
                and no two machines are left on top of each other (netUntangle)
     pairBlock  more machines than this shared by the same two people are packed in a small
                block round the point the same distance from both, not strung along a line */
const NET_MONTH_OPT = {main:0.6, weighted:true, untangle:true, pairBlock:6};
/* the second trial's set: for machines already grouped into badges, only the weighted
   middle and the no-overlap rules */
const NET_GROUP_OPT = {weighted:true, untangle:true};

/* ---- rings: a person and the machines only they hold ---------------------------
   Works out, for the picture as it stands, which machines hang off a single person and
   how far out that person's ring reaches. Called once when the picture is built; the
   steps after that only move things. */
function netRings(nodes, edges, W, H, opt){
  for(const p of nodes){ p.spoke = null; p.spokes = null; p.pair = null; p.hub = null; p.ring = 0; p.main = false; }
  const holders = new Map();               /* machine -> the people holding it */
  const hrsOf = new Map();                 /* machine -> Map(person -> hours held) */
  for(const e of edges){
    let l = holders.get(e.b);
    if(!l){ l = []; holders.set(e.b, l); }
    if(l.indexOf(e.a) < 0) l.push(e.a);
    let h = hrsOf.get(e.b);
    if(!h){ h = new Map(); hrsOf.set(e.b, h); }
    h.set(e.a, (h.get(e.a) || 0) + (e.hrs || 0));
  }
  /* the main user of a machine, when there is one clear enough to count as its owner */
  const mainOf = m => {
    if(!opt || !opt.main) return null;
    const h = hrsOf.get(m);
    let tot = 0, top = null, best = -1;
    for(const [u, v] of h){ tot += v; if(v > best){ best = v; top = u; } }
    return tot > 0 && best / tot >= opt.main ? top : null;
  };
  const pairs = new Map();                 /* the two people -> the machines they share */
  const hubs = new Map();                  /* three or more people -> the machines they share */
  for(const [m, us] of holders){
    const main = us.length > 1 ? mainOf(m) : null;
    if(us.length === 1 || main){
      const o = main || us[0];
      m.spoke = o; m.main = !!main;
      if(!o.spokes) o.spokes = [];
      o.spokes.push(m);
    } else if(us.length === 2){
      /* Held by two people and nobody else. Such a machine goes on the line of the points
         that are the same distance from both of them - the perpendicular bisector - so the
         two lines drawn to it are always the same length. Where several machines are
         shared by the same two people they are spread along that line, half above the
         middle and half below. */
      const a = us[0], b = us[1];
      const key = a.id < b.id ? a.id + '\u0000' + b.id : b.id + '\u0000' + a.id;
      let g = pairs.get(key);
      if(!g){ g = {a:a, b:b, list:[]}; pairs.set(key, g); }
      g.list.push(m);
    } else {
      /* Held by three or more. No one place is the same distance from them all, so it
         goes to the middle of them - the average of where they are. Machines held by the
         very same people share that middle, so they are spread in a small cluster round
         it instead of piling up on one spot. */
      const key = us.map(u => u.id).sort().join('\u0000');
      let g = hubs.get(key);
      if(!g){ g = {us:us.slice(), list:[]}; hubs.set(key, g); }
      g.list.push(m);
    }
  }
  for(const g of hubs.values()){
    g.list.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    /* the weights: the hours each of them held any machine of this group */
    let w = null;
    if(opt && opt.weighted){
      w = g.us.map(u => g.list.reduce((a, m) => a + (hrsOf.get(m).get(u) || 0), 0));
      if(!w.some(v => v > 0)) w = null;
    }
    const grp = {off:{x:0, y:0}, list:g.list};
    g.list.forEach((m, i) => { m.hub = {us:g.us, at:i, of:g.list.length, w:w, g:grp}; });
  }
  /* Who shares machines with whom, and how much: people who share are pulled together, so
     the lines between them stay short instead of reaching across the picture. */
  for(const p of nodes) p.ties = null;
  const ties = new Map();
  for(const [m, us] of holders)
    for(let i = 0; i < us.length; i++)
      for(let j = i + 1; j < us.length; j++){
        const a = us[i], b = us[j];
        const key = a.id < b.id ? a.id + '\u0000' + b.id : b.id + '\u0000' + a.id;
        const t = ties.get(key);
        if(t) t.w++; else ties.set(key, {a:a, b:b, w:1});
      }
  for(const t of ties.values()){
    if(!t.a.ties) t.a.ties = [];
    if(!t.b.ties) t.b.ties = [];
    t.a.ties.push({o:t.b, w:t.w});
    t.b.ties.push({o:t.a, w:t.w});
  }
  for(const g of pairs.values()){
    g.list.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const block = !!(opt && opt.pairBlock && g.list.length > opt.pairBlock);
    g.list.forEach((m, i) => { m.pair = {a:g.a, b:g.b, at:i, of:g.list.length, block:block}; });
  }
  const cap = Math.max(46, Math.min(W, H) / 2 - NET_PAD - 10);
  for(const p of nodes){
    if(!p.spokes || !p.spokes.length) continue;
    p.spokes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    /* the radius that gives every machine its room, but never past what the box allows -
       beyond that they go onto further rings */
    p.ring = Math.max(NET_RING_MIN, Math.min(cap, NET_SPOKE * p.spokes.length / (2 * Math.PI)));
    p.ring = netSpokes(p);                 /* the ring actually used, once they are placed */
  }
}

/* Put one person's own machines around them: evenly round the first ring, then round the
   next one out, and so on. Returns how far the outermost ring reaches. Given the box
   (W, H), a machine whose square would be cut by its edge is moved just inside it - only
   ever a few pixels, for a person the forces have left close to an edge. */
const NET_EDGE = 7;
function netSpokes(u, W, H){
  const list = u.spokes;
  if(!list || !list.length) return 0;
  let r = u.ring || NET_RING_MIN, i = 0, turn = 0, last = r;
  while(i < list.length){
    const room = Math.max(5, Math.floor(2 * Math.PI * r / NET_SPOKE));
    const take = Math.min(room, list.length - i);
    /* every other ring is turned half a step, so the spokes do not line up */
    const off = (turn % 2) * Math.PI / take;
    for(let k = 0; k < take; k++){
      const m = list[i + k], a = off + 2 * Math.PI * k / take;
      m.x = u.x + r * Math.cos(a);
      m.y = u.y + r * Math.sin(a);
      if(W){ m.x = Math.max(NET_EDGE, Math.min(W - NET_EDGE, m.x));
             m.y = Math.max(NET_EDGE, Math.min(H - NET_EDGE, m.y)); }
      m.vx = m.vy = 0;
    }
    last = r;
    i += take; r += NET_SPOKE * 1.05; turn++;
  }
  return last;
}

/* One machine shared by two people: the same distance from each, and clear of whatever
   rings they carry. The machines of one pair sit at 0, +1, -1, +2 ... steps along the
   line between them. */
function netPair(m, W, H){
  const a = m.pair.a, b = m.pair.b, at = m.pair.at, n = m.pair.of;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / L, ny = dx / L;          /* across the line between the two */
  const half = L / 2;
  /* far enough out that neither person's ring of machines is in the way */
  const need = Math.max(a.ring || 0, b.ring || 0) + 16;
  const base = Math.max(NET_PAIR_GAP / 2, Math.sqrt(Math.max(0, need * need - half * half)));
  /* the line is only as long as there is room for: many shared machines pack closer
     together rather than running off the top and the bottom of the box */
  const room = Math.max(60, Math.min(W, H) / 2 - NET_PAD - base);
  let step = Math.max(9, Math.min(NET_PAIR_GAP, room / Math.max(1, Math.ceil(n / 2))));
  /* How far the line can run each way before it leaves the box. A pair near an edge used
     to run its machines straight out of the bottom of the drawing (95 px past it, in the
     busiest hour), so the longer half now goes towards the side with more room, and the
     steps close up until the last machine on its side still fits. */
  const reach = (sx, sy) => {
    let t = Infinity;
    if(sx >  1e-9) t = Math.min(t, (W - NET_PAD - mx) / sx);
    if(sx < -1e-9) t = Math.min(t, (NET_PAD - mx) / sx);
    if(sy >  1e-9) t = Math.min(t, (H - NET_PAD - my) / sy);
    if(sy < -1e-9) t = Math.min(t, (NET_PAD - my) / sy);
    return Math.max(0, t);
  };
  const flip = reach(nx, ny) < reach(-nx, -ny) ? -1 : 1;
  /* Test tab, many machines: a small hex block on the side with more room, its middle on
     the line of equal distance and far enough out that the whole block clears the rings */
  if(m.pair.block){
    const hex = netHex(n), sp = NET_PAIR_GAP * 0.8, rad = hex.rad * sp;
    const t = flip * (base + rad);
    const cx = mx + nx * t, cy = my + ny * t, q = hex.pts[at];
    m.x = Math.max(NET_PAD, Math.min(W - NET_PAD, cx + q[0] * sp));
    m.y = Math.max(NET_PAD, Math.min(H - NET_PAD, cy + q[1] * sp));
    m.vx = m.vy = 0;
    return;
  }
  const side = (at % 2 === 0 ? 1 : -1) * flip;
  const last = (at % 2 === 0 ? Math.ceil(n / 2) : Math.floor(n / 2)) - 1;   /* steps on this side */
  if(last > 0) step = Math.max(4, Math.min(step, (reach(side * nx, side * ny) - base) / last));
  const t = side * (base + Math.floor(at / 2) * step);
  /* and never outside the box, even where the room is too small for the full distance */
  m.x = Math.max(NET_PAD, Math.min(W - NET_PAD, mx + nx * t));
  m.y = Math.max(NET_PAD, Math.min(H - NET_PAD, my + ny * t));
  m.vx = m.vy = 0;
}

/* the first n points of a hex lattice, nearest the middle first; rad is how far out the
   farthest one is, in lattice steps */
const NET_HEX = new Map();
function netHex(n){
  if(NET_HEX.has(n)) return NET_HEX.get(n);
  const pts = [], R = Math.ceil(Math.sqrt(n)) + 2;
  for(let j = -R; j <= R; j++) for(let i = -R; i <= R; i++)
    pts.push([i + (j & 1 ? 0.5 : 0), j * Math.sqrt(3) / 2]);
  pts.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
  const out = {pts:pts.slice(0, n)};
  out.rad = Math.sqrt(Math.max(...out.pts.map(q => q[0] * q[0] + q[1] * q[1])));
  NET_HEX.set(n, out);
  return out;
}

/* A machine three or more people share: the middle of those people, with the machines of
   one such set spread around that middle so they do not sit on top of one another. On the
   test tab the middle is weighted by hours and shifted by whatever netUntangle has moved
   the group by. */
function netHub(m){
  const us = m.hub.us, at = m.hub.at, n = m.hub.of, w = m.hub.w;
  let x = 0, y = 0, tw = 0;
  us.forEach((u, i) => { const k = w ? w[i] : 1; x += k * u.x; y += k * u.y; tw += k; });
  x /= tw; y /= tw;
  if(m.hub.g){ x += m.hub.g.off.x; y += m.hub.g.off.y; }
  if(n > 1){
    const r = NET_HUB_GAP * Math.sqrt(n) / 2;
    const a = 2 * Math.PI * at / n + 0.4;
    x += r * Math.cos(a); y += r * Math.sin(a);
  }
  m.x = x; m.y = y;
  m.vx = m.vy = 0;
}

/* the same hour always starts from the same numbers */
function netSeed(s){
  let x = (s >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
                 return x / 4294967296; };
}

function netStep(nodes, edges, W, H, heat, opt){
  const n = nodes.length;
  if(!n) return;
  /* One length for the whole picture, taken from how much room each node has.
     With few nodes they spread out, with many they pack in, so the picture
     comes to rest at about the size of the panel without being stretched. */
  const L0 = Math.max(40, Math.min(160, 0.95 * Math.sqrt(W * H / n)));
  const REP = 2600 * (L0 / 58) * (L0 / 58) * (L0 / 58);
  const CUT = 9 * L0 * L0;
  /* links pull towards a length a little shorter than that spacing, so lines stay short */
  const LS = Math.max(28, 0.65 * L0);
  /* the step shrinks as the picture settles, so it always comes to rest */
  const cap = 14 * (heat === undefined ? 1 : Math.max(0, Math.min(1, heat)));
  for(let i = 0; i < n; i++){
    const a = nodes[i];
    if(a.spoke || a.pair || a.hub) continue;       /* placed by geometry, not by force */
    for(let j = i + 1; j < n; j++){
      const b = nodes[j];
      if(b.spoke || b.pair || b.hub) continue;
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      /* two people push each other however far apart they are, and harder, so the
         circles spread over the panel instead of gathering in the middle */
      const two = a.kind === 'u' && b.kind === 'u';
      if(d2 > CUT && !two) continue;               /* far apart: leave them */
      if(d2 < 0.5){                                /* exactly on top of each other */
        dx = ((i % 7) - 3) * 0.4 + 0.3; dy = ((j % 5) - 2) * 0.4 + 0.2;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2), f = (two ? NET_USER_PUSH : 1) * REP / d2;
      const fx = f * dx / d, fy = f * dy / d;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
  }
  for(const e of edges){
    if(e.b.spoke || e.b.pair || e.b.hub || e.a.spoke) continue;   /* these keep their own distance */
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const f = 0.07 * (d - LS);
    const fx = f * dx / d, fy = f * dy / d;
    e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
  }
  /* people who share machines pull together, the more they share the harder, so the
     picture gathers into neighbourhoods instead of one crossing-over tangle */
  for(const p of nodes){
    if(p.kind !== 'u' || !p.ties) continue;
    for(const t of p.ties){
      const dx = t.o.x - p.x, dy = t.o.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const rest = Math.max(90, 260 - 10 * t.w);
      if(d <= rest) continue;
      const f = Math.min(6, NET_TIE * t.w * (d - rest));
      p.vx += f * dx / d; p.vy += f * dy / d;
    }
  }
  const cx = W / 2, cy = H / 2;
  for(const p of nodes){
    if(p.spoke || p.pair || p.hub) continue;
    if(p.pin){ p.vx = 0; p.vy = 0; continue; }
    p.vx = (p.vx + (cx - p.x) * 0.006) * 0.80;
    p.vy = (p.vy + (cy - p.y) * 0.006) * 0.80;
    p.x += Math.max(-cap, Math.min(cap, p.vx));
    p.y += Math.max(-cap, Math.min(cap, p.vy));
    /* someone with a ring is kept far enough in for the ring to be seen */
    const mx = Math.min(Math.max(NET_PAD, p.ring + 6), W / 2);
    const my = Math.min(Math.max(NET_PAD, p.ring + 6), H / 2);
    p.x = Math.max(mx, Math.min(W - mx, p.x));
    p.y = Math.max(my, Math.min(H - my, p.y));
  }
  netSpace(nodes, W, H);
  for(const p of nodes) if(p.spokes && p.spokes.length) netSpokes(p, W, H);
  for(const p of nodes) if(p.pair) netPair(p, W, H);
  for(const p of nodes) if(p.hub) netHub(p);
  if(opt && opt.untangle) netUntangle(nodes, W, H);
}

/* Test tab only. The groups of machines three or more people share are treated as disks and
   pushed off each other and off the people (with their rings), the push kept on the group
   (g.off) so the next step puts it back where it was moved to. Then no two machines may be
   closer than NET_NODE_GAP, or closer to a person than that person's figure: a machine on a
   ring is never moved by this, the other one is. Nothing leaves the box. */
const NET_OFF_MAX = 220;                 /* how far a group may be moved off its middle */
function netUntangle(nodes, W, H){
  const groups = [], seen = new Set();
  for(const p of nodes) if(p.hub && p.hub.g && !seen.has(p.hub.g)){ seen.add(p.hub.g); groups.push(p.hub.g); }
  const people = nodes.filter(p => p.kind === 'u');
  const disk = g => {
    let x = 0, y = 0;
    for(const m of g.list){ x += m.x; y += m.y; }
    const big = Math.max(...g.list.map(m => m.r || 5));        /* a badge is as big as its count */
    return {x:x / g.list.length, y:y / g.list.length,
            r:Math.max(NET_HUB_GAP * Math.sqrt(g.list.length) / 2, big) + 8};
  };
  const shift = (g, dx, dy) => {
    g.off.x = Math.max(-NET_OFF_MAX, Math.min(NET_OFF_MAX, g.off.x + dx));
    g.off.y = Math.max(-NET_OFF_MAX, Math.min(NET_OFF_MAX, g.off.y + dy));
    for(const m of g.list){ m.x += dx; m.y += dy; }
  };
  for(let pass = 0; pass < 6; pass++){
    const D = groups.map(disk);
    let moved = false;
    for(let i = 0; i < groups.length; i++){
      for(let j = i + 1; j < groups.length; j++){
        const a = D[i], b = D[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
        const need = a.r + b.r;
        if(d >= need) continue;
        if(d < 0.01){ dx = (i % 3) - 1 + 0.5; dy = (j % 3) - 1 + 0.5; d = Math.sqrt(dx * dx + dy * dy); }
        const k = 0.5 * (need - d) / d;
        shift(groups[i], -dx * k, -dy * k); shift(groups[j], dx * k, dy * k);
        a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k;
        moved = true;
      }
      for(const u of people){
        const a = D[i];
        const dx = a.x - u.x, dy = a.y - u.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const need = a.r + (u.ring ? u.ring + 10 : (u.r || 8) + 8);
        if(d >= need) continue;
        const k = (need - d) / d;
        shift(groups[i], dx * k, dy * k);
        a.x += dx * k; a.y += dy * k;
        moved = true;
      }
    }
    if(!moved) break;
  }
  /* last: shape by shape */
  const machines = nodes.filter(p => p.kind === 'm');
  const cx = v => Math.max(NET_EDGE, Math.min(W - NET_EDGE, v));
  const cy = v => Math.max(NET_EDGE, Math.min(H - NET_EDGE, v));
  for(let pass = 0; pass < 8; pass++){
    let moved = false;
    for(let i = 0; i < machines.length; i++){
      const a = machines[i];
      for(let j = i + 1; j < machines.length; j++){
        const b = machines[j];
        if(a.spoke && b.spoke) continue;                 /* two rings: theirs to keep apart */
        const gap = Math.max(NET_NODE_GAP, (a.r || 5) + (b.r || 5) + 4);
        let dx = b.x - a.x, dy = b.y - a.y;
        if(dx >= gap || dx <= -gap || dy >= gap || dy <= -gap) continue;
        let d = Math.sqrt(dx * dx + dy * dy);
        if(d >= gap) continue;
        if(d < 0.01){ dx = 0.7; dy = 0.3; d = Math.sqrt(0.58); }
        const push = gap - d, ux = dx / d, uy = dy / d;
        const sa = a.spoke ? 0 : (b.spoke ? 1 : 0.5), sb = b.spoke ? 0 : (a.spoke ? 1 : 0.5);
        a.x = cx(a.x - ux * push * sa); a.y = cy(a.y - uy * push * sa);
        b.x = cx(b.x + ux * push * sb); b.y = cy(b.y + uy * push * sb);
        moved = true;
      }
      if(a.spoke) continue;
      for(const u of people){
        const need = (u.r || 8) + (a.r || 5) + 4;
        let dx = a.x - u.x, dy = a.y - u.y;
        if(dx >= need || dx <= -need || dy >= need || dy <= -need) continue;
        let d = Math.sqrt(dx * dx + dy * dy);
        if(d >= need) continue;
        if(d < 0.01){ dx = 0.6; dy = 0.8; d = 1; }
        a.x = cx(a.x + dx / d * (need - d)); a.y = cy(a.y + dy / d * (need - d));
        moved = true;
      }
    }
    if(!moved) break;
  }
}

/* How far apart two user circles are kept. Each person is given a share of the
   panel, so a wide panel spreads people out instead of leaving space around them,
   while a narrow one still keeps NET_USER_GAP between them. */
function netUserGap(nodes, W, H){
  let u = 0;
  for(const p of nodes) if(p.kind === 'u') u++;
  if(u < 2) return NET_USER_GAP;
  /* the distance between neighbours if the people were spread evenly over the
     whole panel; a share of that is what they are kept apart by */
  const even = Math.sqrt(2 * W * H / (Math.sqrt(3) * u));
  return Math.max(NET_USER_GAP, NET_USER_FILL * even);
}

/* the same for every other shape, so the machines spread over the panel instead
   of being squeezed into the middle by the people around them */
function netNodeGap(nodes, W, H){
  const n = nodes.length;
  if(n < 2 || !NET_NODE_FILL) return NET_NODE_GAP;
  const even = Math.sqrt(2 * W * H / (Math.sqrt(3) * n));
  return Math.max(NET_NODE_GAP, NET_NODE_FILL * even);
}

/* Whatever the forces want: two shapes closer than their least distance are
   pushed apart along the line between them, half each, and a pinned (dragged)
   one stays where it is. Several passes, since one push can crowd a third shape. */
function netSpace(nodes, W, H){
  const n = nodes.length;
  const userGap = netUserGap(nodes, W, H), nodeGap = netNodeGap(nodes, W, H);
  const clampX = v => Math.max(NET_PAD, Math.min(W - NET_PAD, v));
  const clampY = v => Math.max(NET_PAD, Math.min(H - NET_PAD, v));
  for(let pass = 0; pass < 12; pass++){
    let moved = false;
    for(let i = 0; i < n; i++){
      const a = nodes[i];
      if(a.spoke || a.pair || a.hub) continue;     /* placed by geometry instead */
      for(let j = i + 1; j < n; j++){
        const b = nodes[j];
        if(b.spoke || b.pair || b.hub) continue;
        /* two people must clear each other's rings, and a machine shared between people
           must stay outside whatever ring it passes */
        const need = Math.max(a.kind === 'u' && b.kind === 'u' ? userGap : nodeGap,
                              (a.ring || 0) + (b.ring || 0) + 16);
        let dx = b.x - a.x, dy = b.y - a.y;
        if(dx >= need || dx <= -need || dy >= need || dy <= -need) continue;
        let d = Math.sqrt(dx * dx + dy * dy);
        if(d >= need) continue;
        if(d < 0.01){ dx = ((i % 5) - 2) + 0.5; dy = ((j % 3) - 1) + 0.5; d = Math.sqrt(dx * dx + dy * dy); }
        const sa = a.pin ? 0 : (b.pin ? 1 : 0.5);
        const sb = b.pin ? 0 : (a.pin ? 1 : 0.5);
        if(!sa && !sb) continue;
        const push = need - d, ux = dx / d, uy = dy / d;
        a.x = clampX(a.x - ux * push * sa); a.y = clampY(a.y - uy * push * sa);
        b.x = clampX(b.x + ux * push * sb); b.y = clampY(b.y + uy * push * sb);
        moved = true;
      }
    }
    if(!moved) break;
  }
}

/* ---- Bipartite Graph: people above and below, machine groups in the middle -----------
   The middle row holds the seven machine groups (H100, rpc-91 ... rpc-97,
   network-panel.js); the people are ordered as below and then dealt alternately into a
   row above it and a row below it. Two matrices say who is like whom:
     common-group matrix  two people: the number of groups they both used
     common-user matrix   two groups: the number of people who used both
   The order, "most-used first":
     groups  start with the group used by the most people; then again and again add the
             group that shares the most users with the groups already placed
             (netGreedyOrder on the common-user matrix)
     people  each person stands over the average position of the groups they used, so
             their lines drop as straight as they can; people who land on the same spot
             are ordered by the common-group matrix, from the person of the first group who
             used the most groups onwards (netGreedyOrder)
   Ordering the people on their own matrix alone, without looking at the groups below,
   crosses about as many lines as name order does (June: 2,400-3,145 against 2,528), which
   is why they follow the groups. An order is scored by the linear-arrangement cost, sum of
   similarity x distance in the row (lower: similar ones closer); NET_BIP holds that and the
   line crossings for this order, name order and the earlier spectral order (netSeriate,
   kept below), so they can be compared. The same data always gives the same picture. */
let NET_BIP = null;
/* Bipartite Graph, inside a group's circle: how deep along its own direction from the entry
   point each machine of a fan sits, as a share of the circle's chord that way, taken in turn
   so neighbours are at different depths (network-panel.js, bipTargets) */
/* measured (1 user / 2 / 3 picked, lines running under another machine): this pattern
   7 / 64 / 144, against 34 / 96 / 185 for five depths and 115 / 200 / 289 for the earlier
   pull to the entry point */
var NET_FAN_DEPTH = [0.55, 0.92];

/* Start from the biggest item (size), then keep adding the one most like everything already
   placed; ties go to the one most like the last placed, then the bigger, then by name. */
function netGreedyOrder(items, S, size, first){
  const n = items.length;
  if(!n) return [];
  const name = i => items[i].id;
  let start = first;
  if(start === undefined){
    start = 0;
    for(let i = 1; i < n; i++)
      if(size(i) > size(start) || (size(i) === size(start) && name(i) < name(start))) start = i;
  }
  const order = [start], left = new Set(items.map((_, i) => i)); left.delete(start);
  const tot = items.map((_, i) => S[start][i]);
  while(left.size){
    const last = order[order.length - 1];
    let best = -1;
    for(const i of left){
      if(best < 0){ best = i; continue; }
      const k = [tot[i] - tot[best], S[last][i] - S[last][best], size(i) - size(best)];
      const d = k.find(v => v !== 0);
      if(d > 0 || (d === undefined && name(i) < name(best))) best = i;
    }
    order.push(best); left.delete(best);
    for(const i of left) tot[i] += S[best][i];
  }
  return order;
}

function netSeriate(items, S){
  const n = items.length, byId = (a, b) => (items[a].id < items[b].id ? -1 : 1);
  if(n < 3) return items.map((_, i) => i).sort(byId);
  /* the connected pieces */
  const seen = new Array(n).fill(false), parts = [];
  for(let s = 0; s < n; s++){
    if(seen[s]) continue;
    const part = [s]; seen[s] = true;
    for(let k = 0; k < part.length; k++)
      for(let j = 0; j < n; j++) if(!seen[j] && S[part[k]][j] > 0){ seen[j] = true; part.push(j); }
    parts.push(part);
  }
  parts.sort((a, b) => b.length - a.length || byId(a[0], b[0]));
  const order = [];
  for(const part of parts){
    const k = part.length;
    if(k < 3){ order.push(...part.sort(byId)); continue; }
    /* Fiedler vector by power iteration on cI - L, kept orthogonal to the constant vector */
    const deg = part.map(i => part.reduce((a, j) => a + (i === j ? 0 : S[i][j]), 0));
    const c = 2 * Math.max(...deg) + 1;
    let v = part.map((_, a) => a - (k - 1) / 2 + 0.37 * Math.sin(a + 1));
    for(let it = 0; it < 600; it++){
      const w = part.map((i, a) => { let s = (c - deg[a]) * v[a];
        for(let b = 0; b < k; b++) if(b !== a) s += S[i][part[b]] * v[b]; return s; });
      const m = w.reduce((x, y) => x + y, 0) / k;
      let nn = 0; for(let a = 0; a < k; a++){ w[a] -= m; nn += w[a] * w[a]; }
      nn = Math.sqrt(nn) || 1; v = w.map(x => x / nn);
    }
    if(v[0] > 0) v = v.map(x => -x);                  /* one way round, always the same */
    const idx = part.map((i, a) => a).sort((a, b) => v[a] - v[b] || byId(part[a], part[b]));
    order.push(...idx.map(a => part[a]));
  }
  /* neighbour swaps that lower sum S[i][j] * |pos i - pos j| */
  for(let pass = 0; pass < 60; pass++){
    let better = false;
    for(let p = 0; p + 1 < n; p++){
      const a = order[p], b = order[p + 1];
      let delta = 0;
      for(let q = 0; q < n; q++){
        if(q === p || q === p + 1) continue;
        const j = order[q], d = S[a][j] - S[b][j];
        delta += q < p ? d : -d;
      }
      if(delta < -1e-9){ order[p] = b; order[p + 1] = a; better = true; }
    }
    if(!better) break;
  }
  return order;
}

function netArrCost(order, S){
  const pos = new Array(order.length);
  order.forEach((i, p) => { pos[i] = p; });
  let c = 0;
  for(let i = 0; i < S.length; i++) for(let j = i + 1; j < S.length; j++) c += S[i][j] * Math.abs(pos[i] - pos[j]);
  return c;
}

function netCrossings(edges, ux, mx){
  const L = edges.map(e => [ux.get(e.a), mx.get(e.b)]);
  let c = 0;
  for(let i = 0; i < L.length; i++) for(let j = i + 1; j < L.length; j++){
    const a = L[i], b = L[j];
    if((a[0] - b[0]) * (a[1] - b[1]) < 0) c++;
  }
  return c;
}

/* The Users & Groups order on its own, so another view can use the very same one (the Test
   view of Network Chart by Month does). people and machines (the groups) come sorted by id,
   and each edge links a person (e.a) to a group (e.b). Returns the matrices and the two
   orders, as indexes into people and machines. */
function netBipOrder(people, machines, edges){
  const ui = new Map(people.map((p, i) => [p, i])), mi = new Map(machines.map((p, i) => [p, i]));
  const held = people.map(() => new Set()), by = machines.map(() => new Set());
  for(const e of edges){ held[ui.get(e.a)].add(mi.get(e.b)); by[mi.get(e.b)].add(ui.get(e.a)); }
  const common = (A, B) => { let c = 0; for(const x of A) if(B.has(x)) c++; return c; };
  const Su = people.map((_, i) => people.map((_, j) => i === j ? 0 : common(held[i], held[j])));
  const Sm = machines.map((_, i) => machines.map((_, j) => i === j ? 0 : common(by[i], by[j])));
  /* the groups: most-used first, then the one sharing the most users with those placed */
  const mo = netGreedyOrder(machines, Sm, i => by[i].size);
  const gpos = new Array(machines.length);
  mo.forEach((i, p) => { gpos[i] = p; });
  /* the people: over the average position of their groups; a tie goes by the common-group
     matrix, from the first group's person who used the most groups onwards */
  const g0 = mo[0];
  let u0 = -1;
  for(const i of by[g0])
    if(u0 < 0 || held[i].size > held[u0].size || (held[i].size === held[u0].size && people[i].id < people[u0].id)) u0 = i;
  const chain = netGreedyOrder(people, Su, i => held[i].size, u0 < 0 ? undefined : u0);
  const rank = new Array(people.length);
  chain.forEach((i, p) => { rank[i] = p; });
  const mean = people.map((_, i) => { let s = 0; for(const g of held[i]) s += gpos[g]; return held[i].size ? s / held[i].size : Infinity; });
  const uo = people.map((_, i) => i).sort((a, b) => (mean[a] - mean[b]) || (rank[a] - rank[b]));
  return {held, by, Su, Sm, mo, uo};
}

function netBipartite(nodes, edges, W, H){
  const people = nodes.filter(p => p.kind === 'u').sort((a, b) => (a.id < b.id ? -1 : 1));
  const machines = nodes.filter(p => p.kind === 'm').sort((a, b) => (a.id < b.id ? -1 : 1));
  if(!people.length || !machines.length) return;
  const {held, Su, Sm, mo, uo} = netBipOrder(people, machines, edges);
  const alpha = n => Array.from({length:n}, (_, i) => i);
  /* where each one stands in its row, 0..1 */
  const at = (order, list) => { const m = new Map(); order.forEach((i, p) => m.set(list[i], order.length > 1 ? p / (order.length - 1) : 0.5)); return m; };
  const ux = at(uo, people), mx = at(mo, machines);
  /* the earlier spectral order, scored for comparison only */
  const su = netSeriate(people, Su), sm = netSeriate(machines, Sm);
  let smx = at(sm, machines);
  const sflip = at(sm.slice().reverse(), machines), sux = at(su, people);
  if(netCrossings(edges, sux, sflip) < netCrossings(edges, sux, smx)) smx = sflip;
  /* Two rows of people, the groups between them: the people in that order are dealt out
     like cards, the 1st to the top row, the 2nd to the bottom row, the 3rd to the top...
     A line from the top row and one from the bottom row are on opposite sides of the
     groups and never cross, and each row has twice the room for its names. */
  const top = uo.filter((_, k) => k % 2 === 0), bot = uo.filter((_, k) => k % 2 === 1);
  const tx = at(top, people), bx = at(bot, people);
  const onTop = new Set(top.map(i => people[i]));
  const rowX = new Map([...tx, ...bx]);
  const two = netCrossings(edges.filter(e => onTop.has(e.a)), rowX, mx) +
              netCrossings(edges.filter(e => !onTop.has(e.a)), rowX, mx);
  NET_BIP = {
    people:{alpha:netArrCost(alpha(people.length), Su), sorted:netArrCost(uo, Su), spectral:netArrCost(su, Su)},
    machines:{alpha:netArrCost(alpha(machines.length), Sm), sorted:netArrCost(mo, Sm), spectral:netArrCost(sm, Sm)},
    /* alpha, spectral and oneRow are single-row figures, kept to compare with */
    crossings:{alpha:netCrossings(edges, at(alpha(people.length), people), at(alpha(machines.length), machines)),
               oneRow:netCrossings(edges, ux, mx), spectral:netCrossings(edges, sux, smx), sorted:two},
    rows:{top:top.length, bottom:bot.length}
  };
  const left = NET_PAD + 40, right = W - NET_PAD - 40;
  const yt = Math.max(90, H * 0.14), ym = H * 0.5, yb = H - Math.max(90, H * 0.14);
  /* the groups are drawn as circles up to 70 px round, so their row keeps a wider margin
     than the people's rows - and on the right, room for the last circle's name, which is
     shown beside a circle on hover */
  const gl = NET_PAD + 80, gr = W - NET_PAD - 140;
  for(const m of machines){ m.x = gl + mx.get(m) * (gr - gl); m.y = ym; m.vx = m.vy = 0; }
  /* Sugiyama's coordinate step: a person is not spread evenly along their row but put as
     near as it can be over their groups - the hours-weighted mean x of the groups they used
     - keeping the row's order and at least 60% of the even spacing between neighbours.
     That is a least-squares fit under an order constraint, solved exactly by pool-adjacent-
     violators on x - i * gap. The order, and so the crossings, do not change; the lines get
     shorter and steeper. */
  const hw = new Map();                    /* 'person|group' -> node-hours */
  for(const e of edges) hw.set(e.a.id + '|' + e.b.id, e.hrs || 1);
  const place = (row, y) => {
    const n = row.length;
    if(!n) return;
    const gap = n > 1 ? 0.6 * (right - left) / (n - 1) : 0;
    const want = row.map(i => { let s = 0, w = 0;
      for(const g of held[i]){ const k = hw.get(people[i].id + '|' + machines[g].id) || 1; s += k * machines[g].x; w += k; }
      return w ? s / w : (left + right) / 2; });
    const wt = row.map(i => { let w = 0; for(const g of held[i]) w += hw.get(people[i].id + '|' + machines[g].id) || 1; return w || 1; });
    /* pool adjacent violators: the nondecreasing fit of want[i] - i * gap */
    const blocks = [];
    for(let i = 0; i < n; i++){
      blocks.push({v:want[i] - i * gap, w:wt[i], n:1});
      while(blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v){
        const b = blocks.pop(), a = blocks[blocks.length - 1];
        a.v = (a.v * a.w + b.v * b.w) / (a.w + b.w); a.w += b.w; a.n += b.n;
      }
    }
    let i = 0;
    for(const b of blocks) for(let k = 0; k < b.n; k++, i++){
      const x = b.v + i * gap;
      const p = people[row[i]];
      p.x = Math.max(left + i * gap, Math.min(right - (n - 1 - i) * gap, x));
      p.y = y; p.vx = p.vy = 0;
    }
    /* A row stays together: nobody stands more than one gap right of the person before
       them. Without this the few who use only far-off groups (root and tongywan, the only
       real users of rpc-96 and rpc-97) sat hundreds of pixels away from everyone else. The
       order is not touched. */
    for(let k = 1; k < n; k++){
      const a = people[row[k - 1]], b = people[row[k]];
      if(b.x - a.x > gap) b.x = a.x + gap;
    }
  };
  place(top, yt); place(bot, yb);
  for(const p of people) p.side = onTop.has(p) ? 'top' : 'bottom';
  /* how long the lines are, as a share of the row's width: now and if spread evenly */
  let now = 0, even = 0;
  for(const e of edges){
    now += Math.abs(e.a.x - e.b.x);
    even += Math.abs(left + rowX.get(e.a) * (right - left) - e.b.x);
  }
  NET_BIP.length = {even:Math.round(even / (right - left) * 10) / 10, sugiyama:Math.round(now / (right - left) * 10) / 10};
}

/* ---- Users & Groups (layers): n rows of groups, n + 1 rows of people -------------------
   The Sugiyama framework with the layer-assignment step Users & Groups skips. Rows run
   people, groups, people, groups, ..., people (2n + 1 rows), and a line only ever joins a
   person to a group in a row next to them, so lines in different gaps never cross:
     rows      n = 1, 2 and 3 group rows are all tried; the fewest rows whose crossings are
               within 5% of the lowest is kept (June: 2)
     groups    every way of putting the groups on n non-empty rows is tried, except those
               that would make a person's line jump over a group row; each is scored after
               quick barycentre sweeps, and the best 10 are then ordered in full
     people    a person who used groups in two neighbouring group rows stands in the people
               row between them; one who used only the top (bottom) group row, in the top
               (bottom) row; only a middle group row, on whichever side of it has fewer
               people. With one group row they are dealt alternately above and below, in
               the Users & Groups order, as on that tab.
     orders    Sugiyama's crossing reduction: rows start in the Users & Groups order
               (netBipOrder), then sweeps down and up put each person and group at the mean
               position of what they link to (barycentre), and neighbours swap while that
               lowers the crossings (transposition)
     places    groups evenly along their row; people fitted by pool-adjacent-violators to the
               hours-weighted mean x of their groups, 60% of an even spacing apart - no
               closer, and (since 2026-09-29, the user's request: root stood 122 px out) no
               further from the one before either, so each row is one evenly spaced line
               that starts where the fit puts its first person
   Crossings are counted between neighbouring rows: two lines cross where their ends swap
   order. The search is kept while the links stay the same, so a redraw does not repeat it.
   NET_BIPL holds the rows, the crossings for each n and what was tried, for checks. Group
   circles get p.Rcap, the largest radius that fits between the rows. */
let NET_BIPL = null, NET_BIPL_KEEP = null;
function netBipLayersSearch(people, groups, edges){
  const t0 = Date.now();
  const P = people.length, G = groups.length;
  const {held, uo, mo} = netBipOrder(people, groups, edges);
  /* one numbering for both: people 0 .. P-1, groups P .. P+G-1 */
  const nb = [], E = [];
  for(let i = 0; i < P + G; i++) nb.push([]);
  held.forEach((s, i) => { for(const g of s){ nb[i].push(P + g); nb[P + g].push(i); E.push([i, P + g]); } });
  const pos = new Float64Array(P + G), lay = new Int32Array(P + G);
  const setPos = layers => layers.forEach((L, k) => L.forEach((id, i) => { pos[id] = (i + 0.5) / L.length; lay[id] = k; }));
  const count = layers => {
    setPos(layers);
    const bands = layers.map(() => []);
    for(const [u, g] of E){ const a = lay[u], b = lay[g];
      bands[Math.min(a, b)].push(a < b ? [pos[u], pos[g], u, g] : [pos[g], pos[u], g, u]); }
    let c = 0;
    for(const L of bands) for(let i = 0; i < L.length; i++) for(let j = i + 1; j < L.length; j++){
      const p = L[i], q = L[j];
      if(p[2] === q[2] || p[3] === q[3]) continue;
      if((p[0] - q[0]) * (p[1] - q[1]) < 0) c++;
    }
    return c;
  };
  /* barycentre: a row sorted by the mean position of what each links to */
  const bary = (layers, k) => {
    setPos(layers);
    const v = new Map(layers[k].map(id => {
      const ns = nb[id]; let s = 0;
      for(const o of ns) s += pos[o];
      return [id, ns.length ? s / ns.length : pos[id]];
    }));
    layers[k] = layers[k].slice().sort((x, y) => v.get(x) - v.get(y));
  };
  /* transposition: the lines of a and b cross this many times with a left of b */
  const cross2 = (a, b) => {
    let c = 0;
    for(const x of nb[a]) for(const y of nb[b]) if(x !== y && lay[x] === lay[y] && pos[x] > pos[y]) c++;
    return c;
  };
  const transpose = (layers, k) => {
    setPos(layers);
    const L = layers[k];
    for(let pass = 0, moved = true; moved && pass < 40; pass++){
      moved = false;
      for(let i = 0; i + 1 < L.length; i++){
        const a = L[i], b = L[i + 1];
        if(cross2(b, a) < cross2(a, b)){ L[i] = b; L[i + 1] = a; moved = true; }
      }
    }
  };
  const quick = layers => {
    for(let r = 0; r < 2; r++){
      for(let k = 1; k < layers.length; k++) bary(layers, k);
      for(let k = layers.length - 2; k >= 0; k--) bary(layers, k);
    }
    return count(layers);
  };
  const full = layers => {
    let best = count(layers), keep = layers.map(L => L.slice());
    for(let r = 0; r < 8; r++){
      for(let k = 0; k < layers.length; k++){ bary(layers, k); transpose(layers, k); }
      for(let k = layers.length - 1; k >= 0; k--){ bary(layers, k); transpose(layers, k); }
      const c = count(layers);
      if(c < best){ best = c; keep = layers.map(L => L.slice()); } else break;
    }
    return {c:best, layers:keep};
  };
  /* the rows for one assignment a (a[j]: the group row of group j), or null */
  const rowsFor = (n, a) => {
    const GR = Array.from({length:n}, () => []), UR = Array.from({length:n + 1}, () => []);
    for(const j of mo) GR[a[j]].push(P + j);
    if(GR.some(r => !r.length)) return null;
    if(n === 1) uo.forEach((i, k) => UR[k % 2].push(i));
    else for(const i of uo){
      let lo = n, hi = -1;
      for(const j of held[i]){ lo = Math.min(lo, a[j]); hi = Math.max(hi, a[j]); }
      if(hi < 0){ UR[0].push(i); continue; }
      if(hi - lo > 1) return null;                 /* a line would jump over a group row */
      if(hi > lo) UR[hi].push(i);
      else if(lo === 0) UR[0].push(i);
      else if(lo === n - 1) UR[n].push(i);
      else UR[UR[lo].length <= UR[lo + 1].length ? lo : lo + 1].push(i);
    }
    const layers = [];
    for(let k = 0; k < n; k++) layers.push(UR[k], GR[k]);
    layers.push(UR[n]);
    return layers;
  };
  const byN = {}, tried = {}, found = {};
  for(let n = 1; n <= 3 && n <= G; n++){
    const cands = [];
    let total = 1; for(let j = 0; j < G; j++) total *= n;
    for(let code = 0; code < total; code++){
      const a = [], m = [];
      for(let j = 0, c = code; j < G; j++, c = Math.floor(c / n)){ a.push(c % n); m.push(n - 1 - (c % n)); }
      /* a turned upside down gives the same crossings: keep one of the two */
      let mcode = 0; for(let j = G - 1; j >= 0; j--) mcode = mcode * n + m[j];
      if(mcode < code) continue;
      const L = rowsFor(n, a);
      if(!L) continue;
      cands.push({a, c:quick(L.map(r => r.slice()))});
    }
    tried[n] = cands.length;
    if(!cands.length) continue;
    cands.sort((x, y) => x.c - y.c);
    let best = null;
    for(const cd of cands.slice(0, 10)){
      const r = full(rowsFor(n, cd.a));
      if(!best || r.c < best.c) best = r;
    }
    byN[n] = best.c; found[n] = best;
  }
  const lowest = Math.min(...Object.values(byN));
  let n = 1;
  while(!(found[n] && found[n].c <= 1.05 * lowest)) n++;
  return {n, c:found[n].c, layers:found[n].layers, byN, tried, ms:Date.now() - t0};
}
function netBipLayers(nodes, edges, W, H){
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const people = nodes.filter(p => p.kind === 'u').sort(byId);
  const groups = nodes.filter(p => p.kind === 'm').sort(byId);
  if(!people.length || !groups.length) return;
  const key = people.map(p => p.id).join('|') + '#' + groups.map(g => g.id).join('|') + '#' +
              edges.map(e => e.a.id + '>' + e.b.id).sort().join('|');
  if(!NET_BIPL_KEEP || NET_BIPL_KEEP.key !== key)
    NET_BIPL_KEEP = Object.assign({key}, netBipLayersSearch(people, groups, edges));
  const K = NET_BIPL_KEEP, P = people.length;
  const node = id => id < P ? people[id] : groups[id - P];
  const rows = K.layers.length;
  /* the rows, evenly down the box; circles as big as fits between them */
  const top = Math.max(34, H * 0.07), bot = H - Math.max(34, H * 0.07);
  const step = rows > 1 ? (bot - top) / (rows - 1) : 0;
  const cap = Math.max(18, step * 0.34);
  const gl = NET_PAD + 80, gr = W - NET_PAD - 140;       /* room on the right for a hovered name */
  const left = NET_PAD + 40, right = W - NET_PAD - 40;
  K.layers.forEach((row, k) => {
    if(k % 2 === 0) return;
    row.forEach((id, i) => {
      const g = node(id);
      g.x = gl + (i + 0.5) / row.length * (gr - gl); g.y = top + k * step; g.vx = g.vy = 0;
      g.Rcap = cap; g.layer = k;
    });
  });
  /* people: as near the hours-weighted middle of their groups as the spacing allows */
  const mine = new Map(people.map(p => [p, []]));
  for(const e of edges) if(mine.has(e.a)) mine.get(e.a).push(e);
  K.layers.forEach((ids, k) => {
    if(k % 2) return;
    const row = ids.map(node), n = row.length;
    if(!n) return;
    const even = n > 1 ? (right - left) / (n - 1) : 0, gap = 0.6 * even;
    const want = row.map(p => { let s = 0, w = 0;
      for(const e of mine.get(p)){ const h = e.hrs || 1; s += h * e.b.x; w += h; }
      return w ? s / w : (left + right) / 2; });
    const wt = row.map(p => mine.get(p).reduce((a, e) => a + (e.hrs || 1), 0) || 1);
    const blocks = [];
    for(let i = 0; i < n; i++){
      blocks.push({v:want[i] - i * gap, w:wt[i], n:1});
      while(blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v){
        const b = blocks.pop(), a = blocks[blocks.length - 1];
        a.v = (a.v * a.w + b.v * b.w) / (a.w + b.w); a.w += b.w; a.n += b.n;
      }
    }
    let i = 0;
    for(const b of blocks) for(let j = 0; j < b.n; j++, i++){
      const p = row[i];
      p.x = Math.max(left + i * gap, Math.min(right - (n - 1 - i) * gap, b.v + i * gap));
      p.y = top + k * step; p.vx = p.vy = 0;
      p.side = k === 0 ? 'top' : (k === rows - 1 ? 'bottom' : 'mid'); p.layer = k;
    }
    for(let j = 1; j < n; j++) if(row[j].x - row[j - 1].x > gap) row[j].x = row[j - 1].x + gap;
  });
  NET_BIPL = {n:K.n, crossings:K.c, byN:K.byN, tried:K.tried, ms:K.ms,
              rows:K.layers.map(ids => ids.map(id => node(id).name))};
}

/* ---- Network Chart by Month: three rings - people, groups, machines -----------------
   The month's people on the outer ring, the seven machine groups (H100 and the Zen4 racks,
   network-panel.js) on the middle ring, every machine on the inner ring. A person links
   only to the groups they used, a machine only to its own group. Nothing is left to the
   forces, so the picture is the same every time it is drawn:
     machines  each group's machines sit together in one arc of the inner ring, as long as
               the group has machines, with a small gap between groups; along the arc they
               alternate between two radii 14 px apart, so neighbours never touch
     groups    each stands at the middle of its machines' arc, so its lines to them are one
               fan and never cross each other
     order     the Users & Groups order (netBipOrder): the group used by the most people at
               the top, then clockwise, again and again, the group sharing the most users
               with the groups already placed
     people    Sugiyama's crossing reduction, the groups held still: first the barycentre -
               each person at the hours-weighted mean direction of the groups they used,
               kept in that order and at least 60% of an even spacing apart (a least-squares
               fit by pool-adjacent-violators) - then transposition: two neighbours swap
               places, and everyone is fitted again, whenever that lowers the crossings,
               until no swap does
   Crossings are counted exactly for the lines as drawn (netBandCross). Group-machine lines
   never cross anything, so every crossing is between two person-group lines.
   (Until 2026-09-29 the group order was the best of all 720 orders by a count of lines whose
   ends swap order between the rings: 942 by that count, but 594 as drawn.)
   NET_TRI holds the group order, the crossings before and after the swaps, and the crossings
   with the groups in plain name order, for checks. */
let NET_TRI = null;
/* Two lines between the same two rings, each kept to the band between them and going round the
   shorter way with the same easing (network-panel.js, place), from angles a1 and a2 on one ring
   to b1 and b2 on the other. At any height the angle between them moves steadily from where
   they start to where they end, so they cross exactly when it passes a whole turn (0 included):
   1 if they cross, 0 if not. */
function netBandCross(a1, b1, a2, b2){
  const TAU = 2 * Math.PI;
  const wrap = a => { a = (a + Math.PI) % TAU; if(a < 0) a += TAU; return a - Math.PI; };
  const d0 = wrap(a1 - a2), d1 = d0 + wrap(b1 - a1) - wrap(b2 - a2);
  const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
  return ((lo < 0 && hi > 0) || (lo < TAU && hi > TAU) || (lo < -TAU && hi > -TAU)) ? 1 : 0;
}
function netTriRing(nodes, edges, W, H){
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ug = edges.filter(e => e.a.kind === 'u'), gm = edges.filter(e => e.a.kind !== 'u');
  const people = nodes.filter(p => p.kind === 'u').sort(byId);
  const groups = [...new Set(ug.map(e => e.b).concat(gm.map(e => e.a)))].sort(byId);
  if(!people.length || !groups.length) return;
  const kids = new Map(groups.map(g => [g, []]));        /* group -> its machines */
  for(const e of gm) kids.get(e.a).push(e.b);
  for(const l of kids.values()) l.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
  const mine = new Map(people.map(p => [p, []]));        /* person -> [group, hours] */
  for(const e of ug) mine.get(e.a).push([e.b, e.hrs || 1]);
  const TAU = 2 * Math.PI;
  const cx = W / 2, cy = H / 2;
  const R = Math.max(80, Math.min(W, H) / 2 - NET_PAD - 12), Rg = 0.74 * R, Rm = 0.5 * R;
  const GAP = 1.5;                                       /* empty slots between two groups */
  const slot = TAU / Math.max(1, gm.length + GAP * groups.length);
  const n = people.length, delta = 0.6 * TAU / Math.max(1, n);
  const wt = people.map(p => mine.get(p).reduce((s, [, h]) => s + h, 0) || 1);

  /* the arcs for one order of the groups: where each starts, and its middle */
  const arcs = order => {
    const len = g => Math.max(1, kids.get(g).length) * slot;
    let a = -Math.PI / 2 - len(order[0]) / 2;            /* the first group at the top */
    const start = new Map(), mid = new Map();
    for(const g of order){ start.set(g, a); mid.set(g, a + len(g) / 2); a += len(g) + GAP * slot; }
    return {start, mid};
  };
  /* the people round the ring in a given order, each as near their barycentre (want, a
     direction already unwrapped along the order) as the order and delta allow */
  const seatOrder = (ord, want) => {
    const blocks = [];
    ord.forEach((i, k) => {
      blocks.push({v:want.get(i) - k * delta, w:wt[i], n:1});
      while(blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v){
        const b = blocks.pop(), a = blocks[blocks.length - 1];
        a.v = (a.v * a.w + b.v * b.w) / (a.w + b.w); a.w += b.w; a.n += b.n;
      }
    });
    const ang = new Map();
    let k = 0;
    for(const b of blocks) for(let j = 0; j < b.n; j++, k++) ang.set(people[ord[k]], b.v + k * delta);
    /* too many to fit round without closing up: spread them evenly instead */
    if(ang.get(people[ord[n - 1]]) - ang.get(people[ord[0]]) > TAU - delta){
      let s = 0, sw = 0;
      ord.forEach((i, k) => { s += wt[i] * (want.get(i) - k * TAU / n); sw += wt[i]; });
      ord.forEach((i, k) => ang.set(people[i], s / sw + k * TAU / n));
    }
    return ang;
  };
  /* crossings of the person-group lines, exactly as drawn */
  const crossings = (uAng, gMid) => {
    let c = 0;
    for(let i = 0; i < ug.length; i++) for(let j = i + 1; j < ug.length; j++){
      const a = ug[i], b = ug[j];
      if(a.a === b.a || a.b === b.b) continue;
      c += netBandCross(uAng.get(a.a), gMid.get(a.b), uAng.get(b.a), gMid.get(b.b));
    }
    return c;
  };
  /* Sugiyama for the people, the groups at mid held still */
  const sugiyama = mid => {
    /* barycentre: the hours-weighted mean direction of their groups */
    const pref = people.map(p => {
      let x = 0, y = 0;
      for(const [g, h] of mine.get(p)){ x += h * Math.cos(mid.get(g)); y += h * Math.sin(mid.get(g)); }
      if(Math.hypot(x, y) > 1e-9) return Math.atan2(y, x);
      const l = mine.get(p);
      return l.length ? mid.get(l[0][0]) : -Math.PI / 2;
    });
    const idx = people.map((_, i) => i).sort((a, b) => (pref[a] - pref[b]) || byId(people[a], people[b]));
    /* cut the circle at its widest empty stretch, so the order does not wrap mid-crowd */
    let cut = 0, widest = -1;
    for(let k = 0; k < n; k++){
      const a = pref[idx[k]], b = k + 1 < n ? pref[idx[k + 1]] : pref[idx[0]] + TAU;
      if(b - a > widest){ widest = b - a; cut = (k + 1) % n; }
    }
    let ord = idx.slice(cut).concat(idx.slice(0, cut));
    const want = new Map();
    let prev = -Infinity;
    for(const i of ord){ let v = pref[i]; while(v < prev) v += TAU; want.set(i, v); prev = v; }
    let ang = seatOrder(ord, want), c = crossings(ang, mid);
    const bary = c;
    /* transposition: neighbours swap while it lowers the crossings */
    let swaps = 0;
    for(let pass = 0; pass < 60; pass++){
      let moved = false;
      for(let k = 0; k + 1 < n; k++){
        const o2 = ord.slice(); [o2[k], o2[k + 1]] = [o2[k + 1], o2[k]];
        const a2 = seatOrder(o2, want), c2 = crossings(a2, mid);
        if(c2 < c){ ord = o2; ang = a2; c = c2; moved = true; swaps++; }
      }
      if(!moved) break;
    }
    return {ang, c, bary, swaps};
  };
  /* the groups in the Users & Groups order, the first at the top */
  const {mo} = netBipOrder(people, groups, ug);
  const order = mo.map(i => groups[i]);
  const {start, mid} = arcs(order);
  const best = sugiyama(mid);
  NET_TRI = {order:order.map(g => g.name), crossings:best.c, barycentre:best.bary, swaps:best.swaps,
             nameOrder:sugiyama(arcs(groups).mid).c};
  /* and put everything in its place */
  for(const p of people){
    const a = best.ang.get(p);
    p.x = cx + R * Math.cos(a); p.y = cy + R * Math.sin(a); p.vx = p.vy = 0; p.ring = 0;
  }
  for(const g of order){
    const a = mid.get(g);
    g.x = cx + Rg * Math.cos(a); g.y = cy + Rg * Math.sin(a); g.vx = g.vy = 0;
    kids.get(g).forEach((m, j) => {
      const t = start.get(g) + (j + 0.5) * slot, r = Rm + (j % 2 ? 7 : -7);
      m.x = cx + r * Math.cos(t); m.y = cy + r * Math.sin(t); m.vx = m.vy = 0;
    });
  }
}

/* ---- Network Chart by Month, "Original (2 rings)" view --------------------------------
   The month as it was drawn before the groups were added, restored unchanged (2026-09-28,
   at the user's request, after a grouped version was tried). Only its colours changed: the
   panel paints each machine in its group's colour. */
/* ---- the whole month: a ring of people round a ring of machines -----------------
   Over a month almost every machine has been held by several people, so the middle of
   its holders is the middle of the picture and everything piles up there. The month is
   laid out instead: the people on an outer ring, the machines on an inner one, each
   ordered so that whoever is linked sits close together. Nothing is left to the forces,
   so the picture is the same every time it is drawn.

   The order comes from the barycentre rule, the usual way of cutting down crossings in a
   two-sided drawing: a machine is put at the average angle of the people holding it, the
   people are then put at the average angle of their machines, and that is repeated a few
   times until it settles. */
function netCircle(nodes, edges, W, H){
  const people = nodes.filter(p => p.kind === 'u');
  const machines = nodes.filter(p => p.kind === 'm');
  if(!people.length || !machines.length) return;
  const near = new Map();                  /* node -> the nodes it links to */
  for(const p of nodes) near.set(p, []);
  for(const e of edges){ near.get(e.a).push(e.b); near.get(e.b).push(e.a); }

  const spread = list => list.forEach((p, i) => { p.ang = 2 * Math.PI * i / list.length; });
  people.sort((a, b) => (near.get(b).length - near.get(a).length) || (a.id < b.id ? -1 : 1));
  spread(people);
  /* the average direction of everything a node links to */
  const mean = p => {
    const ns = near.get(p);
    let x = 0, y = 0;
    for(const o of ns){ if(o.ang === undefined) continue; x += Math.cos(o.ang); y += Math.sin(o.ang); }
    return (x === 0 && y === 0) ? p.ang || 0 : Math.atan2(y, x);
  };
  for(let pass = 0; pass < 8; pass++){
    for(const m of machines) m.ang = mean(m);
    machines.sort((a, b) => a.ang - b.ang);
    spread(machines);
    for(const u of people) u.ang = mean(u);
    people.sort((a, b) => a.ang - b.ang);
    spread(people);
  }
  const cx = W / 2, cy = H / 2;
  const R = Math.max(80, Math.min(W, H) / 2 - NET_PAD - 12);
  const r = R * 0.66;
  for(const u of people){ u.x = cx + R * Math.cos(u.ang); u.y = cy + R * Math.sin(u.ang);
                          u.vx = u.vy = 0; u.ring = 0; }
  for(const m of machines){ m.x = cx + r * Math.cos(m.ang); m.y = cy + r * Math.sin(m.ang);
                            m.vx = m.vy = 0; }
}

/* ---- Network Chart by Month, "Test" view: people in the Users & Groups order, each group's
   machines kept together ----------------------------------------------------------------
   Two rings as in the Original (people outside, machines inside at 66%), placed in one go:
     1. people   in exactly the order of the Users & Groups tab (netBipOrder, from the
                 person-group links groupLinks), evenly round the outer ring from 3 o'clock
     2. machines each wishes to be at the arrow average of the directions of the people who
                 used it, every person counting once (the Original's rule)
     3. groups   each wishes to be at the arrow average of its machines' wishes; the machines
                 are lined up group by group in the order of those wishes, and inside a group
                 by each machine's own wish, so a group's machines are never split up
     4. seats    evenly round the inner ring in that line-up, the whole ring turned so the
                 seats sit as near as they can to the wishes. (The Original starts its seats
                 at 3 o'clock whatever the wishes are, which turns its machines about half a
                 turn away from their people; with the people fixed there is no reason to.)
   People no longer move after their machines, so nothing is repeated. groupOf(name) names a
   machine's group. NET_TEST keeps the group order found, for checks. */
let NET_TEST = null;
function netCircleTest(nodes, edges, W, H, groupOf, groupLinks){
  const people = nodes.filter(p => p.kind === 'u').sort((a, b) => (a.id < b.id ? -1 : 1));
  const machines = nodes.filter(p => p.kind === 'm');
  if(!people.length || !machines.length) return;
  const TAU = 2 * Math.PI;
  const wrap = a => { while(a <= -Math.PI) a += TAU; while(a > Math.PI) a -= TAU; return a; };
  /* 1. the people, with the ids the Users & Groups tab gives them, so ties fall the same way */
  const who = new Map(people.map(p => [p.name, p]));
  const gs = new Map();
  for(const [u, g] of groupLinks) if(who.has(u) && !gs.has(g)) gs.set(g, {id:'m ' + g, name:g});
  const groups = [...gs.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const glinks = groupLinks.filter(l => who.has(l[0])).map(l => ({a:who.get(l[0]), b:gs.get(l[1])}));
  const {uo} = netBipOrder(people, groups, glinks);
  uo.forEach((i, k) => { people[i].ang = TAU * k / uo.length; });
  /* 2. each machine's wish */
  const near = new Map(machines.map(m => [m, []]));
  for(const e of edges) if(near.has(e.b)) near.get(e.b).push(e.a);
  const wish = new Map();
  for(const m of machines){
    let x = 0, y = 0;
    for(const u of near.get(m)){ x += Math.cos(u.ang); y += Math.sin(u.ang); }
    wish.set(m, (x === 0 && y === 0) ? 0 : Math.atan2(y, x));
  }
  /* 3. each group's wish, and the line-up */
  const grp = new Map(machines.map(m => [m, groupOf(m.name)]));
  const gx = new Map(), gy = new Map();
  for(const m of machines){ const g = grp.get(m);
    gx.set(g, (gx.get(g) || 0) + Math.cos(wish.get(m))); gy.set(g, (gy.get(g) || 0) + Math.sin(wish.get(m))); }
  const gang = new Map([...gx.keys()].map(g => [g, Math.atan2(gy.get(g), gx.get(g))]));
  const inGroup = m => wrap(wish.get(m) - gang.get(grp.get(m)));   /* its wish, seen from its group's */
  const line = machines.slice().sort((a, b) => (gang.get(grp.get(a)) - gang.get(grp.get(b))) ||
    (grp.get(a) < grp.get(b) ? -1 : grp.get(a) > grp.get(b) ? 1 : 0) ||
    (inGroup(a) - inGroup(b)) || (a.id < b.id ? -1 : 1));
  /* 4. the seats, turned to face the wishes: the arrow average of (wish - seat) */
  const n = line.length;
  let sx = 0, sy = 0;
  line.forEach((m, i) => { const d = wish.get(m) - TAU * i / n; sx += Math.cos(d); sy += Math.sin(d); });
  const turn = Math.atan2(sy, sx);
  line.forEach((m, i) => { m.ang = turn + TAU * i / n; });
  const gorder = [];
  for(const m of line) if(gorder[gorder.length - 1] !== grp.get(m)) gorder.push(grp.get(m));
  NET_TEST = {users:uo.map(i => people[i].name), groups:gorder, turnDeg:Math.round(turn * 180 / Math.PI)};
  const cx = W / 2, cy = H / 2;
  const R = Math.max(80, Math.min(W, H) / 2 - NET_PAD - 12);
  const r = R * 0.66;
  for(const u of people){ u.x = cx + R * Math.cos(u.ang); u.y = cy + R * Math.sin(u.ang);
                          u.vx = u.vy = 0; u.ring = 0; }
  for(const m of machines){ m.x = cx + r * Math.cos(m.ang); m.y = cy + r * Math.sin(m.ang);
                            m.vx = m.vy = 0; }
}
