// Export to PDF: the preview's own action opens the dialog, preflight
// has passed, and one click writes the file.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.export;
  const OPEN = 38.75, WRITE = 40.55;
  const ACTION = O.mid('css-2', 'export');
  const BUTTON = O.mid('export-0', 'write');
  const DIALOG = O.mid('export-0', 'dialog');

  const CAM = [
    [A, O.HOME],
    [38.0, O.aim(ACTION[0], ACTION[1] + 60, 1.35, 1250, 300)],
    [OPEN + 0.15, O.aim(ACTION[0], ACTION[1] + 60, 1.35, 1250, 300)],
    [39.6, O.aim(DIALOG[0], DIALOG[1], 1.55, 1280, 560)],
    [44.2, O.aim(DIALOG[0], DIALOG[1], 1.62, 1280, 560)],
    [B, O.aim(DIALOG[0], DIALOG[1], 1.3, 1280, 560)],
  ];

  let cap, win;

  O.scenes.push({
    id: 'export', a: A, b: B, pre: 0.3, post: 0.3,
    init() {
      const el = this.el;
      win = O.win(el, ['css-2', 'export-0', 'export-1']);
      el.appendChild(O.h('<div class="shade"></div>'));
      cap = O.caption({
        num: '05', top: 330,
        title: 'Export<br>to <i>PDF.</i>',
        sub: 'Preflight checks the fonts and images first. The PDF holds the same pages as the preview.',
      });
      el.appendChild(cap.el);

      O.cursorTracks.push({
        a: 37.8, b: 41.6,
        frames: [[37.8, [700, 500]], [38.55, ACTION], [OPEN + 0.2, ACTION], [40.3, BUTTON], [WRITE + 0.15, BUTTON], [41.6, [BUTTON[0] + 60, BUTTON[1] + 90]]],
        clicks: [OPEN, WRITE],
        map: O.camMap(CAM),
      });
      O.cues.clicks.push(OPEN, WRITE);
      O.cues.pops.push(OPEN + 0.12);
      O.cues.ticks.push({ t: WRITE + 0.5, n: 5, bright: true });
      O.cues.whooshes.push(44.95);
      O.cues.impacts.push({ t: 37.5 });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 0.3, dout: 0.6, post: 0.3 });
      cap.update(t, 37.75, 44.4);
      win.camera(t, CAM);
      const open = E.outCubic(O.prog(t, OPEN + 0.05, OPEN + 0.3));
      const done = E.outCubic(O.prog(t, WRITE + 0.35, WRITE + 0.6));
      win.show({ 'css-2': open < 1 ? 1 : 0, 'export-0': done < 1 ? open : 0, 'export-1': done });
    },
  });
})();
