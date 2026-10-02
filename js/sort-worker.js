/* One sorting worker: runs one method on one problem and sends back its order.
   sort.js starts five of these side by side, so the page never freezes while they work.
   Loaded with the page's build stamp in its address, which it passes on to sort-core.js. */
importScripts('sort-core.js' + self.location.search);

self.onmessage = ev => {
  const {problem, method, seed, budget, polishMs} = ev.data;
  const t0 = performance.now();
  try {
    const r = SORTCORE.run(problem, method, seed, budget, polishMs);
    self.postMessage({ok:true, method, order:r.order, tight:r.tight, evals:r.evals, ms:performance.now() - t0});
  } catch(e){
    self.postMessage({ok:false, method, error:String(e && e.stack || e)});
  }
};
