// The desk: one Obsidian window that stays on screen from writing to
// export. Each section (write, design, CSS, export) adds its frames,
// its camera keys and its caption, and the camera moves on without a
// cut between them.
(function () {
  const O = window.O, E = O.E;
  O.sections = [];
  let cam = null;

  // The camera keys of every section, in time order.
  O.deskCam = () => {
    if (!cam) cam = O.sections.flatMap((s) => s.cam).sort((a, b) => a[0] - b[0]);
    return cam;
  };

  // Window points to the screen, for a cursor track over the desk.
  O.deskMap = (t, p) => O.camMap(O.deskCam())(t, p);

  O.scenes.push({
    id: 'desk', a: O.T.write[0], b: O.T.export[1], post: 0.1,
    init() {
      const el = this.el;
      const names = [...new Set(O.sections.flatMap((s) => s.frames))];
      this.win = O.win(el, names);
      O.sections.forEach((s) => s.init && s.init(this.win));
      el.appendChild(O.h('<div class="shade"></div>'));
      O.sections.forEach((s) => {
        s.caption = O.caption(s.cap);
        el.appendChild(s.caption.el);
      });
      O.cues.impacts.push({ t: this.a });
    },
    update(t) {
      const [A, B] = [this.a, this.b];
      // In: the window rises into place. Out: it falls away into the
      // pages the export wrote.
      const ki = E.outCubic(O.prog(t, A, A + 0.8));
      const ko = E.inCubic(O.prog(t, B - 0.55, B + 0.1));
      this.el.style.opacity = Math.min(ki, 1 - ko);
      this.el.style.transformOrigin = '1240px 540px';
      this.el.style.transform = `translate3d(0,${(1 - ki) * 50}px,0) scale(${O.lerp(1, 0.86, ko)})`;

      this.win.camera(t, O.deskCam());
      const on = O.sections.find((s) => t < s.b) || O.sections[O.sections.length - 1];
      this.win.show(on.show(t));
      O.sections.forEach((s) => {
        s.caption.update(t, s.capIn, s.capOut);
        if (s.update) s.update(t, this.win, s === on);
      });
    },
  });
})();
