import React, { useId } from 'react';

interface SparklineProps {
  values: number[];
  positive?: boolean;
  width?: number;
  height?: number;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  positive,
  width = 88,
  height = 28,
  className = '',
}) => {
  const gradId = useId();
  if (!values || values.length < 2) {
    return (
      <div
        className={`inline-flex items-center justify-center text-[10px] text-slate-400 font-mono-tabular ${className}`}
        style={{ width, height }}
      >
        —
      </div>
    );
  }

  const pts = values.slice(-28);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const padY = 3;
  const usableH = height - padY * 2;
  const stepX = width / Math.max(pts.length - 1, 1);

  const coords = pts.map((v, i) => {
    const x = Number((i * stepX).toFixed(2));
    const y = Number((padY + usableH - ((v - min) / span) * usableH).toFixed(2));
    return { x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const isUp = positive !== undefined ? positive : pts[pts.length - 1] >= pts[0];
  const stroke = isUp ? '#059669' : '#E11D48';
  const last = coords[coords.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible shrink-0 ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r="2" fill={stroke} />
    </svg>
  );
};
