// Every scene draws itself as a pure function of time, so a moment
// looks the same whether the page plays or the renderer seeks to it.
(function () {
  const O = (window.O = window.O || {});

  O.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  O.lerp = (a, b, t) => a + (b - a) * t;
  O.prog = (t, a, b) => O.clamp((t - a) / (b - a));

  const E = (O.E = {
    outQuad: (x) => 1 - (1 - x) * (1 - x),
    inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    inCubic: (x) => x * x * x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  });

  // Fades in over [a, a + din] and out over [b - dout, b].
  O.env = (t, a, b, din, dout) => Math.min(E.outCubic(O.prog(t, a, a + din)), 1 - E.inCubic(O.prog(t, b - dout, b)));

  O.h = function (html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  };

  // A keyed point: frames is [[t, [x, y]], ...], eased between keys.
  O.keys = function (t, frames) {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 0; i < frames.length - 1; i++) {
      const [t0, v0] = frames[i];
      const [t1, v1] = frames[i + 1];
      if (t <= t1) {
        const k = E.inOutCubic(O.prog(t, t0, t1));
        return v0.map((x, j) => O.lerp(x, v1[j], k));
      }
    }
    return frames[frames.length - 1][1];
  };

  O.setVis = (el, on) => {
    const v = on ? '' : 'none';
    if (el.style.display !== v) el.style.display = v;
  };
})();
