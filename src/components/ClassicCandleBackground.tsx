import React, { useEffect, useRef } from 'react';

interface SimCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  pivot?: 'BUY' | 'SELL' | null;
}

/**
 * Classic AI Trading Background Animation:
 * Smoothly scrolling institutional candlesticks, dual EMA 9 / EMA 20 AI ribbons,
 * subtle structural confluence nodes, and a delicate vertical scan beam.
 * Pure visual atmosphere behind the hero; never used as market quote telemetry.
 */
export const ClassicCandleBackground: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const STEP_PX = 22;
    const BODY_W = 10;
    const candles: SimCandle[] = [];
    let lastClose = 0.52;
    let phase = 0.4;

    const nextSimCandle = (): SimCandle => {
      phase += 0.21;
      const macroWave = Math.sin(phase * 0.45) * 0.018 + Math.cos(phase * 0.17) * 0.012;
      // Pseudo-stochastic deterministic micro variation mixed with light randomness
      const impulse = (Math.random() - 0.48) * 0.055 + macroWave;
      const open = lastClose;
      let close = open + impulse;

      // Mean-revert smoothly inside vertical band [0.18, 0.82]
      if (close > 0.78) close -= 0.045;
      if (close < 0.22) close += 0.045;

      const spread = Math.abs(close - open);
      const wickUp = 0.012 + Math.random() * 0.032;
      const wickDown = 0.012 + Math.random() * 0.032;
      const high = Math.min(0.92, Math.max(open, close) + wickUp);
      const low = Math.max(0.08, Math.min(open, close) - wickDown);

      let pivot: 'BUY' | 'SELL' | null = null;
      if (spread > 0.032 && close > open && Math.random() > 0.65) pivot = 'BUY';
      else if (spread > 0.032 && close < open && Math.random() > 0.68) pivot = 'SELL';

      lastClose = close;
      return { open, high, low, close, pivot };
    };

    const ensureBuffer = (count: number) => {
      while (candles.length < count) {
        candles.push(nextSimCandle());
      }
    };

    const resize = () => {
      const parent = canvas.parentElement;
      width = parent ? parent.clientWidth : window.innerWidth;
      height = parent ? parent.clientHeight : 640;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const needed = Math.ceil(width / STEP_PX) + 18;
      ensureBuffer(needed);
    };

    resize();
    window.addEventListener('resize', resize);

    let scrollOffset = 0;
    let scanX = width * 0.25;
    let rafId = 0;
    let lastTs = performance.now();

    const drawFrame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      if (!reduceMotion) {
        scrollOffset += dt * 18; // Smooth gentle rightward/leftward market flow (px/s)
        while (scrollOffset >= STEP_PX) {
          scrollOffset -= STEP_PX;
          candles.shift();
          candles.push(nextSimCandle());
        }
        scanX += dt * 44;
        if (scanX > width + 140) scanX = -140;
      }

      ctx.clearRect(0, 0, width, height);

      // 1. Subtle Architectural Coordinate Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.032)';
      ctx.lineWidth = 1;
      const gridY = 64;
      const gridX = 88;
      ctx.beginPath();
      for (let y = gridY; y < height; y += gridY) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      for (let x = ((gridX - (scrollOffset % gridX)) + gridX) % gridX; x < width; x += gridX) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      ctx.stroke();

      const visibleCount = Math.min(candles.length, Math.ceil(width / STEP_PX) + 8);
      const toY = (norm: number) => height * (1 - norm);

      // 2. Compute smooth EMA 9 (Gold) & EMA 20 (Emerald) AI ribbons
      const emaFastPts: { x: number; y: number }[] = [];
      const emaSlowPts: { x: number; y: number }[] = [];
      let emaF = candles[0]?.close ?? 0.5;
      let emaS = candles[0]?.close ?? 0.5;
      const kF = 2 / (9 + 1);
      const kS = 2 / (20 + 1);

      for (let i = 0; i < visibleCount; i++) {
        const c = candles[i];
        emaF = c.close * kF + emaF * (1 - kF);
        emaS = c.close * kS + emaS * (1 - kS);
        const x = i * STEP_PX - scrollOffset;
        emaFastPts.push({ x, y: toY(emaF) });
        emaSlowPts.push({ x, y: toY(emaS) });
      }

      // 3. Subtle AI Vertical Scan Beam
      if (!reduceMotion) {
        const beamGrad = ctx.createLinearGradient(scanX - 90, 0, scanX + 18, 0);
        beamGrad.addColorStop(0, 'rgba(201, 162, 77, 0)');
        beamGrad.addColorStop(0.78, 'rgba(201, 162, 77, 0.045)');
        beamGrad.addColorStop(1, 'rgba(16, 185, 129, 0.08)');
        ctx.fillStyle = beamGrad;
        ctx.fillRect(scanX - 90, 0, 108, height);
      }

      // 4. Draw Candlesticks + Wicks
      for (let i = 0; i < visibleCount; i++) {
        const c = candles[i];
        const cx = i * STEP_PX - scrollOffset;
        if (cx < -STEP_PX || cx > width + STEP_PX) continue;

        const isUp = c.close >= c.open;
        const yHigh = toY(c.high);
        const yLow = toY(c.low);
        const yOpen = toY(c.open);
        const yClose = toY(c.close);

        const nearScan = !reduceMotion && Math.abs(cx - scanX) < 70;
        const boost = nearScan ? 0.14 : 0;

        // Wick
        ctx.strokeStyle = isUp
          ? `rgba(16, 185, 129, ${0.34 + boost})`
          : `rgba(201, 162, 77, ${0.30 + boost})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(cx, yHigh);
        ctx.lineTo(cx, yLow);
        ctx.stroke();

        // Body
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(3, Math.abs(yClose - yOpen));
        ctx.fillStyle = isUp
          ? `rgba(16, 185, 129, ${0.22 + boost})`
          : `rgba(201, 162, 77, ${0.18 + boost})`;
        ctx.strokeStyle = isUp
          ? `rgba(52, 211, 153, ${0.42 + boost})`
          : `rgba(218, 181, 96, ${0.36 + boost})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(cx - BODY_W / 2, bodyTop, BODY_W, bodyH, 1.5);
        ctx.fill();
        ctx.stroke();

        // AI Confluence Pivot Nodes + subtle neural connector vectors
        if (c.pivot) {
          const py = c.pivot === 'BUY' ? yLow + 12 : yHigh - 12;
          const pulse = reduceMotion ? 0.5 : 0.4 + 0.4 * Math.sin(now * 0.004 + i);
          ctx.beginPath();
          ctx.arc(cx, py, 3.2, 0, Math.PI * 2);
          ctx.fillStyle =
            c.pivot === 'BUY' ? 'rgba(16, 185, 129, 0.65)' : 'rgba(201, 162, 77, 0.65)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(cx, py, 7 + pulse * 4, 0, Math.PI * 2);
          ctx.strokeStyle =
            c.pivot === 'BUY'
              ? `rgba(16, 185, 129, ${0.22 * (1 - pulse * 0.4)})`
              : `rgba(201, 162, 77, ${0.22 * (1 - pulse * 0.4)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // 5. Draw Smooth EMA 20 Ribbon (Emerald)
      if (emaSlowPts.length > 2) {
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.36)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(emaSlowPts[0].x, emaSlowPts[0].y);
        for (let i = 1; i < emaSlowPts.length - 1; i++) {
          const xc = (emaSlowPts[i].x + emaSlowPts[i + 1].x) / 2;
          const yc = (emaSlowPts[i].y + emaSlowPts[i + 1].y) / 2;
          ctx.quadraticCurveTo(emaSlowPts[i].x, emaSlowPts[i].y, xc, yc);
        }
        ctx.stroke();
      }

      // 6. Draw Smooth EMA 9 Ribbon (Antique Gold)
      if (emaFastPts.length > 2) {
        ctx.strokeStyle = 'rgba(201, 162, 77, 0.44)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(emaFastPts[0].x, emaFastPts[0].y);
        for (let i = 1; i < emaFastPts.length - 1; i++) {
          const xc = (emaFastPts[i].x + emaFastPts[i + 1].x) / 2;
          const yc = (emaFastPts[i].y + emaFastPts[i + 1].y) / 2;
          ctx.quadraticCurveTo(emaFastPts[i].x, emaFastPts[i].y, xc, yc);
        }
        ctx.stroke();
      }

      if (!reduceMotion) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    if (reduceMotion) {
      drawFrame(performance.now());
    } else {
      rafId = window.requestAnimationFrame(drawFrame);
    }

    return () => {
      window.removeEventListener('resize', resize);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      className={`pointer-events-none select-none overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="block w-full h-full opacity-90" />
      {/* Vignette scrim for crisp foreground legibility */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#090B0E]/92 via-[#090B0E]/68 to-[#090B0E]/80" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#090B0E]/55 via-transparent to-[#090B0E]" />
    </div>
  );
};
