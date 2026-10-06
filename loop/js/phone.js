// The loop on a phone, which shows one pane at a time. The navigator
// and the design panel are drawers that slide over the page, and export
// is a sheet. Every state on screen is a frame of Obsidian's own phone
// layout, and a slide moves the frames either side of it.
(function () {
  const O = window.O, E = O.E;
  const W = O.WIN.w;

  // Chapters stay notes: a tap on a chapter opens it, empty, and the
  // navigator's drawer slides away.
  const OPEN = 1.25, AWAY = [OPEN + 0.14, OPEN + 0.5];
  const SHELF = O.shot('notes').marks.drawer;
  O.tap([OPEN], O.mid('notes', 'chapter'));
  O.sections.push({
    b: O.T.notes,
    frames: ['notes', 'write-empty', 'shelf@notes'],
    init(win) {
      win.layers.shelf.style.clipPath = O.boxClip(SHELF);
    },
    show(t) {
      const sliding = t >= AWAY[0];
      return { notes: sliding ? 0 : 1, 'write-empty': sliding ? 1 : 0, shelf: sliding && t < AWAY[1] ? 1 : 0 };
    },
    update(t, win) {
      const k = E.inOutCubic(O.prog(t, AWAY[0], AWAY[1]));
      O.moved(win.layers.shelf, -SHELF.width * k, 0);
      O.moved(win.layers['write-empty'], SHELF.width * (1 - k), 0);
    },
  });

  // Write, then format: the chapter number, the title and the first
  // paragraph are typed, and the note's own action opens the preview.
  const FLIP = 6.2, TYPED = 5.45;
  const ROWS = O.shot('write').rows.slice(0, 17);
  const typing = O.typist(ROWS, [[2.7, 3.1, 0, 1], [3.2, 3.65, 1, 2], [3.8, TYPED, 2, 17]]);
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

  // Design in the panel: a swipe from the edge brings the drawer over
  // the page, each tap steps a control, and a swipe back shows the page
  // as the taps have set it.
  const IN = [7.55, 7.95], OUT = [13.0, 13.4];
  const SIZE = [8.5, 8.8, 9.1], SPACING = [10.75, 11.05, 11.35], JUSTIFY = 12.0;
  const DOWN = [9.6, 10.1];
  const DRAWER = O.shot('design-0').marks.drawer;
  const PANEL = O.shot('design-0').marks.scroller;
  const FINGER = PANEL.x + PANEL.width * 0.62;
  O.drag(IN[0], IN[1], [W - 6, 430], [W - 6 - DRAWER.width * 0.85, 430]);
  O.tap(SIZE, O.mid('design-0', 'size-up'));
  O.drag(DOWN[0], DOWN[1], [FINGER, 590], [FINGER, 590 - (O.shot('design-4').scroll - O.shot('design-3').scroll)]);
  O.tap(SPACING, O.mid('design-4', 'spacing-up'));
  O.tap([JUSTIFY], O.mid('design-7', 'justify'));
  O.drag(OUT[0], OUT[1], [DRAWER.x + 30, 430], [DRAWER.x + 30 + DRAWER.width * 0.85, 430]);
  const STEPS = [
    // The drawer is in, and the page behind it dims.
    [IN[1], 'design-0', 0.15],
    ...SIZE.map((t, i) => [t + 0.06, `design-${i + 1}`, 0.14]),
    [DOWN[1], 'design-4', 0],
    ...SPACING.map((t, i) => [t + 0.06, `design-${i + 5}`, 0.14]),
    [JUSTIFY + 0.06, 'design-8', 0.14],
  ];
  let scrolling;
  O.sections.push({
    b: O.T.design,
    frames: ['read', 'set', 'in@design-0', ...STEPS.map((step) => step[1]), 'out@design-8'],
    init(win) {
      win.layers.in.style.clipPath = O.boxClip(DRAWER);
      win.layers.out.style.clipPath = O.boxClip(DRAWER);
      scrolling = O.scrolls(win, [[DOWN, ['design-3', 'scroll-a', 'design-4']]]);
    },
    show(t) {
      if (t >= OUT[0]) return { set: 1, out: t < OUT[1] ? 1 : 0 };
      const map = O.stepped('read', STEPS, t);
      // The drawer alone slides, over the page it pushes aside.
      map.in = t >= IN[0] && !(map['design-0'] >= 1) ? 1 : 0;
      if (map['design-0'] >= 1 || map['design-1'] > 0) map.read = 0;
      return map;
    },
    update(t, win, on) {
      const coming = E.outCubic(O.prog(t, IN[0], IN[1]));
      const going = E.inOutCubic(O.prog(t, OUT[0], OUT[1]));
      O.moved(win.layers.read, -DRAWER.width * coming, 0);
      O.moved(win.layers.in, DRAWER.width * (1 - coming), 0);
      O.moved(win.layers.out, DRAWER.width * going, 0);
      O.moved(win.layers.set, -DRAWER.width * (1 - going), 0);
      scrolling(t, on);
    },
  });

  // Export: the action in the preview's bar brings the sheet up,
  // preflight has passed, and one tap writes the files.
  const ASK = 14.6, UP = [ASK + 0.1, ASK + 0.48], WRITE = 16.0;
  const SHEET = O.shot('export-0').marks.dialog;
  O.tap([ASK], O.mid('set', 'export'));
  O.tap([WRITE], O.mid('export-0', 'write'));
  O.sections.push({
    b: O.T.export,
    // The sheet's frame twice: the page it dims, and the sheet.
    frames: ['set', 'dimmed@export-0', 'export-0', 'export-1'],
    init(win) {
      win.layers.dimmed.style.clipPath = O.boxClip({ x: 0, y: 0, width: W, height: SHEET.y });
      win.layers['export-0'].style.clipPath = O.boxClip(SHEET);
    },
    show(t) {
      const up = E.outCubic(O.prog(t, UP[0], UP[1]));
      const done = E.outCubic(O.prog(t, WRITE + 0.3, WRITE + 0.55));
      return { set: 1, dimmed: up, 'export-0': t >= UP[0] ? 1 : 0, 'export-1': done };
    },
    update(t, win) {
      const up = E.outCubic(O.prog(t, UP[0], UP[1]));
      O.moved(win.layers['export-0'], 0, SHEET.height * (1 - up));
    },
  });
})();
