import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../lib/types';
import { ema } from '../lib/indicators';

interface Props {
  candles: Candle[];
  loading?: boolean;
}

interface HoveredBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const priceLabel = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000) return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(4);
  return value.toPrecision(5);
};

const timeLabel = (seconds: number) => new Date(seconds * 1000).toLocaleString('en-GB', {
  year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
});

export function CandleChart({ candles, loading = false }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setChartDataRef = useRef<((
    bars: CandlestickData<UTCTimestamp>[],
    volumes: HistogramData<UTCTimestamp>[],
    fast: LineData<UTCTimestamp>[],
    slow: LineData<UTCTimestamp>[],
  ) => void) | null>(null);
  const hasInitialDataRef = useRef(false);
  const [hovered, setHovered] = useState<HoveredBar | null>(null);

  const chartData = useMemo(() => {
    const valid = candles.filter((item) =>
      Number.isFinite(item.time) && item.time > 0 &&
      Number.isFinite(item.open) && Number.isFinite(item.high) &&
      Number.isFinite(item.low) && Number.isFinite(item.close) &&
      Number.isFinite(item.volume) && item.open > 0 && item.high >= item.low &&
      item.high >= Math.max(item.open, item.close) && item.low <= Math.min(item.open, item.close),
    );
    const closes = valid.map((item) => item.close);
    const fast = ema(closes, 9);
    const slow = ema(closes, 21);
    const bars: CandlestickData<UTCTimestamp>[] = valid.map((item) => ({
      time: item.time as UTCTimestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }));
    const volumes: HistogramData<UTCTimestamp>[] = valid.map((item) => ({
      time: item.time as UTCTimestamp,
      value: Math.max(0, item.volume),
      color: item.close >= item.open ? 'rgba(57, 201, 154, .46)' : 'rgba(241, 111, 121, .42)',
    }));
    const fastLine: LineData<UTCTimestamp>[] = valid.flatMap((item, index) =>
      fast[index] === null ? [] : [{ time: item.time as UTCTimestamp, value: fast[index] as number }],
    );
    const slowLine: LineData<UTCTimestamp>[] = valid.flatMap((item, index) =>
      slow[index] === null ? [] : [{ time: item.time as UTCTimestamp, value: slow[index] as number }],
    );
    return { bars, volumes, fastLine, slowLine, last: valid.at(-1) ?? null };
  }, [candles]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // React StrictMode can replay mount effects in development; a new chart needs its own first-fit.
    hasInitialDataRef.current = false;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0b1421' },
        textColor: '#8293a8',
        fontFamily: 'Inter, Segoe UI, sans-serif',
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: 'rgba(139,164,195,.075)' },
        horzLines: { color: 'rgba(139,164,195,.095)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(112, 174, 190, .42)', width: 1, style: 2, labelBackgroundColor: '#1d3446' },
        horzLine: { color: 'rgba(112, 174, 190, .42)', width: 1, style: 2, labelBackgroundColor: '#1d3446' },
      },
      rightPriceScale: {
        borderColor: 'rgba(139,164,195,.16)',
        scaleMargins: { top: 0.08, bottom: 0.24 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(139,164,195,.16)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        minBarSpacing: 2,
        ticksVisible: true,
      },
      localization: {
        priceFormatter: priceLabel,
        timeFormatter: (time: Time) => {
          if (typeof time === 'number') return timeLabel(time);
          if (typeof time === 'string') return time;
          return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#39c99a',
      downColor: '#f16f79',
      borderUpColor: '#39c99a',
      borderDownColor: '#f16f79',
      wickUpColor: '#39c99a',
      wickDownColor: '#f16f79',
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: 'rgba(83,217,195,.65)',
      priceLineStyle: 2,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    const fastSeries = chart.addSeries(LineSeries, {
      color: '#f0bd65',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: 'EMA 9',
    });
    const slowSeries = chart.addSeries(LineSeries, {
      color: '#ad91ff',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: 'EMA 21',
    });

    let lastBarCount = 0;
    setChartDataRef.current = (bars, volumes, fast, slow) => {
      const visibleRange = chart.timeScale().getVisibleLogicalRange();
      const wasFollowingLatest = visibleRange !== null && visibleRange.to >= lastBarCount - 2;
      candleSeries.setData(bars);
      volumeSeries.setData(volumes);
      fastSeries.setData(fast);
      slowSeries.setData(slow);
      if (!hasInitialDataRef.current && bars.length) {
        chart.timeScale().fitContent();
        hasInitialDataRef.current = true;
      } else if (wasFollowingLatest) {
        chart.timeScale().scrollToRealTime();
      } else if (visibleRange) {
        try { chart.timeScale().setVisibleLogicalRange(visibleRange); } catch { /* New history may have changed the available range. */ }
      }
      lastBarCount = bars.length;
    };

    chart.subscribeCrosshairMove((parameter) => {
      const point = parameter.seriesData.get(candleSeries) as CandlestickData<UTCTimestamp> | undefined;
      if (!point || typeof point.time !== 'number') {
        setHovered(null);
        return;
      }
      setHovered({ time: point.time, open: point.open, high: point.high, low: point.low, close: point.close });
    });

    return () => {
      setChartDataRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    setChartDataRef.current?.(chartData.bars, chartData.volumes, chartData.fastLine, chartData.slowLine);
  }, [chartData]);

  return (
    <div className="chart-wrap">
      <div className="chart-readout" aria-live="polite">
        {hovered ? <>
          <span>{timeLabel(hovered.time)}</span>
          <span>O <b>{priceLabel(hovered.open)}</b></span>
          <span>H <b>{priceLabel(hovered.high)}</b></span>
          <span>L <b>{priceLabel(hovered.low)}</b></span>
          <span>C <b>{priceLabel(hovered.close)}</b></span>
        </> : chartData.last ? <>
          <span>{chartData.last.closed === false ? 'LIVE / FORMING BAR' : 'LAST COMPLETED BAR'}</span>
          <span>O <b>{priceLabel(chartData.last.open)}</b></span>
          <span>H <b>{priceLabel(chartData.last.high)}</b></span>
          <span>L <b>{priceLabel(chartData.last.low)}</b></span>
          <span>C <b>{priceLabel(chartData.last.close)}</b></span>
        </> : <span>{loading ? 'Loading market candles…' : 'No candle data available.'}</span>}
      </div>
      <div ref={containerRef} className="lwc-chart" role="img" aria-label="Interactive candlestick chart with EMA 9, EMA 21, volume and crosshair" />
      <div className="chart-legend">
        <span><i className="legend-dot ema-fast"/> EMA 9</span>
        <span><i className="legend-dot ema-slow"/> EMA 21</span>
        <span><i className="legend-dot volume"/> Volume</span>
        <span className="chart-disclaimer">Scroll to zoom · drag to pan · crosshair for OHLC</span>
      </div>
      {loading && <div className="chart-loading-indicator"><span className="spinner"/> Updating candle history…</div>}
    </div>
  );
}
