import { useMemo } from 'react';
import type { EquityPoint } from '../lib/indicators';

export function EquityCurve({ points }: { points: EquityPoint[] }) {
  const model = useMemo(() => {
    if (points.length < 2) return null;
    const visible = points.slice(-240);
    const values = visible.map((point) => point.equity);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.12, 0.25);
    const low = min - padding;
    const high = max + padding;
    const x = (index: number) => 8 + (index / (visible.length - 1)) * 984;
    const y = (value: number) => 12 + ((high - value) / (high - low)) * 176;
    const path = visible.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(2)} ${y(point.equity).toFixed(2)}`).join(' ');
    const area = `${path} L 992 190 L 8 190 Z`;
    return { path, area, first: visible[0], last: visible[visible.length - 1], min, max };
  }, [points]);

  if (!model) return <div className="equity-empty">Run a simulation with enough history to plot the equity curve.</div>;

  return (
    <div className="equity-curve-wrap">
      <div className="equity-meta"><span>START <strong>{model.first.equity.toFixed(2)}</strong></span><span>END <strong>{model.last.equity.toFixed(2)}</strong></span><span>RANGE <strong>{model.min.toFixed(2)}–{model.max.toFixed(2)}</strong></span></div>
      <svg viewBox="0 0 1000 200" role="img" aria-label="Backtest mark-to-market equity curve" className="equity-curve">
        <defs><linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#42d5bd" stopOpacity=".24"/><stop offset="100%" stopColor="#42d5bd" stopOpacity="0"/></linearGradient></defs>
        {[48, 94, 140, 188].map((y) => <line key={y} x1="8" x2="992" y1={y} y2={y} className="equity-grid"/>)}
        <path d={model.area} fill="url(#equityFill)"/>
        <path d={model.path} fill="none" stroke="#53d9c3" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>
      </svg>
      <div className="equity-caption">Compounded equity index · 100 = starting capital · mark-to-market at completed candle closes</div>
    </div>
  );
}
