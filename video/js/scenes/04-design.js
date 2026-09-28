// Design in the panel, then inspect: each control resets a live page, the
// CSS the panel writes updates beside it, and a click on the page shows
// which rule styles the text.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.design;
  const WIN = { x: 640, y: 96, w: 1210, h: 888 };
  const PX = 84 / 72; // page pixels per point

  const SIZE = [[0, 10.5], [24.0, 11], [24.35, 11.5], [24.7, 12]];
  const LINE = [[0, 14], [25.35, 15], [25.7, 16]];
  const FONT = [[0, 'EB Garamond'], [27.05, 'IM FELL English']];
  const OUT = [[0, 0.7], [27.85, 0.8], [28.2, 0.9]];
  const ALIGN = [[0, 'justify'], [28.95, 'left'], [29.65, 'justify']];
  const DROP = [26.35, 27.15];
  const INSPECT = 33.05, PICK = 34.05;
  const step = (t, list) => { let v = list[0][1]; for (const [tt, x] of list) if (t >= tt) v = x; return v; };
  const lastChange = (t, list) => { let v = -9; for (const [tt] of list) if (tt > 0 && t >= tt) v = tt; return v; };

  const TXT = [
    'The year 1866 was signalised by a remarkable incident, a mysterious and puzzling phenomenon, which doubtless no one has yet forgotten. Not to mention rumours which agitated the maritime population and excited the public mind, even in the interior of continents, seafaring men were particularly excited. Merchants, common sailors, captains of vessels, skippers, both of Europe and America, naval officers of all countries, and the Governments of several States on the two continents, were deeply interested in the matter.',
    'For some time past vessels had been met by “an enormous thing,” a long object, spindle-shaped, occasionally phosphorescent, and infinitely larger and more rapid in its movements than a whale.',
    'The facts relating to this apparition (entered in various log-books) agreed in most respects as to the shape of the object or creature in question, the untiring rapidity of its movements, its surprising power of locomotion, and the peculiar life with which it seemed endowed. If it was a whale, it surpassed in size all those hitherto classified in science.',
    'Taking into consideration the mean of observations made at divers times, rejecting the timid estimate of those who assigned to this object a length of two hundred feet, equally with the exaggerated opinions which set it down as a mile in width and three in length, we might fairly conclude that this mysterious being surpassed greatly all dimensions admitted by the ichthyologists of the day, if it existed at all.',
  ];

  let cap1, cap2, win, page, txt, dc, paras, css, cssLines, panelD, panelI, fields, drop, dropOpts, inspBtn, hi, hiTag, iRows, strikes, key = '';

  const num = (id, v, sub) => `<div class="nf" data-f="${id}"><div class="field"><span class="v">${v}</span></div><div class="st"><div class="up">▴</div><div>▾</div></div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

  function applyPage(t) {
    const s = step(t, SIZE), l = step(t, LINE), f = step(t, FONT), o = step(t, OUT), al = step(t, ALIGN);
    const k = [s, l, f, o, al].join('|');
    if (k === key) return;
    key = k;
    page.style.padding = `${0.8 * 84}px ${o * 84}px ${1 * 84}px ${0.95 * 84}px`;
    const fam = f === 'EB Garamond' ? "'EB Garamond'" : "'IM FELL English'";
    txt.style.fontFamily = fam;
    txt.style.fontSize = s * PX + 'px';
    const lh = l * PX;
    txt.style.lineHeight = lh + 'px';
    txt.style.textAlign = al;
    txt.style.height = Math.floor(452 / lh) * lh + 'px';
    dc.style.fontSize = lh * 3.45 + 'px';
    dc.style.lineHeight = lh * 2.9 + 'px';
    fields.size.textContent = s + 'pt';
    fields.line.textContent = l + 'pt';
    fields.font.textContent = f;
    fields.out.textContent = o + 'in';
    O.$$(panelD, '.seg div').forEach((d, i) => d.classList.toggle('on', (al === 'left' && i === 0) || (al === 'justify' && i === 3)));
    cssLines.fam.innerHTML = `font-family: <b>"${f}"</b>;`;
    cssLines.size.innerHTML = `font-size: <b>${s}pt</b>;`;
    cssLines.line.innerHTML = `line-height: <b>${l}pt</b>;`;
    cssLines.align.innerHTML = `text-align: <b>${al}</b>;`;
    cssLines.page.innerHTML = `margin: 0.8in <b>${o}in</b> 1in 0.95in;`;
  }

  O.scenes.push({
    id: 'design', a: A, b: B, pre: 0.3, post: 0.3,
    init() {
      const el = this.el;
      cap1 = O.caption({ num: '03', top: 150, title: 'Design in<br>the <i>panel.</i>', sub: 'Trim, margins, type, headings. The page resets with each change, and the panel writes the CSS for you.' });
      cap2 = O.caption({ num: '04', top: 150, title: 'Inspect<br>any <i>line.</i>', sub: 'Click the page to see the CSS that styles the text, and which rule takes effect.' });
      el.innerHTML = `
        <style>
          #sc-design .win{left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h}px}
          #sc-design .bd{position:absolute;left:0;right:0;top:96px;bottom:0;display:flex}
          #sc-design .desk{flex:1;position:relative;background:var(--o-desk);overflow:hidden}
          #sc-design .pnl{width:372px;flex:none;border-left:1px solid var(--o-border);background:var(--o-side);position:relative;overflow:hidden}
          #sc-design .pg{position:absolute;left:${(838 - 462) / 2}px;top:36px;width:462px;height:714px;background:#fdfcf9;color:#1a1712;box-shadow:0 30px 60px -10px rgba(0,0,0,.7);overflow:hidden;background-image:linear-gradient(to right,rgba(40,30,10,.09),rgba(40,30,10,0) 24px);transform-origin:50% 40%}
          #sc-design .pg .hd{text-align:center;margin-top:44px;margin-bottom:34px}
          #sc-design .pg .c1{font-family:'EB Garamond';font-size:${9 * PX}px;letter-spacing:.2em}
          #sc-design .pg .c2{font-family:'IM FELL English';font-style:italic;font-size:${16 * PX}px;margin-top:6px}
          #sc-design .txt{hyphens:auto;-webkit-hyphens:auto;overflow:hidden;height:470px}
          #sc-design .txt p{margin:0}
          #sc-design .txt p+p{text-indent:1.5em}
          #sc-design .txt p:first-child::first-line{font-variant:small-caps;letter-spacing:.04em}
          #sc-design .dc{float:left;font-family:'IM FELL English';padding:3px 5px 0 0;margin-top:1px}
          #sc-design .fol{position:absolute;left:0;right:0;bottom:44px;text-align:center;font-family:'EB Garamond';font-size:12px;color:#6a6355}
          #sc-design .ph{display:flex;align-items:center;gap:8px;height:56px;padding:0 22px;font-size:13px;letter-spacing:.06em;color:var(--o-faint);font-weight:600}
          #sc-design .ph span+span{font-weight:400;letter-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          #sc-design .pd{position:absolute;inset:0;padding:0 0 0 0}
          #sc-design .gp{padding:4px 22px 6px}
          #sc-design .gh{font-size:17px;font-weight:600;margin:6px 0 10px}
          #sc-design .lb{font-size:15px;color:var(--o-muted);margin:12px 0 7px}
          #sc-design .rw{display:flex;align-items:flex-start;gap:12px}
          #sc-design .rw .rs{margin-left:auto;color:var(--o-faint);padding-top:8px}
          #sc-design .sel{width:282px;justify-content:space-between}
          #sc-design .nf{display:grid;grid-template-columns:auto 18px;width:128px}
          #sc-design .nf .field{border-radius:7px 0 0 7px;width:110px}
          #sc-design .nf .st{height:34px;display:flex;flex-direction:column;border:1px solid var(--o-border);border-left:0;border-radius:0 7px 7px 0;background:var(--o-field);color:var(--o-faint);font-size:9px;line-height:1}
          #sc-design .nf .st div{flex:1;display:flex;align-items:center;justify-content:center}
          #sc-design .nf .sub{grid-column:1/3;font-size:13.5px;color:var(--o-faint);margin-top:5px}
          #sc-design .seg{display:flex;background:var(--o-field);border:1px solid var(--o-border);border-radius:7px;padding:3px;gap:3px;width:282px}
          #sc-design .seg div{flex:1;height:30px;border-radius:5px;display:flex;align-items:center;justify-content:center;color:var(--o-muted)}
          #sc-design .seg div.on{background:var(--o-seg-on);color:var(--o-text)}
          #sc-design .tg{width:38px;height:22px;border-radius:11px;background:var(--accent);position:relative}
          #sc-design .tg:after{content:"";position:absolute;right:3px;top:3px;width:16px;height:16px;border-radius:8px;background:#fff}
          #sc-design .hr{height:1px;background:var(--o-border);margin:16px 22px 6px}
          #sc-design .dd{position:absolute;width:282px;background:#1a1e24;border:1px solid #2c333b;border-radius:9px;padding:5px;box-shadow:0 24px 50px -10px rgba(0,0,0,.8);transform-origin:50% 0}
          #sc-design .dd div{height:36px;border-radius:6px;display:flex;align-items:center;padding:0 12px;font-size:15px;color:var(--o-text);gap:10px}
          #sc-design .dd div.hov{background:var(--o-selected)}
          #sc-design .dd div span{margin-left:auto;color:var(--accent-soft)}
          #sc-design .css{position:absolute;left:120px;top:622px;width:470px;padding:22px 26px;border-radius:12px;background:rgba(16,19,23,.86);border:1px solid var(--o-border);font-family:var(--mono);font-size:17px;line-height:1.75;color:#c9ced4;box-shadow:0 30px 60px -20px rgba(0,0,0,.8)}
          #sc-design .css .cm{color:var(--o-faint)}
          #sc-design .css .sl{color:#fb7185}
          #sc-design .css .dl{padding-left:22px;margin:0 -26px;padding-right:26px;border-left:2px solid transparent}
          #sc-design .css .dl{padding-left:46px}
          #sc-design .css b{font-weight:400;color:#a5b4fc}
          #sc-design .hi{position:absolute;border:2px solid #818cf8;background:rgba(129,140,248,.14);border-radius:2px;pointer-events:none}
          #sc-design .hitag{position:absolute;font-family:var(--mono);font-size:14px;background:#15181c;color:#e9ece8;border-radius:6px;padding:5px 10px;white-space:nowrap;box-shadow:0 8px 20px rgba(0,0,0,.5)}
          #sc-design .hitag i{font-style:normal;color:#818cf8;margin-right:8px}
          #sc-design .pi{position:absolute;inset:0}
          #sc-design .crumb{margin:0 18px;border:1px solid var(--o-border);border-radius:10px;padding:12px 12px;font-family:var(--mono);font-size:12.5px;display:flex;gap:6px;align-items:center;color:var(--o-muted);white-space:nowrap}
          #sc-design .crumb .s{background:var(--o-chip);color:var(--o-text);padding:2px 7px;border-radius:5px}
          #sc-design .crumb .s em{font-style:normal;color:var(--o-faint);font-size:12px}
          #sc-design .ih{margin:18px 18px 8px;font-size:13px;letter-spacing:.07em;font-weight:600;color:var(--o-faint);display:flex;align-items:center;gap:10px}
          #sc-design .ih:after{content:"";flex:1;height:1px;background:var(--o-border)}
          #sc-design .rule{margin:0 18px;background:#14181d;border-radius:8px;padding:11px 14px;font-family:var(--mono);font-size:14.5px;line-height:1.7;position:relative}
          #sc-design .rule .sl{color:#fb7185}
          #sc-design .rule .pp{color:#5eead4;padding-left:18px;position:relative;display:inline-block}
          #sc-design .rule .pp b{font-weight:400;color:#a5b4fc}
          #sc-design .rule .rt{position:absolute;right:14px;top:11px;font-family:var(--ui);font-size:13.5px;color:var(--o-text)}
          #sc-design .rule .x{position:absolute;left:16px;right:0;top:52%;height:1.5px;background:#e9ece8;transform-origin:0 50%}
          #sc-design .rule.off .pp{opacity:.5}
          #sc-design .cp{margin:0 18px;display:grid;grid-template-columns:104px 1fr;row-gap:6px;font-size:14.5px}
          #sc-design .cp span:nth-child(odd){color:var(--o-faint)}
          #sc-design .cp span:nth-child(even){font-family:var(--mono);color:var(--o-text)}
        </style>
        <div class="win">
          <div class="tabbar"><div class="tab">${O.icon.book}<span>Twenty Thousand Leagues Under the Sea</span></div></div>
          <div class="toolbar"><span class="ttl">Book</span><div class="ibtn insp">${O.icon.cross}</div><div class="ibtn">${O.icon.file}</div><div class="ibtn">${O.icon.down}</div>
            <div style="width:1px;height:22px;background:var(--o-border);margin:0 4px"></div><div class="ibtn on">${O.icon.sliders}</div></div>
          <div class="bd">
            <div class="desk">
              <div class="pg"><div class="hd"><div class="c1">CHAPTER I</div><div class="c2">A Shifting Reef</div></div>
                <div class="txt" lang="en-GB">${TXT.map((p, i) => (i ? `<p>${p}</p>` : `<p><span class="dc">T</span>${p.slice(1)}</p>`)).join('')}</div><div class="fol">9</div></div>
              <div class="hi"></div><div class="hitag"><i>p</i>chapter 3.85 × 0.58in</div>
            </div>
            <div class="pnl">
              <div class="pd">
                <div class="ph"><span>DESIGN</span><span>· Twenty Thousand Leagues U…</span></div>
                <div class="gp"><div class="gh">Page</div>
                  <div class="lb">Trim</div><div class="rw"><div class="field sel"><span>Digest (5.5 × 8.5 in)</span>${O.icon.chev}</div><span class="rs">${O.icon.reset}</span></div>
                  <div class="lb">Margins</div><div class="rw" style="gap:24px">${num('in', '0.95in', 'inside')}${num('out', '0.7in', 'outside')}</div>
                </div>
                <div class="hr"></div>
                <div class="gp"><div class="gh">Text</div>
                  <div class="lb">Font</div><div class="rw"><div class="field sel fsel"><span class="v">EB Garamond</span>${O.icon.chev}</div><span class="rs">${O.icon.reset}</span></div>
                  <div class="rw" style="gap:24px"><div><div class="lb">Size</div>${num('size', '10.5pt')}</div><div><div class="lb">Line spacing</div>${num('line', '14pt')}</div></div>
                  <div class="lb">Alignment</div><div class="seg"><div><svg width="20" height="20" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 5H17"/><path d="M3 9H13"/><path d="M3 13H17"/><path d="M3 17H11"/></svg></div><div><svg width="20" height="20" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 5H17"/><path d="M5 9H15"/><path d="M3 13H17"/><path d="M6 17H14"/></svg></div><div><svg width="20" height="20" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 5H17"/><path d="M7 9H17"/><path d="M3 13H17"/><path d="M9 17H17"/></svg></div><div class="on"><svg width="20" height="20" viewBox="0 0 20 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 5H17"/><path d="M3 9H17"/><path d="M3 13H17"/><path d="M3 17H12"/></svg></div></div>
                  <div class="lb">Hyphenate</div><div class="rw" style="align-items:center"><div class="tg"></div><span style="font-size:14px;color:var(--o-faint)">using British English (en-GB)</span></div>
                </div>
                <div class="dd"><div class="hov">EB Garamond<span>${O.icon.check}</span></div><div>IM FELL English</div><div>Junicode</div><div>Alegreya</div></div>
              </div>
              <div class="pi">
                <div class="ph"><span>CSS</span><span>· Twenty Thousand Leagues Under the Sea</span></div>
                <div class="ir crumb">${O.icon.cross.replace('width="19" height="19"', 'width="16" height="16" style="color:#818cf8"')}<span>book</span>›<span class="s">section#a-shifting-reef <em>chapter</em></span>›<span class="s">p</span></div>
                <div class="ir ih">BOOK CSS</div>
                <div class="ir rule"><span class="sl">section#a-shifting-reef p + p</span><span class="rt">line 22</span><br><span class="pp">text-indent: <b>1.5em</b>;</span></div>
                <div class="ir ih">DESIGN PANEL</div>
                <div class="ir rule off"><span class="sl">p + p</span><span class="rt">First-line indent</span><br><span class="pp">text-indent: <b>1.2em</b>;<i class="x"></i></span></div>
                <div class="ir ih">ORCA’S THEME</div>
                <div class="ir rule off"><span class="sl">p + p</span><br><span class="pp">text-indent: <b>1.2em</b>;<i class="x"></i></span></div>
                <div class="ir ih">COMPUTED</div>
                <div class="ir cp"><span>Font</span><span>IM FELL English 12pt</span><span>Line height</span><span>1.333</span><span>Indent</span><span>18pt</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="css">
          <div class="cm">/* written by the panel */</div>
          <div><span class="sl">.orca-body</span> {</div>
          <div class="dl" data-c="fam"></div><div class="dl" data-c="size"></div><div class="dl" data-c="line"></div><div class="dl" data-c="align"></div>
          <div>}</div>
          <div><span class="sl">@page :right</span> {</div>
          <div class="dl" data-c="page"></div>
          <div>}</div>
        </div>`;
      el.appendChild(cap1.el);
      el.appendChild(cap2.el);
      win = el.querySelector('.win');
      page = el.querySelector('.pg');
      txt = el.querySelector('.txt');
      dc = el.querySelector('.dc');
      paras = O.$$(txt, 'p');
      css = el.querySelector('.css');
      cssLines = {};
      O.$$(css, '.dl').forEach((d) => (cssLines[d.dataset.c] = d));
      panelD = el.querySelector('.pd');
      panelI = el.querySelector('.pi');
      fields = {
        size: el.querySelector('[data-f=size] .v'),
        line: el.querySelector('[data-f=line] .v'),
        out: el.querySelector('[data-f=out] .v'),
        font: el.querySelector('.fsel .v'),
      };
      drop = el.querySelector('.dd');
      dropOpts = O.$$(drop, 'div');
      inspBtn = el.querySelector('.insp');
      hi = el.querySelector('.hi');
      hiTag = el.querySelector('.hitag');
      iRows = O.$$(panelI, '.ir, .ph');
      strikes = O.$$(panelI, '.x');

      // Measure targets with the page as it stands when each is used.
      const stage = document.getElementById('stage');
      el.style.display = '';
      el.style.transform = 'none';
      const fsel = el.querySelector('.fsel');
      const fr = O.rectIn(fsel, stage);
      const pnlR = O.rectIn(el.querySelector('.pnl'), stage);
      drop.style.left = fr.x - pnlR.x + 'px';
      drop.style.top = fr.y - pnlR.y + fr.h + 6 + 'px';
      const up = (id) => O.rectIn(el.querySelector(`[data-f=${id}] .up`), stage);
      const S = up('size'), L = up('line'), M = up('out');
      const segs = O.$$(el, '.pd .seg div').map((d) => O.rectIn(d, stage));
      drop.style.display = '';
      const opt2 = O.rectIn(dropOpts[1], stage);
      const insp = O.rectIn(inspBtn, stage);
      key = '';
      applyPage(33.5);
      const p2 = O.rectIn(paras[1], stage);
      const deskR = O.rectIn(el.querySelector('.desk'), stage);
      this.p2 = { x: p2.x - deskR.x - 4, y: p2.y - deskR.y - 3, w: p2.w + 8, h: p2.h + 6 };
      key = '';
      applyPage(0);
      el.style.display = 'none';

      const P = [p2.cx + 40, p2.cy + 4];
      O.cursorTracks.push({
        a: 23.1, b: 37.1,
        frames: [
          [23.1, [1560, 1090]], [23.85, [S.cx, S.cy]], [24.8, [S.cx, S.cy]],
          [25.2, [L.cx, L.cy]], [25.8, [L.cx, L.cy]],
          [26.25, [fr.cx + 40, fr.cy]], [26.5, [fr.cx + 40, fr.cy]],
          [26.9, [opt2.cx + 20, opt2.cy]], [27.15, [opt2.cx + 20, opt2.cy]],
          [27.7, [M.cx, M.cy]], [28.3, [M.cx, M.cy]],
          [28.8, [segs[0].cx, segs[0].cy]], [29.1, [segs[0].cx, segs[0].cy]],
          [29.5, [segs[3].cx, segs[3].cy]], [29.8, [segs[3].cx, segs[3].cy]],
          [30.8, [1560, 930]], [32.3, [1560, 930]],
          [32.9, [insp.cx, insp.cy]], [33.2, [insp.cx, insp.cy]],
          [33.8, P], [34.3, P], [35.6, [P[0] + 60, P[1] + 110]], [37.1, [P[0] + 80, P[1] + 130]],
        ],
        clicks: [24.0, 24.35, 24.7, 25.35, 25.7, DROP[0], 27.05, 27.85, 28.2, 28.95, 29.65, INSPECT, PICK],
        cross: [[33.2, 37.2]],
      });
      O.cues.clicks.push(24.0, 24.35, 24.7, 25.35, 25.7, DROP[0], 27.05, 27.85, 28.2, 28.95, 29.65, INSPECT, PICK);
      O.cues.pops.push(34.2);
      O.cues.whooshes.push({ t: 32.45, soft: true }, 37.45);
      O.cues.impacts.push({ t: 22.5 });
    },
    update(t) {
      O.sceneEnv(this.el, t, A, B, { pre: 0.3, din: 1.0, dout: 0.7, post: 0.3 });
      cap1.update(t, 22.7, 32.05);
      cap2.update(t, 32.35, 36.9);
      const wk = E.outQuart(O.prog(t, 22.3, 23.5));
      win.style.transform = `translate3d(${(1 - wk) * 90}px,0,0)`;
      win.style.opacity = wk;
      const ck = E.outQuart(O.prog(t, 23.4, 24.2)) * (1 - E.inCubic(O.prog(t, 31.8, 32.3)));
      css.style.opacity = ck;
      css.style.transform = `translate3d(0,${(1 - ck) * 24}px,0)`;

      applyPage(t);

      // Flash whatever just changed, in the panel and in the CSS.
      const flash = (list, els) => {
        const d = t - lastChange(t, list);
        const k = d >= 0 && d < 0.9 ? 1 - E.inQuad(d / 0.9) : 0;
        els.forEach((e) => {
          e.style.background = k > 0 ? `rgba(99,102,241,${0.22 * k})` : '';
          e.style.borderColor = k > 0 ? `rgba(129,140,248,${k})` : '';
        });
      };
      flash(SIZE, [cssLines.size, fields.size.parentNode]);
      flash(LINE, [cssLines.line, fields.line.parentNode]);
      flash(FONT, [cssLines.fam, fields.font.parentNode]);
      flash(OUT, [cssLines.page, fields.out.parentNode]);
      flash(ALIGN, [cssLines.align]);

      // Page reset pulse.
      const lc = Math.max(...[SIZE, LINE, FONT, OUT, ALIGN].map((l) => lastChange(t, l)));
      const pk = t - lc < 0.35 ? Math.sin(O.prog(t - lc, 0, 0.35) * Math.PI) : 0;
      const push = E.inOutCubic(O.prog(t, 29.9, 32.2)) * (1 - E.inOutCubic(O.prog(t, 32.3, 33.3)));
      page.style.transform = `scale(${(1 - pk * 0.006) * (1 + push * 0.06)})`;

      // Font menu.
      const dk = E.outCubic(O.prog(t, DROP[0], DROP[0] + 0.18)) * (1 - O.prog(t, DROP[1] - 0.05, DROP[1] + 0.08));
      drop.style.display = dk > 0.01 ? '' : 'none';
      drop.style.opacity = dk;
      drop.style.transform = `scaleY(${0.9 + 0.1 * dk})`;
      dropOpts.forEach((d, i) => d.classList.toggle('hov', i === (t > 26.75 ? 1 : 0)));

      // Inspect.
      inspBtn.classList.toggle('on', t >= INSPECT);
      const sw = E.inOutCubic(O.prog(t, PICK + 0.05, PICK + 0.45));
      panelD.style.opacity = 1 - sw;
      panelD.style.transform = `translate3d(${-sw * 30}px,0,0)`;
      panelI.style.display = sw > 0 ? '' : 'none';
      iRows.forEach((r, i) => {
        const k = E.outQuart(O.prog(t, PICK + 0.15 + i * 0.045, PICK + 0.7 + i * 0.045));
        r.style.opacity = k;
        r.style.transform = `translate3d(${(1 - k) * 26}px,0,0)`;
      });
      strikes.forEach((s, i) => (s.style.transform = `scaleX(${E.inOutCubic(O.prog(t, 35.05 + i * 0.22, 35.4 + i * 0.22))})`));
      const hv = E.outCubic(O.prog(t, 33.6, 33.85));
      const p2 = this.p2;
      hi.style.display = hv > 0 ? '' : 'none';
      hi.style.left = p2.x + 'px';
      hi.style.top = p2.y + 'px';
      hi.style.width = p2.w + 'px';
      hi.style.height = p2.h + 'px';
      hi.style.opacity = hv;
      hiTag.style.display = hv > 0 ? '' : 'none';
      hiTag.style.left = p2.x + 'px';
      hiTag.style.top = p2.y - 40 + 'px';
      hiTag.style.opacity = hv;
      hiTag.style.transform = `translate3d(0,${(1 - hv) * 8}px,0)`;
    },
  });
})();
