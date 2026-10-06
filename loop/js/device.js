// What the scenes of a tablet and of a phone share. Both are timed from
// 0, and both draw a finger in place of the arrow.
(function () {
  const O = window.O, E = O.E;

  // Typing in spans: each is [from, to, first row, the row after the
  // last]. Returns how much of each row shows at a time, and the caret.
  O.typist = function (rows, spans) {
    return function (t) {
      const shown = rows.map(() => 0);
      let at = null;
      let done = -Infinity;
      for (const [a, b, i, j] of spans) {
        const part = O.typed(rows.slice(i, j), t, a, b);
        part.shown.forEach((w, k) => (shown[i + k] = w));
        // The caret waits at the end of a span until the next one starts.
        if (t >= a - 0.4 && t >= done) at = part.caret;
        done = b;
      }
      return { shown, at };
    };
  };

  // Puts a caret at [x, y, height]. It blinks once the typing has stopped.
  O.caretAt = function (caret, at, t, stopped) {
    if (!at) return;
    caret.style.left = at[0] + 1 + 'px';
    caret.style.top = at[1] - 2 + 'px';
    caret.style.height = at[2] + 4 + 'px';
    caret.style.opacity = t > stopped && Math.floor((t - stopped) * 2.4) % 2 === 1 ? 0 : 1;
  };

  // The frames on screen at a time, from steps of [time, frame, seconds
  // it fades in over] in order. The frame before the latest step shows
  // under the one after it.
  O.stepped = function (first, steps, t) {
    const map = { [first]: 1 };
    let under = first;
    for (const [c, name, fade] of steps) {
      if (t < c) break;
      const k = fade ? E.outQuad(O.prog(t, c, c + fade)) : 1;
      map[name] = k;
      if (k >= 1 && name !== under) {
        map[under] = 0;
        under = name;
      }
    }
    return map;
  };

  // The scrolls of the design panel: each is [[from, to], the frames
  // the scroll passes]. Returns what draws them at a time.
  O.scrolls = function (win, list) {
    const strips = list.map(([span, names]) => ({
      span,
      from: O.shot(names[0]).scroll,
      to: O.shot(names[names.length - 1]).scroll,
      strip: O.strip(win, names),
    }));
    return function (t, on) {
      for (const { span: [a, b], from, to, strip } of strips) {
        const scrolling = on && t >= a && t < b;
        O.setVis(strip.el, scrolling);
        if (scrolling) strip.at(O.lerp(from, to, E.inOutCubic(O.prog(t, a, b))));
      }
    };
  };

  // Moves a frame sideways or down by a distance in pixels.
  O.moved = function (layer, x, y) {
    layer.style.transform = x || y ? `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)` : '';
  };
})();
