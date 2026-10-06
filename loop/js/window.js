// The Obsidian window, from frames taken of real Obsidian on the sample
// book, which e2e/film.spec.ts writes. A scene stacks frames in one
// window, and nothing in the window is drawn here.
(function () {
  const O = window.O;
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
  // A clip path that keeps a box of the window and hides the rest.
  O.boxClip = (box) => `inset(${box.y}px ${W - box.x - box.width}px ${H - box.y - box.height}px ${box.x}px)`;

  // A name can be `layer@frame`, for a frame shown in two layers.
  O.win = function (parent, list) {
    const el = O.h(`<div class="ow"></div>`);
    const layers = {};
    const names = list.map((n) => {
      const [key, file] = n.split('@');
      const img = O.h(`<img class="ol" src="${O.UI}/${file || key}.jpg" alt="">`);
      el.appendChild(img);
      layers[key] = img;
      return key;
    });
    parent.appendChild(el);
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
    };
  };

  // A scroll of the design panel, drawn from frames of the panel at
  // several scroll positions. Each frame's panel is placed where its
  // content sits, so the frames tile one tall strip under the panel.
  O.strip = function (win, names) {
    const box = O.shot(names[0]).marks.scroller;
    const el = O.h(`<div class="strip" style="left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px"></div>`);
    const imgs = names.map((n) => {
      const img = O.h(`<img class="ol" src="${O.UI}/${n}.jpg" alt="">`);
      img.style.left = -box.x + 'px';
      img.style.top = -box.y + 'px';
      img.style.clipPath = O.boxClip(box);
      el.appendChild(img);
      return [img, O.shot(n).scroll];
    });
    win.el.appendChild(el);
    return {
      el,
      at(scroll) {
        for (const [img, top] of imgs) img.style.transform = `translate3d(0,${(top - scroll).toFixed(2)}px,0)`;
      },
    };
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
})();
