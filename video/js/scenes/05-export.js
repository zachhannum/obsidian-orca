// Export: the engine's pages fill the frame, preflight passes, and the
// pages gather into one PDF.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.export;
  const ROWS = 5, COLS = 9, TW = 170, TH = 263, GX = 198, GY = 292;
  const CX = 1250, CY = 530;
  const COLLAPSE = 41.65, EXPORT = 41.25;
  const tIn = (r, c) => 37.65 + (c + r * 0.6) * 0.075;

  let cap, plane, tiles, counter, cnum, pre, rows, checks, btn, pdf, pdfName, ring;

  O.scenes.push({
    id: 'export', a: A, b: B, pre: 0.3, post: 0.3,
    init() {
      const el = this.el;
      cap = O.caption({ num: '05', top: 330, title: 'Export<br>to <i>PDF.</i>', sub: 'Preflight finds missing fonts and images first. Export writes the PDF from the pages on screen.' });
      let tilesHTML = '';
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const n = String(((r * COLS + c) * 7) % 19 + 1).padStart(2, '0');
          tilesHTML += `<img class="tl" src="assets/pages/page-${n}.png" data-r="${r}" data-c="${c}">`;
        }
      el.innerHTML = `
        <style>
          #sc-export .wall{position:absolute;left:0;top:0;width:1920px;height:1080px;perspective:1700px;perspective-origin:${CX}px ${CY}px;-webkit-mask-image:linear-gradient(90deg,transparent 560px,#000 900px);mask-image:linear-gradient(90deg,transparent 560px,#000 900px)}
          #sc-export .plane{position:absolute;left:${CX}px;top:${CY}px;width:0;height:0;transform-style:preserve-3d}
          #sc-export .tl{position:absolute;left:${-TW / 2}px;top:${-TH / 2}px;width:${TW}px;height:${TH}px;background:#fdfcf9;box-shadow:0 20px 40px -10px rgba(0,0,0,.7);will-change:transform}
          #sc-export .cnt{position:absolute;left:${CX}px;top:118px;transform:translateX(-50%);display:flex;gap:14px;align-items:center;font-family:var(--display);font-size:18px;color:var(--muted);background:rgba(16,19,23,.85);border:1px solid var(--o-border);border-radius:30px;padding:10px 22px;white-space:nowrap}
          #sc-export .cnt b{font-weight:500;color:var(--text);font-variant-numeric:tabular-nums}
          #sc-export .cnt .dot{width:8px;height:8px;border-radius:4px;background:var(--accent);box-shadow:0 0 12px var(--accent)}
          #sc-export .pre{position:absolute;left:1380px;top:600px;width:430px;padding:22px 24px 24px;background:rgba(18,21,25,.96);border:1px solid var(--o-border);border-radius:14px;font-family:var(--ui);box-shadow:0 40px 80px -20px rgba(0,0,0,.95)}
          #sc-export .pre h3{margin:0 0 14px;font-size:19px;font-weight:600;color:var(--o-text)}
          #sc-export .pr{display:flex;align-items:center;gap:14px;height:44px;border-top:1px solid var(--o-border);font-size:16px;color:var(--o-text)}
          #sc-export .pr span.m{margin-left:auto;color:var(--o-faint);font-family:var(--mono);font-size:14px}
          #sc-export .ck{width:24px;height:24px;border-radius:12px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;flex:none}
          #sc-export .btn{margin-top:16px;height:46px;border-radius:9px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;gap:10px;font-size:17px;font-weight:600}
          #sc-export .pdf{position:absolute;left:${CX - 160}px;top:${CY - 247}px;width:320px;height:495px;transform-origin:50% 50%}
          #sc-export .pdf .sh{position:absolute;inset:0;background:#e9e7e1;box-shadow:0 30px 60px -10px rgba(0,0,0,.8)}
          #sc-export .pdf img{position:absolute;inset:0;width:100%;height:100%;box-shadow:0 40px 80px -10px rgba(0,0,0,.9)}
          #sc-export .pdf .tag{position:absolute;left:-14px;top:26px;background:#e5484d;color:#fff;font-family:var(--ui);font-weight:800;font-size:17px;letter-spacing:.06em;padding:6px 12px;border-radius:5px;box-shadow:0 8px 20px rgba(0,0,0,.4)}
          #sc-export .pdf .ring{position:absolute;right:-26px;top:-26px;width:64px;height:64px}
          #sc-export .nm{position:absolute;left:${CX - 400}px;width:800px;top:${CY + 282}px;text-align:center}
          #sc-export .nm .f{font-size:27px;font-weight:600;color:var(--text)}
          #sc-export .nm .m{margin-top:10px;font-family:var(--display);font-size:17px;color:var(--muted)}
        </style>
        <div class="wall"><div class="plane">${tilesHTML}</div></div>
        <div class="cnt"><span class="dot"></span><span>Setting pages</span><b class="n">0</b><span>/ 335</span></div>
        <div class="pdf"><div class="sh" style="transform:translate(10px,10px) rotate(1.5deg)"></div><div class="sh" style="transform:translate(5px,5px) rotate(.6deg)"></div><img src="assets/pages/page-01.png"><div class="tag">PDF</div>
          <svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#6366f1"/><path d="M19 33l9 9 17-19" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1"/></svg></div>
        <div class="nm"><div class="f">Twenty Thousand Leagues Under the Sea.pdf</div><div class="m">335 pages · 5.5 × 8.5 in · fonts embedded</div></div>
        <div class="pre"><h3>Preflight</h3>
          <div class="pr"><span class="ck">${O.icon.check}</span>Fonts<span class="m">4 faces found</span></div>
          <div class="pr"><span class="ck">${O.icon.check}</span>Images<span class="m">12 found</span></div>
          <div class="pr"><span class="ck">${O.icon.check}</span>Links<span class="m">64 resolved</span></div>
          <div class="btn">${O.icon.down}Export PDF</div></div>`;
      el.appendChild(cap.el);
      plane = el.querySelector('.plane');
      tiles = O.$$(el, '.tl').map((im) => ({ im, r: +im.dataset.r, c: +im.dataset.c }));
      counter = el.querySelector('.cnt');
      cnum = el.querySelector('.cnt .n');
      pre = el.querySelector('.pre');
      rows = O.$$(pre, '.pr');
      checks = O.$$(pre, '.ck');
      btn = pre.querySelector('.btn');
      pdf = el.querySelector('.pdf');
      pdfName = el.querySelector('.nm');
      ring = el.querySelector('.ring');

      tiles.forEach((tl) => O.cues.flicks.push(tIn(tl.r, tl.c) + 0.05));
      [40.15, 40.45, 40.75].forEach((t, i) => O.cues.ticks.push({ t, n: i + 2 }));
      O.cues.clicks.push(EXPORT);
      O.cues.whooshes.push({ t: 42.55, soft: true }, 44.95);
      O.cues.impacts.push({ t: 37.5 }, { t: 42.7 });
      O.cues.ticks.push({ t: 43.25, n: 5, bright: true });

      const stage = document.getElementById('stage');
      el.style.display = '';
      const b = O.rectIn(btn, stage);
      el.style.display = 'none';
      O.cursorTracks.push({
        a: 40.3, b: 41.9,
        frames: [[40.3, [1760, 1070]], [41.1, [b.cx + 30, b.cy + 4]], [41.35, [b.cx + 30, b.cy + 4]], [41.9, [b.cx + 70, b.cy + 90]]],
        clicks: [EXPORT],
      });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 0.9, dout: 0.6, post: 0.3 });
      cap.update(t, 37.75, 44.4);

      const col = E.inOutQuart(O.prog(t, COLLAPSE, COLLAPSE + 1.0));
      const rx = O.lerp(54, 0, col), rz = O.lerp(-30, 0, col);
      const scroll = -(t - 37.5) * 34 * (1 - col);
      plane.style.transform = `rotateX(${rx}deg) rotateZ(${rz}deg) translate3d(${scroll}px,${-scroll * 0.3}px,0)`;
      const n = tiles.length;
      tiles.forEach((tl, i) => {
        const k = E.outExpo(O.prog(t, tIn(tl.r, tl.c), tIn(tl.r, tl.c) + 0.8));
        const gx = (tl.c - (COLS - 1) / 2) * GX, gy = (tl.r - (ROWS - 1) / 2) * GY;
        const dist = Math.hypot(tl.c - 4, tl.r - 2);
        const ck = E.inOutCubic(O.prog(t, COLLAPSE + dist * 0.06, COLLAPSE + 0.55 + dist * 0.06));
        const x = O.lerp(gx - scroll, i * 0.15, ck), y = O.lerp(gy + scroll * 0.3, -i * 0.15, ck);
        const z = O.lerp((1 - k) * -520 + 8 * Math.sin(t * 1.3 + i), i * 0.4, ck);
        const s = O.lerp(1, 1, ck);
        tl.im.style.transform = `translate3d(${x}px,${y}px,${z}px) rotateZ(${(1 - k) * 8}deg) scale(${s})`;
        tl.im.style.opacity = k * (1 - O.prog(t, 42.55, 42.85));
      });

      const cn = E.outQuart(O.prog(t, 37.8, 40.6));
      cnum.textContent = String(Math.round(cn * 335)).padStart(3, ' ');
      const ce = E.outCubic(O.prog(t, 37.9, 38.5)) * (1 - O.prog(t, 41.3, 41.7));
      counter.style.opacity = ce;
      counter.style.transform = `translateX(-50%) translate3d(0,${(1 - ce) * -16}px,0)`;

      const pk = E.outQuart(O.prog(t, 39.55, 40.25)) * (1 - E.inCubic(O.prog(t, 41.4, 41.8)));
      pre.style.opacity = pk;
      pre.style.transform = `translate3d(${(1 - pk) * 40}px,0,0) scale(${O.lerp(0.97, 1, pk)})`;
      rows.forEach((r, i) => (r.style.opacity = 0.35 + 0.65 * O.tw(t, 40.0 + i * 0.3, 40.25 + i * 0.3)));
      checks.forEach((c, i) => (c.style.transform = `scale(${E.outBack(O.prog(t, 40.1 + i * 0.3, 40.4 + i * 0.3))})`));
      const bp = t > EXPORT - 0.05 && t < EXPORT + 0.2 ? 0.96 : 1;
      btn.style.transform = `scale(${bp})`;

      // The stack becomes the PDF.
      const pk2 = E.outBackSoft(O.prog(t, 42.55, 43.35));
      pdf.style.display = t > 42.5 ? '' : 'none';
      pdf.style.opacity = O.tw(t, 42.5, 42.75);
      const base = TW / 320;
      const fl = 6 * Math.sin((t - 43) * 1.4);
      pdf.style.transform = `translate3d(0,${t > 43.3 ? fl * O.tw(t, 43.3, 44) : 0}px,0) scale(${O.lerp(base, 1, pk2)})`;
      ring.style.transform = `scale(${E.outBack(O.prog(t, 43.15, 43.45))})`;
      ring.querySelector('path').setAttribute('stroke-dashoffset', String(1 - E.outCubic(O.prog(t, 43.3, 43.65))));
      const nk = E.outQuart(O.prog(t, 43.0, 43.7));
      pdfName.style.opacity = nk;
      pdfName.style.transform = `translate3d(0,${(1 - nk) * 20}px,0)`;
    },
  });
})();
