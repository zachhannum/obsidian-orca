// The clock and the page. The scenes are timed on one clock that runs
// from 12.5 to 42 seconds, and the loop plays the spans of it where
// something in the window moves.
(function () {
  const O = window.O;
  const q = new URLSearchParams(location.search);
  // The folder the frames are in, one per scheme.
  O.UI = 'assets/' + (q.get('ui') || 'ui');
  O.FPS = +(q.get('fps') || 30);
  // The seconds the last frame takes to fade into the first.
  O.SEAM = 0.8;

  const KEEP = [[12.5, 21.0], [22.2, 36.0], [37.2, 42.0]];
  O.LAST = KEEP[KEEP.length - 1][1];
  O.LENGTH = KEEP.reduce((n, [a, b]) => n + b - a, 0);
  // The scene time each scene ends at.
  O.T = { notes: 15, write: 22.5, design: 30, css: 37.5, export: 41.25 };
  O.sections = [];
  O.cursorTracks = [];

  // Loop time to scene time.
  const scene = (u) => {
    for (const [a, b] of KEEP) {
      if (u < b - a) return a + u;
      u -= b - a;
    }
    return O.LAST;
  };

  O.seek = (u) => {
    const t = scene(Math.max(0, Math.min(O.LENGTH - 1e-6, u)));
    O.drawDesk(t);
    O.drawCursor(t);
  };

  O.ready = new Promise((r) => addEventListener('DOMContentLoaded', r)).then(async () => {
    const stage = document.getElementById('stage');
    const root = document.documentElement.style;
    root.setProperty('--width', O.WIN.w + 'px');
    root.setProperty('--height', O.WIN.h + 'px');
    root.setProperty('--cover', window.FRAMES.paint.cover);
    root.setProperty('--caret', window.FRAMES.paint.caret);
    O.buildDesk(stage);
    O.buildCursor(stage);
    await Promise.all(Array.from(document.images).map((im) => im.decode().catch(() => null)));
    O.seek(0);
    // The renderer seeks the page itself. Opened by hand, the page plays.
    if (!q.has('render')) {
      const t0 = performance.now();
      const play = () => {
        O.seek(((performance.now() - t0) / 1000) % O.LENGTH);
        requestAnimationFrame(play);
      };
      requestAnimationFrame(play);
    }
    return true;
  });
})();
