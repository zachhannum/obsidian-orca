// Go further in CSS: the panel turns to the book's own CSS, a rule is
// typed at its end, and the pages take it once the typing stops.
(function () {
  const O = window.O, E = O.E;
  const TO_CSS = 30.85, INTO = 32.0, TYPE = [32.35, 34.6], SET = 34.9;
  const CODE = O.shot('css-2').marks.code;
  // The rule's rows, the closing brace last.
  const ROWS = O.shot('css-2').rows;
  const GUTTER = CODE.x + 2;
  const SWITCH = O.mid('design-12', 'css');
  const END = [1000, 690];
  let covers, caret;

  O.cursorTracks.push({
    a: 30.1, b: 32.4,
    frames: [[30.1, [900, 640]], [30.7, SWITCH], [TO_CSS + 0.2, SWITCH], [31.8, END], [32.4, [END[0] + 30, END[1] + 60]]],
    clicks: [TO_CSS, INTO],
  });

  O.sections.push({
    b: O.T.css,
    // The last frame twice: its editor while the rule is typed, and all
    // of it once the pages are set again.
    frames: ['design-12', 'css-0', 'css-1', 'css-2', 'css-2-page@css-2'],
    init(win) {
      covers = ROWS.map(() => {
        const c = O.h('<div class="cover"></div>');
        win.el.insertBefore(c, win.layers['css-2-page']);
        return c;
      });
      caret = O.h('<div class="caret"></div>');
      win.el.appendChild(caret);
      win.layers['css-2'].style.clipPath = O.boxClip(CODE);
    },
    show(t) {
      const toCss = E.outQuad(O.prog(t, TO_CSS + 0.06, TO_CSS + 0.2));
      return {
        'design-12': toCss < 1 ? 1 : 0,
        'css-0': t < INTO + 0.06 ? toCss : 0,
        'css-1': t >= INTO + 0.06 ? 1 : 0,
        'css-2': t >= TYPE[0] - 0.05 ? 1 : 0,
        'css-2-page': E.outQuad(O.prog(t, SET, SET + 0.25)),
      };
    },
    update(t, win, on) {
      const typing = on && t >= TYPE[0] - 0.05;
      // Rows not yet typed are covered, gutter and all.
      const { shown, caret: at } = O.typed(ROWS, t, TYPE[0], TYPE[1]);
      covers.forEach((c, i) => {
        const r = ROWS[i];
        const hide = typing && shown[i] < r.width;
        O.setVis(c, hide);
        if (!hide) return;
        const x = shown[i] > 0 ? r.x + shown[i] : GUTTER;
        c.style.left = x + 'px';
        c.style.top = r.y - 3 + 'px';
        c.style.width = CODE.x + CODE.width - 3 - x + 'px';
        c.style.height = r.height + 7 + 'px';
      });
      O.setVis(caret, typing && t < 36);
      if (at) {
        caret.style.left = at[0] + 1 + 'px';
        caret.style.top = at[1] - 2 + 'px';
        caret.style.height = at[2] + 4 + 'px';
        caret.style.opacity = t > TYPE[1] && Math.floor((t - TYPE[1]) * 2.4) % 2 === 1 ? 0 : 1;
      }
    },
  });
})();
