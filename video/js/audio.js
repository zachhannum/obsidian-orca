// The score, synthesized with Web Audio into one buffer. The music runs at
// 128 bpm so that scene cuts fall on bar lines, and every sound effect is
// placed from the cues the scenes publish.
(function () {
  const O = window.O;
  const SR = 48000;
  const BEAT = 60 / 128;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const CHORDS = [
    [0, 47, [62, 66, 69, 73]],
    [3.75, 43, [59, 62, 66, 69]],
    [7.5, 42, [57, 62, 64, 66]],
    [11.25, 45, [61, 64, 69, 71]],
    [15, 47, [62, 66, 69, 73]],
    [18.75, 43, [59, 62, 66, 69]],
    [22.5, 40, [55, 59, 62, 66]],
    [26.25, 42, [57, 62, 64, 66]],
    [30, 43, [59, 62, 66, 69]],
    [33.75, 45, [61, 64, 69, 71]],
    [37.5, 47, [62, 66, 69, 73]],
    [41.25, 43, [59, 62, 66, 69]],
    [45, 40, [55, 59, 62, 66]],
    [47.8125, 45, [61, 64, 69, 71]],
    [50.625, 38, [54, 57, 61, 64, 66]],
  ];

  function build(ctx, total) {
    const rnd = O.rng(1234);
    const noise = ctx.createBuffer(1, SR * 3, SR);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;

    // Master: glue compressor, then a limiter.
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.25; glue.knee.value = 8;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; lim.knee.value = 0;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = 0.7;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf'; shelf.frequency.value = 140; shelf.gain.value = -4;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf'; air.frequency.value = 6000; air.gain.value = 2;
    glue.connect(hp).connect(shelf).connect(air).connect(lim).connect(master).connect(ctx.destination);
    master.gain.setValueAtTime(0.9, total - 2.2);
    master.gain.linearRampToValueAtTime(0, total);

    // Reverb.
    const irLen = SR * 3.4;
    const ir = ctx.createBuffer(2, irLen, SR);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < irLen; i++) {
        lp = lp * 0.55 + (rnd() * 2 - 1) * 0.45;
        d[i] = lp * Math.pow(1 - i / irLen, 3.4);
      }
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const verbIn = ctx.createGain();
    verbIn.gain.value = 0.6;
    verbIn.connect(verb).connect(glue);

    // Music bus, ducked by the kick.
    const music = ctx.createGain();
    music.connect(glue);
    const duck = music.gain;
    duck.value = 1;

    // Tempo delay for the arpeggio.
    const dly = ctx.createDelay(2);
    dly.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    dly.connect(dlp).connect(fb).connect(dly);
    const dOut = ctx.createGain();
    dOut.gain.value = 0.3;
    dlp.connect(dOut).connect(music);

    const pan = (v) => {
      const p = ctx.createStereoPanner();
      p.pan.value = v;
      return p;
    };
    const noiseSrc = (t, dur) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.start(t, rnd() * 2, dur + 0.05);
      return s;
    };

    // Pad: detuned saws, slow filter.
    function pad(notes, t0, t1, peak, attack) {
      notes.forEach((m, j) => {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + attack);
        g.gain.setValueAtTime(peak, Math.max(t0 + attack, t1 - 0.05));
        g.gain.linearRampToValueAtTime(0, t1 + 1.8);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 0.6;
        f.frequency.setValueAtTime(500, t0);
        f.frequency.linearRampToValueAtTime(1500, t1 + 1);
        const p = pan((j / (notes.length - 1) - 0.5) * 0.9);
        [-9, 0, 8].forEach((cents) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(m);
          o.detune.value = cents;
          o.connect(f);
          o.start(t0);
          o.stop(t1 + 2);
        });
        f.connect(g).connect(p);
        p.connect(music);
        const s = ctx.createGain();
        s.gain.value = 0.5;
        p.connect(s).connect(verbIn);
      });
    }

    function sub(m, t0, t1, peak) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(m);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.8);
      g.gain.setValueAtTime(peak, t1 - 0.1);
      g.gain.linearRampToValueAtTime(0, t1 + 0.6);
      o.connect(g).connect(music);
      o.start(t0);
      o.stop(t1 + 0.7);
    }

    function bassNote(m, t, dur, v) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(m);
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 3;
      f.frequency.setValueAtTime(700, t);
      f.frequency.exponentialRampToValueAtTime(160, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(f);
      const g2 = ctx.createGain();
      g2.gain.value = 0.6;
      o2.connect(g2).connect(f);
      f.connect(g).connect(music);
      o.start(t); o2.start(t);
      o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
    }

    function pluck(m, t, v, p, bright) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = mtof(m);
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = mtof(m + 12);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(bright, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.55);
      const g2 = ctx.createGain();
      g2.gain.value = 0.35;
      o.connect(f);
      o2.connect(g2).connect(f);
      const pp = pan(p);
      f.connect(g).connect(pp);
      pp.connect(music);
      pp.connect(dly);
      const s = ctx.createGain();
      s.gain.value = 0.35;
      pp.connect(s).connect(verbIn);
      o.start(t); o2.start(t);
      o.stop(t + 0.6); o2.stop(t + 0.6);
    }

    function bell(m, t, v, p = 0, decay = 2.2, wet = 0.7) {
      const f = mtof(m);
      const car = ctx.createOscillator();
      car.frequency.value = f;
      const mod = ctx.createOscillator();
      mod.frequency.value = f * 3.5;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * 2.2, t);
      mg.gain.exponentialRampToValueAtTime(f * 0.05, t + decay * 0.5);
      mod.connect(mg).connect(car.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
      const pp = pan(p);
      car.connect(g).connect(pp);
      pp.connect(glue);
      const s = ctx.createGain();
      s.gain.value = wet;
      pp.connect(s).connect(verbIn);
      car.start(t); mod.start(t);
      car.stop(t + decay + 0.1); mod.stop(t + decay + 0.1);
    }

    function kick(t, v = 0.9) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g).connect(glue);
      o.start(t);
      o.stop(t + 0.55);
      const n = noiseSrc(t, 0.02);
      const hf = ctx.createBiquadFilter();
      hf.type = 'highpass'; hf.frequency.value = 2000;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.12 * v, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      n.connect(hf).connect(ng).connect(glue);
      duck.setValueAtTime(1, t);
      duck.linearRampToValueAtTime(0.55, t + 0.015);
      duck.linearRampToValueAtTime(1, t + 0.32);
    }

    function clap(t, v = 0.28) {
      [0, 0.012, 0.024].forEach((d, i) => {
        const n = noiseSrc(t + d, 0.2);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.9;
        const g = ctx.createGain();
        g.gain.setValueAtTime(v * (i === 2 ? 1 : 0.6), t + d);
        g.gain.exponentialRampToValueAtTime(0.001, t + d + (i === 2 ? 0.18 : 0.02));
        n.connect(bp).connect(g);
        g.connect(glue);
        const s = ctx.createGain();
        s.gain.value = 0.5;
        g.connect(s).connect(verbIn);
      });
    }

    function hat(t, v, p) {
      const n = noiseSrc(t, 0.06);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      const pp = pan(p);
      n.connect(hp).connect(g).connect(pp).connect(glue);
    }

    function whoosh(t, soft) {
      const dur = soft ? 0.8 : 1.1;
      const t0 = t - dur;
      const n = noiseSrc(t0, dur + 0.5);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(250, t0);
      bp.frequency.exponentialRampToValueAtTime(soft ? 2400 : 4200, t);
      bp.frequency.exponentialRampToValueAtTime(800, t + 0.4);
      const g = ctx.createGain();
      const v = soft ? 0.16 : 0.3;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.45);
      const pp = ctx.createStereoPanner();
      pp.pan.setValueAtTime(-0.6, t0);
      pp.pan.linearRampToValueAtTime(0.6, t + 0.4);
      n.connect(bp).connect(g).connect(pp);
      pp.connect(glue);
      const s = ctx.createGain();
      s.gain.value = 0.5;
      pp.connect(s).connect(verbIn);
    }

    function impact(t, big) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(big ? 90 : 75, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(big ? 0.85 : 0.45, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (big ? 2.2 : 1.1));
      o.connect(g).connect(glue);
      o.start(t);
      o.stop(t + 2.3);
      const n = noiseSrc(t, 0.8);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = big ? 900 : 500;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(big ? 0.35 : 0.18, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      n.connect(lp).connect(ng);
      ng.connect(glue);
      const s = ctx.createGain();
      s.gain.value = 1;
      ng.connect(s).connect(verbIn);
    }

    function riser(t0, t1, v) {
      const n = noiseSrc(t0, t1 - t0 + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 2;
      bp.frequency.setValueAtTime(300, t0);
      bp.frequency.exponentialRampToValueAtTime(6000, t1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t1 - 0.02);
      g.gain.linearRampToValueAtTime(0, t1 + 0.02);
      n.connect(bp).connect(g);
      g.connect(glue);
      const s = ctx.createGain();
      s.gain.value = 0.6;
      g.connect(s).connect(verbIn);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(mtof(57), t0);
      o.frequency.exponentialRampToValueAtTime(mtof(81), t1);
      const of = ctx.createBiquadFilter();
      of.type = 'lowpass'; of.frequency.value = 2500;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(v * 0.18, t1 - 0.02);
      og.gain.linearRampToValueAtTime(0, t1 + 0.02);
      o.connect(of).connect(og).connect(glue);
      o.start(t0);
      o.stop(t1 + 0.05);
    }

    function click(t, v = 0.32) {
      const n = noiseSrc(t, 0.01);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
      n.connect(bp).connect(g).connect(glue);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(1900, t);
      o.frequency.exponentialRampToValueAtTime(700, t + 0.03);
      const og = ctx.createGain();
      og.gain.setValueAtTime(v * 0.35, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      o.connect(og).connect(glue);
      o.start(t);
      o.stop(t + 0.04);
    }

    function key(t) {
      const n = noiseSrc(t, 0.03);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1500 + rnd() * 1400; bp.Q.value = 1.5;
      const g = ctx.createGain();
      const v = 0.1 + rnd() * 0.09;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
      const pp = pan((rnd() - 0.5) * 0.4);
      n.connect(bp).connect(g).connect(pp).connect(glue);
      const o = ctx.createOscillator();
      o.frequency.value = 160 + rnd() * 50;
      const og = ctx.createGain();
      og.gain.setValueAtTime(v * 0.6, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      o.connect(og).connect(pp);
      o.start(t);
      o.stop(t + 0.04);
    }

    function flick(t) {
      const n = noiseSrc(t, 0.05);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 3000 + rnd() * 2500; bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07 + rnd() * 0.05, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      const pp = pan((rnd() - 0.5) * 1.2);
      n.connect(bp).connect(g).connect(pp).connect(glue);
    }

    function pop(t) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(380, t);
      o.frequency.exponentialRampToValueAtTime(980, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(glue);
      const s = ctx.createGain();
      s.gain.value = 0.4;
      g.connect(s).connect(verbIn);
      o.start(t);
      o.stop(t + 0.14);
    }

    // Harmony.
    CHORDS.forEach(([t0, root, notes], i) => {
      const t1 = i + 1 < CHORDS.length ? CHORDS[i + 1][0] : total;
      const intro = t0 < 7.5;
      const fin = t0 >= 50;
      pad(notes, t0, t1, fin ? 0.03 : 0.022, intro && i === 0 ? 2.6 : 0.5);
      sub(root, t0, t1, intro ? 0.09 : t0 >= 45 ? 0.12 : 0.06);
    });

    // Arpeggio: from the second scene to the break.
    const PAT = [0, 2, 1, 3, 2, 0, 3, 1];
    const chordAt = (t) => { let c = CHORDS[0]; for (const x of CHORDS) if (t >= x[0] - 0.001) c = x; return c; };
    for (let t = 7.5, k = 0; t < 47.8; t += BEAT / 2, k++) {
      const [, , notes] = chordAt(t);
      const m = notes[PAT[k % 8] % notes.length] + 12;
      const fade = t < 15 ? O.lerp(0.35, 0.8, (t - 7.5) / 7.5) : t > 45 ? 0.8 * (1 - (t - 45) / 2.8) : 0.8;
      const bright = t < 15 ? 900 + (t - 7.5) * 200 : t > 45 ? 2400 - (t - 45) * 600 : 2400 + (t > 37.5 ? 1200 : 0);
      pluck(m, t, 0.13 * fade * (k % 2 ? 0.75 : 1), (k % 4) / 3 - 0.5, bright);
      if (t >= 37.5 && t < 45 && k % 2 === 0) pluck(m + 12, t + BEAT / 4, 0.045, 0.5 - (k % 4) / 3, 3000);
    }

    // Rhythm section.
    for (let b = 0, t = 15; t < 45 - 0.01; b++, t = 15 + b * BEAT) {
      const full = t >= 22.5;
      if (full || b % 2 === 0) kick(t, full ? 0.85 : 0.7);
      if (full && b % 2 === 1) clap(t);
      const [, root] = chordAt(t);
      if (full) {
        bassNote(root + 12, t + BEAT / 2, BEAT / 2 - 0.02, 0.2);
        bassNote(root + 12, t, BEAT / 2 - 0.02, 0.14);
        for (let s = 0; s < 4; s++) hat(t + (s * BEAT) / 4, [0.03, 0.012, 0.05, 0.015][s], 0.25);
      } else if (b % 2 === 0) bassNote(root + 12, t, BEAT * 1.8, 0.16);
    }

    // The break builds into the last chord.
    riser(47.8, 50.625, 0.28);
    for (let t = 48.75, i = 0; t < 50.62; i++) {
      const step = t < 49.69 ? BEAT / 2 : t < 50.16 ? BEAT / 4 : BEAT / 8;
      clap(t, 0.05 + 0.2 * ((t - 48.75) / 1.9));
      t += step;
    }
    kick(50.625, 1);
    // Opening shimmer and the resolution.
    [[1.0, 81], [1.9, 78], [2.7, 85], [3.75, 74], [3.9, 81], [4.05, 86], [4.2, 90]].forEach(([t, m], i) => bell(m, t, 0.06 + (i > 2 ? 0.03 : 0), (i % 2 ? 0.4 : -0.4), 3.2, 1));
    [74, 78, 81, 85, 88].forEach((m, i) => bell(m, 50.7 + i * 0.16, 0.08, (i / 4 - 0.5) * 0.8, 4.5, 1.1));
    [[52.3, 86], [53.0, 85], [53.5, 81], [54.2, 78], [55, 74]].forEach(([t, m], i) => bell(m, t, 0.04, i % 2 ? 0.5 : -0.5, 3.5, 1.2));
    riser(2.55, 3.75, 0.12);

    // Sound effects from the scenes.
    const c = O.cues;
    c.whooshes.forEach((w) => (typeof w === 'number' ? whoosh(w, false) : whoosh(w.t, w.soft)));
    c.impacts.forEach((i) => impact(i.t, i.big));
    c.clicks.forEach((t) => click(t));
    c.keys.forEach((t) => key(t));
    c.flicks.forEach((t) => flick(t));
    c.pops.forEach((t) => pop(t));
    const SCALE = [74, 76, 78, 81, 83, 86, 88];
    c.ticks.forEach((k) => {
      if (k.bright) {
        [86, 90, 93].forEach((m, i) => bell(m, k.t + i * 0.05, 0.05, 0, 2.4, 0.9));
        return;
      }
      bell(SCALE[k.n % SCALE.length], k.t, k.soft ? 0.035 : 0.05, (k.n % 3 - 1) * 0.4, 1.4, 0.6);
    });
  }

  function encodeWav(buf) {
    const n = buf.length, ch = buf.numberOfChannels;
    const out = new ArrayBuffer(44 + n * ch * 2);
    const v = new DataView(out);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++)
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    return out;
  }

  O.audio = {
    async render() {
      const total = O.T.total;
      const ctx = new OfflineAudioContext(2, Math.ceil(SR * total), SR);
      build(ctx, total);
      return ctx.startRendering();
    },
    async wavBase64() {
      const buf = await O.audio.render();
      const bytes = new Uint8Array(encodeWav(buf));
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(s);
    },
  };
})();
