// Shared helpers. Every scene draws itself as a pure function of time,
// so any frame renders the same way whether it plays live or is captured.
(function () {
  const O = (window.O = window.O || {});

  O.W = 1920;
  O.H = 1080;
  O.FPS = 60;

  O.clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  O.lerp = (a, b, t) => a + (b - a) * t;
  O.prog = (t, a, b) => O.clamp((t - a) / (b - a));

  const E = (O.E = {
    linear: (x) => x,
    inQuad: (x) => x * x,
    outQuad: (x) => 1 - (1 - x) * (1 - x),
    inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    inCubic: (x) => x * x * x,
    outCubic: (x) => 1 - Math.pow(1 - x, 3),
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outQuart: (x) => 1 - Math.pow(1 - x, 4),
    inOutQuart: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
    outQuint: (x) => 1 - Math.pow(1 - x, 5),
    inOutQuint: (x) => (x < 0.5 ? 16 * Math.pow(x, 5) : 1 - Math.pow(-2 * x + 2, 5) / 2),
    outExpo: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inExpo: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
    inOutExpo: (x) =>
      x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
    outBack: (x) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    },
    outBackSoft: (x) => {
      const c1 = 0.9, c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    },
    inBack: (x) => 2.70158 * x * x * x - 1.70158 * x * x,
  });

  O.tw = (t, a, b, e) => (e || E.outCubic)(O.prog(t, a, b));

  // Fade in over [a, a+din], out over [b-dout, b].
  O.env = (t, a, b, din = 0.6, dout = 0.6, ei = E.outCubic, eo = E.inCubic) =>
    Math.min(ei(O.prog(t, a, a + din)), 1 - eo(O.prog(t, b - dout, b)));

  O.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  O.h = function (html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  };

  O.$ = (root, sel) => root.querySelector(sel);
  O.$$ = (root, sel) => Array.from(root.querySelectorAll(sel));

  // Keyframed value: frames = [[t, v], ...] where v is a number or array.
  O.keys = function (t, frames, ease) {
    ease = ease || E.inOutCubic;
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 0; i < frames.length - 1; i++) {
      const [t0, v0, e] = frames[i];
      const [t1, v1] = frames[i + 1];
      if (t <= t1) {
        const k = (e || ease)(O.prog(t, t0, t1));
        if (Array.isArray(v0)) return v0.map((x, j) => O.lerp(x, v1[j], k));
        return O.lerp(v0, v1, k);
      }
    }
    return frames[frames.length - 1][1];
  };

  // Wrap each word of an element in a mask, for line-by-line reveals.
  O.splitWords = function (el) {
    const out = [];
    const walk = (node) => {
      Array.from(node.childNodes).forEach((c) => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
              return;
            }
            const m = document.createElement('span');
            m.className = 'wm';
            const i = document.createElement('span');
            i.className = 'wi';
            i.textContent = part;
            m.appendChild(i);
            frag.appendChild(m);
            out.push(i);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1) walk(c);
      });
    };
    walk(el);
    return out;
  };

  // Wrap each character, keeping spaces as plain text.
  O.splitChars = function (el) {
    const out = [];
    const walk = (node) => {
      Array.from(node.childNodes).forEach((c) => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          Array.from(c.textContent).forEach((ch) => {
            if (ch === ' ') {
              frag.appendChild(document.createTextNode(' '));
              return;
            }
            const s = document.createElement('span');
            s.className = 'ch';
            s.textContent = ch;
            frag.appendChild(s);
            out.push(s);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1) walk(c);
      });
    };
    walk(el);
    return out;
  };

  // Rise-in reveal for a list of spans.
  O.reveal = function (spans, t, start, stagger, dur, opts) {
    opts = opts || {};
    const ease = opts.ease || E.outQuart;
    const dist = opts.dist == null ? 105 : opts.dist;
    spans.forEach((s, i) => {
      const k = ease(O.prog(t, start + i * stagger, start + i * stagger + dur));
      s.style.transform = `translate3d(0,${(1 - k) * dist}%,0)` + (opts.rot ? ` rotate(${(1 - k) * opts.rot}deg)` : '');
      s.style.opacity = opts.fade === false ? '' : String(O.clamp(k * 1.6));
    });
  };

  O.hide = function (spans, t, start, stagger, dur) {
    spans.forEach((s, i) => {
      const k = E.inCubic(O.prog(t, start + i * stagger, start + i * stagger + dur));
      if (k <= 0) return;
      s.style.transform = `translate3d(0,${-k * 105}%,0)`;
      s.style.opacity = String(1 - k);
    });
  };

  // Rect of an element in stage coordinates, ignoring the stage's own scale.
  O.rectIn = function (el, root) {
    const r = el.getBoundingClientRect();
    const b = root.getBoundingClientRect();
    const s = b.width / root.offsetWidth || 1;
    return {
      x: (r.left - b.left) / s,
      y: (r.top - b.top) / s,
      w: r.width / s,
      h: r.height / s,
      cx: (r.left - b.left + r.width / 2) / s,
      cy: (r.top - b.top + r.height / 2) / s,
    };
  };

  O.setVis = (el, on) => {
    const v = on ? '' : 'none';
    if (el.style.display !== v) el.style.display = v;
  };

  // Audio and visual cues shared with the score.
  O.cues = { clicks: [], keys: [], ticks: [], flicks: [], whooshes: [], impacts: [], pops: [] };
})();
