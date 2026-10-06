// The pointer and the ring a click leaves, drawn over the window along
// O.cursorTracks. A frame is taken with the pointer off the window.
(function () {
  const O = window.O, E = O.E;
  let cursor, ring;

  O.buildCursor = function (stage) {
    ring = O.h('<div class="ring"></div>');
    cursor = O.h(`<div id="cursor">
      <svg width="40" height="40" viewBox="0 0 40 40"><path d="M9 5 L9 31 L15.5 25 L20 35 L24.5 33 L20 23.5 L29 23.5 Z" fill="#fff" stroke="#0a0c0f" stroke-width="1.8" stroke-linejoin="round"/></svg>
    </div>`);
    stage.appendChild(ring);
    stage.appendChild(cursor);
  };

  O.drawCursor = function (t) {
    const tr = O.cursorTracks.find((c) => t >= c.a && t <= c.b);
    if (!tr) {
      O.setVis(cursor, false);
      O.setVis(ring, false);
      return;
    }
    O.setVis(cursor, true);
    const [x, y] = O.keys(t, tr.frames);
    const vis = O.env(t, tr.a, tr.b, 0.3, 0.3);
    let press = 1;
    let rk = -1;
    for (const c of tr.clicks) {
      const d = t - c;
      if (d > -0.08 && d < 0.14) press = Math.min(press, 1 - 0.18 * Math.sin(O.prog(d, -0.08, 0.14) * Math.PI));
      if (d >= 0 && d < 0.5) rk = d / 0.5;
    }
    // The arrow's tip is 9 by 5 pixels into its picture.
    cursor.style.transform = `translate3d(${x - 9}px,${y - 5}px,0) scale(${press})`;
    cursor.style.opacity = vis;
    O.setVis(ring, rk >= 0);
    if (rk >= 0) {
      ring.style.transform = `translate3d(${x}px,${y}px,0) scale(${0.3 + E.outCubic(rk) * 0.9})`;
      ring.style.opacity = (1 - rk) * 0.9;
    }
  };
})();
