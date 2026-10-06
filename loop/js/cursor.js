// The pointer and the ring a click leaves, drawn over the window along
// O.cursorTracks. A frame is taken with the pointer off the window. On
// a device the pointer is a finger: a dot that is there for a tap or a
// drag, and gone between them.
(function () {
  const O = window.O, E = O.E;
  let cursor, ring;

  O.buildCursor = function (stage) {
    ring = O.h('<div class="ring"></div>');
    cursor = O.TOUCH ? O.h('<div id="cursor" class="touch"></div>') : O.h(`<div id="cursor">
      <svg width="40" height="40" viewBox="0 0 40 40"><path d="M9 5 L9 31 L15.5 25 L20 35 L24.5 33 L20 23.5 L29 23.5 Z" fill="#fff" stroke="#0a0c0f" stroke-width="1.8" stroke-linejoin="round"/></svg>
    </div>`);
    stage.appendChild(ring);
    stage.appendChild(cursor);
  };

  // Taps at these times on one point. The finger lifts between them.
  O.tap = function (times, at) {
    const a = times[0] - 0.2, b = times[times.length - 1] + 0.5;
    O.cursorTracks.push({ a, b, frames: [[a, at], [b, at]], clicks: times });
  };

  // A drag from one point to another over [a, b], which moves the way a
  // scroll or a slide drawn over the same span does.
  O.drag = function (a, b, from, to) {
    O.cursorTracks.push({ a: a - 0.12, b: b + 0.16, frames: [[a - 0.12, from], [a, from], [b, to], [b + 0.16, to]], clicks: [] });
  };

  // A finger shows while it is on the glass: around each tap, or for
  // the length of a drag.
  function touching(t, tr) {
    if (tr.clicks.length === 0) return O.env(t, tr.a, tr.b, 0.1, 0.14);
    return Math.max(...tr.clicks.map((c) => O.env(t, c - 0.12, c + 0.24, 0.08, 0.16)));
  }

  O.drawCursor = function (t) {
    const on = O.cursorTracks.filter((c) => t >= c.a && t <= c.b);
    // A finger that has just landed is the one on the glass.
    const tr = O.TOUCH ? on.sort((p, q) => q.a - p.a)[0] : on[0];
    if (!tr) {
      O.setVis(cursor, false);
      O.setVis(ring, false);
      return;
    }
    O.setVis(cursor, true);
    const [x, y] = O.keys(t, tr.frames);
    const vis = O.TOUCH ? touching(t, tr) : O.env(t, tr.a, tr.b, 0.3, 0.3);
    let press = 1;
    let rk = -1;
    for (const c of tr.clicks) {
      const d = t - c;
      if (d > -0.08 && d < 0.14) press = Math.min(press, 1 - 0.18 * Math.sin(O.prog(d, -0.08, 0.14) * Math.PI));
      if (d >= 0 && d < 0.5) rk = d / 0.5;
    }
    // The arrow's tip is 9 by 5 pixels into its picture, and the dot's
    // centre is 18 by 18.
    const [dx, dy] = O.TOUCH ? [18, 18] : [9, 5];
    cursor.style.transform = `translate3d(${x - dx}px,${y - dy}px,0) scale(${press})`;
    cursor.style.opacity = vis;
    O.setVis(ring, rk >= 0);
    if (rk >= 0) {
      ring.style.transform = `translate3d(${x}px,${y}px,0) scale(${0.3 + E.outCubic(rk) * 0.9})`;
      ring.style.opacity = (1 - rk) * 0.9;
    }
  };
})();
