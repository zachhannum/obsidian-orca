// Chapters stay notes: the navigator lists the book's notes, and the
// book note holds the details, the design and the reading order.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.notes;

  // The camera reads down the navigator, then across to the book note.
  const CAM = [
    [A, O.aim(190, 300, 1.5, 1060, 470)],
    [10.4, O.aim(190, 420, 1.5, 1060, 560)],
    [12.2, O.aim(560, 330, 1.22, 1390, 520)],
    [13.8, O.aim(620, 400, 1.22, 1390, 520)],
    [B, O.HOME],
  ];

  let cap, win;

  O.scenes.push({
    id: 'notes', a: A, b: B, pre: 0.1, post: 0.3,
    init() {
      const el = this.el;
      win = O.win(el, ['notes']);
      el.appendChild(O.h('<div class="shade"></div>'));
      cap = O.caption({
        num: '01', top: 330,
        title: 'Chapters<br>stay <i>notes.</i>',
        sub: 'Each chapter is a Markdown note. The book note lists them in reading order and holds the details and the design.',
      });
      el.appendChild(cap.el);
      O.cues.whooshes.push(14.95);
      O.cues.impacts.push({ t: 7.5 });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { din: 0.2, pre: 0.1, dout: 0.8, post: 0.3 });
      cap.update(t, 7.75, 14.3);
      win.show({ notes: 1 });
      win.camera(t, CAM);
      const k = E.outQuart(O.prog(t, 7.9, 9.0));
      win.el.style.opacity = k;
    },
  });
})();
