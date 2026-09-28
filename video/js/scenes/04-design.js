// Design in the panel: each click steps a control, and the pages are set
// again from it. Every state on screen is a frame of the real panel.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.design;
  const M = (mark) => O.mid('design-0', mark);
  // The navigator is put away with Obsidian's own sidebar button, which
  // gives the preview and the panel the room.
  const IN = 22.95;
  const SIDEBAR = [321, 19];
  // Each click moves the window to the frame taken after it.
  const CLICKS = [
    [23.7, 'size-up', 'design-1'],
    [24.05, 'size-up', 'design-2'],
    [24.75, 'spacing-up', 'design-3'],
    [25.1, 'spacing-up', 'design-4'],
    [25.85, 'outside-up', 'design-5'],
    [26.2, 'outside-up', 'design-6'],
    [27.0, 'left', 'design-7'],
    [28.4, 'justify', 'design-8'],
  ];
  const TEXT = [600, 470];

  const frames = [[22.3, [700, 380]], [22.85, SIDEBAR], [IN + 0.12, SIDEBAR]];
  CLICKS.forEach(([t, mark], i) => {
    const p = M(mark);
    const prev = CLICKS[i - 1];
    if (!prev || prev[1] !== mark) frames.push([t - 0.3, p]);
    frames.push([t + 0.12, p]);
  });
  frames.push([29.9, [1000, 700]]);
  O.cursorTracks.push({ a: 22.3, b: 29.9, frames, clicks: [IN, ...CLICKS.map((c) => c[0])], map: O.deskMap });
  [IN, ...CLICKS.map((c) => c[0])].forEach((t) => O.cues.clicks.push(t));

  O.sections.push({
    a: A, b: B,
    frames: ['read', 'design-0', ...CLICKS.map((c) => c[2])],
    cap: {
      num: '03', top: 330,
      title: 'Design in<br>the <i>panel.</i>',
      sub: 'Type, spacing, margins and alignment. Each change sets the pages again as you make it.',
    },
    capIn: 22.7, capOut: 29.4,
    cam: [
      [IN + 0.15, O.HOME],
      [23.55, O.aim(760, 400, 1.22, 1330, 560)],
      [26.4, O.aim(760, 420, 1.22, 1330, 560)],
      [27.2, O.aim(TEXT[0], TEXT[1], 1.7, 1280, 560)],
      [28.1, O.aim(TEXT[0], TEXT[1], 1.7, 1280, 560)],
      [28.8, O.aim(760, 420, 1.22, 1330, 560)],
      [B, O.aim(760, 420, 1.2, 1330, 560)],
    ],
    show(t) {
      // The frame before the latest click shows under the one after it,
      // which fades in as the engine repaints.
      const k0 = E.outQuad(O.prog(t, IN + 0.05, IN + 0.18));
      const map = { read: k0 < 1 ? 1 : 0, 'design-0': k0 };
      let under = 'design-0';
      for (const [c, , name] of CLICKS) {
        if (t < c + 0.06) break;
        const k = E.outQuad(O.prog(t, c + 0.06, c + 0.2));
        map[name] = k;
        if (k >= 1) {
          map[under] = 0;
          under = name;
        }
      }
      return map;
    },
  });
})();
