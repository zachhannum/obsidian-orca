// The loop on a tablet, with the navigator and the design panel pinned
// either side of the page. It follows the desktop's scenes, and every
// state on screen is a frame of Obsidian's own tablet layout.
(function () {
  const O = window.O, E = O.E;

  // Chapters stay notes: a tap on a chapter opens it, empty.
  const OPEN = 1.25;
  O.tap([OPEN], O.mid('notes', 'chapter'));
  O.sections.push({
    b: O.T.notes,
    frames: ['notes', 'write-empty'],
    show(t) {
      const k = E.outQuad(O.prog(t, OPEN + 0.06, OPEN + 0.25));
      return { notes: k < 1 ? 1 : 0, 'write-empty': k };
    },
  });

  // Write, then format: the chapter number, the title and the first
  // paragraph are typed, and the note's own action opens the preview.
  const FLIP = 6.0, TYPED = 5.25;
  const ROWS = O.shot('write').rows.slice(0, 17);
  const typing = O.typist(ROWS, [[2.5, 2.9, 0, 1], [3.0, 3.45, 1, 2], [3.6, TYPED, 2, 17]]);
  let caret;
  O.tap([FLIP], O.mid('write', 'preview'));
  O.sections.push({
    b: O.T.write,
    frames: ['write-empty', 'write', 'read'],
    init(win) {
      caret = O.h('<div class="caret"></div>');
      win.el.appendChild(caret);
    },
    show(t) {
      const flip = E.inOutCubic(O.prog(t, FLIP + 0.08, FLIP + 0.38));
      return { 'write-empty': flip < 1 ? 1 : 0, write: flip < 1 ? 1 : 0, read: flip };
    },
    update(t, win, on) {
      const { shown, at } = typing(t);
      win.layers.write.style.clipPath = O.rowsClip(ROWS, shown, 5);
      O.setVis(caret, on && at !== null && t < FLIP);
      O.caretAt(caret, at, t, TYPED);
    },
  });

  // Design in the panel: each tap steps a control, and the pages are
  // set again from it. A drag scrolls the panel to the next control.
  const SIZE = [7.3, 7.6, 7.9], SPACING = [9.5, 9.8, 10.1], JUSTIFY = 10.75;
  const CAP = 12.3, FONT = 12.95, FACE = 13.6;
  const DOWN = [8.35, 8.85], FURTHER = [11.25, 11.85], UP = [14.05, 14.65];
  const PANEL = O.shot('read').marks.scroller;
  const FINGER = PANEL.x + PANEL.width * 0.6;
  O.tap(SIZE, O.mid('read', 'size-up'));
  O.drag(DOWN[0], DOWN[1], [FINGER, 640], [FINGER, 640 - (O.shot('design-4').scroll - O.shot('design-3').scroll)]);
  O.tap(SPACING, O.mid('design-4', 'spacing-up'));
  O.tap([JUSTIFY], O.mid('design-7', 'justify'));
  // A flick: the finger lifts, and the panel runs on.
  O.drag(FURTHER[0], FURTHER[0] + 0.3, [FINGER, 660], [FINGER, 260]);
  O.tap([CAP], O.mid('design-9', 'drop-cap'));
  O.tap([FONT], O.mid('design-10', 'cap-font'));
  O.tap([FACE], O.mid('design-11', 'option'));
  O.drag(UP[0], UP[0] + 0.3, [FINGER, 260], [FINGER, 660]);
  const STEPS = [
    ...SIZE.map((t, i) => [t + 0.06, `design-${i + 1}`, 0.14]),
    [DOWN[1], 'design-4', 0],
    ...SPACING.map((t, i) => [t + 0.06, `design-${i + 5}`, 0.14]),
    [JUSTIFY + 0.06, 'design-8', 0.14],
    [FURTHER[1], 'design-9', 0],
    [CAP + 0.06, 'design-10', 0.14],
    [FONT + 0.06, 'design-11', 0.14],
    [FACE + 0.06, 'design-12', 0.14],
    [UP[1], 'design-13', 0],
  ];
  let scrolling;
  O.sections.push({
    b: O.T.design,
    frames: ['read', ...STEPS.map((step) => step[1])],
    init(win) {
      scrolling = O.scrolls(win, [
        [DOWN, ['design-3', 'scroll-a', 'design-4']],
        [FURTHER, ['design-8', 'scroll-b-1', 'scroll-b-2', 'design-9']],
        [UP, ['design-12', 'scroll-c-1', 'scroll-c-2', 'scroll-c-3', 'design-13']],
      ]);
    },
    show: (t) => O.stepped('read', STEPS, t),
    update: (t, win, on) => scrolling(t, on),
  });

  // Go further in CSS: the panel turns to the book's own CSS, a rule is
  // typed at its end, and the pages take it once the typing stops.
  const TO_CSS = 15.4, INTO = 16.4, TYPE = [16.75, 19.0], SET = 19.3;
  const CODE = O.shot('css-2').marks.code;
  // The rule's rows, the closing brace last.
  const RULE = O.shot('css-2').rows;
  const GUTTER = CODE.x + 2;
  let covers, mark;
  O.tap([TO_CSS], O.mid('design-13', 'css'));
  O.tap([INTO], [CODE.x + CODE.width * 0.45, CODE.y + CODE.height - 70]);
  O.sections.push({
    b: O.T.css,
    // The last frame twice: its editor while the rule is typed, and all
    // of it once the pages are set again.
    frames: ['design-13', 'css-0', 'css-1', 'css-2', 'css-2-page@css-2'],
    init(win) {
      covers = RULE.map(() => {
        const c = O.h('<div class="cover"></div>');
        win.el.insertBefore(c, win.layers['css-2-page']);
        return c;
      });
      mark = O.h('<div class="caret"></div>');
      win.el.appendChild(mark);
      win.layers['css-2'].style.clipPath = O.boxClip(CODE);
    },
    show(t) {
      const toCss = E.outQuad(O.prog(t, TO_CSS + 0.06, TO_CSS + 0.2));
      return {
        'design-13': toCss < 1 ? 1 : 0,
        'css-0': t < INTO + 0.06 ? toCss : 0,
        'css-1': t >= INTO + 0.06 ? 1 : 0,
        'css-2': t >= TYPE[0] - 0.05 ? 1 : 0,
        'css-2-page': E.outQuad(O.prog(t, SET, SET + 0.25)),
      };
    },
    update(t, win, on) {
      const busy = on && t >= TYPE[0] - 0.05;
      // Rows not yet typed are covered, gutter and all.
      const { shown, caret: at } = O.typed(RULE, t, TYPE[0], TYPE[1]);
      covers.forEach((c, i) => {
        const r = RULE[i];
        const hide = busy && shown[i] < r.width;
        O.setVis(c, hide);
        if (!hide) return;
        const x = shown[i] > 0 ? r.x + shown[i] : GUTTER;
        c.style.left = x + 'px';
        c.style.top = r.y - 3 + 'px';
        c.style.width = CODE.x + CODE.width - 3 - x + 'px';
        c.style.height = r.height + 7 + 'px';
      });
      O.setVis(mark, busy && t < SET);
      O.caretAt(mark, at, t, TYPE[1]);
    },
  });

  // Export: the action in the preview's bar opens the dialog, preflight
  // has passed, and one tap writes the files.
  const ASK = 20.8, WRITE = 22.0;
  O.tap([ASK], O.mid('css-2', 'export'));
  O.tap([WRITE], O.mid('export-0', 'write'));
  O.sections.push({
    b: O.T.export,
    frames: ['css-2-page@css-2', 'export-0', 'export-1'],
    show(t) {
      const open = E.outCubic(O.prog(t, ASK + 0.06, ASK + 0.3));
      const done = E.outCubic(O.prog(t, WRITE + 0.3, WRITE + 0.55));
      return { 'css-2-page': open < 1 ? 1 : 0, 'export-0': done < 1 ? open : 0, 'export-1': done };
    },
  });
})();
