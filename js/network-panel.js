/* WHO WAS ON WHAT: the network diagram on the page, its by-hour and by-month tabs,
   selecting people and dragging them about.
   It used to be a panel that slid in from the right; it is a chart on the page now,
   between the Users picker and the Time arcs. The Time arcs were a third tab here once;
   they are their own band (js/arcs.js) and reach back through NETPANEL.toggle.
   Needs: D, NT (config.js), SEL, USERCOL (selection.js), draw, network-layout.js. */

/* ---- the network chart: who was on which machine -----------------------
   A circle is a person, a square is a machine, and a line between them means
   that person held that machine. Machines only one person holds sit on a ring around
   that person, all the same distance out and evenly spread, so each person reads as one
   sunburst; machines shared between people are left to the forces, between them. Five
   tabs share the box, in this order:
     Summarization                  - the month in numbers and the hours used per day
                                      (js/summary.js); nothing there can be clicked
     Time arcs                      - js/arcs.js
     Network Chart by Hour          - the links of the hour the slider sits on
     Network Chart by Month (rings) - the same month, laid out by the by-hour rules: a
                                      person's own machines on a ring around them
     Network Chart by Month         - every link of the month, drawn as a ring of people
                                      round a ring of machines, thicker the longer held
   Clicking a circle does what ticking the old checkbox did - SEL plus a
   redraw - so the heatmap highlights that person's whole month. */
function initNetworkPanel(){
  const svg   = document.getElementById('netsvg');
  const tip   = document.getElementById('nettip');
  const empty = document.getElementById('netempty');
  const range = document.getElementById('nettime');
  const txt   = document.getElementById('nettxt');
  const chips = document.getElementById('netchiplist');   /* the people; ALL sits before them */
  const allb  = document.getElementById('netall');
  const hourCtl  = document.getElementById('nethourctl');
  const stamp0   = document.getElementById('netstamp');
  const tabHour  = document.getElementById('nettabHour');
  const tabMonth = document.getElementById('nettabMonth');
  const tabMonthR = document.getElementById('nettabMonthR');   /* the month, by-hour rules */
  const tabBip = document.getElementById('nettabBip');         /* people over machines, similar ones together */
  const tabBipL = document.getElementById('nettabBipL');       /* the same in rows of groups (netBipLayers) */
  const tabArcs = document.getElementById('nettabArcs');       /* the Time arcs band */
  const tabSum  = document.getElementById('nettabSum');        /* the summary, first */
  const sumscroll = document.getElementById('sumscroll');
  const netscroll = document.getElementById('netscroll');
  const arcscroll = document.getElementById('arcscroll');
  const arcTools = document.getElementById('arcTools');
  const netwrap  = document.getElementById('netwrap');
  const NS = 'http://www.w3.org/2000/svg';

  /* ---- who held what. One pass over the rows: a machine held with both a
     CPU row and a GPU row are two links - the heatmap gives each of those a row and so
     does this, keyed by the heatmap's own groupKey() - the node's readings ride along for
     the hover, and every hour a link exists adds one to its month total. ---- */
  const LINKS = [], LOAD = [];
  for(let h = 0; h < NT; h++){ LINKS.push([]); LOAD.push(new Map()); }
  const MONTHH = new Map();          /* 'user node' -> hours held in the month */
  (function index(){
    const seen = [];
    for(let h = 0; h < NT; h++) seen.push(new Set());
    D.rows.forEach((r, k0) => {
      const slot = r.m === 'gpu' ? 1 : 0;
      const id = groupKey(k0, 'node');        /* rpg-93-1#gpu for a GPU row, else the name */
      const mark = (h, v) => {
        const k = r.u + ' ' + id;
        if(!seen[h].has(k)){
          seen[h].add(k); LINKS[h].push([r.u, id]);
          MONTHH.set(k, (MONTHH.get(k) || 0) + 1);
        }
        /* the readings belong to the one physical node, so they are kept under its name */
        let L = LOAD[h].get(r.n);
        if(!L){ L = [null, null]; LOAD[h].set(r.n, L); }
        L[slot] = v;
      };
      for(let j = 0; j < r.i.length; j++) mark(r.i[j], r.a[j]);
      for(const h of (r.g || [])) mark(h, 0);      /* held, but no reading */
    });
  })();
  const MONTH = [...MONTHH].map(([k, c]) => { const s = k.split(' '); return [s[0], s[1], c]; });

  /* The Bipartite Graph draws the month with its machines in seven groups: H100 (both sides of every H100 node together) and the Zen4 racks rpc-91,
     rpc-92, rpc-94, rpc-95, rpc-96, rpc-97 (arcGroupOf in arcs.js, with its two H100
     groups merged). Every person who held a machine of a group has one line to that group,
     all lines equally slim; their node-hours (an H100 node held on its CPU and GPU side in
     the same hour counts once) are kept on the line for ordering and placing. */
  const GROUPS = new Map();            /* group name -> {machines, users} */
  /* the group of a machine id (rpg-93-1#gpu, rpc-91-4 ...): H100, or its Zen4 rack */
  const groupOfMachine = m => {
    const g = arcGroupOf(plainName(m), m.indexOf(GPU_SFX) > 0);
    return g.indexOf('H100') === 0 ? 'H100' : g;
  };
  /* each group's colour on the Original (2 rings) view: the first seven slots of a
     categorical palette, in the groups' fixed order, never cycled */
  const GROUP_COL = new Map([['H100', '#3987e5'], ['rpc-91', '#d95926'], ['rpc-92', '#199e70'],
    ['rpc-94', '#c98500'], ['rpc-95', '#d55181'], ['rpc-96', '#008300'], ['rpc-97', '#9085e9']]);
  const GROUPED = (function group(){
    const out = new Map();             /* 'person group' -> node-hours */
    for(let h = 0; h < NT; h++){
      const seen = new Set();          /* a node counts once an hour, whichever side */
      for(const [u, m] of LINKS[h]){
        const node = plainName(m);
        const key = groupOfMachine(m);
        if(!GROUPS.has(key)) GROUPS.set(key, {machines:new Set(), users:new Set(), byUser:new Map()});
        const G = GROUPS.get(key);
        G.machines.add(node); G.users.add(u);
        if(!G.byUser.has(u)) G.byUser.set(u, new Set());
        G.byUser.get(u).add(node);         /* which of its machines each person held */
        if(seen.has(u + ' ' + node)) continue;
        seen.add(u + ' ' + node);
        out.set(u + ' ' + key, (out.get(u + ' ' + key) || 0) + 1);
      }
    }
    return [...out].map(([k, c]) => { const i = k.indexOf(' '); return [k.slice(0, i), k.slice(i + 1), c]; });
  })();
  let MAXH = 1;
  for(const l of MONTH) if(l[2] > MAXH) MAXH = l[2];
  let GUMAX = 1;                       /* the most node-hours one person spent on one group */
  for(const l of GROUPED) if(l[2] > GUMAX) GUMAX = l[2];

  /* the GPU side of an H100 node is drawn as a triangle, its CPU side and every other
     machine as a square - the same two shapes the heatmap's two sections stand for */
  const GPUNODE = new Set();
  D.rows.forEach((r, k0) => { if(r.m === 'gpu') GPUNODE.add(groupKey(k0, 'node')); });
  /* what to call a machine on screen: 'rpg-93-1 GPU' and 'rpg-93-1 CPU' for the two sides
     of an H100 node, its own name for everything else. The rule lives in arcs.js, so the
     two charts cannot end up calling the same thing by different names. */
  const netLabel = id => arcLabelOf(id, GPUNODE.has(id));

  /* open on the busiest hour, so the panel says something as soon as it opens */
  range.max = NT - 1;
  let hour = 0;
  for(let h = 0, best = -1; h < NT; h++)
    if(LINKS[h].length > best){ best = LINKS[h].length; hour = h; }
  range.value = hour;

  let MODE = 'summary';                    /* the page opens on the Summarization tab */
  let M0TEST = false;                      /* the 'month0' drawing is the Test view (netCircleTest) */
  let BIPLAYERS = false;                   /* the 'bip' drawing is Users & Groups (layers) */
  const POSBY = {hour:new Map(), monthr:new Map(), month:new Map(), month0:new Map(), bip:new Map()};   /* each tab keeps its own layout */
  let POS = POSBY.hour;
  let NODES = [], EDGES = [], LIVE = new Set(), PRESENT = new Set();
  let raf = 0, spin = 0, spin0 = 1;
  const shown = true;                      /* the chart is on the page: always drawing */
  const monthly = () => MODE === 'month' || MODE === 'month0' || MODE === 'monthr' || MODE === 'bip';   /* the month tabs */
  const grouped = () => MODE === 'bip';   /* the month in seven machine groups */
  /* worked out once, not settled by pushing: nothing to drag, a press is a click */
  const fixed = () => MODE === 'month' || MODE === 'month0' || MODE === 'bip';
  const solved = fixed;
  /* Extra layout rules for a tab (network-layout.js). None is in use. */
  const layoutOpt = () => null;
  /* Network Chart by Month links people to groups (and groups to machines, added in build) */
  const linksNow = () => (grouped() || MODE === 'month') ? GROUPED : (monthly() ? MONTH : LINKS[hour]);
  const fmt = n => n.toLocaleString('en-US');

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const two = n => (n < 10 ? '0' : '') + n;
  /* the day over the hour, on two lines, so it fits the room the label gutter leaves left of
     the slider; the whole date, year included, is its tooltip */
  function stamp(){
    const d = new Date(D.ts[hour]);
    const day = DAY[d.getUTCDay()] + ' ' + two(d.getUTCDate()) + ' ' + MON[d.getUTCMonth()];
    const hh = two(d.getUTCHours()) + ':00 UTC';
    txt.replaceChildren();
    for(const s of [day, hh]){ const e = document.createElement('span'); e.textContent = s; txt.append(e); }
    txt.title = day + ' ' + d.getUTCFullYear() + ', ' + hh;
  }

  /* ---- the picture for the chosen hour, or for the whole month ---- */
  function build(settle){
    if(MODE === 'arcs' || MODE === 'summary') return;   /* those two draw themselves */
    const W = svg.clientWidth || 336, H = svg.clientHeight || 320;
    const ls = linksNow();
    const people = new Set(), machines = new Set();
    for(const l of ls){ people.add(l[0]); machines.add(l[1]); }
    PRESENT = new Set(people);             /* who is really here */
    for(const u of SEL) people.add(u);     /* a selected person stays on screen when idle */
    const rnd = netSeed(monthly() ? 987654321 : hour * 2654435761 + 12345);
    const idx = new Map(), fresh = [];
    NODES = [];
    const put = (id, kind, name) => {
      let p = POS.get(id);
      if(!p){ p = {x:W * (0.25 + 0.5 * rnd()), y:H * (0.15 + 0.7 * rnd()), vx:0, vy:0};
              POS.set(id, p); fresh.push(p); }
      p.id = id; p.kind = kind; p.name = name; p.deg = 0; p.hrs = 0; p.pin = false;
      idx.set(id, NODES.length); NODES.push(p);
    };
    [...people].sort().forEach(u => put('u ' + u, 'u', u));
    [...machines].sort().forEach(n => put('m ' + n, 'm', n));
    EDGES = [];
    for(const l of ls){
      const a = NODES[idx.get('u ' + l[0])], b = NODES[idx.get('m ' + l[1])];
      const hrs = l[2] || 0;
      a.deg++; b.deg++; a.hrs += hrs; b.hrs += hrs;
      /* month lines grow with the hours held; hour lines are all the same, and so are the
         bipartite graph's, all equally slim */
      const w = grouped() ? BIP_LINE
              : MODE === 'month' ? 0.6 + 2.4 * Math.sqrt(hrs / GUMAX)
              : monthly() ? 0.5 + 2.3 * Math.sqrt(hrs / MAXH) : 1.1;
      EDGES.push({a:a, b:b, u:l[0], n:l[1], hrs:hrs, w:w});
    }
    /* Network Chart by Month is three rings: the people link to the groups they used (the
       lines above), and every machine links to its own group, and to nothing else. The
       machine keeps who held it and for how long, for its hover box. */
    if(MODE === 'month'){
      const held = new Map();                  /* machine -> {who, hours} */
      for(const [u, m, c] of MONTH){
        if(!held.has(m)) held.set(m, {who:new Set(), hrs:0});
        const h = held.get(m); h.who.add(u); h.hrs += c;
      }
      [...held.keys()].sort().forEach(m => put('n ' + m, 'm', m));
      for(const [m, h] of held){
        const b = NODES[idx.get('n ' + m)], a = NODES[idx.get('m ' + groupOfMachine(m))];
        if(!a || !b) continue;
        b.deg++; b.who = h.who.size; b.users = h.who; b.mh = h.hrs; b.gname = a.name;
        EDGES.push({a:a, b:b, u:null, n:m, hrs:0, w:0.7});
      }
    }
    /* a node that has just appeared starts among the ones it links to, so the
       picture drifts from hour to hour instead of jumping */
    const isNew = new Set(fresh);
    for(const p of fresh){
      let sx = 0, sy = 0, k = 0;
      for(const e of EDGES){
        const o = e.a === p ? e.b : (e.b === p ? e.a : null);
        if(o && !isNew.has(o)){ sx += o.x; sy += o.y; k++; }
      }
      if(k){ p.x = sx / k + (rnd() - 0.5) * 30; p.y = sy / k + (rnd() - 0.5) * 30; }
    }
    LIVE = people;
    /* which machines hang off one person only, and how wide a ring each person needs */
    netRings(NODES, EDGES, W, H, layoutOpt());
    /* the month tab is too crowded for that: it is drawn as three rings instead - people,
       groups, machines (netTriRing). The other month tab keeps the by-hour rules, so it is
       left alone here. */
    if(MODE === 'month'){
      for(const p of NODES){ p.spoke = null; p.spokes = null; p.pair = null; p.hub = null; p.ring = 0; }
      netTriRing(NODES, EDGES, W, H);
    }
    /* its "Original (2 rings)" view: people round a ring of machines, as before the groups
       (netCircle); the machines are painted in their group's colour */
    if(MODE === 'month0'){
      for(const p of NODES){ p.spoke = null; p.spokes = null; p.pair = null; p.hub = null; p.ring = 0; }
      /* Test: people in the Users & Groups order, each group's machines together */
      if(M0TEST) netCircleTest(NODES, EDGES, W, H, groupOfMachine, GROUPED);
      else netCircle(NODES, EDGES, W, H);
    }
    /* Users & Groups: two rows of people round the groups; Users & Groups (layers): n rows of
       groups between n + 1 rows of people. The two share the nodes, so what one sets on
       them (a circle's size cap, a row) is cleared first. */
    if(MODE === 'bip'){
      for(const p of NODES){ p.spoke = null; p.spokes = null; p.pair = null; p.hub = null; p.ring = 0;
                             p.Rcap = null; p.layer = null; p.side = null; }
      if(BIPLAYERS) netBipLayers(NODES, EDGES, W, H);
      else netBipartite(NODES, EDGES, W, H);
    }
    empty.classList.toggle('on', MODE === 'hour' && ls.length === 0);
    paint();
    /* the circle settles nothing: every place there is worked out, not found by pushing.
       The month drawn by the by-hour rules settles like the hour does, but for longer -
       it has every machine of the month in it, not one hour's worth. */
    spin = spin0 = solved() ? 0
                 : (settle === undefined ? (MODE === 'monthr' ? 320 : 170) : settle);
    if(shown){ if(!raf) raf = setTimeout(tick, 16); }
    else { for(let i = 0; i < 90 && spin > 0; i++, spin--) netStep(NODES, EDGES, W, H, spin / spin0, layoutOpt());
           place(); }
  }

  /* ---- the shapes ---- */
  function paint(){
    while(svg.firstChild) svg.removeChild(svg.firstChild);
    const gl = document.createElementNS(NS, 'g');
    const gm = document.createElementNS(NS, 'g');
    const gu = document.createElementNS(NS, 'g');
    const gt = document.createElementNS(NS, 'g');
    svg.append(gl, gm, gu, gt);
    for(const e of EDGES){
      const l = document.createElementNS(NS, 'path');
      l.setAttribute('class', 'lk');
      l.setAttribute('fill', 'none');
      l.setAttribute('stroke', USERCOL.get(e.u) || '#8fa6c0');
      gl.append(l); e.el = l; l.__e = e;       /* the line knows its link, for checks */
    }
    let nm = 0;
    for(const p of NODES) if(p.kind === 'm') nm++;
    const small = nm > 30;               /* many machines: same names, smaller type */
    for(const p of NODES){
      const person = p.kind === 'u';
      const col = person ? (USERCOL.get(p.name) || '#8fa6c0') : '#9fb3c8';
      let el;
      if(person){
        /* head and shoulders, drawn in a box one unit each way and scaled to size */
        p.r = 5 + Math.min(5, Math.sqrt(p.deg) * 1.6);
        el = document.createElementNS(NS, 'g');
        const head = document.createElementNS(NS, 'circle');
        head.setAttribute('cx', 0); head.setAttribute('cy', -0.52); head.setAttribute('r', 0.36);
        const body = document.createElementNS(NS, 'path');
        body.setAttribute('d', 'M-0.92,0.96 C-0.92,0.16 -0.5,-0.08 0,-0.08 ' +
                               'C0.5,-0.08 0.92,0.16 0.92,0.96 Z');
        el.append(head, body);
        el.setAttribute('data-u', p.name);
        gu.append(el);
      } else if(GROUPS.has(p.name) && MODE === 'bip'){
        /* The bipartite graph: a group is a circle with its machines floating inside, as
           big as it needs for them. Its name shows on hover. bipInner() moves the machines
           when people are picked, and draws a line from each machine a picked person held
           to where that person's line meets the circle. */
        p.grp = GROUPS.get(p.name); p.gpu = false;
        const nodes = [...p.grp.machines].sort((a, b) => a.localeCompare(b, undefined, {numeric:true}));
        p.R = 32 + 8.5 * Math.sqrt(nodes.length);   /* 20 machines: 70 px, 8: 56 px */
        if(p.Rcap) p.R = Math.min(p.R, p.Rcap);      /* (layers): no bigger than fits between rows */
        p.r = p.R;
        el = document.createElementNS(NS, 'g');
        const ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('r', p.R);
        ring.setAttribute('fill', 'rgba(12,19,29,.92)');
        ring.setAttribute('stroke', col); ring.setAttribute('stroke-width', '1.2');
        const lines = document.createElementNS(NS, 'g');
        lines.setAttribute('pointer-events', 'none');
        const dots = document.createElementNS(NS, 'g');
        el.append(ring, lines, dots);
        p.innerLines = lines;
        /* at rest the machines are spread evenly over the circle (a sunflower pattern) */
        const room = p.R - 10;
        p.inner = nodes.map((name, i) => {
          const r = room * Math.sqrt((i + 0.5) / nodes.length), a = i * 2.39996;
          const m = {name:name, hx:r * Math.cos(a), hy:r * Math.sin(a)};
          m.x = m.hx; m.y = m.hy;
          const sq = document.createElementNS(NS, 'rect');
          sq.setAttribute('width', 8); sq.setAttribute('height', 8);
          sq.setAttribute('fill', 'rgba(20,32,46,1)'); sq.setAttribute('stroke', '#9fb3c8');
          sq.setAttribute('stroke-width', '0.9');
          sq.__mach = {name:name, grp:p.grp};
          dots.append(sq); m.el = sq;
          return m;
        });
        gm.append(el);
      } else if(GROUPS.has(p.name) && MODE === 'month'){
        /* Network Chart by Month: a group on the middle ring - a circle, a little bigger
           for more machines, its name shown on hover */
        p.grp = GROUPS.get(p.name); p.gpu = false;
        p.r = 12 + 0.4 * p.grp.machines.size;
        el = document.createElementNS(NS, 'circle');
        el.setAttribute('r', p.r.toFixed(1));
        el.setAttribute('fill', 'rgba(12,19,29,.95)');
        el.setAttribute('stroke', '#cfe0f5'); el.setAttribute('stroke-width', '1.3');
        gm.append(el);
      } else if(GROUPS.has(p.name)){
        /* a group: a box as big as the number of machines in it, its name written on it,
           and never narrower than the name */
        p.grp = GROUPS.get(p.name); p.gpu = false;
        const side = 10 + 3.2 * Math.sqrt(p.grp.machines.size);
        const hw = Math.max(side, 4 + 3.3 * p.name.length), hh = side;
        p.r = Math.max(hw, hh);
        el = document.createElementNS(NS, 'g');
        const box = document.createElementNS(NS, 'rect');
        box.setAttribute('width', 2 * hw); box.setAttribute('height', 2 * hh);
        box.setAttribute('x', -hw); box.setAttribute('y', -hh); box.setAttribute('rx', 4);
        box.setAttribute('fill', 'rgba(12,19,29,.92)');
        box.setAttribute('stroke', col); box.setAttribute('stroke-width', '1.2');
        const n = document.createElementNS(NS, 'text');
        n.textContent = p.name;
        n.setAttribute('class', 'gcount');
        n.setAttribute('text-anchor', 'middle'); n.setAttribute('dy', '0.35em');
        n.setAttribute('fill', '#dbe7f3'); n.setAttribute('pointer-events', 'none');
        n.setAttribute('font-size', '10.5');
        el.append(box, n);
        gm.append(el);
      } else {
        p.gpu = GPUNODE.has(p.name);
        p.r = p.gpu ? 6.4 : 4.8;
        el = document.createElementNS(NS, p.gpu ? 'polygon' : 'rect');
        if(!p.gpu){ el.setAttribute('width', 9.6); el.setAttribute('height', 9.6); }
        /* the Original (2 rings) view paints a machine in its group's colour */
        p.gcol = MODE === 'month0' ? GROUP_COL.get(groupOfMachine(p.name)) : null;
        if(p.gcol){
          el.setAttribute('fill', p.gcol); el.setAttribute('fill-opacity', '0.35');
          el.setAttribute('stroke', p.gcol); el.setAttribute('stroke-width', '1.4');
        } else {
          el.setAttribute('fill', 'rgba(12,19,29,.85)');
          el.setAttribute('stroke', col); el.setAttribute('stroke-width', '1.1');
        }
        el.setAttribute('data-m', p.name);
        gm.append(el);
      }
      el.setAttribute('class', 'nn');
      el.__n = p; p.el = el;
      /* Every name is made, and none of them is shown: a hundred names over one drawing
         is a smudge. Hovering a person or a machine shows that one (see hover). */
      const t = document.createElementNS(NS, 'text');
      t.textContent = person ? p.name
        : p.grp ? (MODE === 'bip' || MODE === 'month' ? p.name : '')   /* a circle's name shows on hover; a box carries it */
        : netLabel(p.name);
      t.setAttribute('fill', person ? col : '#cfe0f5');
      t.setAttribute('pointer-events', 'none');
      /* names show on hover only; on the bipartite graph they slant away from the groups */
      t.setAttribute('class', 'nlab' + (!person && small ? ' sm' : ''));
      gt.append(t); p.lab = t;
    }
    restyle();
    place();
  }

  /* a line's resting look: selected people's lines stand out, and the month's
     many lines are fainter so the picture does not turn into one blur */
  /* FOCUS (applyFocus): the people in focus and what they are linked to; lines outside it
     fade */
  let FOCUS = null;
  const restOpacity = e => {
    if(FOCUS){
      if(e.u) return FOCUS.users.has(e.u) ? 0.95 : 0.04;   /* a person's line */
      return FOCUS.machines.has(e.b) ? 0.9 : 0.04;         /* a group's line to a machine */
    }
    return SEL.has(e.u) ? 0.95
      : grouped() ? 0.5
      : MODE === 'month' ? (e.u ? 0.45 : 0.3)       /* person-group lines, group-machine lines */
      : monthly() ? 0.22 : 0.42;
  };
  /* A line keeps its width whatever is picked or hovered, on every tab (2026-09-29, the
     user's request; the bipartite graph always did): colour and opacity alone say which are
     picked. The bipartite graphs draw every line the same width. */
  const BIP_LINE = 1;
  const restWidth   = e => e.w;

  /* colour and weight only - nothing moves, so selecting never rearranges */
  /* The focus: with people picked - or, on the two month views, a person hovered - what they
     are linked to stays and everything else fades.
       Current (3 rings)   their lines to their groups, those groups' lines to the machines
                           they used (in their colour; a light one when several in focus
                           used it), those groups and those machines
       Original (2 rings)  their lines to machines, and those machines
       Users & Groups      their lines and their groups (the machines inside follow, bipInner)
     users is a Set of names, or null for no focus. */
  function applyFocus(users){
    const focusing = MODE === 'month' || MODE === 'month0' || MODE === 'bip';
    FOCUS = null;
    if(focusing && users && users.size){
      const groups = new Set(), machines = new Set();
      for(const e of EDGES) if(e.u && users.has(e.u)) (MODE === 'month0' ? machines : groups).add(e.b);
      if(MODE === 'month')
        for(const p of NODES) if(p.users && [...p.users].some(u => users.has(u))) machines.add(p);
      FOCUS = {users, groups, machines};
    }
    if(focusing)
      for(const p of NODES){
        if(p.kind !== 'm') continue;
        const on = !FOCUS || (p.grp ? FOCUS.groups.has(p) : FOCUS.machines.has(p));
        p.el.setAttribute('opacity', on ? '1' : '0.12');
      }
    if(MODE === 'month')
      for(const e of EDGES){
        if(e.u) continue;
        let col = '#8fa6c0';
        if(FOCUS && FOCUS.machines.has(e.b)){
          const who = [...e.b.users].filter(u => FOCUS.users.has(u));
          col = who.length === 1 ? (USERCOL.get(who[0]) || '#cfe0f5') : '#cfe0f5';
        }
        e.el.setAttribute('stroke', col);
      }
    for(const e of EDGES){
      e.el.setAttribute('stroke-opacity', restOpacity(e));
      e.el.setAttribute('stroke-width', restWidth(e));
    }
  }

  function restyle(){
    applyFocus(SEL.size ? SEL : null);
    for(const p of NODES){
      if(p.kind !== 'u') continue;
      const sel = SEL.has(p.name), col = USERCOL.get(p.name) || '#8fa6c0';
      p.el.setAttribute('fill', sel ? col : 'rgba(12,19,29,.9)');
      p.el.setAttribute('stroke', col);
      p.el.setAttribute('stroke-width', (sel ? 0.34 : 0.2).toFixed(2));   /* in glyph units */
      p.el.setAttribute('opacity', p.deg ? '1' : '0.45');    /* selected but idle */
      if(p.lab) p.lab.setAttribute('font-weight', sel ? '700' : '400');
    }
    if(MODE === 'bip') bipInner();     /* the machines inside the circles follow the picks */
  }

  /* ---- Bipartite Graph: the machines inside each group's circle ----
     Nobody picked: the machines rest spread evenly over the circle. Someone picked:
       1. sectors by who held it - each machine's label is the set of picked people who held
          it ("A", "B", "A and B"). Every label gets a slice of the circle, as wide as its
          number of machines, the slices in the order of the people's entry points round the
          circle and turned so each sits as near as it can to its own entry point(s)
       2. a fan from the entry point - within its slice, each machine gets its own direction
          from the entry point (the middle of them for a shared label) and alternating
          distances, so one person's lines share an end, never cross, and do not run under
          another square; together the fans cover the whole circle
       3. machines no picked person held take the slice left over, away from the entry
          points, and are dimmed
     A line in the person's colour joins each machine to their entry point. The machines
     glide there over about half a second, then are kept at least 13 px apart. */
  let innerTimer = 0;
  const wrap = a => { while(a <= -Math.PI) a += 2 * Math.PI; while(a > Math.PI) a -= 2 * Math.PI; return a; };
  function bipTargets(g){
    const into = EDGES.filter(e => e.b === g && SEL.has(e.u) && e.anchor);
    const lim = g.R - 9;
    for(const m of g.inner){ m.on = false; m.dim = false; m.tx = m.hx; m.ty = m.hy; }
    if(!into.length) return;
    /* 1. the labels: which picked people held each machine */
    const sigs = new Map();
    for(const m of g.inner){
      const who = into.filter(e => { const s = g.grp.byUser.get(e.u); return s && s.has(m.name); });
      const key = who.map(e => e.u).sort().join(',');
      if(!sigs.has(key)) sigs.set(key, {edges:who, list:[]});
      sigs.get(key).list.push(m);
    }
    const parts = [];
    for(const [key, s] of sigs){
      if(key){
        let x = 0, y = 0;
        for(const e of s.edges){ x += Math.cos(e.ang); y += Math.sin(e.ang); }
        s.ang = Math.atan2(y, x);                        /* the middle of its entry points */
        s.A = [lim * Math.cos(s.ang), lim * Math.sin(s.ang)];
        if(s.edges.length === 1) s.A = [s.edges[0].anchor[0], s.edges[0].anchor[1]];
      }
      s.key = key; s.list.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric:true}));
      parts.push(s);
    }
    const used = parts.filter(s => s.key).sort((a, b) => a.ang - b.ang);
    const idle = parts.find(s => !s.key);
    const N = g.inner.length;
    /* the slices: consecutive, widths by count; the idle slice closes the ring. Turn the
       ring so each used slice's middle is as near as it can be to its label's angle. */
    const width = s => 2 * Math.PI * s.list.length / N;
    let best = null;
    for(let t = 0; t < 144; t++){
      let a = -Math.PI + 2 * Math.PI * t / 144, cost = 0;
      const at = [];
      for(const s of used){ const mid = a + width(s) / 2; at.push([a, a + width(s)]); cost += s.list.length * Math.abs(wrap(mid - s.ang)); a += width(s); }
      if(!best || cost < best.cost) best = {cost, at, end:a};
    }
    used.forEach((s, j) => { s.a0 = best.at[j][0]; s.a1 = best.at[j][1]; });
    if(idle){ idle.a0 = best.end; idle.a1 = best.end + width(idle); }
    /* 2. a fan from the entry point over its own slice */
    for(const s of used){
      const [ax, ay] = s.A;
      /* the directions from the entry point to the slice: sample the slice and take the
         range of angles seen from the entry point */
      const dirs = [];
      for(let i = 0; i <= 8; i++) for(const rr of [0.25, 0.6, 0.95]){
        const t = s.a0 + (s.a1 - s.a0) * i / 8;
        dirs.push(Math.atan2(lim * rr * Math.sin(t) - ay, lim * rr * Math.cos(t) - ax));
      }
      const inward = Math.atan2(-ay, -ax);
      const rel = dirs.map(d => wrap(d - inward)).filter(d => Math.abs(d) < 1.45);
      const lo = rel.length ? Math.min(...rel) : -1.3, hi = rel.length ? Math.max(...rel) : 1.3;
      const n = s.list.length;
      s.list.forEach((m, k) => {
        const phi = inward + lo + (hi - lo) * (n === 1 ? 0.5 : (k + 0.5) / n);
        /* the stretch of this direction that lies inside the label's own slice, so one
           label's fan never reaches into another's; the machine sits at its depth share of
           that stretch */
        const ux = Math.cos(phi), uy = Math.sin(phi);
        const b = ax * ux + ay * uy, c = ax * ax + ay * ay - lim * lim;
        const chord = Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
        let t0 = -1, t1 = -1;
        for(let t = 0; t <= chord; t += 2){
          const px = ax + ux * t, py = ay + uy * t, r = Math.hypot(px, py);
          if(r > lim || r < 6) continue;
          const off = ((Math.atan2(py, px) - s.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
          if(off <= s.a1 - s.a0 + 0.02 || off >= 2 * Math.PI - 0.02){
            if(t0 < 0) t0 = t; t1 = t;
          }
        }
        if(t0 < 0){ t0 = chord * 0.3; t1 = chord * 0.85; }   /* the slice missed: whole chord */
        const layer = NET_FAN_DEPTH[k % NET_FAN_DEPTH.length];   /* neighbours at different depths */
        const d = Math.max(16, t0 + (t1 - t0) * layer);
        m.tx = ax + ux * d; m.ty = ay + uy * d; m.on = true;
      });
    }
    /* 3. the rest: spread over the leftover slice, dimmed */
    if(idle){
      const n = idle.list.length;
      idle.list.forEach((m, k) => {
        const t = idle.a0 + (idle.a1 - idle.a0) * (k + 0.5) / n;
        const r = lim * [0.85, 0.55, 0.7, 0.35][k % 4];
        m.tx = r * Math.cos(t); m.ty = r * Math.sin(t); m.dim = true;
      });
    }
  }
  function bipInner(){
    const groups = NODES.filter(p => p.inner);
    for(const g of groups) bipTargets(g);
    if(innerTimer) clearTimeout(innerTimer);
    /* push apart and keep inside, together, so a push never ends outside the circle */
    const separate = (g, passes) => {
      const lim = g.R - 8, gap = 13, list = g.inner;
      for(let pass = 0; pass < passes; pass++){
        let moved = false;
        for(let i = 0; i < list.length; i++) for(let j = i + 1; j < list.length; j++){
          const a = list[i], b = list[j];
          let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
          if(d >= gap) continue;
          if(d < 0.01){ dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
          const k = (gap - d) / d / 2;
          a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k;
          moved = true;
        }
        for(const m of list){
          const d = Math.hypot(m.x, m.y);
          if(d > lim){ m.x *= lim / d; m.y *= lim / d; }
        }
        if(!moved) break;
      }
    };
    let frames = 36;
    const step = () => {
      innerTimer = 0;
      const last = --frames <= 0;
      for(const g of groups){
        for(const m of g.inner){ m.x += (m.tx - m.x) * 0.15; m.y += (m.ty - m.y) * 0.15; }
        /* the pull stops at the end and the machines are left no closer than their gap */
        separate(g, last ? 80 : 4);
      }
      bipInnerDraw(groups);
      if(!last) innerTimer = setTimeout(step, 16);
    };
    step();
  }
  function bipInnerDraw(groups){
    for(const g of groups){
      for(const m of g.inner){
        m.el.setAttribute('x', (m.x - 4).toFixed(1)); m.el.setAttribute('y', (m.y - 4).toFixed(1));
        m.el.setAttribute('stroke', m.on ? '#dbe7f3' : '#9fb3c8');
        m.el.setAttribute('opacity', m.dim ? '0.12' : '1');  /* held by none of the picked */
      }
      while(g.innerLines.firstChild) g.innerLines.removeChild(g.innerLines.firstChild);
      for(const e of EDGES){
        if(e.b !== g || !SEL.has(e.u) || !e.anchor) continue;
        const held = g.grp.byUser.get(e.u);
        if(!held) continue;
        for(const m of g.inner){
          if(!held.has(m.name)) continue;
          const l = document.createElementNS(NS, 'line');
          l.setAttribute('x1', m.x.toFixed(1)); l.setAttribute('y1', m.y.toFixed(1));
          l.setAttribute('x2', e.anchor[0].toFixed(1)); l.setAttribute('y2', e.anchor[1].toFixed(1));
          l.setAttribute('stroke', USERCOL.get(e.u) || '#8fa6c0');
          l.setAttribute('stroke-width', '1'); l.setAttribute('stroke-opacity', '0.85');
          g.innerLines.append(l);
        }
      }
    }
  }

  function place(){
    const W = svg.clientWidth || 336, H = svg.clientHeight || 320;
    /* Current (3 rings): each line runs between two neighbouring rings, leaving and arriving
       square to them. Original (2 rings), as it was: the lines are bent towards the middle -
       straight ones would all cross in the centre, bent ones lie beside each other. */
    const bend = MODE === 'month0' ? 0.74 : 0;
    const cx = W / 2, cy = H / 2;
    /* The bipartite graph: each line ends on its group's circle, not at the middle. The
       lines from the row above meet the upper half of the circle and those from below the
       lower half, spread along it in the order of their people from left to right, so no
       two arrive at one point. e.anchor is that point, from the circle's middle. */
    if(MODE === 'bip'){
      for(const g of NODES){
        if(!g.R) continue;
        const into = EDGES.filter(e => e.b === g);
        for(const up of [true, false]){
          const side = into.filter(e => (e.a.y < g.y) === up).sort((a, b) => a.a.x - b.a.x);
          const pad = 0.32, span = Math.PI - 2 * pad;
          side.forEach((e, k) => {
            const t = (k + 0.5) / side.length;
            const ang = up ? -Math.PI + pad + span * t : Math.PI - pad - span * t;
            e.ang = ang; e.anchor = [g.R * Math.cos(ang), g.R * Math.sin(ang)];
          });
        }
      }
    }
    for(const e of EDGES){
      /* an S-curve that leaves the person upright and meets the circle head on, so the
         lines to one group gather at it instead of fanning across the middle (Sugiyama's
         edge-routing step) */
      if(MODE === 'bip' && e.anchor){
        const ex = e.b.x + e.anchor[0], ey = e.b.y + e.anchor[1];
        const my = (e.a.y + ey) / 2, reach = Math.abs(e.a.y - ey) * 0.35;
        const c2x = ex + Math.cos(e.ang) * reach, c2y = ey + Math.sin(e.ang) * reach;
        e.el.setAttribute('d', 'M' + e.a.x.toFixed(1) + ',' + e.a.y.toFixed(1) +
                               'C' + e.a.x.toFixed(1) + ',' + my.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) +
                               ' ' + ex.toFixed(1) + ',' + ey.toFixed(1));
        continue;
      }
      if(MODE === 'month'){
        /* The line keeps to the band between its two rings: it leaves square to the ring,
           goes round the shorter way at the band's height and arrives square, so a line to
           a group across the circle runs round the ring instead of cutting through the
           middle. Two such lines cross exactly when the angle between them passes a whole
           turn on the way across, which is what netTriRing counts (netBandCross). */
        const ra = Math.hypot(e.a.x - cx, e.a.y - cy), rb = Math.hypot(e.b.x - cx, e.b.y - cy);
        const ta = Math.atan2(e.a.y - cy, e.a.x - cx), tb = Math.atan2(e.b.y - cy, e.b.x - cx);
        let dt = tb - ta;
        while(dt > Math.PI) dt -= 2 * Math.PI;
        while(dt < -Math.PI) dt += 2 * Math.PI;
        const steps = Math.min(64, Math.max(8, Math.ceil(Math.abs(dt) * 30)));
        let d = 'M' + e.a.x.toFixed(1) + ',' + e.a.y.toFixed(1);
        for(let i = 1; i <= steps; i++){
          const t = i / steps, s = t * t * (3 - 2 * t);     /* the angle turns in the middle */
          const r = ra + (rb - ra) * t, th = ta + dt * s;
          d += 'L' + (cx + r * Math.cos(th)).toFixed(1) + ',' + (cy + r * Math.sin(th)).toFixed(1);
        }
        e.el.setAttribute('d', d);
        continue;
      }
      if(!bend){
        e.el.setAttribute('d', 'M' + e.a.x.toFixed(1) + ',' + e.a.y.toFixed(1) +
                               'L' + e.b.x.toFixed(1) + ',' + e.b.y.toFixed(1));
        continue;
      }
      const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2;
      const qx = mx + (cx - mx) * bend, qy = my + (cy - my) * bend;
      e.el.setAttribute('d', 'M' + e.a.x.toFixed(1) + ',' + e.a.y.toFixed(1) +
                             'Q' + qx.toFixed(1) + ',' + qy.toFixed(1) +
                             ' ' + e.b.x.toFixed(1) + ',' + e.b.y.toFixed(1));
    }
    for(const p of NODES){
      if(p.kind === 'u')
        p.el.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) +
                                       ') scale(' + (p.r * 1.25).toFixed(2) + ')');
      else if(p.grp)
        p.el.setAttribute('transform', 'translate(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')');
      else if(p.gpu){
        const s = 6.6;
        p.el.setAttribute('points', p.x + ',' + (p.y - s) + ' ' +
          (p.x - s * 0.92) + ',' + (p.y + s * 0.7) + ' ' +
          (p.x + s * 0.92) + ',' + (p.y + s * 0.7));
      }
      else { p.el.setAttribute('x', p.x - 4.8); p.el.setAttribute('y', p.y - 4.8); }
      if(p.lab && MODE === 'bip' && p.kind === 'u' && p.side === 'bottom'){
        /* the row below the groups: the name slants down, under the figure */
        const tx = p.x + 2, ty = p.y + p.r * 1.4 + 10;
        p.lab.setAttribute('x', tx); p.lab.setAttribute('y', ty);
        p.lab.setAttribute('text-anchor', 'start');
        p.lab.setAttribute('transform', 'rotate(40 ' + tx.toFixed(1) + ' ' + ty.toFixed(1) + ')');
      }
      else if(p.lab && MODE === 'bip' && p.kind === 'u'){
        const tx = p.x + 2, ty = p.y - p.r * 1.4 - 4;
        p.lab.setAttribute('x', tx); p.lab.setAttribute('y', ty);
        p.lab.setAttribute('text-anchor', 'start');
        p.lab.setAttribute('transform', 'rotate(-40 ' + tx.toFixed(1) + ' ' + ty.toFixed(1) + ')');
      }
      else if(p.lab){
        const left = p.x > W / 2;          /* names point away from the middle */
        p.lab.setAttribute('x', left ? p.x - p.r - 4 : p.x + p.r + 4);
        p.lab.setAttribute('y', p.y + 3.3);
        p.lab.setAttribute('text-anchor', left ? 'end' : 'start');
      }
    }
    if(MODE === 'bip') bipInner();     /* the lines' end points on the circles are known now */
  }

  function tick(){
    raf = 0;
    const W = svg.clientWidth || 336, H = svg.clientHeight || 320;
    for(let i = 0; i < 5 && spin > 0; i++, spin--) netStep(NODES, EDGES, W, H, spin / spin0, layoutOpt());
    place();
    if(spin > 0 && shown) raf = setTimeout(tick, 16);
  }

  /* ---- hover ---- */
  function lift(p){
    for(const e of EDGES){
      const on = !p || e.a === p || e.b === p;
      e.el.setAttribute('stroke-opacity', p ? (on ? 1 : 0.06) : restOpacity(e));
      e.el.setAttribute('stroke-width',   restWidth(e));
    }
  }
  function reads(p){
    if(monthly()){
      if(p.grp){
        const g = p.grp;
        return p.name + ' · ' + g.machines.size + (g.machines.size === 1 ? ' machine' : ' machines') +
               ' · ' + g.users.size + (g.users.size === 1 ? ' person' : ' people') +
               ' · ' + fmt(p.hrs) + ' node-hours this month';
      }
      if(p.kind === 'u' && (grouped() || MODE === 'month'))
        return p.name + ' · on ' + p.deg + ' of ' + GROUPS.size + ' groups' +
               ' · ' + fmt(p.hrs) + ' node-hours this month';
      if(p.kind === 'u')
        return p.name + ' · ' + p.deg + (p.deg === 1 ? ' machine' : ' machines') +
               ' · ' + fmt(p.hrs) + ' node-hours this month';
      if(MODE === 'month')                          /* a machine on the inner ring */
        return netLabel(p.name) + ' · in ' + p.gname + ' · ' + p.who + (p.who === 1 ? ' person' : ' people') +
               ' · ' + fmt(p.mh) + ' hours held this month';
      if(MODE === 'month0')                         /* its group, as well as its colour */
        return netLabel(p.name) + ' · in ' + groupOfMachine(p.name) + ' · ' + p.deg +
               (p.deg === 1 ? ' person' : ' people') + ' · ' + fmt(p.hrs) + ' hours held this month';
      return netLabel(p.name) + ' · ' + p.deg + (p.deg === 1 ? ' person' : ' people') +
             ' · ' + fmt(p.hrs) + ' hours held this month';
    }
    if(p.kind === 'u')
      return p.name + ' · ' + (p.deg ? p.deg + (p.deg === 1 ? ' machine' : ' machines') +
                                       ' this hour' : 'not on the cluster this hour');
    const L = LOAD[hour].get(plainName(p.name)) || [null, null];
    const v = p.gpu ? L[1] : L[0];               /* its own side's reading, not both */
    let s = netLabel(p.name) + ' · ' + p.deg + (p.deg === 1 ? ' person' : ' people');
    if(v !== null && v !== undefined) s += ' · ' + v.toFixed(1) + '%' + (p.gpu ? ' GPU' : ' CPU');
    return s;
  }
  let HOVERED = null;
  function hover(p){
    /* On the two month views a hovered person is shown as a pick is (applyFocus); anything
       else hovered lights its own lines. The focus is only worked out again when what is
       under the pointer changes. */
    const same = p === HOVERED;
    HOVERED = p;
    if(MODE === 'month' || MODE === 'month0'){
      if(!same){
        applyFocus(p && p.kind === 'u' ? new Set([p.name]) : (SEL.size ? SEL : null));
        if(p && p.kind !== 'u') lift(p);
      }
    } else lift(p);
    /* the drawing carries no names until one is hovered */
    for(const q of NODES) if(q.lab) q.lab.setAttribute('class', q.lab.getAttribute('class').replace(' on', ''));
    if(!p){ tip.style.display = 'none'; return; }
    /* the bipartite graph says only the name, once, in the hover box; a group's name stands
       beside its circle, never over the machines and lines inside it */
    if(MODE === 'bip'){
      tip.textContent = p.name;
      if(p.R) placeTipBeside(tip, p.x + p.R + 8, p.x - p.R - 8, p.y);
      else placeTip(tip, p.x, p.y);
      return;
    }
    if(p.lab) p.lab.setAttribute('class', p.lab.getAttribute('class') + ' on');
    tip.textContent = reads(p);
    placeTip(tip, p.x, p.y);
  }
  /* Show the hover box over (x, y), but never past the panel's edges. A box that
     poked out at the side made the panel grow a scrollbar to make room for it. */
  function placeTip(t, x, y){
    t.classList.remove('beside');
    t.style.display = 'block';
    const sc = netwrap.parentNode;                 /* the box is placed inside the drawing,
       which can be taller than the panel: keep it within the part on screen */
    const W = netwrap.clientWidth, w = t.offsetWidth, h = t.offsetHeight;
    const top = sc.scrollTop + 4, bottom = sc.scrollTop + sc.clientHeight - 4;
    const cx = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, x));
    const cy = Math.max(top + h * 1.6, Math.min(bottom + h * 0.6, y));
    t.style.left = cx + 'px';
    t.style.top  = cy + 'px';
  }
  /* The hover box level with y, its left edge at `right` - just right of a circle. Only
     when that would run past the drawing's edge does it go left of the circle instead, its
     right edge at `left`. */
  function placeTipBeside(t, right, left, y){
    t.classList.add('beside');
    t.style.display = 'block';
    const W = netwrap.clientWidth, w = t.offsetWidth;
    t.style.left = (right + w <= W - 4 ? right : left - w) + 'px';
    t.style.top  = y + 'px';
  }

  /* ---- click to select, drag to move ---- */
  let drag = null, dragRaf = 0;
  const nodeAt = ev => { const el = ev.target.closest ? ev.target.closest('.nn') : null;
                         return el ? el.__n : null; };
  /* while something is being pulled the rest keeps moving, so its neighbours,
     and their neighbours, trail after it instead of jumping with it */
  function pullLoop(){
    dragRaf = 0;
    if(!drag) return;
    const W = svg.clientWidth || 336, H = svg.clientHeight || 320;
    netStep(NODES, EDGES, W, H, 0.4, layoutOpt());
    place();
    dragRaf = setTimeout(pullLoop, 16);
  }
  svg.addEventListener('pointerdown', ev => {
    const p = nodeAt(ev); if(!p) return;
    if(!fixed()) svg.style.cursor = '';
    ev.preventDefault();                    /* and no text gets selected on the way */
    drag = {p:p, x:ev.clientX, y:ev.clientY, moved:0};
    try { svg.setPointerCapture(ev.pointerId); } catch(e) {}   /* no live pointer: fine */
  });
  svg.addEventListener('pointermove', ev => {
    /* a machine inside a group's circle: its name and who held it this month */
    const mc = !drag && ev.target && ev.target.__mach;
    if(mc){
      hover(null);
      tip.textContent = mc.name;           /* the name only */
      const r = svg.getBoundingClientRect();
      placeTip(tip, ev.clientX - r.left, ev.clientY - r.top);
      return;
    }
    if(!drag){ hover(nodeAt(ev)); return; }
    drag.moved = Math.max(drag.moved,
      Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y));
    /* the month's places are worked out, not found by pushing, so dragging one out of
       its ring would only spoil the picture: there a press is a click and nothing else */
    if(fixed()) return;
    if(drag.moved > 4){
      const r = svg.getBoundingClientRect();
      drag.p.pin = true; drag.p.vx = 0; drag.p.vy = 0;
      drag.p.x = Math.max(NET_PAD, Math.min(r.width  - NET_PAD, ev.clientX - r.left));
      drag.p.y = Math.max(NET_PAD, Math.min(r.height - NET_PAD, ev.clientY - r.top));
      netSpace(NODES, r.width, r.height);   /* never drawn on top of another, even for a frame */
      place();
      if(!dragRaf) dragRaf = setTimeout(pullLoop, 16);
    }
  });
  svg.addEventListener('pointerup', () => {
    if(!drag) return;
    const p = drag.p, click = drag.moved <= 4;
    drag = null;
    if(dragRaf){ clearTimeout(dragRaf); dragRaf = 0; }
    if((click || fixed()) && p.kind === 'u') toggle(p.name);
    else if(fixed()) return;
    else if(shown){ spin = spin0 = 60;      /* and the rest settles again */
                    if(!raf) raf = setTimeout(tick, 16); }
  });
  svg.addEventListener('pointerleave', () => { if(!drag) hover(null); });

  /* ---- selecting: the same two lines the checkboxes used to run ---- */
  function toggle(u){
    if(SEL.has(u)) SEL.delete(u); else SEL.add(u);
    changed();
  }
  function changed(){
    draw();                                  /* the highlight on the heatmap */
    drawTimeArcs();                          /* the band above the heatmap follows too */
    let differs = false;
    for(const u of SEL) if(!LIVE.has(u)) differs = true;
    for(const p of NODES) if(p.kind === 'u' && !p.deg && !SEL.has(p.name)) differs = true;
    if(differs) build(60); else restyle();   /* rebuild only when the cast changes */
    badge(); tally(); chipRow();
  }
  function badge(){
    allb.classList.toggle('on', SEL.size === D.users.length);
    allb.classList.toggle('some', SEL.size > 0 && SEL.size < D.users.length);
  }
  allb.addEventListener('click', () => {
    if(SEL.size === D.users.length) SEL.clear();
    else for(const u of D.users) SEL.add(u);
    changed();
  });

  /* The bar carries the tabs, the hour and ALL, and nothing else: what the drawing holds
     is in the drawing. Kept as a function because the tabs and the picking call it. */
  function tally(){}

  /* every person, all the time: the ones on the cluster this hour stand out,
     and clicking one never takes it off the list. The by-hour tab only. */
  /* Everyone, whichever tab is up: this is how a person is picked without hunting for
     them in the drawing. On the by-hour tab the ones really on the cluster that hour are
     brought forward; over a month they all are. */
  function chipRow(){
    while(chips.firstChild) chips.removeChild(chips.firstChild);
    for(const u of D.users){
      const b = document.createElement('button');
      const live = MODE === 'hour' ? PRESENT.has(u) : true;
      b.className = 'netchip' + (live ? ' live' : '') + (SEL.has(u) ? ' on' : '');
      b.setAttribute('data-u', u);
      const sw = document.createElement('span');
      sw.className = 'sw'; sw.style.background = USERCOL.get(u) || '#8fa6c0';
      const sp = document.createElement('span'); sp.textContent = u;
      b.append(sw, sp);
      b.addEventListener('click', () => toggle(u));
      chips.append(b);
    }
  }

  /* ---- the slider ---- */
  function goTo(h){
    hour = Math.max(0, Math.min(NT - 1, h));
    range.value = hour;
    stamp(); build(); tally(); chipRow();
  }
  range.addEventListener('input', () => goTo(+range.value));
  document.getElementById('netprev').addEventListener('click', () => goTo(hour - 1));
  document.getElementById('netnext').addEventListener('click', () => goTo(hour + 1));

  /* ---- the five tabs: the summary, the Time arcs, three drawings of the links ---- */
  const monthTabs = document.getElementById('monthTabs');
  /* The Original (2 rings) view's key: each group, its colour and its machines. Resting on a
     row brings that group's machines and their lines forward. */
  const grpLegend = document.getElementById('grpLegend');
  (function key(){
    const names = [...GROUPS.keys()].sort((a, b) => a.localeCompare(b, undefined, {numeric:true}));
    grpLegend.innerHTML = '<thead><tr><th colspan="2">Machine group</th><th>Machines</th></tr></thead><tbody>' +
      names.map(g => '<tr data-g="' + g + '"><td><span class="sw" style="background:' + GROUP_COL.get(g) +
                     '"></span></td><td>' + g + '</td><td class="n">' + GROUPS.get(g).machines.size + '</td></tr>').join('') +
      '</tbody>';
    const only = g => {
      if(MODE !== 'month0') return;
      if(!g){ applyFocus(SEL.size ? SEL : null); return; }   /* back to the picks, if any */
      for(const p of NODES) if(p.kind === 'm') p.el.setAttribute('opacity', groupOfMachine(p.name) === g ? '1' : '0.12');
      for(const e of EDGES) e.el.setAttribute('stroke-opacity', groupOfMachine(e.b.name) === g ? 0.6 : 0.02);
    };
    for(const tr of grpLegend.querySelectorAll('tbody tr')){
      tr.addEventListener('mouseenter', () => only(tr.getAttribute('data-g')));
      tr.addEventListener('mouseleave', () => only(null));
    }
  })();
  /* [button, mode, Test?] - Test draws like the Original (two rings, group colours, key,
     focus) with its own layout - people in the Users & Groups order, each group's machines
     together (netCircleTest) - so it shares the 'month0' mode and only swaps the layout */
  const MONTH_VIEWS = [[document.getElementById('monthViewOld'), 'month0', false],
                       [document.getElementById('monthViewNow'), 'month', false],
                       [document.getElementById('monthViewTest'), 'month0', true]];
  let monthView = 'month0';                    /* the Original view comes first */
  /* Users & Groups and Users & Groups (layers) share the 'bip' mode: BIPLAYERS says which */
  const TABS = [[tabSum, 'summary'], [tabArcs, 'arcs'], [tabHour, 'hour'],
                [tabMonthR, 'monthr'], [tabMonth, 'month'], [tabBip, 'bip'], [tabBipL, 'bip']];
  function show(m){
    for(const [b, name] of TABS){
      const on = (m === name && (name !== 'bip' || (b === tabBipL) === BIPLAYERS)) ||
                 (name === 'month' && m === 'month0');   /* both views are one tab */
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    /* the month tab's two views: shown only on that tab, the one up marked */
    monthTabs.style.display = (m === 'month' || m === 'month0') ? '' : 'none';
    grpLegend.hidden = m !== 'month0';
    for(const [b, name, test] of MONTH_VIEWS){
      const up = m === name && (name !== 'month0' || test === M0TEST);
      b.classList.toggle('on', up);
      b.setAttribute('aria-selected', up ? 'true' : 'false');
    }
    hourCtl.style.display = m === 'hour' ? '' : 'none';   /* the slider, under the by-hour drawing */
    stamp0.style.display  = m === 'hour' ? '' : 'none';
    /* one drawing at a time: the summary, the arcs with their own zoom buttons, or the links */
    sumscroll.hidden = m !== 'summary';
    arcscroll.hidden = m !== 'arcs';
    netscroll.hidden = m === 'summary' || m === 'arcs';
    arcTools.style.display = m === 'arcs' ? '' : 'none';
    if(m === 'hour') alignHourRow();          /* it could not be measured while hidden */
    if(typeof placePins === 'function') placePins();   /* the foot bar changed height */
  }
  function setMode(m){
    if(m === MODE) return;
    hover(null);
    if(raf){ clearTimeout(raf); raf = 0; }
    MODE = m; POS = POSBY[m] || POS;
    /* the rings tab settles from its seeded start every time it is opened, so it is always
       the same picture - never carried on from a visit before, nor from another tab */
    if(m === 'monthr') POS.clear();
    show(m);
    /* the people stay whichever tab is up: they are how anyone is picked */
    netwrap.style.height = '';
    if(m === 'summary'){ chipRow(); drawSummary(); return; }
    if(m === 'arcs'){ chipRow(); drawTimeArcs(); return; }      /* nothing to settle over there */
    build(); tally(); chipRow();
  }
  /* the month tab opens on whichever of its two views was up last (at first the current) */
  for(const [b, name] of TABS) b.addEventListener('click', () => {
    if(name === 'bip'){
      const layers = b === tabBipL, was = BIPLAYERS;
      BIPLAYERS = layers;
      /* the two share a mode, so going between them only redraws */
      if(MODE === 'bip' && was !== layers){ hover(null); show(MODE); build(); tally(); return; }
    }
    setMode(name === 'month' ? monthView : name);
  });
  for(const [b, name, test] of MONTH_VIEWS) b.addEventListener('click', () => {
    const was = M0TEST;
    monthView = name;
    if(name === 'month0') M0TEST = test;
    /* Original and Test share a mode, so going between them only redraws */
    if(MODE === name && was !== M0TEST){ hover(null); show(MODE); build(); tally(); }
    else setMode(name);
  });

  window.addEventListener('resize', () => build(60));
  alignHourRow();

  /* the Time arcs band picks people through this */
  NETPANEL = {toggle:toggle, changed:changed};
  show(MODE);

  stamp(); build(); tally(); chipRow(); badge();
}
let NETPANEL = null;

/* The hour slider runs on the same hours as the dates at the foot of the page: its handle
   stands over the column it is showing. An <input type=range> moves its handle between
   half a handle in from each end, so the track is made a handle wider than the hours and
   shifted half a handle left; the handle then travels exactly across them.
   Needs: NT (config.js), the heatmap's rendered x axis (heatmap.js). */
const NET_THUMB = 15;                    /* the handle, as css/base.css draws it */
function alignHourRow(){
  const row = document.getElementById('nethourctl'), el = document.getElementById('nettime');
  const gd = document.getElementById('heat');
  if(!row || !el || !gd || !gd._fullLayout || !gd._fullLayout.xaxis) return;
  const ax = gd._fullLayout.xaxis, g = gd.getBoundingClientRect(), box = row.getBoundingClientRect();
  if(!box.width || !ax._length) return;
  const left = g.left + ax._offset;       /* where the first hour's column begins */
  el.style.marginLeft = (left - box.left + ax._length * 0.5 / NT - NET_THUMB / 2).toFixed(1) + 'px';
  el.style.width = (ax._length * (NT - 1) / NT + NET_THUMB).toFixed(1) + 'px';
}
