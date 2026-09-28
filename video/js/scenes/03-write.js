// Write, then format: Markdown is typed in the editor, the pane flips to
// the book, and the camera settles on the chapter opening the engine set.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.write;

  const P1 = 'The year 1866 was signalised by a remarkable incident, a mysterious and puzzling phenomenon, which doubtless no one has yet forgotten. Not to mention rumours which agitated the maritime population and excited the public mind, even in the interior of continents, seafaring men were particularly excited.';
  const P2 = 'For some time past vessels had been met by “an enormous thing,” a long object, spindle-shaped, occasionally phosphorescent, and infinitely larger and more rapid in its movements than a whale.';
  // Each line is a list of [text, class] runs, typed over [start, end].
  const LINES = [
    { cls: 'h2', runs: [['## ', 'md'], ['CHAPTER I', '']], a: 15.85, b: 16.3 },
    { cls: 'h1', runs: [['# ', 'md'], ['*', 'md'], ['A Shifting Reef', 'em'], ['*', 'md']], a: 16.4, b: 17.0 },
    { cls: 'p', runs: [[P1, '']], a: 17.15, b: 18.2 },
    { cls: 'p', runs: [[P2, '']], a: 18.25, b: 18.75 },
  ];
  const WIN = { x: 690, y: 118, w: 1110, h: 844 };
  const FLIP = 19.25;

  let cap, win, lines, caret, flipper, spread, ttl, toggle, badge;

  function lineHTML(L, n) {
    let out = '', left = n;
    for (const [txt, c] of L.runs) {
      if (left <= 0) break;
      const s = txt.slice(0, left);
      left -= s.length;
      out += c ? `<span class="${c}">${s}</span>` : s;
    }
    return out;
  }
  const lineLen = (L) => L.runs.reduce((a, r) => a + r[0].length, 0);

  O.scenes.push({
    id: 'write', a: A, b: B, pre: 0.3, post: 0.3,
    init() {
      const el = this.el;
      cap = O.caption({
        num: '02', top: 330,
        title: 'Write,<br>then <i>format.</i>',
        sub: 'Write chapters in Markdown. Switch the pane to the book, open at the page you are writing.',
      });
      el.innerHTML = `
        <style>
          #sc-write .win{left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h}px}
          #sc-write .body{position:absolute;left:0;right:0;top:96px;bottom:0;perspective:2400px}
          #sc-write .flip{position:absolute;inset:0;transform-style:preserve-3d}
          #sc-write .face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden}
          #sc-write .ed{background:var(--o-pane);padding:56px 110px 0 110px;font-family:var(--ui);color:var(--o-text)}
          #sc-write .ed .ln{white-space:pre-wrap;word-wrap:break-word}
          #sc-write .ed .h2{font-size:25px;font-weight:700;letter-spacing:.02em;margin-bottom:18px;color:var(--o-text)}
          #sc-write .ed .h1{font-size:38px;font-weight:700;margin-bottom:26px;letter-spacing:-.01em}
          #sc-write .ed .p{font-size:20px;line-height:1.65;color:#d7dbd6;margin-bottom:20px}
          #sc-write .ed .md{color:var(--o-faint);font-weight:400}
          #sc-write .ed .em{font-style:italic}
          #sc-write .caret{display:inline-block;width:2px;height:1.05em;background:var(--accent-soft);vertical-align:-0.15em;margin-left:1px}
          #sc-write .desk{background:var(--o-desk);transform:rotateY(180deg)}
          #sc-write .spread{position:absolute;left:50%;top:50%;width:900px;height:696px;margin:-348px 0 0 -450px;display:flex;box-shadow:0 40px 80px -10px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.04);transform-origin:73% 34%}
          #sc-write .spread img{width:450px;height:696px;display:block}
          #sc-write .spread .gut{position:absolute;left:446px;top:0;bottom:0;width:8px;background:linear-gradient(90deg,rgba(0,0,0,.18),rgba(0,0,0,0) 50%,rgba(0,0,0,.12));}
          #sc-write .badge{position:absolute;right:18px;bottom:16px;font-size:14px;color:var(--o-muted);background:var(--o-side);border:1px solid var(--o-border);border-radius:7px;padding:6px 11px}
          #sc-write .seg{display:flex;background:var(--o-field);border:1px solid var(--o-border);border-radius:8px;padding:3px;gap:3px}
          #sc-write .seg div{height:30px;padding:0 12px;display:flex;align-items:center;gap:7px;border-radius:6px;color:var(--o-muted);font-size:14px}
          #sc-write .seg div.on{background:var(--o-seg-on);color:var(--o-text)}
        </style>
        <div class="win">
          <div class="tabbar"><div class="tab">${O.icon.file}<span>A Shifting Reef</span></div></div>
          <div class="toolbar"><span class="ttl">A Shifting Reef</span>
            <div class="seg"><div class="src on">${O.icon.pen}Write</div><div class="bk">${O.icon.book}Book</div></div></div>
          <div class="body"><div class="flip">
            <div class="face ed"></div>
            <div class="face desk"><div class="spread"><img src="assets/pages/page-08.png"><img src="assets/pages/page-09.png"><div class="gut"></div></div><div class="badge">pages 8–9 of 335</div></div>
          </div></div>
        </div>`;
      el.appendChild(cap.el);
      win = el.querySelector('.win');
      const ed = el.querySelector('.ed');
      lines = LINES.map((L) => {
        const d = O.h(`<div class="ln ${L.cls}"></div>`);
        ed.appendChild(d);
        return d;
      });
      caret = O.h('<span class="caret"></span>');
      flipper = el.querySelector('.flip');
      spread = el.querySelector('.spread');
      ttl = el.querySelector('.ttl');
      toggle = [el.querySelector('.seg .src'), el.querySelector('.seg .bk')];
      badge = el.querySelector('.badge');

      // Key sounds follow the characters as they appear.
      LINES.forEach((L) => {
        const n = lineLen(L);
        const step = Math.max(1, Math.round(n / ((L.b - L.a) * 26)));
        for (let i = 0; i < n; i += step) O.cues.keys.push(L.a + (i / n) * (L.b - L.a));
      });
      O.cursorTracks.push({
        a: 18.35, b: 19.9,
        frames: [[18.35, [1500, 1010]], [19.05, [1716, 184]], [19.9, [1740, 230]]],
        clicks: [FLIP - 0.1],
      });
      O.cues.clicks.push(FLIP - 0.1);
      O.cues.whooshes.push({ t: FLIP + 0.55, soft: true }, 22.45);
      O.cues.impacts.push({ t: 15 });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 1.0, dout: 0.7, post: 0.3 });
      cap.update(t, 15.25, 21.9);
      const wk = E.outQuart(O.prog(t, 14.9, 16.0));
      win.style.transform = `translate3d(${(1 - wk) * 80}px,0,0)`;
      win.style.opacity = wk;

      // Typing.
      let active = -1;
      LINES.forEach((L, i) => {
        const n = lineLen(L);
        const k = O.prog(t, L.a, L.b);
        const c = Math.round(k * n);
        const key = String(c);
        if (lines[i].dataset.c !== key) {
          lines[i].innerHTML = lineHTML(L, c);
          lines[i].dataset.c = key;
        }
        if (t >= L.a) active = i;
      });
      const idx = Math.max(0, active);
      if (caret.parentNode !== lines[idx]) lines[idx].appendChild(caret);
      else if (lines[idx].lastChild !== caret) lines[idx].appendChild(caret);
      const typing = LINES.some((L) => t >= L.a && t <= L.b + 0.1);
      caret.style.opacity = typing || Math.floor(t * 2.2) % 2 === 0 ? 1 : 0;

      // Flip to the book.
      const fk = E.inOutCubic(O.prog(t, FLIP, FLIP + 1.0));
      flipper.style.transform = `translateZ(${-Math.sin(fk * Math.PI) * 260}px) rotateY(${fk * 180}deg)`;
      toggle[0].classList.toggle('on', t < FLIP);
      toggle[1].classList.toggle('on', t >= FLIP);
      ttl.textContent = t < FLIP ? 'A Shifting Reef' : 'Book';

      // Then settle on the drop cap.
      const push = E.inOutCubic(O.prog(t, FLIP + 1.1, 22.6));
      spread.style.transform = `scale(${O.lerp(1, 1.85, push)})`;
      badge.style.opacity = 1 - push;
    },
  });
})();
