// The book the export wrote: its pages fill the frame, then gather into
// the one file.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.pdf;
  const ROWS = 5, COLS = 9, TW = 170, TH = 263, GX = 198, GY = 292;
  const PAGES = 24;
  const CX = 960, CY = 520;
  const COLLAPSE = 48.1;
  const tIn = (r, c) => 45.1 + (c + r * 0.6) * 0.075;

  let plane, tiles, pdf, pdfName, ring;

  O.scenes.push({
    id: 'pdf', a: A, b: B, pre: 0.3, post: 0.3,
    init() {
      const el = this.el;
      let tilesHTML = '';
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const n = String(((r * COLS + c) * 7) % PAGES + 1).padStart(2, '0');
          tilesHTML += `<img class="tl" src="assets/pages/page-${n}.jpg" data-r="${r}" data-c="${c}" alt="">`;
        }
      el.innerHTML = `
        <style>
          #sc-pdf .wall{position:absolute;left:0;top:0;width:1920px;height:1080px;perspective:1700px;perspective-origin:${CX}px ${CY}px}
          #sc-pdf .plane{position:absolute;left:${CX}px;top:${CY}px;width:0;height:0;transform-style:preserve-3d}
          #sc-pdf .tl{position:absolute;left:${-TW / 2}px;top:${-TH / 2}px;width:${TW}px;height:${TH}px;background:#fff;box-shadow:0 20px 40px -10px rgba(0,0,0,.7);will-change:transform}
          #sc-pdf .pdf{position:absolute;left:${CX - 160}px;top:${CY - 247}px;width:320px;height:495px;transform-origin:50% 50%}
          #sc-pdf .pdf .sh{position:absolute;inset:0;background:#e9e7e1;box-shadow:0 30px 60px -10px rgba(0,0,0,.8)}
          #sc-pdf .pdf img{position:absolute;inset:0;width:100%;height:100%;background:#fff;box-shadow:0 40px 80px -10px rgba(0,0,0,.9)}
          #sc-pdf .pdf .tag{position:absolute;left:-14px;top:26px;background:#e5484d;color:#fff;font-family:var(--ui);font-weight:800;font-size:17px;letter-spacing:.06em;padding:6px 12px;border-radius:5px;box-shadow:0 8px 20px rgba(0,0,0,.4)}
          #sc-pdf .pdf .ring{position:absolute;right:-26px;top:-26px;width:64px;height:64px}
          #sc-pdf .nm{position:absolute;left:${CX - 400}px;width:800px;top:${CY + 282}px;text-align:center}
          #sc-pdf .nm .f{font-size:27px;font-weight:600;color:var(--text)}
        </style>
        <div class="wall"><div class="plane">${tilesHTML}</div></div>
        <div class="pdf"><div class="sh" style="transform:translate(10px,10px) rotate(1.5deg)"></div><div class="sh" style="transform:translate(5px,5px) rotate(.6deg)"></div><img src="assets/pages/page-01.jpg" alt=""><div class="tag">PDF</div>
          <svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#6366f1"/><path d="M19 33l9 9 17-19" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1"/></svg></div>
        <div class="nm"><div class="f">Twenty Thousand Leagues Under the Sea.pdf</div></div>`;
      plane = el.querySelector('.plane');
      tiles = O.$$(el, '.tl').map((im) => ({ im, r: +im.dataset.r, c: +im.dataset.c }));
      pdf = el.querySelector('.pdf');
      pdfName = el.querySelector('.nm');
      ring = el.querySelector('.ring');

      tiles.forEach((tl) => O.cues.flicks.push(tIn(tl.r, tl.c) + 0.05));
      O.cues.impacts.push({ t: 49.05 });
      O.cues.ticks.push({ t: 49.6, n: 4, bright: true });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 0.5, dout: 0.5, post: 0.3 });

      const col = E.inOutQuart(O.prog(t, COLLAPSE, COLLAPSE + 1.0));
      const rx = O.lerp(54, 0, col), rz = O.lerp(-30, 0, col);
      const scroll = -(t - A) * 34 * (1 - col);
      plane.style.transform = `rotateX(${rx}deg) rotateZ(${rz}deg) translate3d(${scroll}px,${-scroll * 0.3}px,0)`;
      tiles.forEach((tl, i) => {
        const k = E.outExpo(O.prog(t, tIn(tl.r, tl.c), tIn(tl.r, tl.c) + 0.8));
        const gx = (tl.c - (COLS - 1) / 2) * GX, gy = (tl.r - (ROWS - 1) / 2) * GY;
        const dist = Math.hypot(tl.c - 4, tl.r - 2);
        const ck = E.inOutCubic(O.prog(t, COLLAPSE + dist * 0.06, COLLAPSE + 0.55 + dist * 0.06));
        const x = O.lerp(gx - scroll, i * 0.15, ck), y = O.lerp(gy + scroll * 0.3, -i * 0.15, ck);
        const z = O.lerp((1 - k) * -520 + 8 * Math.sin(t * 1.3 + i), i * 0.4, ck);
        tl.im.style.transform = `translate3d(${x}px,${y}px,${z}px) rotateZ(${(1 - k) * 8}deg)`;
        tl.im.style.opacity = k * (1 - O.prog(t, 49.0, 49.3));
      });

      // The stack becomes the file.
      const pk = E.outBackSoft(O.prog(t, 49.0, 49.8));
      pdf.style.display = t > 48.95 ? '' : 'none';
      pdf.style.opacity = O.tw(t, 48.95, 49.2);
      const fl = 6 * Math.sin((t - 49.5) * 1.4);
      pdf.style.transform = `translate3d(0,${t > 49.8 ? fl * O.tw(t, 49.8, 50.4) : 0}px,0) scale(${O.lerp(TW / 320, 1, pk)})`;
      ring.style.transform = `scale(${E.outBack(O.prog(t, 49.5, 49.8))})`;
      ring.querySelector('path').setAttribute('stroke-dashoffset', String(1 - E.outCubic(O.prog(t, 49.65, 50.0))));
      const nk = E.outQuart(O.prog(t, 49.4, 50.0));
      pdfName.style.opacity = nk;
      pdfName.style.transform = `translate3d(0,${(1 - nk) * 20}px,0)`;
    },
  });
})();
