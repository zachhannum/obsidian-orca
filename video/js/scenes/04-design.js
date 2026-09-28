// Design in the panel: each click steps a control, and the pages are set
// again from it. Every state on screen is a frame of the real panel.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.design;
  const M = (mark) => O.mid('design-0', mark);
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
  const NAMES = ['design-0', ...CLICKS.map((c) => c[2])];
  const TEXT = [600, 470];

  const CAM = [
    [A, O.HOME],
    [23.3, O.aim(760, 400, 1.22, 1330, 560)],
    [26.4, O.aim(760, 420, 1.22, 1330, 560)],
    [27.2, O.aim(TEXT[0], TEXT[1], 1.7, 1280, 560)],
    [28.1, O.aim(TEXT[0], TEXT[1], 1.7, 1280, 560)],
    [28.8, O.aim(760, 420, 1.22, 1330, 560)],
    [B, O.aim(760, 420, 1.2, 1330, 560)],
  ];

  let cap, win;

  O.scenes.push({
    id: 'design', a: A, b: B, pre: 0.3, post: 0.3,
    init() {
      const el = this.el;
      win = O.win(el, NAMES);
      el.appendChild(O.h('<div class="shade"></div>'));
      cap = O.caption({
        num: '03', top: 330,
        title: 'Design in<br>the <i>panel.</i>',
        sub: 'Type, spacing, margins and alignment. Each change sets the pages again as you make it.',
      });
      el.appendChild(cap.el);

      const frames = [[23.05, [1000, 760]]];
      CLICKS.forEach(([t, mark], i) => {
        const p = M(mark);
        const prev = CLICKS[i - 1];
        if (!prev || prev[1] !== mark) frames.push([t - 0.3, p]);
        frames.push([t + 0.12, p]);
      });
      frames.push([29.9, [1000, 700]]);
      O.cursorTracks.push({ a: 23.05, b: 29.9, frames, clicks: CLICKS.map((c) => c[0]), map: O.camMap(CAM) });
      CLICKS.forEach(([t]) => O.cues.clicks.push(t));
      O.cues.whooshes.push(29.95);
      O.cues.impacts.push({ t: 22.5 });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 0.3, dout: 0.7, post: 0.3 });
      cap.update(t, 22.7, 29.4);
      win.camera(t, CAM);
      // The frame before the latest click shows under the one after it,
      // which fades in as the engine repaints.
      const map = { 'design-0': 1 };
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
      win.show(map);
    },
  });
})();
