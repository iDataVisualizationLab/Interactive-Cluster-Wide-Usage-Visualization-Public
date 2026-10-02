/* The heatmap's controls, in the small box at its top right: the colour band (legend.js),
   Group rows by, Order rows by, the slider for rows with at least so many hours, and the
   Expand all / Collapse all toggle. The box can be put away and brought back.
   Also keeps the box clear of the row of people stuck to the top of the window.
   Needs: D, open, shut (config.js), groupOrder (rows.js), draw. */

const MM_KEY = 'repacss.heatmapControls';      /* remembers whether the box was put away */

function initControls(){
  document.getElementById('group').addEventListener('change', () => {
    open.clear(); shut.clear(); draw(); });
  document.getElementById('minh').addEventListener('input', draw);
  document.getElementById('order').addEventListener('change', draw);
  /* one button for both: it opens every group, or closes them if they are all open */
  document.getElementById('exp').addEventListener('click', () => {
    if(allOpen()){ open.clear(); shut.clear(); }
    else { shut.clear(); groupOrder(document.getElementById('group').value).forEach(k => open.add(k)); }
    draw();
  });
  refreshExpand();

  /* the box folds down to its title button, and opens again from it */
  const box = document.getElementById('minimenu'), tog = document.getElementById('mmToggle');
  const setOpen = on => {
    box.classList.toggle('shut', !on);
    tog.setAttribute('aria-expanded', on ? 'true' : 'false');
    tog.title = on ? 'Hide the heatmap controls' : 'Show the heatmap controls';
    try { localStorage.setItem(MM_KEY, on ? 'open' : 'shut'); } catch(e) {}
  };
  let start = true;
  try { start = localStorage.getItem(MM_KEY) !== 'shut'; } catch(e) {}
  setOpen(start);
  tog.addEventListener('click', () => setOpen(box.classList.contains('shut')));

  window.addEventListener('resize', () => setTimeout(placePins, 120));
  placePins();
}

/* The controls box sticks to the heatmap as the page scrolls, just under the row of people
   at the top of the window; that row wraps, so its height is measured rather than written
   into the stylesheet. */
function placePins(){
  const chips = document.getElementById('netchips'), mp = document.getElementById('minipin');
  if(mp && chips) mp.style.top = chips.offsetHeight + 'px';
}

/* are all the groups on screen open? the button and its label follow the answer, so
   opening the last group by clicking it in the gutter also turns the button around */
function allOpen(){
  const keys = groupOrder(document.getElementById('group').value);
  return keys.length > 0 && keys.every(k => open.has(k));
}
function refreshExpand(){
  const b = document.getElementById('exp');
  if(!b) return;
  const on = allOpen();
  b.textContent = on ? 'Collapse all' : 'Expand all';
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = on ? 'Close every group' : 'Open every group';
}
