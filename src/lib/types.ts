export type MarketKind = 'crypto' | 'stock';
export type Interval = '15m' | '1h' | '4h' | '1d' | '1w';
export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface Ticker {
  symbol: string;
  label: string;
  market: MarketKind;
  /** ISO 4217 currency code for stock quotes, when supplied by the provider. */
  currency?: string;
  price: number;
  changePct: number;
  high24h?: number;
  low24h?: number;
  volume?: number;
  quoteVolume?: number;
  updatedAt: number;
}

export interface Candle {
  /** Unix timestamp in seconds at the candle open. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** False when the provider says this candle is still forming. */
  closed?: boolean;
}

export interface DataResult<T> {
  data: T;
  source: string;
  updatedAt: number;
}

export interface JournalEntry {
  id: string;
  title: string;
  body: string;
  symbol: string;
  createdAt: number;
}
