// End card: back to the surface, the tail breaks the water, the name.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.end;
  let tailSky, tailSea, skyL, seaL, drops, dropEls, mark, markCh, tag, url;

  O.scenes.push({
    id: 'end', a: A, b: B + 1, pre: 0.4,
    init() {
      const el = this.el;
      el.innerHTML = `
        <style>
          #sc-end .ly{position:absolute;inset:0}
          #sc-end .tail{position:absolute;left:${960 - 230}px;top:0;width:460px;height:265px;transform-origin:50% 100%}
          #sc-end .tail svg{width:100%;height:100%;display:block}
          #sc-end .mark{position:absolute;left:0;width:1920px;top:650px;text-align:center;font-family:'Dirtyline';font-size:150px;line-height:1;color:var(--text)}
          #sc-end .tag{position:absolute;left:0;width:1920px;top:852px;text-align:center;font-size:32px;color:var(--muted)}
          #sc-end .url{position:absolute;left:0;width:1920px;top:916px;text-align:center;font-family:var(--display);font-size:22px;letter-spacing:.04em;color:var(--accent-soft)}
          #sc-end .dp{position:absolute;left:0;top:0;border-radius:50%;background:var(--ink)}
        </style>
        <div class="ly sea"><div class="tail" style="color:rgba(238,240,236,.07)">${O.tail}</div></div>
        <div class="ly sky"><div class="tail" style="color:var(--ink)">${O.tail}</div><div class="drops"></div></div>
        <div class="mark">oRcA</div>
        <div class="tag">A book designer inside Obsidian.</div>
        <div class="url">orca.typeworks.dev</div>`;
      skyL = el.querySelector('.ly.sky');
      seaL = el.querySelector('.ly.sea');
      tailSky = skyL.querySelector('.tail');
      tailSea = seaL.querySelector('.tail');
      mark = el.querySelector('.mark');
      markCh = O.splitChars(mark);
      tag = el.querySelector('.tag');
      url = el.querySelector('.url');
      const r = O.rng(11);
      drops = [];
      const dEl = el.querySelector('.drops');
      for (let i = 0; i < 34; i++) {
        const side = r() < 0.5 ? -1 : 1;
        const d = { x: 960 + side * (40 + r() * 170), vx: side * (40 + r() * 220), vy: -(260 + r() * 420), r: 2 + r() * 5, t0: 51.55 + r() * 0.35 };
        const e = document.createElement('div');
        e.className = 'dp';
        e.style.width = e.style.height = d.r * 2 + 'px';
        dEl.appendChild(e);
        d.el = e;
        drops.push(d);
      }
      O.cues.impacts.push({ t: 50.625, big: true, final: true });
      O.cues.pops.push(51.6);
    },
    update(t) {
      const lvl = O.level(t);
      skyL.style.clipPath = `path('${O.skyPath(t, lvl)}')`;
      seaL.style.clipPath = `path('${O.seaPath(t, lvl)}')`;
      this.el.style.opacity = O.tw(t, 50.3, 50.8);

      const rise = E.outBackSoft(O.prog(t, 50.95, 52.35));
      const bottom = O.lerp(1000, 628, rise);
      const sway = 2.2 * Math.sin((t - 51) * 1.2) * O.tw(t, 52, 53);
      const tr = `translate3d(0,${bottom - 265}px,0) rotate(${sway}deg)`;
      tailSky.style.transform = tr;
      tailSea.style.transform = tr;

      drops.forEach((d) => {
        const dt = t - d.t0;
        if (dt < 0 || dt > 1.6) { d.el.style.display = 'none'; return; }
        d.el.style.display = '';
        const x = d.x + d.vx * dt, y = lvl - 4 + d.vy * dt + 0.5 * 980 * dt * dt;
        d.el.style.transform = `translate3d(${x - d.r}px,${y - d.r}px,0) scale(${1 - dt / 2})`;
      });

      markCh.forEach((c, i) => {
        const k = E.outQuart(O.prog(t, 52.25 + i * 0.09, 53.2 + i * 0.09));
        c.style.transform = `translate3d(0,${(1 - k) * 60}px,0) scale(${O.lerp(0.8, 1, k)})`;
        c.style.opacity = k;
        c.style.filter = k < 0.99 ? `blur(${(1 - k) * 10}px)` : 'none';
      });
      const tk = E.outQuart(O.prog(t, 53.0, 53.9));
      tag.style.opacity = tk;
      tag.style.transform = `translate3d(0,${(1 - tk) * 18}px,0)`;
      const uk = E.outQuart(O.prog(t, 53.5, 54.4));
      url.style.opacity = uk;
      url.style.letterSpacing = `${O.lerp(0.3, 0.04, uk)}em`;
    },
  });
})();
