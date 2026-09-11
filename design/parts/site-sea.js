class Component extends DCLogic {
  componentDidMount() {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const tick = (now) => {
      if (this.props.animate !== false && !reduce) {
        const t = (now - t0) / 1000;
        for (const p of document.querySelectorAll("[data-sea]")) p.setAttribute("d", this.seaPath(p.dataset, t));
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  componentWillUnmount() {
    cancelAnimationFrame(this.raf);
  }
  seaPath(ds, t) {
    const P = {
      phone: { w: 390, h: 360, b0: 72, b1: 62, c: 230, s: 160, a1: 5, l1: 260, p1: 7, a2: 2.5, l2: 130, p2: 4.5 },
      hero: { w: 1440, h: 760, b0: 72, b1: 30, c: 980, s: 520, a1: 9, l1: 640, p1: 8, a2: 4, l2: 240, p2: 5 },
      waterline: { w: 1440, h: 1200, b0: 72, b1: 30, c: 980, s: 520, a1: 9, l1: 640, p1: 8, a2: 4, l2: 240, p2: 5 },
      phonewater: { w: 390, h: 900, b0: 40, b1: 10, c: 260, s: 160, a1: 4, l1: 220, p1: 7, a2: 2, l2: 110, p2: 4.5 },
      longwater: { w: 1440, h: 6500, b0: 72, b1: 30, c: 980, s: 520, a1: 9, l1: 640, p1: 8, a2: 4, l2: 240, p2: 5 },
      landing: { w: 1440, h: 620, b0: 158, b1: 138, c: 760, s: 450, a1: 10, l1: 720, p1: 9, a2: 4.5, l2: 280, p2: 5.5 },
    }[ds.sea];
    const off = Number(ds.off || 0), tt = t - Number(ds.lag || 0), n = 36, step = P.w / n, TAU = Math.PI * 2;
    const breath = 1 + 0.06 * Math.sin((TAU * tt) / 13);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const x = i * step;
      const g = Math.exp(-Math.pow((x - P.c) / P.s, 2));
      pts.push([x, P.b0 - P.b1 * g * breath + P.a1 * Math.sin(TAU * (x / P.l1 - tt / P.p1)) + P.a2 * Math.sin(TAU * (x / P.l2 + tt / P.p2)) + off]);
    }
    const f = (v) => v.toFixed(1);
    let d = "M0 " + f(pts[0][1]);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[i], c = pts[i + 1], e = pts[Math.min(i + 2, n)];
      d += "C" + f(b[0] + (c[0] - a[0]) / 6) + " " + f(b[1] + (c[1] - a[1]) / 6) + " " + f(c[0] - (e[0] - b[0]) / 6) + " " + f(c[1] - (e[1] - b[1]) / 6) + " " + f(c[0]) + " " + f(c[1]);
    }
    return ds.kind === "line" ? d : d + "V" + P.h + "H0Z";
  }
}
