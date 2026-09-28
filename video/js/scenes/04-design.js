// Design in the panel: each click steps a control, and the pages are set
// again from it. Every state on screen is a frame of the real panel.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.design;
  // The navigator is put away with Obsidian's own sidebar button, which
  // gives the preview and the panel the room.
  const IN = 22.95;
  const SIDEBAR = [321, 19];
  // Each click is [time, frame the target is in, target, frame after it].
  const CLICKS = [
    [23.55, 'design-0', 'size-up', 'design-1'],
    [23.85, 'design-0', 'size-up', 'design-2'],
    [24.15, 'design-0', 'size-up', 'design-3'],
    [24.7, 'design-0', 'spacing-up', 'design-4'],
    [25.0, 'design-0', 'spacing-up', 'design-5'],
    [25.3, 'design-0', 'spacing-up', 'design-6'],
    [25.95, 'design-0', 'justify', 'design-7'],
    [27.3, 'design-8', 'drop-cap', 'design-9'],
    [27.95, 'design-9', 'cap-font', 'design-10'],
    [28.65, 'design-10', 'option', 'design-11'],
  ];
  // The panel scrolls down to the drop cap rows, and back up after.
  const DOWN = [26.4, 26.9], UP = [29.25, 29.75];
  const SCROLLS = [
    [DOWN, ['design-7', 'scroll-down', 'design-8'], 'design-8'],
    [UP, ['design-11', 'scroll-up', 'design-12'], 'design-12'],
  ];
  const TEXT = [600, 470];
  const CAP = [500, 390];
  let strips;

  const frames = [[22.3, [700, 380]], [22.85, SIDEBAR], [IN + 0.12, SIDEBAR]];
  CLICKS.forEach(([t, shot, mark], i) => {
    const p = O.mid(shot, mark);
    const prev = CLICKS[i - 1];
    if (!prev || prev[2] !== mark) frames.push([t - 0.3, p]);
    frames.push([t + 0.12, p]);
  });
  frames.push([29.9, [1000, 700]]);
  O.cursorTracks.push({ a: 22.3, b: 29.9, frames, clicks: [IN, ...CLICKS.map((c) => c[0])], map: O.deskMap });
  [IN, ...CLICKS.map((c) => c[0])].forEach((t) => O.cues.clicks.push(t));
  // The filter is typed as the picker opens.
  O.keySounds(28.05, 28.3);
  SCROLLS.forEach(([[a]]) => O.cues.whooshes.push({ t: a, soft: true }));

  // The frame on screen and the one fading in over it, at time t.
  const STEPS = [
    ...CLICKS.map(([t, , , name]) => [t + 0.06, name, 0.14]),
    ...SCROLLS.map(([[, b], , name]) => [b, name, 0]),
  ].sort((a, b) => a[0] - b[0]);

  O.sections.push({
    a: A, b: B,
    frames: ['read', 'design-0', ...CLICKS.map((c) => c[3]), 'design-8', 'design-12'],
    cap: {
      num: '03', top: 330,
      title: 'Design in<br>the <i>panel.</i>',
      sub: 'Type, spacing, alignment and drop caps. Each change sets the pages again as you make it.',
    },
    capIn: 22.7, capOut: 29.4,
    cam: [
      [IN + 0.15, O.HOME],
      [23.45, O.aim(760, 400, 1.22, 1330, 560)],
      [25.4, O.aim(760, 420, 1.22, 1330, 560)],
      [25.85, O.aim(TEXT[0], TEXT[1], 1.7, 1280, 560)],
      [26.3, O.aim(TEXT[0], TEXT[1], 1.7, 1280, 560)],
      [26.9, O.aim(780, 400, 1.3, 1330, 540)],
      [28.8, O.aim(780, 400, 1.3, 1330, 540)],
      [29.3, O.aim(CAP[0], CAP[1], 1.9, 1250, 560)],
      [B, O.aim(CAP[0], CAP[1], 1.95, 1250, 560)],
    ],
    init(win) {
      strips = SCROLLS.map(([span, names]) => ({
        span,
        from: O.shot(names[0]).scroll,
        to: O.shot(names[names.length - 1]).scroll,
        strip: O.strip(win, names),
      }));
    },
    show(t) {
      // The frame before the latest step shows under the one after it,
      // which fades in as the engine repaints.
      const k0 = E.outQuad(O.prog(t, IN + 0.05, IN + 0.18));
      const map = { read: k0 < 1 ? 1 : 0, 'design-0': k0 };
      let under = 'design-0';
      for (const [c, name, fade] of STEPS) {
        if (t < c) break;
        const k = fade ? E.outQuad(O.prog(t, c, c + fade)) : 1;
        map[name] = k;
        if (k >= 1) {
          map[under] = 0;
          under = name;
        }
      }
      return map;
    },
    update(t, win, on) {
      for (const { span: [a, b], from, to, strip } of strips) {
        const scrolling = on && t >= a && t < b;
        O.setVis(strip.el, scrolling);
        if (scrolling) strip.at(O.lerp(from, to, E.inOutCubic(O.prog(t, a, b))));
      }
    },
  });
})();
