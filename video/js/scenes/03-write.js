// Write, then format: the chapter fills in the editor, the note's own
// action hands the pane to the preview, and the camera settles on the
// opening the engine set.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.write;
  const FLIP = 19.3;
  // Typed rows: the chapter number, the title, the first paragraph and
  // the second. The rest of the chapter stays unwritten on screen.
  const ROWS = O.shot('write').rows.slice(0, 13);
  const SPANS = [[15.9, 16.3, 0, 1], [16.4, 16.85, 1, 2], [17.0, 18.35, 2, 10], [18.45, 18.9, 10, 13]];
  const PREVIEW = O.mid('write', 'preview');
  const DROP = [676, 400];

  const CAM = [
    [A, O.HOME],
    [16.0, O.aim(560, 320, 1.28, 1220, 470)],
    [18.2, O.aim(560, 420, 1.28, 1220, 520)],
    [18.95, O.aim(1000, 160, 1.15, 1450, 330)],
    [FLIP + 0.2, O.aim(1000, 160, 1.15, 1450, 330)],
    [FLIP + 0.9, O.HOME],
    [FLIP + 1.4, O.HOME, E.inOutQuart],
    [B, O.aim(DROP[0], DROP[1], 2.3, 1300, 560)],
  ];

  let cap, win, caret;

  function typing(t) {
    const shown = ROWS.map(() => 0);
    let caretAt = null;
    for (const [a, b, i, j] of SPANS) {
      const part = O.typed(ROWS.slice(i, j), t, a, b);
      part.shown.forEach((w, k) => (shown[i + k] = w));
      if (t >= a - 0.4) caretAt = part.caret;
    }
    return { shown, caretAt };
  }

  O.scenes.push({
    id: 'write', a: A, b: B, pre: 0.3, post: 0.3,
    init() {
      const el = this.el;
      win = O.win(el, ['write-empty', 'write', 'read']);
      caret = O.h('<div class="caret"></div>');
      win.el.appendChild(caret);
      el.appendChild(O.h('<div class="shade"></div>'));
      cap = O.caption({
        num: '02', top: 330,
        title: 'Write,<br>then <i>format.</i>',
        sub: 'Write chapters in Markdown. One click turns the pane into the typeset book, open at the page you are writing.',
      });
      el.appendChild(cap.el);

      SPANS.forEach(([a, b]) => O.keySounds(a, b));
      O.cursorTracks.push({
        a: 18.55, b: 20.1,
        frames: [[18.55, [900, 700]], [19.15, PREVIEW], [FLIP + 0.15, PREVIEW], [20.1, [PREVIEW[0] + 40, PREVIEW[1] + 120]]],
        clicks: [FLIP - 0.05],
        map: O.camMap(CAM),
      });
      O.cues.clicks.push(FLIP - 0.05);
      O.cues.whooshes.push({ t: FLIP + 0.5, soft: true }, 22.45);
      O.cues.impacts.push({ t: 15 });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 0.4, dout: 0.7, post: 0.3 });
      cap.update(t, 15.25, 21.9);
      win.camera(t, CAM);

      const flip = E.inOutCubic(O.prog(t, FLIP + 0.05, FLIP + 0.35));
      win.show({ 'write-empty': 1, write: flip < 1 ? 1 : 0, read: flip });
      const { shown, caretAt } = typing(t);
      win.layers.write.style.clipPath = O.rowsClip(ROWS, shown, 5);

      const blink = t > 18.9 && Math.floor((t - 18.9) * 2.4) % 2 === 1;
      O.setVis(caret, caretAt !== null && t < FLIP);
      if (caretAt) {
        caret.style.left = caretAt[0] + 1 + 'px';
        caret.style.top = caretAt[1] - 2 + 'px';
        caret.style.height = caretAt[2] + 4 + 'px';
        caret.style.opacity = blink ? 0 : 1;
      }
    },
  });
})();
