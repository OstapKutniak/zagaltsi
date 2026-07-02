// Процедурний арт локацій-заглушок — чорнильні силуетні сцени в палітрі гри
// (присмерк як у бітемап-рівні: #3a3148 небо / #4a3f2e земля, чорні силуети).
// Перша сцена — «Дуб-Боржник». Дві канви: back (небо/пагорб/земля) і front
// (дуб/очерет/віньєтка) — між ними LocationScene кладе шар туману (плановість).

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SceneLayers { back: HTMLCanvasElement; front: HTMLCanvasElement; groundY: number }

export function oakScene(w = 1280, h = 576, seed = 21): SceneLayers {
  const r = rng(seed);
  const groundY = h * 0.78;

  // ── BACK: небо, бліде сонце, далекий пагорб, земля ──────────────────────────
  const back = document.createElement('canvas'); back.width = w; back.height = h;
  {
    const x = back.getContext('2d')!;
    const sky = x.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, '#241e30'); sky.addColorStop(0.6, '#3a3148'); sky.addColorStop(1, '#4a3d52');
    x.fillStyle = sky; x.fillRect(0, 0, w, groundY);
    // мутне низьке сонце/місяць за серпанком
    const sun = x.createRadialGradient(w * 0.72, h * 0.3, 4, w * 0.72, h * 0.3, 90);
    sun.addColorStop(0, 'rgba(232,214,180,0.5)');
    sun.addColorStop(0.4, 'rgba(232,214,180,0.14)');
    sun.addColorStop(1, 'rgba(232,214,180,0)');
    x.fillStyle = sun; x.fillRect(w * 0.72 - 100, h * 0.3 - 100, 200, 200);
    // далекий пагорб з рідкими деревами
    x.fillStyle = '#2c2536';
    x.beginPath(); x.moveTo(0, groundY);
    for (let px = 0; px <= w; px += 40) x.lineTo(px, groundY - 40 - Math.sin(px * 0.004 + 1) * 26 - r() * 8);
    x.lineTo(w, groundY); x.closePath(); x.fill();
    for (let i = 0; i < 9; i++) {
      const tx = r() * w, ty = groundY - 52 - Math.sin(tx * 0.004 + 1) * 26, s = 8 + r() * 10;
      x.strokeStyle = '#241e2c'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(tx, ty); x.lineTo(tx, ty - s); x.stroke();
      x.beginPath(); x.arc(tx, ty - s - 4, s * 0.42, 0, Math.PI * 2); x.fillStyle = '#241e2c'; x.fill();
    }
    // земля
    const gr = x.createLinearGradient(0, groundY, 0, h);
    gr.addColorStop(0, '#4a3f2e'); gr.addColorStop(1, '#332b20');
    x.fillStyle = gr; x.fillRect(0, groundY, w, h - groundY);
    // стежка до дуба
    x.strokeStyle = 'rgba(20,16,12,0.35)'; x.lineWidth = 14; x.lineCap = 'round';
    x.beginPath(); x.moveTo(w * 0.1, h * 0.97);
    x.quadraticCurveTo(w * 0.3, groundY + 30, w * 0.44, groundY + 8); x.stroke();
  }

  // ── FRONT: великий дуб з дуплом і монетами, очерет, віньєтка ───────────────
  const front = document.createElement('canvas'); front.width = w; front.height = h;
  {
    const x = front.getContext('2d')!;
    const cx = w * 0.46, baseY = groundY + 10;
    x.fillStyle = '#17121c'; x.strokeStyle = '#17121c';
    // коріння-лапи
    for (const [dx, len] of [[-1, 90], [-0.4, 55], [0.5, 60], [1, 95]] as const) {
      x.beginPath();
      x.moveTo(cx + dx * 28, baseY - 30);
      x.quadraticCurveTo(cx + dx * (28 + len * 0.5), baseY - 8, cx + dx * (28 + len), baseY + 6);
      x.quadraticCurveTo(cx + dx * (28 + len * 0.4), baseY, cx + dx * 18, baseY);
      x.closePath(); x.fill();
    }
    // стовбур — грубий, звужується, гнутий
    x.beginPath();
    x.moveTo(cx - 46, baseY);
    x.bezierCurveTo(cx - 40, baseY - 120, cx - 30, baseY - 180, cx - 34, baseY - 250);
    x.lineTo(cx + 26, baseY - 260);
    x.bezierCurveTo(cx + 34, baseY - 170, cx + 44, baseY - 110, cx + 50, baseY);
    x.closePath(); x.fill();
    // гілки — криві «пазурі» (рекурсія)
    const branch = (bx: number, by: number, ang: number, len: number, wd: number, depth: number): void => {
      if (depth <= 0 || len < 14) return;
      const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
      const mx = bx + Math.cos(ang + 0.35) * len * 0.5, my = by + Math.sin(ang + 0.35) * len * 0.5;
      x.lineWidth = wd; x.lineCap = 'round';
      x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(mx, my, ex, ey); x.stroke();
      const n = 2 + (r() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) branch(ex, ey, ang + (r() - 0.45) * 1.1, len * (0.55 + r() * 0.2), wd * 0.55, depth - 1);
    };
    branch(cx - 20, baseY - 240, -Math.PI / 2 - 0.7, 120, 16, 4);
    branch(cx + 8,  baseY - 252, -Math.PI / 2 + 0.1, 140, 18, 4);
    branch(cx + 22, baseY - 235, -Math.PI / 2 + 0.8, 115, 14, 4);
    branch(cx - 38, baseY - 190, Math.PI + 0.5, 70, 10, 3);
    // рвана крона — темні клапті листя на кінцях
    x.fillStyle = 'rgba(23,18,28,0.88)';
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
      const dist = 130 + r() * 130;
      const px = cx + Math.cos(a) * dist, py = baseY - 250 + Math.sin(a) * dist * 0.72 - 40;
      if (py > baseY - 190) continue;
      x.beginPath(); x.ellipse(px, py, 26 + r() * 30, 16 + r() * 18, (r() - 0.5), 0, Math.PI * 2); x.fill();
    }
    // ДУПЛО — темна паща з чорнильним обведенням і слабким відблиском монет усередині
    const hx = cx + 2, hy = baseY - 150;
    x.fillStyle = '#060409';
    x.beginPath(); x.ellipse(hx, hy, 20, 30, 0.06, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#241c2e'; x.lineWidth = 3;
    x.beginPath(); x.ellipse(hx, hy, 22, 33, 0.06, 0, Math.PI * 2); x.stroke();
    x.fillStyle = 'rgba(214,182,110,0.32)';
    x.beginPath(); x.arc(hx - 4, hy + 16, 3, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(hx + 5, hy + 19, 2.4, 0, Math.PI * 2); x.fill();
    // Монети-обереги, підвішені до гілок на нитках (борг, який «висить»)
    x.strokeStyle = 'rgba(20,15,25,0.9)';
    for (const [mx2, my2, drop] of [[cx - 96, baseY - 320, 46], [cx + 78, baseY - 348, 60], [cx + 150, baseY - 300, 38]] as const) {
      x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(mx2, my2); x.lineTo(mx2, my2 + drop); x.stroke();
      x.fillStyle = 'rgba(160,134,82,0.85)';
      x.beginPath(); x.arc(mx2, my2 + drop + 5, 5, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(20,15,25,0.9)'; x.lineWidth = 1.2;
      x.beginPath(); x.arc(mx2, my2 + drop + 5, 5, 0, Math.PI * 2); x.stroke();
    }
    // передній план: темна трава/очерет знизу
    x.strokeStyle = '#141019'; x.lineWidth = 2.4; x.lineCap = 'round';
    for (let i = 0; i < 60; i++) {
      const gx = r() * w, gh = 14 + r() * 30, sway = (r() - 0.5) * 14;
      const gy = h - r() * 24;
      x.beginPath(); x.moveTo(gx, gy); x.quadraticCurveTo(gx + sway * 0.4, gy - gh * 0.6, gx + sway, gy - gh); x.stroke();
    }
    // віньєтка
    const vg = x.createRadialGradient(w / 2, h * 0.52, h * 0.36, w / 2, h * 0.52, h * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,5,12,0.55)');
    x.fillStyle = vg; x.fillRect(0, 0, w, h);
  }

  return { back, front, groundY };
}
