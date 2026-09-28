// Boot, the live player and the hooks the renderer drives.
(function () {
  const O = window.O;
  const render = /render/.test(location.search);
  if (render) document.documentElement.classList.add('render');
  const stage = document.getElementById('stage');

  const FACES = [
    'italic 700 40px "Faune Display"', '400 20px "Archivo"', '600 20px "Archivo"', 'italic 400 20px "Archivo"',
    '400 20px "DM Mono"', '500 20px "DM Mono"',
    '400 20px "Geist"', '400 20px "Geist Mono"', '500 20px "Roboto Flex"',
  ];

  O.ready = (async () => {
    await Promise.all(FACES.map((f) => document.fonts.load(f).catch(() => null)));
    O.buildWorld(stage);
    for (const s of O.scenes) {
      s.el.style.display = 'none';
      s.init();
    }
    await Promise.all(Array.from(document.images).map((im) => im.decode().catch(() => null)));
    await document.fonts.ready;
    O.seek(0);
    return true;
  })();

  O.seek = (t) => O.renderWorld(Math.max(0, Math.min(O.T.total, t)));

  if (render) return;

  // Live player.
  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `scale(${s})`;
  };
  addEventListener('resize', fit);
  fit();

  const scrub = document.getElementById('scrub');
  const time = document.getElementById('time');
  const playBtn = document.getElementById('play');
  let playing = false, t0 = 0, offset = 0, actx = null, buf = null, src = null;

  const now = () => (playing ? offset + (actx ? actx.currentTime - t0 : (performance.now() - t0) / 1000) : offset);

  function startAudio(at) {
    if (!actx || !buf) return;
    if (src) try { src.stop(); } catch (e) {}
    src = actx.createBufferSource();
    src.buffer = buf;
    src.connect(actx.destination);
    src.start(0, at);
  }
  function play() {
    if (offset >= O.T.total - 0.05) offset = 0;
    playing = true;
    t0 = actx ? actx.currentTime : performance.now();
    startAudio(offset);
    playBtn.textContent = 'Pause';
  }
  function pause() {
    offset = now();
    playing = false;
    if (src) try { src.stop(); } catch (e) {}
    playBtn.textContent = 'Play';
  }
  function loop() {
    let t = now();
    if (playing && t >= O.T.total) {
      pause();
      offset = O.T.total;
      t = offset;
    }
    O.seek(t);
    scrub.value = String(t / O.T.total);
    time.textContent = `${t.toFixed(2)}s / ${O.T.total.toFixed(1)}s`;
    requestAnimationFrame(loop);
  }

  document.getElementById('start').addEventListener('click', async (ev) => {
    const st = ev.currentTarget;
    st.querySelector('.lbl').textContent = 'COMPOSING THE SCORE…';
    await O.ready;
    try {
      actx = new AudioContext({ sampleRate: 48000 });
      buf = await O.audio.render();
    } catch (e) {
      console.warn('audio unavailable', e);
      actx = null;
    }
    st.remove();
    play();
  });
  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  scrub.addEventListener('input', () => {
    const was = playing;
    if (playing) pause();
    offset = +scrub.value * O.T.total;
    if (was) play();
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
    if (e.code === 'ArrowRight') { offset = Math.min(O.T.total, now() + 2); if (playing) play(); }
    if (e.code === 'ArrowLeft') { offset = Math.max(0, now() - 2); if (playing) play(); }
  });
  O.ready.then(() => requestAnimationFrame(loop));
})();
