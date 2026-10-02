/* Who is highlighted (SEL) and the colour each person is drawn in.
   Needs: D. */

/* ---- who is highlighted ------------------------------------------------
   Picking a person - in the row of people, the network chart or the Time arcs - puts
   them in SEL. The heatmap then keeps their cells as they are and darkens the rest
   (js/highlight.js); with two or more picked it can show their union, their
   intersection or what is left of the union once the intersection is taken out. */
const SEL   = new Set();
let USERCOL = new Map();

function prepareSelection(){
  USERCOL = new Map();
  /* step the wheel by the golden angle so neighbours differ, and cycle
     lightness as well, so two users who land on a similar hue still separate */
  const L = [64, 47, 78], S = [90, 72, 96];
  D.users.forEach((u, i) => {
    const hue = (i * 137.508 + 20) % 360;
    USERCOL.set(u, 'hsl(' + hue.toFixed(0) + ',' + S[i % 3] + '%,' + L[i % 3] + '%)');
  });
}
