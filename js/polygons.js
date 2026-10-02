/* Geometry of the highlight polygons: a person's cells -> runs of nearby cells ->
   one span per row -> merged shapes -> an outline with only horizontal and vertical
   edges. No page access.
   Needs: HL_R (selection.js). */

/* ---- rectilinear outlines ------------------------------------------------
   A shape is kept as one span per row: rows y0 .. y0+n-1, row y0+j covering
   hours L[j] .. R[j]. An outline traced from spans only ever runs along a row
   boundary or a column boundary, so every edge is horizontal or vertical. */

/* offsets to the neighbours below a cell, within HL_R. Links inside one row
   need nothing extra, since a row already spans from its first cell to its last */
const HL_DOWN = (() => {
  const o = [];
  for(let dy = 1; dy <= HL_R; dy++)
    for(let dx = -HL_R; dx <= HL_R; dx++)
      if(dx*dx + dy*dy <= HL_R*HL_R) o.push([dx, dy]);
  return o;
})();

/* The staircase that joins a cell to each linked neighbour below it: on row k of
   the link it covers columns x+lo[k] .. x+hi[k], following the straight line
   between the two cells to the nearest column. Worked out once, not per cell. */
const HL_STAIRS = HL_DOWN.map(([dx, dy]) => {
  const lo = [], hi = [];
  for(let k = 0; k <= dy; k++){
    const a = k === 0  ? 0  : Math.floor(dx * (k - 0.5) / dy + 0.5);
    const b = k === dy ? dx : Math.floor(dx * (k + 0.5) / dy + 0.5);
    lo.push(Math.min(a, b)); hi.push(Math.max(a, b));
  }
  return {dx:dx, dy:dy, lo:lo, hi:hi};
});

/* One run of cells -> its shape. Each row spans its leftmost to rightmost cell.
   Two linked cells on different rows are also joined by their staircase, so the
   rows in between are bridged and the shape stays in one piece - without
   reaching any further out than the old convex outline of the same cells would. */
function spansOf(cl, set){
  let y0 = Infinity, y1 = -Infinity;
  for(const p of cl){ if(p[1] < y0) y0 = p[1]; if(p[1] > y1) y1 = p[1]; }
  const n = y1 - y0 + 1;
  const L = new Array(n).fill(Infinity), R = new Array(n).fill(-Infinity);
  for(const [x, y] of cl){
    const j = y - y0;
    if(x < L[j]) L[j] = x;
    if(x > R[j]) R[j] = x;
    for(const s of HL_STAIRS){
      if(!set.has((x + s.dx) + '|' + (y + s.dy))) continue;
      for(let k = 0; k <= s.dy; k++){
        if(x + s.lo[k] < L[j + k]) L[j + k] = x + s.lo[k];
        if(x + s.hi[k] > R[j + k]) R[j + k] = x + s.hi[k];
      }
    }
  }
  return closeSpans({y0:y0, L:L, R:R});
}

/* Remove every dent. Reading down the rows, the left edge may only step out and
   then back in, never in and out again - likewise the right edge - so that each
   column is one unbroken run too. Each edge takes the tighter of its running
   extremes from the top and from the bottom. */
function closeSpans(sh){
  const L = sh.L, R = sh.R, n = L.length;
  const topL = new Array(n), topR = new Array(n);
  let l = Infinity, r = -Infinity;
  for(let j = 0; j < n; j++){
    if(L[j] < l) l = L[j];
    if(R[j] > r) r = R[j];
    topL[j] = l; topR[j] = r;
  }
  l = Infinity; r = -Infinity;
  for(let j = n - 1; j >= 0; j--){
    if(L[j] < l) l = L[j];
    if(R[j] > r) r = R[j];
    L[j] = Math.max(topL[j], l);
    R[j] = Math.min(topR[j], r);
  }
  sh.x0 = Infinity; sh.x1 = -Infinity;
  for(let j = 0; j < n; j++){
    if(L[j] < sh.x0) sh.x0 = L[j];
    if(R[j] > sh.x1) sh.x1 = R[j];
  }
  return sh;
}

/* Two shapes overlap, or meet along an edge - a shared corner alone does not
   count. On one row, spans side by side already meet. */
function touches(A, B){
  if(A.x0 > B.x1 + 1 || B.x0 > A.x1 + 1) return false;
  const a1 = A.y0 + A.L.length - 1, b1 = B.y0 + B.L.length - 1;
  if(A.y0 > b1 + 1 || B.y0 > a1 + 1) return false;
  for(let y = Math.max(A.y0, B.y0 - 1); y <= Math.min(a1, b1 + 1); y++){
    const ja = y - A.y0;
    for(let dy = -1; dy <= 1; dy++){
      const jb = y + dy - B.y0;
      if(jb < 0 || jb >= B.L.length) continue;
      const s = dy === 0 ? 1 : 0;
      if(A.L[ja] <= B.R[jb] + s && B.L[jb] <= A.R[ja] + s) return true;
    }
  }
  return false;
}

function unite(A, B){
  const y0 = Math.min(A.y0, B.y0);
  const n = Math.max(A.y0 + A.L.length, B.y0 + B.L.length) - y0;
  const L = new Array(n).fill(Infinity), R = new Array(n).fill(-Infinity);
  for(const S of [A, B])
    for(let j = 0; j < S.L.length; j++){
      const k = S.y0 + j - y0;
      if(S.L[j] < L[k]) L[k] = S.L[j];
      if(S.R[j] > R[k]) R[k] = S.R[j];
    }
  return closeSpans({y0:y0, L:L, R:R});
}

/* A shape can reach past its own cells and meet a sibling. Fold any two that
   overlap or share an edge into one, and keep going until none do. */
function mergeTouching(shapes){
  for(let again = true; again; ){
    again = false;
    for(let i = 0; i < shapes.length; i++)
      for(let j = i + 1; j < shapes.length; j++)
        if(touches(shapes[i], shapes[j])){
          shapes[i] = unite(shapes[i], shapes[j]);
          shapes.splice(j, 1);
          j = i;                         /* the grown shape meets the rest again */
          again = true;
        }
  }
  return shapes;
}

/* The spans as a closed outline: down the right-hand ends, back up the left.
   Cell centres sit on whole numbers, so the outline runs on the halves between
   them. A point that merely continues a straight edge is dropped. */
function outline(sh){
  const P = [];
  const add = (x, y) => {
    const k = P.length;
    if(k && P[k - 1][0] === x && P[k - 1][1] === y) return;
    if(k >= 2){
      const a = P[k - 2], b = P[k - 1];
      if((a[0] === b[0] && b[0] === x) || (a[1] === b[1] && b[1] === y)){ P[k - 1] = [x, y]; return; }
    }
    P.push([x, y]);
  };
  const n = sh.L.length;
  for(let j = 0; j < n; j++){
    add(sh.R[j] + 0.5, sh.y0 + j - 0.5);
    add(sh.R[j] + 0.5, sh.y0 + j + 0.5);
  }
  for(let j = n - 1; j >= 0; j--){
    add(sh.L[j] - 0.5, sh.y0 + j + 0.5);
    add(sh.L[j] - 0.5, sh.y0 + j - 0.5);
  }
  return P;
}

function runsOf(pts){                    /* single-linkage clusters at HL_R */
  const S = new Set(pts), seen = new Set(), out = [];
  const off = [];
  for(let dx = -HL_R; dx <= HL_R; dx++)
    for(let dy = -HL_R; dy <= HL_R; dy++)
      if(dx*dx + dy*dy <= HL_R*HL_R && (dx || dy)) off.push([dx, dy]);
  for(const k0 of S){
    if(seen.has(k0)) continue;
    seen.add(k0);
    const stack = [k0], cl = [];
    while(stack.length){
      const k = stack.pop();
      const c = k.indexOf('|'), x = +k.slice(0, c), y = +k.slice(c + 1);
      cl.push([x, y]);
      for(const [dx, dy] of off){
        const q = (x + dx) + '|' + (y + dy);
        if(S.has(q) && !seen.has(q)){ seen.add(q); stack.push(q); }
      }
    }
    out.push(cl);
  }
  return out;
}
