/* The page's data. Nothing is read from the server: the lock screen (lock.js) waits for
   the input .zip, opens it in the browser, and convertRaw (convert.js) turns the two raw
   metric files inside into the hourly rows per person and machine. Nothing is saved: the
   rows exist only in memory while the page is open.

   D is null until loadData() has finished, so everything that depends on it waits for
   main.js. The lock screen is taken away before anything is drawn, so the charts are laid
   out on the page as it will be seen. */

let D = null;

function loadData(){
  return waitForData().then(data => { D = data; unlockPage(); return D; });
}
