// Export to PDF: the preview's own action opens the dialog, preflight
// has passed, and one click writes the file.
(function () {
  const O = window.O, E = O.E;
  const OPEN = 38.3, WRITE = 39.45;
  const ACTION = O.mid('css-2', 'export');
  const BUTTON = O.mid('export-0', 'write');

  O.cursorTracks.push({
    a: 37.35, b: 40.2,
    frames: [[37.35, [600, 560]], [38.1, ACTION], [OPEN + 0.2, ACTION], [39.2, BUTTON], [WRITE + 0.15, BUTTON], [40.2, [BUTTON[0] + 60, BUTTON[1] + 90]]],
    clicks: [OPEN, WRITE],
  });

  O.sections.push({
    b: O.T.export,
    frames: ['css-2-page@css-2', 'export-0', 'export-1'],
    show(t) {
      const open = E.outCubic(O.prog(t, OPEN + 0.05, OPEN + 0.3));
      const done = E.outCubic(O.prog(t, WRITE + 0.3, WRITE + 0.55));
      return { 'css-2-page': open < 1 ? 1 : 0, 'export-0': done < 1 ? open : 0, 'export-1': done };
    },
  });
})();
