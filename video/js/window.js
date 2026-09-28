// The Obsidian window, from frames taken of real Obsidian on the sample
// book (e2e/film.spec.ts writes them). A scene stacks frames in one
// window and moves a camera over it; nothing in the window is drawn here.
(function () {
  const O = window.O, E = O.E;
  const F = window.FRAMES;
  const W = F.window.width, H = F.window.height;
  O.WIN = { w: W, h: H };

  O.shot = (name) => {
    const f = F.frames.find((x) => x.name === name);
    if (!f) throw new Error('no frame ' + name);
    return f;
  };
  // The centre of a mark, in window coordinates.
  O.mid = (name, mark) => {
    const m = O.shot(name).marks[mark];
    if (!m) throw new Error(`no mark ${mark} in ${name}`);
    return [m.x + m.width / 2, m.y + m.height / 2];
  };

  // Camera keys are [t, [x, y, scale]]: where the window's top left
  // corner sits on screen, and its scale. O.aim puts a window point at a
  // screen point instead.
  O.HOME = [640, 165, 1];
  O.aim = (fx, fy, s, sx, sy) => [sx - fx * s, sy - fy * s, s];

  // A name can be `layer@frame`, for a frame shown in two layers.
  O.win = function (parent, list) {
    const el = O.h(`<div class="ow"></div>`);
    const layers = {};
    const names = list.map((n) => {
      const [key, file] = n.split('@');
      const img = O.h(`<img class="ol" src="assets/ui/${file || key}.jpg" alt="">`);
      el.appendChild(img);
      layers[key] = img;
      return key;
    });
    parent.appendChild(el);
    let cam = O.HOME;
    return {
      el,
      layers,
      // Only the named frames show, each at its opacity.
      show(map) {
        for (const n of names) {
          const v = map[n] || 0;
          O.setVis(layers[n], v > 0);
          if (v > 0) layers[n].style.opacity = v;
        }
      },
      camera(t, keys) {
        cam = O.keys(t, keys, E.inOutCubic);
        el.style.transform = `translate3d(${cam[0]}px,${cam[1]}px,0) scale(${cam[2]})`;
      },
    };
  };

  // Maps window points to the screen through the camera at time t, for
  // a cursor track.
  O.camMap = (keys) => (t, p) => {
    const [x, y, s] = O.keys(t, keys, E.inOutCubic);
    return [x + p[0] * s, y + p[1] * s];
  };

  // Typing: rows uncover left to right, each over its share of [a, b].
  // Returns the rows with how much of each shows, and where the caret is.
  O.typed = function (rows, t, a, b) {
    const total = rows.reduce((n, r) => n + r.width, 0);
    const k = O.clamp((t - a) / (b - a)) * total;
    let left = k, caret = null;
    const out = rows.map((r) => {
      const w = O.clamp(left, 0, r.width);
      left -= r.width;
      if (w > 0 || caret === null) caret = [r.x + w, r.y, r.height];
      return w;
    });
    if (t < a) caret = [rows[0].x, rows[0].y, rows[0].height];
    return { shown: out, caret };
  };

  // A clip path that holds the uncovered part of each row.
  O.rowsClip = function (rows, shown, pad) {
    let d = '';
    rows.forEach((r, i) => {
      const w = shown[i];
      if (w <= 0) return;
      const x = r.x - pad, y = r.y - pad, ww = w + pad * (w >= r.width ? 2 : 1), hh = r.height + pad * 2;
      d += `M${x} ${y}h${ww}v${hh}h${-ww}Z`;
    });
    return d ? `path('${d}')` : 'inset(50%)';
  };

  // Key sounds over a typed span, a little uneven, as hands are.
  O.keySounds = function (a, b) {
    const r = O.rng(Math.round(a * 100));
    for (let t = a; t < b; t += 0.042 + r() * 0.03) O.cues.keys.push(t);
  };
})();
