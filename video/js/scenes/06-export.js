// Export to PDF: the preview's own action opens the dialog, preflight
// has passed, and one click writes the file.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.export;
  const OPEN = 38.3, WRITE = 39.45;
  const ACTION = O.mid('css-2', 'export');
  const BUTTON = O.mid('export-0', 'write');
  const DIALOG = O.mid('export-0', 'dialog');

  O.cursorTracks.push({
    a: 37.35, b: 40.2,
    frames: [[37.35, [600, 560]], [38.1, ACTION], [OPEN + 0.2, ACTION], [39.2, BUTTON], [WRITE + 0.15, BUTTON], [40.2, [BUTTON[0] + 60, BUTTON[1] + 90]]],
    clicks: [OPEN, WRITE],
    map: O.deskMap,
  });
  O.cues.clicks.push(OPEN, WRITE);
  O.cues.pops.push(OPEN + 0.12);
  O.cues.ticks.push({ t: WRITE + 0.45, n: 5, bright: true });
  O.cues.whooshes.push(41.2);

  O.sections.push({
    a: A, b: B,
    frames: ['css-2-page@css-2', 'export-0', 'export-1'],
    cap: {
      num: '05', top: 330,
      title: 'Export<br>to <i>PDF.</i>',
      sub: 'Preflight checks the fonts and images first. The PDF holds the same pages as the preview.',
    },
    capIn: 37.6, capOut: 40.75,
    cam: [
      [37.9, O.aim(ACTION[0], ACTION[1] + 60, 1.35, 1250, 300)],
      [OPEN + 0.15, O.aim(ACTION[0], ACTION[1] + 60, 1.35, 1250, 300)],
      [38.95, O.aim(DIALOG[0], DIALOG[1], 1.55, 1280, 560)],
      [B + 0.3, O.aim(DIALOG[0], DIALOG[1], 1.7, 1280, 560)],
    ],
    show(t) {
      const open = E.outCubic(O.prog(t, OPEN + 0.05, OPEN + 0.3));
      const done = E.outCubic(O.prog(t, WRITE + 0.3, WRITE + 0.55));
      return { 'css-2-page': open < 1 ? 1 : 0, 'export-0': done < 1 ? open : 0, 'export-1': done };
    },
  });
})();
