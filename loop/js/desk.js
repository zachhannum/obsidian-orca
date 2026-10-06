// The desk: one Obsidian window that stays on screen for the whole
// loop. Each section adds its frames, and the one whose span holds the
// time chooses which of them show.
(function () {
  const O = window.O, E = O.E;
  let win, seam;

  O.buildDesk = function (stage) {
    const names = [...new Set(O.sections.flatMap((s) => s.frames))];
    win = O.win(stage, names);
    O.sections.forEach((s) => s.init && s.init(win));
    // The loop ends on the frame it starts on, over everything else.
    seam = O.h(`<img class="ol" src="${O.UI}/notes.jpg" alt="">`);
    win.el.appendChild(seam);
  };

  O.drawDesk = function (t) {
    seam.style.opacity = E.inOutQuad(O.prog(t, O.LAST - O.SEAM, O.LAST - 1 / O.FPS));
    const on = O.sections.find((s) => t < s.b) || O.sections[O.sections.length - 1];
    win.show(on.show(t));
    O.sections.forEach((s) => {
      if (s.update) s.update(t, win, s === on);
    });
  };
})();
