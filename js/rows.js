/* Rows grouped by machine or by person, and the order of the groups.
   Needs: D. */

let MAXH = 1;            /* the busiest pair, for the slider range, once the data is in */
let GROUPS = null;

function buildGroups(mode){
  const g = new Map();
  D.rows.forEach((r, k) => {
    const key = mode === 'user' ? r.u : r.n;
    if(!g.has(key)) g.set(key, {key:key, members:[]});
    g.get(key).members.push(k);
  });
  return g;
}
function prepareRows(){
  MAXH = Math.max(...D.rows.map(r => r.h));
  GROUPS = {user:buildGroups('user'), node:buildGroups('node')};
}

/* Groups are keyed by name, but inside H100 a CPU row and a GPU row can both be
   "rpg-93-1". A GPU key carries a suffix so the two never merge into one group;
   the gutter strips it again, so both sections still read rpg-93-1. */
const GPU_SFX = '#gpu';
const groupKey  = (k, mode) => mode === 'user' ? D.rows[k].u
  : (D.rows[k].m === 'gpu' ? D.rows[k].n + GPU_SFX : D.rows[k].n);
const plainName = key => String(key).split(GPU_SFX)[0];

function groupOrder(mode){
  const order = mode === 'user' ? D.order_user : D.order_node;
  const out = [], has = new Set();
  for(const k of order){
    const key = groupKey(k, mode);
    if(!has.has(key)){ has.add(key); out.push(key); }
  }
  return out;
}
