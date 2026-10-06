// Write, then format: the chapter fills in the editor, and the note's
// own action hands the pane to the preview.
(function () {
  const O = window.O, E = O.E;
  const FLIP = 19.3;
  // Typed rows: the chapter number, the title, the first paragraph and
  // the second. The rest of the chapter stays unwritten on screen.
  const ROWS = O.shot('write').rows.slice(0, 13);
  const SPANS = [[15.9, 16.3, 0, 1], [16.4, 16.85, 1, 2], [17.0, 18.35, 2, 10], [18.45, 18.9, 10, 13]];
  const PREVIEW = O.mid('write', 'preview');
  let caret;

  function typing(t) {
    const shown = ROWS.map(() => 0);
    let at = null;
    for (const [a, b, i, j] of SPANS) {
      const part = O.typed(ROWS.slice(i, j), t, a, b);
      part.shown.forEach((w, k) => (shown[i + k] = w));
      if (t >= a - 0.4) at = part.caret;
    }
    return { shown, at };
  }

  O.cursorTracks.push({
    a: 18.55, b: 20.1,
    frames: [[18.55, [900, 700]], [19.15, PREVIEW], [FLIP + 0.15, PREVIEW], [20.1, [PREVIEW[0] + 40, PREVIEW[1] + 120]]],
    clicks: [FLIP - 0.05],
  });

  O.sections.push({
    b: O.T.write,
    frames: ['write-empty', 'write', 'read'],
    init(win) {
      caret = O.h('<div class="caret"></div>');
      win.el.appendChild(caret);
    },
    show(t) {
      const flip = E.inOutCubic(O.prog(t, FLIP + 0.05, FLIP + 0.35));
      return { 'write-empty': flip < 1 ? 1 : 0, write: flip < 1 ? 1 : 0, read: flip };
    },
    update(t, win, on) {
      const { shown, at } = typing(t);
      win.layers.write.style.clipPath = O.rowsClip(ROWS, shown, 5);
      O.setVis(caret, on && at !== null && t < FLIP);
      if (at) {
        caret.style.left = at[0] + 1 + 'px';
        caret.style.top = at[1] - 2 + 'px';
        caret.style.height = at[2] + 4 + 'px';
        caret.style.opacity = t > 18.9 && Math.floor((t - 18.9) * 2.4) % 2 === 1 ? 0 : 1;
      }
    },
  });
})();
