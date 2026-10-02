/* Starts the page: read the data, work out everything that depends on it, then
   run the same steps the page has always started with. The other files only
   define things; this runs them. */

(function main(){
  checkBuild();
  loadData().then(() => {
    prepareConfig();
    prepareSelection();
    prepareRows();
    prepareStrip();

    paintLegend();
    initControls();
    showCounts();
    initNetworkPanel();
    initSummary();
    initColourGrips();
    initStrip();
    initTimeAxis();
    initTimeArcs();
    draw();
    initHeatmapEvents();
  }).catch(cannotRead);

  /* The counts live on the Summarization tab (summary.js) and in the heatmap controls
     box, which draw() fills (heatmap.js), so nothing is written to the header any more. */
  function showCounts(){}

  /* Is this the page as it stands on disk, or one the browser kept from earlier?
     A plain "python -m http.server" sends no caching headers, so a browser will
     happily keep old scripts; then new buttons do nothing and nothing explains
     why. The build in the code is compared with the one in version.json (beside the
     page, not in the data folder), which is always fetched fresh. A page opened from
     disk cannot fetch anything, so there the check is skipped. */
  function checkBuild(){
    if(location.protocol === 'file:') return;   /* a page opened from disk cannot fetch */
    fetch('version.json', {cache:'no-store'}).then(r => r.json()).then(v => {
      if(!v || !v.build || typeof BUILD === 'undefined' || v.build === BUILD) return;
      const bar = document.createElement('div');
      bar.className = 'stale';
      bar.innerHTML = 'Your browser is showing a copy of this page it kept from earlier ' +
        '(build ' + BUILD + '; on the server it is ' + v.build + '). ' +
        '<button class="btn" id="staleReload">Load the current one</button>' +
        ' &nbsp;or press Ctrl+Shift+R.';
      document.body.prepend(bar);
      document.getElementById('staleReload').addEventListener('click', () => {
        location.replace(location.pathname + '?fresh=' + Date.now());
      });
    }).catch(() => {});
  }

  /* A bad zip is answered on the lock screen (lock.js), so this only catches a failure
     after the data was read: say what went wrong instead of leaving an empty page. */
  function cannotRead(err){
    console.error(err);
    const meta = document.getElementById('meta');
    meta.className = 'meta show';          /* hidden until there is something wrong to say */
    meta.innerHTML = '<span style="color:#f4712a">The page could not be drawn &mdash; ' +
      (err && err.message ? err.message : String(err)) + '</span>' +
      '<span>Reload the page with <b>Ctrl+Shift+R</b> and upload the data again.</span>';
  }
})();
