// The clock and the page. Each device plays scenes of its own, timed on
// a clock of its own, and the loop plays the spans of that clock where
// something in the window moves.
(function () {
  const O = window.O;
  const q = new URLSearchParams(location.search);

  // For each device: the folder its dark frames are in, the scripts
  // that hold its scenes, the spans of scene time the loop keeps, the
  // scene time each scene ends at, the frame the loop starts and ends
  // on, and whether the pointer is a finger. The desktop's scenes are
  // timed from 12.5 to 42 seconds, and a device's from 0.
  const DEVICES = {
    desktop: {
      ui: 'ui',
      scenes: ['scenes/notes', 'scenes/write', 'scenes/design', 'scenes/css', 'scenes/export'],
      keep: [[12.5, 21.0], [22.2, 36.0], [37.2, 42.0]],
      ends: { notes: 15, write: 22.5, design: 30, css: 37.5, export: 41.25 },
      seam: 'notes',
      touch: false,
    },
    tablet: {
      ui: 'ui-tablet',
      scenes: ['device', 'tablet'],
      keep: [[0, 24.4]],
      ends: { notes: 2.2, write: 6.8, design: 14.9, css: 20.2, export: 24.4 },
      seam: 'notes',
      touch: true,
    },
    phone: {
      ui: 'ui-phone',
      scenes: ['device', 'phone'],
      keep: [[0, 18.4]],
      ends: { notes: 2.3, write: 7.1, design: 14.2, export: 18.4 },
      seam: 'notes',
      touch: true,
    },
  };
  const device = DEVICES[q.get('device') || 'desktop'];
  if (!device) throw new Error('no device ' + q.get('device'));

  // The folder the frames are in, one per device and scheme.
  O.UI = 'assets/' + (q.get('ui') || device.ui);
  O.FPS = +(q.get('fps') || 30);
  // The seconds the last frame takes to fade into the first.
  O.SEAM = 0.8;
  O.SCENES = device.scenes;
  O.FIRST = device.seam;
  O.TOUCH = device.touch;

  const KEEP = device.keep;
  O.T_FIRST = KEEP[0][0];
  O.LAST = KEEP[KEEP.length - 1][1];
  O.LENGTH = KEEP.reduce((n, [a, b]) => n + b - a, 0);
  // The scene time each scene ends at.
  O.T = device.ends;
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
