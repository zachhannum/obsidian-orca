// Open: a tail rises out of the dark, the sky comes down, and the title
// is set across the surface the way the site sets it.
(function () {
  const O = window.O, E = O.E;
  const [A, B] = O.T.open;
  let tail, mark, skyCopy, seaCopy, charsSky, charsSea, lede, words;

  const HL = `<div class="hl"><span class="lm">A B<span class="wide">O</span><span class="wide">O</span>K DESIGNER</span><span class="lm"><i>INSIDE OBSIDIAN.</i></span></div>`;

  O.scenes.push({
    id: 'open', a: A, b: B, post: 0.2,
    init() {
      const el = this.el;
      el.innerHTML = `
        <style>
          #sc-open .hl{position:absolute;left:112px;top:238px;font-family:var(--title);font-weight:500;font-size:208px;line-height:.87;text-transform:uppercase;white-space:nowrap}
          #sc-open .hl i{font-style:normal}
          #sc-open .hlayer{position:absolute;inset:0}
          #sc-open .tail{position:absolute;left:0;top:0;width:560px;height:322px;will-change:transform}
          #sc-open .tail svg{width:100%;height:100%;display:block}
          #sc-open .mark{position:absolute;left:226px;top:78px;font-family:'Dirtyline';font-size:70px;line-height:1;color:var(--ink);white-space:nowrap}
          #sc-open .lede{position:absolute;left:120px;top:690px;width:1000px;font-size:30px;line-height:1.5;color:var(--muted)}
        </style>
        <div class="hlayer sea" style="color:var(--text)">${HL}</div>
        <div class="hlayer sky" style="color:var(--ink)">${HL}</div>
        <div class="tail">${O.tail}</div>
        <div class="mark">oRcA</div>
        <p class="lede">Each chapter is a Markdown note. One book note stores the details and the design. Preview the typeset book and export it to PDF, without leaving Obsidian.</p>`;
      tail = el.querySelector('.tail');
      mark = el.querySelector('.mark');
      seaCopy = el.querySelector('.hlayer.sea');
      skyCopy = el.querySelector('.hlayer.sky');
      const prep = (layer) => {
        const cs = O.splitChars(layer.querySelector('.hl'));
        cs.forEach((c) => {
          c.dataset.w = c.closest('.wide') ? 150 : 60;
          c.dataset.s = c.closest('i') ? -10 : 0;
        });
        return cs;
      };
      charsSea = prep(seaCopy);
      charsSky = prep(skyCopy);
      lede = el.querySelector('.lede');
      words = O.splitWords(lede);

      O.cues.whooshes.push(1.15, 7.45);
      O.cues.impacts.push({ t: 3.75, big: true });
      O.cues.pops.push(3.45);
    },
    update(t) {
      const lvl = O.level(t);
      const out = E.inCubic(O.prog(t, 6.55, 7.65));
      const lvlLocal = lvl + out * 620;

      // Tail: rise from the deep, then settle into the header as the logo.
      const rise = E.outCubic(O.prog(t, 0.4, 2.4));
      const move = E.inOutQuart(O.prog(t, 2.35, 3.6));
      const sway = 3.5 * Math.sin(t * 1.4) * (1 - move);
      const bigX = 960 - 280, bigY = O.lerp(820, 380, rise);
      const smallW = 96, s = O.lerp(1, smallW / 560, move);
      const x = O.lerp(bigX, 120, move);
      const y = O.lerp(bigY, 88, move);
      tail.style.transform = `translate3d(${x}px,${y}px,0) rotate(${sway}deg) scale(${s})`;
      tail.style.transformOrigin = '0 0';
      tail.style.opacity = O.clamp(rise * 1.4);
      const skyOver = O.clamp((lvl - 60) / 80);
      const c = Math.round(O.lerp(238, 10, skyOver));
      tail.style.color = `rgb(${c},${Math.round(O.lerp(240, 12, skyOver))},${Math.round(O.lerp(236, 15, skyOver))})`;
      tail.style.filter = move < 1 ? `drop-shadow(0 0 ${60 * (1 - move)}px rgba(120,124,255,${0.35 * (1 - move)}))` : 'none';

      const mk = E.inOutCubic(O.prog(t, 3.3, 4.2));
      mark.style.clipPath = `inset(-20% ${(1 - mk) * 100}% -20% 0)`;
      mark.style.transform = `translate3d(${(1 - mk) * -20}px,0,0)`;

      // The title, twice: ink above the surface, light below it.
      skyCopy.style.clipPath = `path('${O.skyPath(t, lvlLocal)}')`;
      seaCopy.style.clipPath = `path('${O.seaPath(t, lvlLocal)}')`;
      const setChars = (cs) =>
        cs.forEach((ch, i) => {
          const line2 = ch.dataset.s === '-10';
          const st = 3.55 + (line2 ? 0.35 : 0) + i * 0.028;
          const k = E.outQuart(O.prog(t, st, st + 0.9));
          const kw = E.outCubic(O.prog(t, st, st + 1.4));
          ch.style.transform = `translate3d(0,${(1 - k) * 120}%,0)`;
          ch.style.opacity = O.clamp(k * 3);
          ch.style.fontVariationSettings = `'wdth' ${O.lerp(151, +ch.dataset.w, kw)}, 'slnt' ${ch.dataset.s}`;
        });
      setChars(charsSea);
      setChars(charsSky);

      O.reveal(words, t, 4.75, 0.022, 0.8, { dist: 100 });

      // Exit: the camera sinks, so everything rides up with the surface.
      this.el.style.transform = `translate3d(0,${-out * 620}px,0)`;
      this.el.style.filter = out > 0.01 ? `blur(${out * 6}px)` : 'none';
      this.el.style.opacity = 1 - O.prog(t, 7.2, 7.7);
    },
  });
})();
