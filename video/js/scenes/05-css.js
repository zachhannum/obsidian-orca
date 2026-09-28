// Go further in CSS: the panel turns to the book's own CSS, a rule is
// typed at its end, and the pages take it once the typing stops.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.css;
  const TO_CSS = 30.85, INTO = 32.0, TYPE = [32.35, 34.55], SET = 34.85;
  const CODE = O.shot('css-2').marks.code;
  // The rule's rows, as far as the editor shows them.
  const ROWS = O.shot('css-2').rows.filter((r) => r.y >= 590 && r.y + r.height <= CODE.y + CODE.height);
  const GUTTER = CODE.x + 2;
  const DROP = [495, 410];
  const SWITCH = O.mid('design-0', 'css');
  const END = [1000, 690];

  const CAM = [
    [A, O.aim(760, 420, 1.2, 1330, 560)],
    [30.4, O.HOME],
    [31.1, O.HOME],
    [31.9, O.aim(1000, 560, 1.55, 1330, 560)],
    [34.6, O.aim(1000, 600, 1.55, 1330, 560)],
    [35.6, O.aim(DROP[0] + 60, DROP[1] - 30, 2.1, 1250, 560)],
    [B, O.aim(DROP[0] + 60, DROP[1] - 30, 2.25, 1250, 560)],
  ];

  let cap, win, covers, caret;

  O.scenes.push({
    id: 'css', a: A, b: B, pre: 0.3, post: 0.3,
    init() {
      const el = this.el;
      // The last frame twice: its editor while the rule is typed, and all
      // of it once the pages are set again.
      win = O.win(el, ['design-8', 'css-0', 'css-1', 'css-2', 'css-2-page@css-2']);
      covers = ROWS.map(() => {
        const c = O.h('<div class="cover"></div>');
        win.el.insertBefore(c, win.layers['css-2-page']);
        return c;
      });
      caret = O.h('<div class="caret"></div>');
      win.el.appendChild(caret);
      el.appendChild(O.h('<div class="shade"></div>'));
      cap = O.caption({
        num: '04', top: 330,
        title: 'Go further<br>in <i>CSS.</i>',
        sub: 'Switch the panel to the book’s CSS and write any rule. The pages take it when you stop typing.',
      });
      el.appendChild(cap.el);

      O.cursorTracks.push({
        a: 30.1, b: 32.4,
        frames: [[30.1, [900, 640]], [30.7, SWITCH], [TO_CSS + 0.2, SWITCH], [31.8, END], [32.4, [END[0] + 30, END[1] + 60]]],
        clicks: [TO_CSS, INTO],
        map: O.camMap(CAM),
      });
      O.cues.clicks.push(TO_CSS, INTO);
      O.keySounds(TYPE[0], TYPE[1]);
      O.cues.pops.push(SET + 0.05);
      O.cues.whooshes.push({ t: 35.2, soft: true }, 37.45);
      O.cues.impacts.push({ t: 30 });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 0.3, dout: 0.7, post: 0.3 });
      cap.update(t, 30.25, 36.9);
      win.camera(t, CAM);

      const toCss = E.outQuad(O.prog(t, TO_CSS + 0.06, TO_CSS + 0.2));
      const typing = t >= TYPE[0] - 0.05;
      const set = E.outQuad(O.prog(t, SET, SET + 0.25));
      win.show({
        'design-8': toCss < 1 ? 1 : 0,
        'css-0': t < INTO + 0.06 ? toCss : 0,
        'css-1': t >= INTO + 0.06 ? 1 : 0,
        'css-2': typing ? 1 : 0,
        'css-2-page': set,
      });
      win.layers['css-2'].style.clipPath = `inset(${CODE.y}px ${1200 - CODE.x - CODE.width}px ${750 - CODE.y - CODE.height}px ${CODE.x}px)`;

      // Rows not yet typed are covered, gutter and all.
      const { shown, caret: at } = O.typed(ROWS, t, TYPE[0], TYPE[1]);
      covers.forEach((c, i) => {
        const r = ROWS[i];
        const on = typing && shown[i] < r.width;
        O.setVis(c, on);
        if (!on) return;
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
