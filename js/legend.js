/* The colour band above the chart: its ramp and ticks, the usage range (LIM,
   inLim) and the two grips that set it.
   Needs: RAINBOW, T, TMAX (config.js), draw. */

function paintLegend(){
  /* a plain 0-100 ramp, evenly spaced */
  const stops = RAINBOW.map(s => s[1] + ' ' + (100 * s[0]).toFixed(1) + '%');
  document.getElementById('bar').style.background = 'linear-gradient(to right,' + stops.join(',') + ')';
  const t = document.getElementById('ticks');
  const put = (left, label, cls) => {
    const s = document.createElement('span');
    s.style.left = left + '%';
    s.innerHTML = '<i></i>' + label;
    if(cls) s.className = cls;
    t.append(s);
  };
  [0, 20, 40, 60, 80, 100].forEach(v => put(100 * T(v) / TMAX, v + '%'));
}

const LIM = {loPct:0, hiPct:100};        /* grips read straight as percentages */
const v2pct = v => v;
const pct2v = p => Math.min(100, Math.max(0, p));
const loVal = () => LIM.loPct;
const hiVal = () => LIM.hiPct;
const inLim = v => v >= loVal() - 1e-9 && v <= hiVal() + 1e-9;

/* ---- the two grips on the colour band ---- */
function initColourGrips(){
  const wrap = document.getElementById('barwrap');
  const gLo = document.getElementById('gripLo'), gHi = document.getElementById('gripHi');
  const vLo = document.getElementById('veilLo'), vHi = document.getElementById('veilHi');
  const paint = () => {
    const a = LIM.loPct, b = LIM.hiPct;
    gLo.style.left = a + '%';  gHi.style.left = b + '%';
    vLo.style.left = '0%';     vLo.style.width = a + '%';
    vHi.style.left = b + '%';  vHi.style.width = (100 - b) + '%';
    document.getElementById('rngTxt').textContent =
      loVal().toFixed(0) + '–' + hiVal().toFixed(0) + '%';
  };
  const drag = (grip, which) => {
    grip.addEventListener('pointerdown', ev => {
      ev.preventDefault(); grip.setPointerCapture(ev.pointerId); grip.classList.add('on');
      const move = e => {
        const r = wrap.getBoundingClientRect();
        let pct = 100 * (e.clientX - r.left) / r.width;
        pct = Math.min(100, Math.max(0, pct));
        if(which === 'lo') LIM.loPct = Math.min(pct, LIM.hiPct - 1);
        else               LIM.hiPct = Math.max(pct, LIM.loPct + 1);
        paint(); draw();
      };
      const up = e => { grip.classList.remove('on');
        grip.releasePointerCapture(ev.pointerId);
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  };
  drag(gLo, 'lo'); drag(gHi, 'hi');
  document.getElementById('rngReset').addEventListener('click', () => {
    LIM.loPct = 0; LIM.hiPct = 100; paint(); draw(); });
  paint();
}
