import React, { useEffect, useRef } from 'react';

interface DigitalLandscapeProps {
  hidden?: boolean;
}

export const DigitalLandscape: React.FC<DigitalLandscapeProps> = ({ hidden }) => {
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const fgRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const hiddenRef = useRef<boolean>(!!hidden);
  hiddenRef.current = !!hidden;

  useEffect(() => {
    const bgCanvas = bgRef.current;
    const fgCanvas = fgRef.current;
    const container = containerRef.current;
    if (!bgCanvas || !fgCanvas || !container) return;

    const ctx = bgCanvas.getContext('2d');
    const fgCtx = fgCanvas.getContext('2d');
    if (!ctx || !fgCtx) return;

    let rafId: number | null = null;
    let time = 0;
    let lastTs: number | null = null;
    let particles: Array<{ x: number; y: number; size: number; speedX: number; speedY: number; opacity: number }> = [];

    function resize() {
      if (!bgCanvas || !fgCanvas || !ctx || !fgCtx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      bgCanvas.width = Math.round(w * dpr);
      bgCanvas.height = Math.round(h * dpr);
      fgCanvas.width = Math.round(w * dpr);
      fgCanvas.height = Math.round(h * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      fgCtx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      fgCtx.scale(dpr, dpr);
      bgCanvas.style.width = w + 'px';
      bgCanvas.style.height = h + 'px';
      fgCanvas.style.width = w + 'px';
      fgCanvas.style.height = h + 'px';
    }

    resizeRef.current = resize;
    window.addEventListener('resize', resize);
    resize();

    const colors = [
      { h: 260, s: 15, l: 50 },
      { h: 240, s: 20, l: 40 },
      { h: 220, s: 25, l: 30 },
      { h: 200, s: 30, l: 22 },
      { h: 170, s: 25, l: 14 },
      { h: 150, s: 20, l: 6 },
    ];

    function fbm(x: number) {
      let y = 0,
        amplitude = 1,
        frequency = 1,
        maxAmplitude = 0;
      for (let i = 0; i < 5; i++) {
        let n = 1.0 - Math.abs(Math.sin(x * frequency + i * 2.345));
        n = n * n;
        y += n * amplitude;
        maxAmplitude += amplitude;
        amplitude *= 0.45;
        frequency *= 2.1;
      }
      return (y / maxAmplitude) * 2 - 1;
    }

    function getLayerY(xVal: number, layerIndex: number, width: number, height: number) {
      const nx = xVal / width;
      const scale = 3 + layerIndex * 1.2;
      const layerSpeed = time * (0.5 + layerIndex * 0.3);
      const sampleX = nx * scale + layerSpeed + layerIndex * 100;
      const macroShape = Math.sin(sampleX * 0.8) * 0.5;
      const detail = fbm(sampleX);
      const baseHeight = height * 0.35 + layerIndex * (height * 0.12);
      const waveHeight = height * (0.12 + (6 - layerIndex) * 0.02);
      return baseHeight - (macroShape + detail * 0.6) * waveHeight;
    }

    function drawCloud(baseX: number, y: number, scale: number, opacity: number, speed: number, width: number) {
      if (!ctx) return;
      const range = width + 1000;
      const x = ((baseX + time * speed * 4) % range) - 500;
      const bobbingY = y + Math.sin(time * 1.5 + baseX) * 12;
      ctx.save();
      ctx.translate(x, bobbingY);
      ctx.scale(scale, scale);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = '#F4EAE0';
      const t = time * 1.5 + baseX;
      const breath = Math.sin(t) * 6,
        stretch = Math.cos(t * 0.8) * 8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-20 + stretch, -10, -40, -40 + breath, -10, -60);
      ctx.bezierCurveTo(10, -100 - breath, 70 + stretch, -110, 100, -70);
      ctx.bezierCurveTo(120, -120 + breath, 200 - stretch, -100, 220, -50);
      ctx.bezierCurveTo(260 + stretch, -60 - breath, 290, -20, 270, 15);
      ctx.bezierCurveTo(300, 40 + breath, 250 - stretch, 70, 210, 40);
      ctx.bezierCurveTo(170, 80, 80 + stretch, 70 + breath, 60, 30);
      ctx.bezierCurveTo(30, 50 + breath, -20 - stretch, 30, 0, 0);
      ctx.fill();
      ctx.restore();
    }

    function draw(ts: number = performance.now()) {
      if (hiddenRef.current) {
        lastTs = null;
        rafId = requestAnimationFrame(draw);
        return;
      }

      let dt = lastTs == null ? 1 : (ts - lastTs) / 16.666;
      lastTs = ts;
      if (dt > 3) dt = 3;
      time += 0.0005 * dt;

      const width = window.innerWidth;
      const height = window.innerHeight;

      if (particles.length === 0 && width > 0) {
        particles = Array.from({ length: 26 }).map(() => ({
          x: Math.random() * width,
          y: Math.random() * height,
          size: Math.random() * 2 + 0.5,
          speedX: Math.random() * 1.1 + 0.45,
          speedY: Math.random() * 0.45 - 0.22,
          opacity: Math.random() * 0.5 + 0.1,
        }));
      }

      ctx!.clearRect(0, 0, width, height);
      fgCtx!.clearRect(0, 0, width, height);

      const gradient = ctx!.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#0a0d1a');
      gradient.addColorStop(0.3, '#162038');
      gradient.addColorStop(0.6, '#283655');
      gradient.addColorStop(0.8, '#415a77');
      gradient.addColorStop(1, '#778da9');
      ctx!.fillStyle = gradient;
      ctx!.fillRect(0, 0, width, height);

      ctx!.beginPath();
      const sunY = height * 0.45 + Math.sin(time * 0.5) * 20;
      ctx!.arc(width * 0.65, sunY, width * 0.05, 0, Math.PI * 2);
      ctx!.fillStyle = '#ffeedd';
      ctx!.shadowColor = '#ffaa55';
      ctx!.shadowBlur = 60;
      ctx!.fill();
      ctx!.shadowBlur = 0;

      drawCloud(width * 0.15, height * 0.2, 0.4, 0.35, 20, width);
      drawCloud(width * 0.6, height * 0.15, 0.3, 0.25, 12, width);
      drawCloud(width * 0.85, height * 0.25, 0.5, 0.4, 28, width);
      drawCloud(width * 0.75, height * 0.1, 0.9, 0.3, 16, width);
      drawCloud(width * 0.3, height * 0.3, 0.35, 0.35, 22, width);

      const layers = 6;
      for (let i = 0; i < layers; i++) {
        ctx!.beginPath();
        ctx!.moveTo(0, height);
        for (let x = 0; x <= width; x += 3) {
          ctx!.lineTo(x, getLayerY(x, i, width, height));
        }
        ctx!.lineTo(width, height);
        ctx!.closePath();
        const { h, s, l } = colors[i % colors.length];
        ctx!.fillStyle = `hsl(${h}, ${s}%, ${l}%)`;
        ctx!.fill();

        if (i < layers - 1) {
          const baseHeight = height * 0.35 + i * (height * 0.12);
          const waveHeight = height * (0.12 + (layers - i) * 0.02);
          const fogGradient = ctx!.createLinearGradient(0, baseHeight - waveHeight, 0, height);
          fogGradient.addColorStop(0, 'rgba(119,141,169,0)');
          fogGradient.addColorStop(1, `rgba(119,141,169,${0.1 + 0.05 * (layers - i)})`);
          ctx!.fillStyle = fogGradient;
          ctx!.fill();
        }

        if (i >= layers - 3) {
          const scale = 3 + i * 1.2;
          const layerSpeed = time * (0.5 + i * 0.3);
          const offset = layerSpeed + i * 100;
          const spacing = 0.2;
          const startWX = Math.floor(offset / spacing) * spacing;
          const endWX = offset + scale + spacing;
          for (let wx = startWX; wx <= endWX; wx += spacing) {
            const rand = Math.abs(Math.sin(wx * 123.456 + i * 78.9));
            if (rand < 0.15) {
              const sx = ((wx - offset) / scale) * width;
              const sy = getLayerY(sx, i, width, height);
              if (sx > -20 && sx < width + 20) {
                const isFlower = Math.abs(Math.cos(wx * 456.789)) < 0.15;
                const sizeMult = 0.5 + Math.abs(Math.sin(wx * 789.123)) * 0.5;
                const baseSize = (i - (layers - 4)) * (width > 800 ? 5 : 3);
                ctx!.save();
                ctx!.translate(sx, sy);
                if (isFlower && i === layers - 1) {
                  const hue = 320 + Math.abs(Math.sin(wx * 321)) * 40;
                  ctx!.fillStyle = 'hsl(150,40%,20%)';
                  ctx!.fillRect(-1, -baseSize * 1.5, 2, baseSize * 1.5);
                  ctx!.fillStyle = `hsl(${hue},80%,70%)`;
                  ctx!.beginPath();
                  ctx!.arc(0, -baseSize * 1.5, baseSize * 0.6, 0, Math.PI * 2);
                  ctx!.fill();
                  ctx!.fillStyle = 'hsl(50,90%,60%)';
                  ctx!.beginPath();
                  ctx!.arc(0, -baseSize * 1.5, baseSize * 0.2, 0, Math.PI * 2);
                  ctx!.fill();
                } else {
                  const layerColor = colors[i % colors.length];
                  const h2 = baseSize * 5 * sizeMult,
                    w2 = baseSize * 1.8 * sizeMult;
                  ctx!.fillStyle = `hsl(${layerColor.h}, ${Math.max(layerColor.s - 15, 0)}%, ${Math.max(layerColor.l - 12, 5)}%)`;
                  ctx!.fillRect(-w2 * 0.15, -h2 * 0.2, w2 * 0.3, h2 * 0.2);
                  ctx!.fillStyle = `hsl(${layerColor.h}, ${Math.max(layerColor.s - 5, 0)}%, ${Math.max(layerColor.l - 6, 2)}%)`;
                  for (let lvl = 0; lvl < 3; lvl++) {
                    const bottomY = -h2 * 0.15 - h2 * 0.25 * lvl,
                      topY = bottomY - h2 * 0.45,
                      levelW = w2 * (1 - lvl * 0.25);
                    ctx!.beginPath();
                    ctx!.moveTo(0, topY);
                    ctx!.lineTo(-levelW, bottomY);
                    ctx!.lineTo(levelW, bottomY);
                    ctx!.fill();
                  }
                  ctx!.fillStyle = 'rgba(255,255,255,0.06)';
                  for (let lvl = 0; lvl < 3; lvl++) {
                    const bottomY = -h2 * 0.15 - h2 * 0.25 * lvl,
                      topY = bottomY - h2 * 0.45,
                      levelW = w2 * (1 - lvl * 0.25);
                    ctx!.beginPath();
                    ctx!.moveTo(0, topY);
                    ctx!.lineTo(0, bottomY);
                    ctx!.lineTo(levelW, bottomY);
                    ctx!.fill();
                  }
                }
                ctx!.restore();
              }
            }
          }
        }
      }

      ctx!.fillStyle = '#ffffff';
      particles.forEach(p => {
        p.x += p.speedX * dt;
        p.y += p.speedY * dt;
        const wave = Math.sin(time * 15 + p.x * 0.01) * 1.5;
        const currentY = p.y + wave;
        if (p.x > width + 10) {
          p.x = -10;
          p.y = Math.random() * height;
        }
        if (p.y > height + 10) p.y = -10;
        if (p.y < -10) p.y = height + 10;
        ctx!.globalAlpha = p.opacity;
        ctx!.beginPath();
        ctx!.arc(p.x, currentY, p.size, 0, Math.PI * 2);
        ctx!.fill();
      });
      ctx!.globalAlpha = 1.0;

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    if (!hidden && resizeRef.current) {
      resizeRef.current();
    }
  }, [hidden]);

  return (
    <div
      ref={containerRef}
      id="night-stage"
      className={hidden ? 'hidden' : ''}
    >
      <canvas ref={bgRef} id="dl-bg" className="dl-canvas dl-bg" />
      <canvas ref={fgRef} id="dl-fg" className="dl-canvas dl-fg" />
      <div className="dl-vignette" />
      <div className="dl-canvas-texture" />
    </div>
  );
};
