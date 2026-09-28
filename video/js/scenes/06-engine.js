// The engine: one path from notes to pages, with preview and export
// drawn from one session.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.engine;
  const NODES = [
    { id: 'notes', x: 360, y: 660, w: 240, t: 'Notes', s: 'Markdown', ic: 'file' },
    { id: 'model', x: 700, y: 660, w: 270, t: 'Book model', s: 'reading order', ic: 'book' },
    { id: 'eng', x: 1070, y: 660, w: 280, t: 'fleuron', s: 'WebAssembly', ic: null, hot: true },
    { id: 'prev', x: 1460, y: 560, w: 270, t: 'Preview', s: 'pages on screen', ic: 'sliders' },
    { id: 'pdf', x: 1460, y: 760, w: 270, t: 'PDF', s: 'the same pages', ic: 'down' },
  ];
  const EDGES = [[0, 1], [1, 2], [2, 3], [2, 4]];
  const tNode = (i) => 45.55 + i * 0.2;

  let cap, nodes, paths, pulses, brace, braceLbl, glow;

  O.scenes.push({
    id: 'engine', a: A, b: B, pre: 0.3, post: 0.2,
    init() {
      const el = this.el;
      cap = O.caption({ num: '06', top: 150, title: 'Set by <i>fleuron.</i>', sub: 'A typesetting engine, built to WebAssembly, runs inside the plugin. Preview and export come from one session.' });
      cap.el.style.cssText += ';left:0;width:1920px;text-align:center';
      cap.el.querySelector('.cap-num').style.justifyContent = 'center';
      cap.el.querySelector('.cap-sub').style.cssText += ';max-width:760px;margin-left:auto;margin-right:auto';
      el.innerHTML = `
        <style>
          #sc-engine .nd{position:absolute;height:120px;border-radius:16px;background:rgba(16,19,23,.92);border:1px solid var(--o-border);display:flex;align-items:center;gap:16px;padding:0 24px;font-family:var(--ui);box-shadow:0 30px 60px -20px rgba(0,0,0,.9)}
          #sc-engine .nd .ic{width:48px;height:48px;border-radius:12px;background:var(--o-chip);display:flex;align-items:center;justify-content:center;color:var(--o-muted);flex:none}
          #sc-engine .nd .ic svg{width:24px;height:24px}
          #sc-engine .nd .t{white-space:nowrap;font-size:23px;font-weight:600;color:var(--text)}
          #sc-engine .nd .s{white-space:nowrap;font-family:var(--display);font-size:15px;color:var(--faint);margin-top:6px}
          #sc-engine .nd.hot{background:linear-gradient(160deg,#4f52d9,#3730a3);border-color:#8285f5}
          #sc-engine .nd.hot .t{font-family:var(--title);font-size:36px;font-weight:600;font-variation-settings:'wdth' 60,'slnt' -10;text-transform:uppercase;letter-spacing:.01em}
          #sc-engine .nd.hot .s{color:#c7c9fd}
          #sc-engine .nd.hot .ic{background:rgba(255,255,255,.14);color:#fff}
          #sc-engine svg.ed{position:absolute;inset:0;overflow:visible}
          #sc-engine .glow{position:absolute;width:560px;height:560px;left:${1070 - 280}px;top:${660 - 280}px;border-radius:50%;background:radial-gradient(circle,rgba(99,102,241,.42),rgba(99,102,241,0) 65%)}
          #sc-engine .brl{position:absolute;left:1656px;top:648px;font-family:var(--display);font-size:17px;color:var(--accent-soft);white-space:nowrap}
        </style>
        <div class="glow"></div>
        <svg class="ed" width="1920" height="1080"></svg>
        ${NODES.map((n) => `<div class="nd${n.hot ? ' hot' : ''}" style="left:${n.x - n.w / 2}px;top:${n.y - 60}px;width:${n.w}px"><div class="ic">${n.ic ? O.icon[n.ic] : O.tail.replace('<svg ', '<svg style="width:30px;height:18px" ')}</div><div><div class="t">${n.t}</div><div class="s">${n.s}</div></div></div>`).join('')}
        <div class="brl">one session</div>`;
      el.appendChild(cap.el);
      nodes = O.$$(el, '.nd');
      glow = el.querySelector('.glow');
      braceLbl = el.querySelector('.brl');
      const svg = el.querySelector('svg.ed');
      const NS = 'http://www.w3.org/2000/svg';
      paths = EDGES.map(([a, b]) => {
        const na = NODES[a], nb = NODES[b];
        const x1 = na.x + na.w / 2, y1 = na.y, x2 = nb.x - nb.w / 2, y2 = nb.y;
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', `M${x1} ${y1} C${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#3a4048');
        p.setAttribute('stroke-width', '2');
        p.setAttribute('pathLength', '1');
        p.setAttribute('stroke-dasharray', '1');
        svg.appendChild(p);
        return p;
      });
      pulses = [];
      paths.forEach((p, i) => {
        for (let k = 0; k < 3; k++) {
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('r', '5');
          c.setAttribute('fill', '#c7c9fd');
          c.style.filter = 'drop-shadow(0 0 6px #818cf8)';
          svg.appendChild(c);
          pulses.push({ c, p, i, k, len: 0 });
        }
      });
      brace = document.createElementNS(NS, 'path');
      brace.setAttribute('d', 'M1605 520 Q1622 520 1622 540 L1622 640 Q1622 660 1636 660 Q1622 660 1622 680 L1622 780 Q1622 800 1605 800');
      brace.setAttribute('fill', 'none');
      brace.setAttribute('stroke', '#818cf8');
      brace.setAttribute('stroke-width', '2');
      brace.setAttribute('pathLength', '1');
      brace.setAttribute('stroke-dasharray', '1');
      svg.appendChild(brace);
      NODES.forEach((n, i) => O.cues.ticks.push({ t: tNode(i) + 0.05, n: i, soft: true }));
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 0.9, dout: 0.7, post: 0.2 });
      cap.update(t, 45.2, 50.0);
      nodes.forEach((nd, i) => {
        const k = E.outBack(O.prog(t, tNode(i), tNode(i) + 0.55));
        nd.style.opacity = O.clamp(k * 1.5);
        nd.style.transform = `translate3d(0,${(1 - k) * 30}px,0) scale(${O.lerp(0.85, 1, k)})`;
      });
      const gk = O.tw(t, tNode(2), tNode(2) + 0.8) * (0.8 + 0.2 * Math.sin(t * 3.2));
      glow.style.opacity = gk;
      glow.style.transform = `scale(${0.9 + 0.1 * Math.sin(t * 2.1)})`;
      paths.forEach((p, i) => {
        const a = tNode(EDGES[i][0]) + 0.25;
        p.setAttribute('stroke-dashoffset', String(1 - E.inOutCubic(O.prog(t, a, a + 0.5))));
        if (!p._len) p._len = p.getTotalLength();
      });
      pulses.forEach((u) => {
        const st = tNode(EDGES[u.i][0]) + 0.8;
        if (t < st) { u.c.style.display = 'none'; return; }
        u.c.style.display = '';
        const ph = ((t - st) * 0.9 + u.k / 3) % 1;
        const pt = u.p.getPointAtLength(ph * u.p._len);
        u.c.setAttribute('cx', pt.x);
        u.c.setAttribute('cy', pt.y);
        u.c.style.opacity = Math.sin(ph * Math.PI) * O.tw(t, st, st + 0.3);
      });
      brace.setAttribute('stroke-dashoffset', String(1 - E.inOutCubic(O.prog(t, 47.3, 47.9))));
      const bl = E.outCubic(O.prog(t, 47.7, 48.2));
      braceLbl.style.opacity = bl;
      braceLbl.style.transform = `translate3d(${(1 - bl) * -12}px,0,0)`;
    },
  });
})();
