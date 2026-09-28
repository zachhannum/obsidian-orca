// Chapters stay notes: loose chapter notes find their place in the
// reading order the book note lists as links.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.notes;

  const CH = [
    { t: 'Part One', s: 'PART ONE', chip: 'part' },
    { t: 'A squid of colossal dimensions', s: '![[squid-frontispiece.jpg]]' },
    { t: 'A Shifting Reef', s: 'The year 1866 was signalised by a remarkable incident…' },
    { t: 'Pro and Con', s: 'At the period when these events took place, I had just…' },
    { t: 'I Form My Resolution', s: 'Three seconds before the arrival of J. B. Hobson’s letter…' },
    { t: 'Ned Land', s: 'Captain Farragut was a good seaman, worthy of the frigate…' },
  ];
  const SCATTER = [
    [1470, 120, -8], [1030, 800, 7], [1580, 470, 5], [1400, 760, -6], [1080, 300, 9], [1620, 930, -9],
  ];
  const NOTE = { x: 690, y: 150, w: 570 };
  const COL = { x: 1350, y: 262, w: 430, h: 82, pitch: 96 };
  const LINK0 = 470, LROW = 40;
  const tArrive = (i) => 10.35 + i * 0.3;
  const FILE = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>';
  const BOOK = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/></svg>';

  let cap, note, props, bodyH, links, cards, wires, dots;

  O.scenes.push({
    id: 'notes', a: A, b: B, pre: 0.1,
    init() {
      const el = this.el;
      cap = O.caption({
        num: '01', kicker: '', top: 330,
        title: 'Chapters<br>stay <i>notes.</i>',
        sub: 'The book note lists every chapter in reading order, as a link. Its properties hold the details and the design.',
      });
      el.innerHTML = `
        <style>
          #sc-notes{--o-pane:#101317;--o-side:#101317;--o-border:#232930;--o-text:#e9ece8;--o-muted:#9aa3ab;--o-faint:#626b75}
          #sc-notes .win{position:absolute;background:var(--o-pane);color:var(--o-text);font-family:var(--ui);font-size:15px;line-height:1.3;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px var(--o-border),0 60px 120px -30px rgba(0,0,0,.9),0 0 120px -20px rgba(99,102,241,.12)}
          #sc-notes .tabbar{height:46px;display:flex;align-items:center;gap:10px;padding:0 18px;background:var(--o-side);border-bottom:1px solid var(--o-border);color:var(--o-muted);font-size:15px}
          #sc-notes .tabbar .tab{display:flex;align-items:center;gap:9px;color:var(--o-text);height:100%;padding:0 14px;background:var(--o-pane);border-left:1px solid var(--o-border);border-right:1px solid var(--o-border);margin-left:-18px}
          #sc-notes .tabbar svg{color:var(--o-faint);flex:none}
          #sc-notes .chip{font-size:12px;padding:2px 8px;border-radius:10px;background:rgba(99,102,241,.16);color:var(--accent-soft)}
          #sc-notes .note{left:${NOTE.x}px;top:${NOTE.y}px;width:${NOTE.w}px;height:760px}
          #sc-notes .doc{position:absolute;inset:46px 0 0 0;padding:0 42px}
          #sc-notes h1{position:absolute;left:42px;right:42px;top:30px;margin:0;font-size:29px;line-height:1.2;font-weight:700;letter-spacing:-.01em}
          #sc-notes .props{position:absolute;left:42px;right:42px;top:122px;border-top:1px solid var(--o-border);border-bottom:1px solid var(--o-border);padding:6px 0}
          #sc-notes .pr{display:flex;align-items:center;gap:12px;height:36px;font-size:15.5px}
          #sc-notes .pr .k{width:150px;color:var(--o-muted);display:flex;gap:8px;align-items:center}
          #sc-notes .pr .k:before{content:"";width:13px;height:13px;border:1.6px solid var(--o-faint);border-radius:3px;flex:none}
          #sc-notes .pr .v{color:var(--o-text)}
          #sc-notes .bh{position:absolute;left:42px;top:${LINK0 - 66}px;font-size:23px;font-weight:700}
          #sc-notes .ln{position:absolute;left:42px;right:30px;height:${LROW}px;display:flex;align-items:center;gap:1px;font-size:17px;color:var(--o-faint)}
          #sc-notes .ln .b{width:6px;height:6px;border-radius:3px;background:currentColor;opacity:.8;margin:0 16px 0 8px}
          #sc-notes .ln .br{color:var(--o-faint);opacity:.6}
          #sc-notes .ln .chip{margin-left:12px;font-family:var(--mono);font-size:12.5px}
          #sc-notes .card{position:absolute;left:0;top:0;width:${COL.w}px;height:${COL.h}px;background:#14181d;border:1px solid var(--o-border);border-radius:12px;padding:15px 18px;display:flex;gap:14px;box-shadow:0 30px 60px -20px rgba(0,0,0,.9);will-change:transform}
          #sc-notes .card svg{color:var(--o-faint);margin-top:2px}
          #sc-notes .card .tt{font-size:17.5px;font-weight:600;color:var(--o-text);white-space:nowrap;display:flex;gap:10px;align-items:center}
          #sc-notes .card .sn{margin-top:9px;font-size:14px;color:var(--o-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:300px;font-family:var(--mono)}
          #sc-notes .card .no{margin-left:auto;font-family:var(--display);font-size:14px;color:var(--o-faint)}
          #sc-notes svg.wires{position:absolute;inset:0;overflow:visible}
        </style>
        <svg class="wires" width="1920" height="1080"></svg>
        <div class="cards"></div>
        <div class="win note">
          <div class="tabbar"><div class="tab">${BOOK}<span>Twenty Thousand Leagues Under the Sea</span></div></div>
          <div class="doc"></div>
        </div>`;
      el.appendChild(cap.el);
      note = el.querySelector('.note');
      const doc = el.querySelector('.doc');
      doc.innerHTML = `
        <h1>Twenty Thousand Leagues Under the Sea</h1>
        <div class="props">
          ${[['author', 'Jules Verne'], ['language', 'en-GB'], ['trim', '5.5in 8.5in'], ['body-font', 'EB Garamond'], ['body-size', '10.5pt'], ['chapter-drop-cap', '3']]
            .map(([k, v]) => `<div class="pr"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}
        </div>
        <div class="bh">Body</div>
        ${CH.map((c, i) => `<div class="ln" style="top:${LINK0 + i * LROW}px"><span class="b"></span><span class="br">[[</span><span class="lt">${c.t}</span><span class="br">]]</span>${c.chip ? `<span class="chip">${c.chip}</span>` : ''}</div>`).join('')}`;
      props = O.$$(doc, '.pr, h1');
      bodyH = doc.querySelector('.bh');
      links = O.$$(doc, '.ln');

      const cardsEl = el.querySelector('.cards');
      cards = CH.map((c, i) => {
        const d = O.h(`<div class="card">${FILE}<div><div class="tt">${c.t}${c.chip ? `<span class="chip">${c.chip}</span>` : ''}</div><div class="sn">${c.s}</div></div><span class="no">${String(i + 1).padStart(2, '0')}</span></div>`);
        cardsEl.appendChild(d);
        return d;
      });

      const svg = el.querySelector('svg.wires');
      wires = CH.map((c, i) => {
        const x1 = NOTE.x + NOTE.w - 4, y1 = NOTE.y + 46 + LINK0 + LROW / 2 + i * LROW;
        const x2 = COL.x, y2 = COL.y + COL.h / 2 + i * COL.pitch;
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', `M${x1} ${y1} C${x1 + 50} ${y1}, ${x2 - 50} ${y2}, ${x2} ${y2}`);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#8285f5');
        p.setAttribute('stroke-width', '1.6');
        p.setAttribute('pathLength', '1');
        p.setAttribute('stroke-dasharray', '1');
        svg.appendChild(p);
        return p;
      });
      dots = CH.map((c, i) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        g.setAttribute('cx', NOTE.x + NOTE.w - 4);
        g.setAttribute('cy', NOTE.y + 46 + LINK0 + LROW / 2 + i * LROW);
        g.setAttribute('r', '4');
        g.setAttribute('fill', '#a5a7fb');
        svg.appendChild(g);
        return g;
      });
      CH.forEach((c, i) => O.cues.ticks.push({ t: tArrive(i) + 0.5, n: i, soft: true }));
      O.cues.whooshes.push(14.95);
      O.cues.impacts.push({ t: 7.5 });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { din: 0.2, pre: 0.1, dout: 0.6, post: 0 });
      cap.update(t, 7.75, 14.2);

      // The book note settles in, then its details stagger up.
      const nk = E.outQuart(O.prog(t, 8.8, 9.8));
      note.style.opacity = nk;
      note.style.transform = `translate3d(${(1 - nk) * 50}px,0,0) perspective(1600px) rotateY(${(1 - nk) * -12}deg)`;
      props.forEach((p, i) => {
        const k = E.outCubic(O.prog(t, 9.15 + i * 0.06, 9.75 + i * 0.06));
        p.style.opacity = k;
        p.style.transform = `translate3d(0,${(1 - k) * 12}px,0)`;
      });
      const bk = E.outCubic(O.prog(t, 9.6, 10.2));
      bodyH.style.opacity = bk;
      links.forEach((l, i) => {
        const k = E.outCubic(O.prog(t, 9.75 + i * 0.05, 10.3 + i * 0.05));
        const lit = E.outCubic(O.prog(t, tArrive(i) + 0.45, tArrive(i) + 0.8));
        l.style.opacity = k;
        l.style.transform = `translate3d(${(1 - k) * 14}px,0,0)`;
        l.style.color = lit > 0 ? `rgb(${O.lerp(98, 165, lit)},${O.lerp(107, 167, lit)},${O.lerp(117, 251, lit)})` : '';
      });

      // Loose notes drift, then fly to their place in the order.
      cards.forEach((c, i) => {
        const [sx, sy, sr] = SCATTER[i];
        const ink = E.outCubic(O.prog(t, 7.7 + i * 0.12, 8.7 + i * 0.12));
        const fly = E.inOutQuart(O.prog(t, tArrive(i) - 0.35, tArrive(i) + 0.55));
        const fx = sx + 10 * Math.sin(t * 0.8 + i * 1.3);
        const fy = sy + 12 * Math.sin(t * 0.9 + i * 2.1) + (1 - ink) * 70;
        const tx = COL.x, ty = COL.y + i * COL.pitch;
        const arc = Math.sin(fly * Math.PI) * -40;
        const x = O.lerp(fx, tx, fly), y = O.lerp(fy, ty, fly) + arc;
        const r = O.lerp(sr + 2 * Math.sin(t * 0.6 + i), 0, fly);
        const sc = O.lerp(0.9 + (i % 3) * 0.05, 1, fly);
        c.style.transform = `translate3d(${x}px,${y}px,0) rotate(${r}deg) scale(${sc})`;
        c.style.opacity = ink;
        const blur = (1 - fly) * (i % 2 ? 2.2 : 0.8) + (1 - ink) * 6;
        c.style.filter = blur > 0.1 ? `blur(${blur.toFixed(2)}px)` : 'none';
        const lit = E.outCubic(O.prog(t, tArrive(i) + 0.45, tArrive(i) + 0.8));
        c.style.borderColor = lit > 0 ? `rgba(130,133,245,${0.25 + 0.4 * lit})` : '';
        c.querySelector('.no').style.color = lit > 0 ? `rgba(165,167,251,${0.4 + 0.6 * lit})` : '';
        c.style.zIndex = fly > 0.5 ? 2 : 1;
        c.parentNode.style.zIndex = t > 10.2 ? 3 : 0;
      });
      wires.forEach((w, i) => {
        const k = E.inOutCubic(O.prog(t, tArrive(i) + 0.3, tArrive(i) + 0.75));
        w.setAttribute('stroke-dashoffset', String(1 - k));
        w.style.opacity = k > 0 ? 0.85 : 0;
        const dk = E.outBack(O.prog(t, tArrive(i) + 0.25, tArrive(i) + 0.55));
        dots[i].setAttribute('r', String(4 * dk));
      });
    },
  });
})();
