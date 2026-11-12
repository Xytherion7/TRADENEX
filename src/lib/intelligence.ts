import type { Candle } from './types';
import { atr, ema, macd, rsi } from './indicators';

export interface IntelligenceMetric {
  label: string;
  value: string;
  tone: 'positive' | 'negative' | 'neutral';
  note: string;
}

export interface MarketBrief {
  symbol: string;
  intervalLabel: string;
  classification: 'Positive alignment' | 'Negative alignment' | 'Mixed conditions' | 'Insufficient history';
  summary: string;
  metrics: IntelligenceMetric[];
  evidence: string[];
  cautions: string[];
  candleCount: number;
  generatedAt: number;
}

const fmt = (value: number, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';

/** Deterministic, transparent market-context rules. This is not a generative AI forecast. */
export function buildMarketBrief(symbol: string, intervalLabel: string, input: Candle[]): MarketBrief {
  const candles = input.filter((candle) => candle.closed !== false);
  const base: MarketBrief = {
    symbol,
    intervalLabel,
    classification: 'Insufficient history',
    summary: 'Not enough completed candles are available to build a stable context snapshot.',
    metrics: [],
    evidence: [],
    cautions: ['This is descriptive market research, not a buy/sell instruction or a price forecast.'],
    candleCount: candles.length,
    generatedAt: Date.now(),
  };
  if (candles.length < 60) return base;

  const closes = candles.map((candle) => candle.close);
  const last = candles[candles.length - 1];
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const rsiSeries = rsi(closes, 14);
  const atrSeries = atr(candles, 14);
  const macdSeries = macd(closes);
  const ema20 = ema20Series.at(-1) ?? null;
  const ema50 = ema50Series.at(-1) ?? null;
  const currentRsi = rsiSeries.at(-1) ?? null;
  const currentAtr = atrSeries.at(-1) ?? null;
  const currentMacd = macdSeries.at(-1) ?? null;
  const previousVolumes = candles.slice(-21, -1).map((candle) => candle.volume);
  const meanVolume = previousVolumes.reduce((sum, value) => sum + value, 0) / Math.max(previousVolumes.length, 1);
  const relativeVolume = meanVolume > 0 ? last.volume / meanVolume : null;
  const rangeCandles = candles.slice(-20);
  const rangeHigh = Math.max(...rangeCandles.map((candle) => candle.high));
  const rangeLow = Math.min(...rangeCandles.map((candle) => candle.low));
  const rangePosition = rangeHigh > rangeLow ? ((last.close - rangeLow) / (rangeHigh - rangeLow)) * 100 : 50;
  const atrPct = currentAtr !== null ? (currentAtr / last.close) * 100 : null;
  const macdHistogram = currentMacd?.histogram ?? null;
  const positiveTrend = ema20 !== null && ema50 !== null && last.close > ema20 && ema20 > ema50;
  const negativeTrend = ema20 !== null && ema50 !== null && last.close < ema20 && ema20 < ema50;
  const positiveMomentum = macdHistogram !== null && macdHistogram > 0;
  const negativeMomentum = macdHistogram !== null && macdHistogram < 0;

  const classification = positiveTrend && positiveMomentum
    ? 'Positive alignment'
    : negativeTrend && negativeMomentum
      ? 'Negative alignment'
      : 'Mixed conditions';

  const evidence: string[] = [];
  if (ema20 !== null && ema50 !== null) {
    evidence.push(`Price ${last.close > ema20 ? 'is above' : 'is below'} EMA 20; EMA 20 is ${ema20 > ema50 ? 'above' : 'below'} EMA 50.`);
  }
  if (currentRsi !== null) evidence.push(`RSI (14) is ${fmt(currentRsi, 1)}; this describes recent momentum and can remain elevated or subdued in persistent moves.`);
  if (macdHistogram !== null) evidence.push(`MACD histogram is ${macdHistogram >= 0 ? 'positive' : 'negative'} (${fmt(macdHistogram, 5)}), relative to its signal line.`);
  if (relativeVolume !== null) evidence.push(`Latest completed-bar volume is ${fmt(relativeVolume, 2)}× the mean of the previous 20 bars.`);
  if (rangePosition >= 80) evidence.push(`Price is in the upper ${fmt(100 - rangePosition, 0)}% of its recent 20-bar range.`);
  else if (rangePosition <= 20) evidence.push(`Price is in the lower ${fmt(rangePosition, 0)}% of its recent 20-bar range.`);
  else evidence.push(`Price is around the middle of its recent 20-bar range (${fmt(rangePosition, 0)}th percentile).`);

  const cautions: string[] = ['Indicator agreement is not predictive proof. The same conditions can precede continuation, consolidation or reversal.'];
  if (currentRsi !== null && (currentRsi >= 70 || currentRsi <= 30)) {
    cautions.push(`RSI is in an extreme zone (${fmt(currentRsi, 1)}); extreme readings are not automatic reversal signals.`);
  }
  if (relativeVolume !== null && relativeVolume < 0.5) cautions.push('Latest-bar activity is notably below its recent average; thin activity can make context less informative.');
  if (atrPct !== null && atrPct >= 4) cautions.push(`ATR is ${fmt(atrPct, 2)}% of price, indicating comparatively wide recent ranges for this instrument and timeframe.`);

  const summary = classification === 'Positive alignment'
    ? 'The selected trend and momentum measures currently point in the same positive direction. This is a description of the sampled history, not a forecast.'
    : classification === 'Negative alignment'
      ? 'The selected trend and momentum measures currently point in the same negative direction. This is a description of the sampled history, not a forecast.'
      : 'Trend and momentum measures are not fully aligned. The current snapshot is mixed, so no single directional label captures the available evidence.';

  return {
    ...base,
    classification,
    summary,
    metrics: [
      { label: 'EMA structure', value: positiveTrend ? 'Positive' : negativeTrend ? 'Negative' : 'Mixed', tone: positiveTrend ? 'positive' : negativeTrend ? 'negative' : 'neutral', note: 'Close vs EMA 20 and EMA 20 vs EMA 50' },
      { label: 'RSI (14)', value: currentRsi === null ? '—' : fmt(currentRsi, 1), tone: currentRsi !== null && currentRsi >= 50 ? 'positive' : currentRsi !== null && currentRsi < 50 ? 'negative' : 'neutral', note: currentRsi !== null && currentRsi >= 70 ? 'Upper momentum zone' : currentRsi !== null && currentRsi <= 30 ? 'Lower momentum zone' : 'Middle momentum range' },
      { label: 'MACD histogram', value: macdHistogram === null ? '—' : fmt(macdHistogram, 5), tone: positiveMomentum ? 'positive' : negativeMomentum ? 'negative' : 'neutral', note: 'MACD minus signal line' },
      { label: 'ATR / Price', value: atrPct === null ? '—' : `${fmt(atrPct, 2)}%`, tone: 'neutral', note: 'Recent range as a share of price' },
      { label: 'Relative volume', value: relativeVolume === null ? '—' : `${fmt(relativeVolume, 2)}×`, tone: relativeVolume !== null && relativeVolume >= 1.5 ? 'positive' : 'neutral', note: 'Latest bar vs prior 20-bar mean' },
      { label: '20-bar range position', value: `${fmt(rangePosition, 0)}%`, tone: rangePosition >= 80 ? 'positive' : rangePosition <= 20 ? 'negative' : 'neutral', note: 'Position between recent high and low' },
    ],
    evidence,
    cautions,
    generatedAt: Date.now(),
  };
}
