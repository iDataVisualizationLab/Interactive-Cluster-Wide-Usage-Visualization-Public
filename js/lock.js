/* The lock screen. The page stays covered until someone gives it the input data: one .zip
   holding the two raw metric files (h100 and zen4). Nothing is read from the server's data
   folder - the data comes only from the file the person picks or drops here.

   The zip is opened in the browser (fflate, from cdn.jsdelivr.net). Its two files are
   recognised by what is inside them (their "cluster" field: h100 or zen4), not by their
   names, and checked before anything is drawn. Then convertRaw (convert.js) turns them into
   the rows the charts use, in memory only. Anything wrong is said on the lock screen, which
   stays up until a good zip is given.

   waitForData() resolves with that data once a good zip has been read; unlockPage() then
   takes the lock screen away. */

function readInputZip(bytes){
  if(typeof fflate === 'undefined')
    throw new Error('The unzip library (cdn.jsdelivr.net) did not load. Check the internet connection and reload the page.');
  let entries;
  try { entries = fflate.unzipSync(bytes, {filter:f => /\.json$/i.test(f.name)}); }
  catch(e){ throw new Error('This is not a .zip file that can be opened.'); }
  const found = {}, dec = new TextDecoder();
  for(const [name, data] of Object.entries(entries)){
    if(name.startsWith('__MACOSX/') || /(^|\/)\._/.test(name)) continue;   /* macOS side files */
    let j;
    try { j = JSON.parse(dec.decode(data)); } catch(e){ continue; }
    if(j && (j.cluster === 'h100' || j.cluster === 'zen4') && j.data && Array.isArray(j.timestamps))
      found[j.cluster] = j;
  }
  const missing = ['h100', 'zen4'].filter(c => !found[c]);
  if(missing.length)
    throw new Error('The zip has no ' + missing.join(' and no ') + ' metric file. It needs both the h100 and the zen4 metric files.');
  const a = found.h100.timestamps, b = found.zen4.timestamps;
  if(a.length !== b.length || a[0] !== b[0] || a[a.length - 1] !== b[b.length - 1])
    throw new Error('The h100 and zen4 files cover different hours, so they cannot be shown together.');
  return found;
}

function waitForData(){
  const lock = document.getElementById('lock');
  const input = document.getElementById('lockFile');
  const drop = document.getElementById('lockDrop');
  const msg = document.getElementById('lockMsg');
  return new Promise(resolve => {
    let busy = false;
    const say = (text, err) => { msg.textContent = text; msg.classList.toggle('err', !!err); };
    const take = file => {
      if(!file || busy) return;
      busy = true;
      lock.classList.add('busy');
      say('Reading ' + file.name + ' …');
      /* let the message show before the heavy work starts */
      setTimeout(() => {
        file.arrayBuffer().then(buf => {
          const f = readInputZip(new Uint8Array(buf));
          const data = convertRaw(f.h100, f.zen4);
          if(!data.rows.length) throw new Error('The files hold no hours in which anyone used a machine.');
          resolve(data);
        }).catch(err => {
          console.error(err);
          busy = false;
          lock.classList.remove('busy');
          say(err && err.message ? err.message : String(err), true);
        });
      }, 30);
    };
    drop.addEventListener('click', () => { if(!busy) input.click(); });
    input.addEventListener('change', () => { take(input.files[0]); input.value = ''; });
    /* a file dropped anywhere on the lock screen is taken, and never opened by the browser */
    lock.addEventListener('dragover', e => { e.preventDefault(); lock.classList.add('over'); });
    lock.addEventListener('dragleave', e => { if(e.target === lock) lock.classList.remove('over'); });
    lock.addEventListener('drop', e => {
      e.preventDefault();
      lock.classList.remove('over');
      take(e.dataTransfer && e.dataTransfer.files[0]);
    });
  });
}

function unlockPage(){
  const lock = document.getElementById('lock');
  if(lock) lock.remove();
  document.body.classList.remove('locked');
}
