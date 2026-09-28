// The layers every scene shares: the sea, the sky's surface, the cursor,
// film grain and the fades. Scenes register themselves in O.scenes.
(function () {
  const O = window.O;
  const E = O.E;

  O.T = {
    total: 58.125,
    bpm: 128,
    open: [0, 7.5],
    notes: [7.5, 15],
    write: [15, 22.5],
    design: [22.5, 37.5],
    export: [37.5, 45],
    engine: [45, 50.625],
    end: [50.625, 58.125],
  };
  O.scenes = [];
  O.cursorTracks = [];

  // Surface of the sea: where the sky meets the water.
  O.level = function (t) {
    if (t < 20) {
      const down = O.tw(t, 2.7, 4.1, E.outQuart);
      const up = O.tw(t, 6.6, 7.6, E.inCubic);
      return O.lerp(O.lerp(-160, 455, down), -160, up);
    }
    return O.lerp(-160, 590, O.tw(t, 50.35, 51.9, E.outQuart));
  };
  O.surfaceY = (x, t, lvl) =>
    lvl + 11 * Math.sin(x * 0.0037 + t * 1.05) + 6 * Math.sin(x * 0.0102 - t * 1.6 + 1.3) + 2.5 * Math.sin(x * 0.024 + t * 2.4);

  O.skyPath = function (t, lvl, off = 0) {
    let d = `M-20 -20 L-20 ${O.surfaceY(-20, t, lvl) + off}`;
    for (let x = 0; x <= 1940; x += 20) d += ` L${x} ${(O.surfaceY(x, t, lvl) + off).toFixed(1)}`;
    return d + ' L1940 -20 Z';
  };
  O.seaPath = function (t, lvl) {
    let d = `M-20 1100 L-20 ${O.surfaceY(-20, t, lvl)}`;
    for (let x = 0; x <= 1940; x += 20) d += ` L${x} ${O.surfaceY(x, t, lvl).toFixed(1)}`;
    return d + ' L1940 1100 Z';
  };
  O.lineAt = function (t, lvl, off, amp, ph) {
    let d = '';
    for (let x = -20; x <= 1940; x += 20) {
      const y = O.surfaceY(x, t * 0.8 + ph, lvl) + off + amp * Math.sin(x * 0.006 + ph * 3 + t * 0.7);
      d += (d ? ' L' : 'M') + x + ' ' + y.toFixed(1);
    }
    return d;
  };

  // How far the camera has sunk; specks drift against it.
  O.camY = (t) =>
    1100 * O.tw(t, 6.5, 8.3, E.inOutCubic) +
    320 * O.tw(t, 14.5, 15.7, E.inOutCubic) +
    320 * O.tw(t, 22.0, 23.2, E.inOutCubic) +
    320 * O.tw(t, 37.0, 38.2, E.inOutCubic) +
    320 * O.tw(t, 44.5, 45.7, E.inOutCubic) -
    1400 * O.tw(t, 49.9, 51.9, E.inOutCubic);

  let bg, bgx, sky, grain, gx, noise = [], cursor, ring, fade, specks = [];

  O.buildWorld = function (stage) {
    bg = O.h('<canvas class="layer" width="1920" height="1080"></canvas>');
    bgx = bg.getContext('2d');
    sky = O.h(`<svg class="layer" viewBox="0 0 1920 1080" width="1920" height="1080">
      <path class="sky" fill="#eef0ec"/>
      <path class="l1" fill="none" stroke="rgba(10,12,15,.22)" stroke-width="1.4"/>
      <path class="l2" fill="none" stroke="rgba(10,12,15,.14)" stroke-width="1.2"/>
      <path class="l3" fill="none" stroke="rgba(238,240,236,.12)" stroke-width="1.2"/>
    </svg>`);
    stage.appendChild(bg);
    stage.appendChild(sky);

    const scenes = O.h('<div class="layer" id="scenes"></div>');
    stage.appendChild(scenes);
    O.scenes.forEach((s) => {
      s.el = O.h(`<div class="scene" id="sc-${s.id}"></div>`);
      scenes.appendChild(s.el);
    });

    ring = O.h('<div class="ring"></div>');
    cursor = O.h(`<div id="cursor">
      <svg class="arrow" width="40" height="40" viewBox="0 0 40 40"><path d="M9 5 L9 31 L15.5 25 L20 35 L24.5 33 L20 23.5 L29 23.5 Z" fill="#fff" stroke="#0a0c0f" stroke-width="1.8" stroke-linejoin="round"/></svg>
      <svg class="cross" width="40" height="40" viewBox="0 0 40 40" style="left:-20px;top:-20px"><g stroke="#0a0c0f" stroke-width="5" stroke-linecap="round"><path d="M20 6v10M20 24v10M6 20h10M24 20h10"/></g><g stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M20 6v10M20 24v10M6 20h10M24 20h10"/></g></svg>
    </div>`);
    stage.appendChild(ring);
    stage.appendChild(cursor);

    const vig = O.h('<div class="layer" id="vignette"></div>');
    grain = O.h('<canvas class="layer" id="grain" width="960" height="540"></canvas>');
    gx = grain.getContext('2d');
    fade = O.h('<div class="layer" id="fade"></div>');
    stage.appendChild(vig);
    stage.appendChild(grain);
    stage.appendChild(fade);

    const r = O.rng(7);
    for (let i = 0; i < 8; i++) {
      const c = document.createElement('canvas');
      c.width = 960;
      c.height = 540;
      const x = c.getContext('2d');
      const img = x.createImageData(960, 540);
      for (let p = 0; p < img.data.length; p += 4) {
        const v = r() * 255;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
        img.data[p + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      noise.push(c);
    }

    const sr = O.rng(42);
    for (let i = 0; i < 300; i++) {
      const z = Math.pow(sr(), 1.6) * 0.9 + 0.1;
      specks.push({ x: sr() * 1920, y: sr() * 1200, z, r: 0.6 + z * 2.2, ph: sr() * 6.28, tw: 0.4 + sr() * 1.2 });
    }
  };

  function drawSea(t) {
    const c = bgx;
    c.fillStyle = '#000';
    c.fillRect(0, 0, 1920, 1080);

    // A slow indigo glow behind the work, wandering between scenes.
    const gxp = O.keys(t, [[0, 960], [7.5, 1200], [15, 1250], [22.5, 1220], [37.5, 1250], [45, 960], [58, 960]]);
    const gyp = O.keys(t, [[0, 700], [7.5, 520], [15, 540], [22.5, 540], [37.5, 520], [45, 560], [58, 820]]);
    const g = c.createRadialGradient(gxp, gyp, 0, gxp, gyp, 900);
    g.addColorStop(0, 'rgba(70,72,190,0.16)');
    g.addColorStop(0.45, 'rgba(40,42,120,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 1920, 1080);

    // Light from the surface.
    const lvl = O.level(t);
    const top = Math.max(-40, lvl);
    const rayA = 0.05 * (0.55 + 0.45 * O.clamp(1 - Math.abs(O.camY(t)) / 1400));
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const x0 = 180 + i * 260 + 60 * Math.sin(t * 0.25 + i * 1.7);
      const w0 = 40 + 30 * Math.sin(i * 2.1 + 1);
      const skew = 240 + 80 * Math.sin(t * 0.18 + i);
      const lg = c.createLinearGradient(0, top, 0, top + 900);
      const a = rayA * (0.6 + 0.4 * Math.sin(t * 0.5 + i * 1.3));
      lg.addColorStop(0, `rgba(170,175,255,${a})`);
      lg.addColorStop(1, 'rgba(170,175,255,0)');
      c.fillStyle = lg;
      c.beginPath();
      c.moveTo(x0, top);
      c.lineTo(x0 + w0, top);
      c.lineTo(x0 + w0 * 5 + skew, top + 900);
      c.lineTo(x0 + skew - w0 * 2, top + 900);
      c.closePath();
      c.fill();
    }
    c.restore();

    // Plankton, in three depths.
    const cam = O.camY(t);
    const on = O.tw(t, 0.1, 1.8);
    for (const s of specks) {
      const H = 1200;
      let y = (s.y - t * 14 * s.z + cam * s.z * 0.9) % H;
      if (y < 0) y += H;
      y -= 60;
      const x = s.x + Math.sin(t * 0.35 + s.ph) * 14 * s.z;
      const tw = 0.55 + 0.45 * Math.sin(t * s.tw + s.ph);
      const a = on * tw * (0.15 + s.z * 0.55);
      if (s.z > 0.85) {
        const rr = s.r * 5;
        const bg2 = c.createRadialGradient(x, y, 0, x, y, rr);
        bg2.addColorStop(0, `rgba(201,203,248,${a * 0.35})`);
        bg2.addColorStop(1, 'rgba(201,203,248,0)');
        c.fillStyle = bg2;
        c.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      } else {
        c.fillStyle = `rgba(201,203,248,${a})`;
        c.beginPath();
        c.arc(x, y, s.r, 0, 6.2832);
        c.fill();
      }
    }
  }

  function drawSky(t) {
    const lvl = O.level(t);
    const on = lvl > -120;
    O.setVis(sky, on);
    if (!on) return;
    sky.querySelector('.sky').setAttribute('d', O.skyPath(t, lvl));
    sky.querySelector('.l1').setAttribute('d', O.lineAt(t, lvl, -26, 6, 0.4));
    sky.querySelector('.l2').setAttribute('d', O.lineAt(t, lvl, -48, 9, 1.9));
    sky.querySelector('.l3').setAttribute('d', O.lineAt(t, lvl, 22, 7, 3.1));
  }

  function drawCursor(t) {
    const tr = O.cursorTracks.find((c) => t >= c.a && t <= c.b);
    if (!tr) {
      O.setVis(cursor, false);
      O.setVis(ring, false);
      return;
    }
    O.setVis(cursor, true);
    const [x, y] = O.keys(t, tr.frames, E.inOutCubic);
    const vis = O.env(t, tr.a, tr.b, 0.3, 0.3);
    let press = 1;
    let rk = -1;
    for (const c of tr.clicks) {
      const d = t - c;
      if (d > -0.08 && d < 0.14) press = Math.min(press, 1 - 0.18 * Math.sin(O.prog(d, -0.08, 0.14) * Math.PI));
      if (d >= 0 && d < 0.5) rk = d / 0.5;
    }
    const cross = (tr.cross || []).some(([a, b]) => t >= a && t < b);
    cursor.querySelector('.arrow').style.display = cross ? 'none' : '';
    cursor.querySelector('.cross').style.display = cross ? '' : 'none';
    cursor.style.transform = `translate3d(${cross ? x : x - 9}px,${cross ? y : y - 5}px,0) scale(${press})`;
    cursor.style.opacity = vis;
    O.setVis(ring, rk >= 0);
    if (rk >= 0) {
      ring.style.transform = `translate3d(${x}px,${y}px,0) scale(${0.3 + E.outCubic(rk) * 0.9})`;
      ring.style.opacity = (1 - rk) * 0.9;
    }
  }

  O.renderWorld = function (t) {
    drawSea(t);
    drawSky(t);
    for (const s of O.scenes) {
      const on = t >= s.a - (s.pre || 0) && t < s.b + (s.post || 0);
      O.setVis(s.el, on);
      if (on) s.update(t);
    }
    drawCursor(t);
    gx.drawImage(noise[Math.floor(t * 24) % noise.length], 0, 0);
    fade.style.opacity = Math.max(1 - O.tw(t, 0, 0.9, E.outQuad), O.tw(t, O.T.total - 1.1, O.T.total - 0.05, E.inQuad));
  };

  // A section caption: number, condensed title, one line of plain words.
  O.caption = function (opts) {
    const el = O.h(`<div class="cap" style="top:${opts.top}px">
      <div class="cap-num"><span class="n">${opts.num}</span><span class="bar"></span><span class="k">${opts.kicker || ''}</span></div>
      <h2 class="cap-title">${opts.title}</h2>
      <p class="cap-sub">${opts.sub}</p>
    </div>`);
    const title = el.querySelector('.cap-title');
    title.innerHTML = title.innerHTML
      .split('<br>')
      .map((l) => `<span class="lm">${l}</span>`)
      .join('');
    const chars = O.splitChars(title);
    chars.forEach((c) => (c.dataset.slnt = c.closest('i') ? '-10' : '0'));
    const words = O.splitWords(el.querySelector('.cap-sub'));
    const num = el.querySelector('.cap-num');
    const bar = el.querySelector('.bar');
    return {
      el,
      update(t, a, b) {
        const nk = O.tw(t, a, a + 0.6);
        num.style.opacity = nk * (1 - O.tw(t, b - 0.1, b + 0.3));
        bar.style.transform = `scaleX(${E.outQuart(O.prog(t, a + 0.1, a + 0.8))})`;
        chars.forEach((c, i) => {
          const s = a + 0.12 + i * 0.022;
          const k = E.outQuart(O.prog(t, s, s + 0.75));
          const o = E.inCubic(O.prog(t, b + i * 0.008, b + i * 0.008 + 0.35));
          c.style.transform = `translate3d(0,${(1 - k) * 105 - o * 105}%,0)`;
          c.style.fontVariationSettings = `'wdth' ${O.lerp(135, 60, E.outCubic(O.prog(t, s, s + 1.1)))}, 'slnt' ${c.dataset.slnt}`;
        });
        O.reveal(words, t, a + 0.55, 0.018, 0.7, { dist: 100 });
        const so = O.tw(t, b, b + 0.4, E.inCubic);
        if (so > 0) words.forEach((w) => {
          w.style.opacity = 1 - so;
          w.style.transform = `translate3d(0,${-so * 60}%,0)`;
        });
      },
    };
  };

  // Standard scene entrance and exit on the root element.
  O.sceneEnv = function (el, t, a, b, opts) {
    opts = opts || {};
    const ki = E.outCubic(O.prog(t, a - (opts.pre || 0), a - (opts.pre || 0) + (opts.din || 0.9)));
    const ko = E.inCubic(O.prog(t, b - (opts.dout || 0.7), b + (opts.post || 0)));
    const sc = O.lerp(0.965, 1, ki) * O.lerp(1, 1.05, ko) * (opts.drift ? O.lerp(1, 1.018, O.prog(t, a, b)) : 1);
    const y = (1 - ki) * 40 - ko * 60;
    el.style.transform = `translate3d(0,${y}px,0) scale(${sc})`;
    el.style.opacity = Math.min(ki, 1 - ko);
    const bl = (1 - ki) * 10 + ko * 8;
    el.style.filter = bl > 0.05 ? `blur(${bl.toFixed(2)}px)` : 'none';
  };

  O.icon = {
    file: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
    book: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/></svg>',
    pen: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    cross: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
    down: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M4 20h16"/></svg>',
    sliders: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    chev: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10l4-4 4 4M8 14l4 4 4-4"/></svg>',
    reset: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    link: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  };
  O.tail = '<svg viewBox="60 244 905 520" fill="currentColor"><path d="M797.14 322.264C701.904 337.045 656.024 322.264 585.814 381.386C515.604 440.507 530.898 491.5 530.898 727.247C531.632 759.024 538.347 759.169 542.02 759.024C560.789 758.285 565.172 711.922 688.909 618.805C812.645 525.688 830.955 523.281 884.3 473.658C958.279 404.84 961.195 286.052 954.243 267.577C947.292 249.101 892.375 307.484 797.14 322.264Z"/><path d="M227.611 322.264C322.847 337.045 368.727 322.264 438.937 381.386C509.147 440.507 493.853 491.5 493.853 727.247C493.119 759.024 486.404 759.169 482.731 759.024C463.962 758.285 459.579 711.922 335.842 618.805C212.106 525.688 193.796 523.281 140.452 473.658C66.4723 404.84 63.5559 286.052 70.5077 267.577C77.4594 249.101 132.376 307.484 227.611 322.264Z"/></svg>';
})();
